// Repair the "PTC dispatch repeats subCallId" corruption in a stored v4
// session log. Ported from tools/repair-ptc-dup.mjs (verified against real
// corrupt samples) with the frame-splitting hardening from
// tools/scan-session-ptc-dups.mjs (empty frames, magic inside payloads).
//
// Invariants honoured here (see the requirement spec, section 6.5):
//   * never delete or reorder events; seq stays dense
//   * only the *later* execution is renamed, earlier records untouched
//   * later content updates (surface replacements) of a renamed result node
//     are renamed with it — the codec allows a tool/result replacement to
//     change only content, so its toolCallId must track the node's
//   * untouched frames keep their exact compressed bytes
//   * healthy input is a no-op (no write at all)
//   * running the repair twice is a no-op
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const MAX_TRIES = 64

/**
 * Decode the log into frames. A compressed payload can contain the magic byte
 * sequence, so a candidate range is accepted only when it decodes to records
 * ending on a newline (or is an empty frame, which DSH writes for empty
 * append batches); otherwise the range is extended to the next candidate.
 */
function readLog(buf) {
  const starts = []
  for (let i = buf.indexOf(MAGIC, 0); i !== -1; i = buf.indexOf(MAGIC, i + 4)) starts.push(i)
  const frames = []
  let i = 0
  while (i < starts.length) {
    const start = starts[i]
    let text
    let used = -1
    for (const limit of [MAX_TRIES, Infinity]) {
      for (let j = i + 1; j <= starts.length && j - i <= limit; j++) {
        const end = j < starts.length ? starts[j] : buf.length
        let candidate
        try {
          candidate = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
        } catch {
          continue
        }
        const atEnd = j === starts.length
        if (candidate === '' || candidate.endsWith('\n') || (atEnd && candidate.length > 0)) {
          text = candidate
          used = j
          break
        }
      }
      if (text !== undefined) break
    }
    if (text === undefined) throw new Error(`no decodable frame boundary at offset ${start}`)
    const rows = []
    let cursor = 0
    while (cursor < text.length) {
      const nl = text.indexOf('\n', cursor)
      if (nl === -1) break
      const raw = text.slice(cursor, nl)
      if (raw.trim() !== '') rows.push({ raw, frame: frames.length, event: JSON.parse(raw) })
      cursor = nl + 1
    }
    frames.push({ index: frames.length, start, end: used < starts.length ? starts[used] : buf.length, rows })
    i = used
  }
  return { buf, frames, rows: frames.flatMap((frame) => frame.rows) }
}

/** Find every subCallId that started more than once. Returns Map<id, {first, row}> keyed by id. */
function findDuplicates(events) {
  const firstStart = new Map()
  const dups = new Map()
  for (const row of events) {
    if (row.event.type !== 'tool/ptc-dispatch-start') continue
    const id = row.event.data?.subCallId
    if (typeof id !== 'string') continue
    if (firstStart.has(id)) {
      if (!dups.has(id)) dups.set(id, { first: firstStart.get(id), rows: [] })
      dups.get(id).rows.push(row)
    } else {
      firstStart.set(id, row.event.seq)
    }
  }
  return dups
}

/**
 * Delimit one later execution: the assistant message advertising the tool
 * call, the tool/call itself, the PTC dispatch records, and the tool/result.
 * Only records strictly belonging to this execution are rewritten.
 */
function delimitExecution(events, dupRow, rootId) {
  const dupIndex = events.indexOf(dupRow)
  let callIndex = -1
  for (let i = dupIndex - 1; i >= 0; i--) {
    const event = events[i].event
    if (event.type === 'tool/call' && event.data?.callId === rootId) { callIndex = i; break }
  }
  let advertiseIndex = -1
  for (let i = (callIndex >= 0 ? callIndex : dupIndex) - 1; i >= 0; i--) {
    const event = events[i].event
    if (event.type !== 'assistant/message') continue
    const blocks = event.data?.message?.content ?? []
    if (blocks.some((block) => block?.type === 'tool-call' && block.id === rootId)) { advertiseIndex = i; break }
  }
  let resultIndex = -1
  for (let i = dupIndex + 1; i < events.length; i++) {
    const event = events[i].event
    if (event.type === 'tool/result' && event.data?.message?.toolCallId === rootId) { resultIndex = i; break }
  }
  if (callIndex < 0 || resultIndex < 0) return undefined
  const from = advertiseIndex >= 0 ? advertiseIndex : callIndex
  return events.slice(from, resultIndex + 1)
}

/**
 * A tool/result surface replacement may change only the target node's
 * message content, so every later content update of a renamed node must be
 * renamed with it. The group above ends at the FIRST tool/result of the
 * execution, but DSH may update that result later: a subsequent tool/result
 * whose surfaceOp replaces exactly one surface node keeps the same
 * toolCallId and must stay in lockstep with the node it shadows.
 *
 * Collects the group's append-origin surface nodes, then follows the
 * replacement chain to a fixpoint: any later tool/result whose replace range
 * covers exactly one node of the chain (the original node or an earlier
 * update) belongs to the same logical result and is included.
 */
function extendWithLateReplacements(events, group) {
  const lastSeq = group[group.length - 1].event.seq
  const chainSeqs = new Set()
  for (const row of group) if (row.event.surfaceOp === 'append') chainSeqs.add(row.event.seq)
  const extra = []
  let grew = true
  while (grew) {
    grew = false
    for (const row of events) {
      const event = row.event
      if (event.seq <= lastSeq) continue
      if (event.type !== 'tool/result') continue
      const op = event.surfaceOp
      if (op === null || typeof op !== 'object' || op.op !== 'replace') continue
      if (op.startSeq !== op.endSeq) continue
      if (chainSeqs.has(op.startSeq) && !extra.includes(row)) {
        extra.push(row)
        chainSeqs.add(event.seq)
        grew = true
      }
    }
  }
  return [...group, ...extra]
}

/**
 * Repair one log buffer. Returns { changed, out, renamed } where `out` is the
 * new file contents (identical reference to `buf` when changed is false) and
 * `renamed` lists every "old -> new" id applied.
 */
export function repairBuffer(buf) {
  const { frames, rows } = readLog(buf)
  const events = rows.filter((row) => row.event.seq !== undefined)
  const dups = findDuplicates(events)
  if (dups.size === 0) return { changed: false, out: buf, renamed: [] }

  const plaintext = rows.map((row) => row.raw).join('\n')
  // Ids assigned by earlier passes of THIS run. `plaintext` is computed once
  // (it only guards against ids that already exist in the log, e.g. from an
  // earlier repair pass), so a third reuse of the same root call would be
  // offered the same `rootIdr2` twice without this set — two executions
  // landing on one id keeps the duplicate and the round-trip check refuses.
  const assigned = new Set()
  const touched = new Set()
  const renamed = []

  for (const [, dup] of dups) {
    for (const dupRow of dup.rows) {
      const rootId = dupRow.event.data?.rootCallId
      if (typeof rootId !== 'string') throw new Error(`repeated dispatch without rootCallId at seq ${dupRow.event.seq}`)
      const group = delimitExecution(events, dupRow, rootId)
      if (group === undefined) {
        throw new Error(`could not delimit the later execution of ${rootId} (seq ${dupRow.event.seq}); refusing`)
      }
      let newId
      for (let n = 2; ; n++) {
        const candidate = `${rootId}r${n}`
        if (!plaintext.includes(candidate) && !assigned.has(candidate)) { newId = candidate; break }
      }
      assigned.add(newId)
      const renameSet = extendWithLateReplacements(events, group)
      const patterns = [
        [`{"type":"tool-call","id":"${rootId}"`, `{"type":"tool-call","id":"${newId}"`],
        [`"callId":"${rootId}"`, `"callId":"${newId}"`],
        [`"toolCallId":"${rootId}"`, `"toolCallId":"${newId}"`],
        [`"rootCallId":"${rootId}"`, `"rootCallId":"${newId}"`],
        [`"parentCallId":"${rootId}"`, `"parentCallId":"${newId}"`],
        [`"subCallId":"${rootId}:ptc:`, `"subCallId":"${newId}:ptc:`],
      ]
      let rewritten = 0
      for (const row of renameSet) {
        let raw = row.raw
        for (const [needle, replacement] of patterns) raw = raw.split(needle).join(replacement)
        if (raw === row.raw) continue
        const event = JSON.parse(raw)
        const leftovers = patterns.map(([needle]) => needle)
        const text = JSON.stringify(event)
        const left = leftovers.find((needle) => text.includes(needle))
        if (left !== undefined) throw new Error(`seq ${row.event.seq}: rewrite incomplete (${left}); refusing`)
        row.raw = raw
        row.event = event
        touched.add(row.frame)
        rewritten++
      }
      if (rewritten === 0) throw new Error(`no record matched ${rootId}; unexpected log shape`)
      renamed.push([rootId, newId])
    }
  }

  // Recompress only the touched frames; copy every other frame byte-for-byte.
  const chunks = []
  let cursor = 0
  for (const frame of frames) {
    if (!touched.has(frame.index)) continue
    const plain = Buffer.from(frame.rows.map((row) => `${row.raw}\n`).join(''), 'utf8')
    chunks.push(buf.subarray(cursor, frame.start))
    chunks.push(zlib.zstdCompressSync(plain))
    cursor = frame.end
  }
  chunks.push(buf.subarray(cursor))
  const out = Buffer.concat(chunks)

  // Round-trip self-check: density + uniqueness on the written bytes.
  const check = readLog(out)
  const checkEvents = check.rows.filter((row) => row.event.seq !== undefined)
  if (checkEvents.length !== events.length) throw new Error(`record count changed: ${events.length} -> ${checkEvents.length}`)
  if (!checkEvents.every((row, index) => row.event.seq === index)) throw new Error('repaired log is not dense')
  if (findDuplicates(checkEvents).size !== 0) throw new Error('repaired log still repeats a subCallId')

  return { changed: true, out, renamed }
}

// Retention for `.corrupt-*` backups: at most BACKUP_KEEP per session log, and
// none older than BACKUP_MAX_AGE_MS. A backup is the pre-repair bytes of one
// log, kept only for diagnosis or rollback. The repair itself is semantic
// (renames only), so the backup has no further use after the retention window.
const BACKUP_KEEP = 3
const BACKUP_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const BACKUP_TIME_RE = /\.corrupt-(\d{8})-(\d{6})(\d{3})$/

/** Epoch ms of a backup, read from its name; falls back to the file mtime. */
function backupTime(dir, name) {
  const m = BACKUP_TIME_RE.exec(name)
  if (m) {
    const [d, t, ms] = [m[1], m[2], m[3]]
    return new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6), +ms).getTime()
  }
  try { return fs.statSync(path.join(dir, name)).mtimeMs } catch { return NaN }
}

/**
 * Delete the `.corrupt-*` backups of `logPath` that are beyond the newest
 * BACKUP_KEEP or older than BACKUP_MAX_AGE_MS. Best effort: a failed delete is
 * skipped and retried at the next prune.
 */
function pruneBackups(logPath, now = Date.now()) {
  const dir = path.dirname(logPath)
  const base = path.basename(logPath)
  let names
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(`${base}.corrupt-`)).sort()
  } catch {
    return
  }
  const doomed = new Set(names.slice(0, Math.max(0, names.length - BACKUP_KEEP)))
  for (const name of names) {
    const t = backupTime(dir, name)
    if (Number.isFinite(t) && now - t > BACKUP_MAX_AGE_MS) doomed.add(name)
  }
  for (const stale of doomed) {
    try { fs.unlinkSync(path.join(dir, stale)) } catch { /* best effort */ }
  }
}

/**
 * Apply the retention rule to every session under `root`. Walks directories
 * once and only looks at names, so the cost is one readdir per session folder.
 */
export function sweepBackups(root, now = Date.now()) {
  const visit = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    const logs = new Set()
    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(dir, entry.name))
      else if (entry.isFile() && entry.name.includes('.corrupt-')) logs.add(path.join(dir, entry.name.slice(0, entry.name.indexOf('.corrupt-'))))
    }
    for (const logPath of logs) pruneBackups(logPath, now)
  }
  visit(root)
}

function timestamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`
}

/**
 * Repair the log at `logPath` in place, atomically. Backs the original up as
 * `<file>.corrupt-<timestamp>` first. Refuses (returns { changed:false,
 * reason }) when the file is healthy, busy, or not repairable — callers must
 * then rethrow the original error.
 */
export function repairFile(logPath) {
  let buf
  try {
    buf = fs.readFileSync(logPath)
  } catch (error) {
    return { changed: false, reason: `unreadable: ${error.message}` }
  }
  let result
  try {
    result = repairBuffer(buf)
  } catch (error) {
    return { changed: false, reason: error.message }
  }
  if (!result.changed) return { changed: false, reason: 'no repeated subCallId' }

  const dir = path.dirname(logPath)
  const backup = `${logPath}.corrupt-${timestamp()}`
  const tmp = path.join(dir, `.ptc-repair-${process.pid}-${Date.now()}.tmp`)
  try {
    fs.copyFileSync(logPath, backup)
    fs.writeFileSync(tmp, result.out)
    fs.renameSync(tmp, logPath)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch { /* already gone or never created */ }
    return { changed: false, reason: `write failed (${error.code ?? error.message}); original left untouched` }
  }
  pruneBackups(logPath)
  return { changed: true, renamed: result.renamed, backup }
}
