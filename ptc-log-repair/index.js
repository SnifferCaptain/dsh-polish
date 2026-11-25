/**
 * PTC 日志自愈（组件 P）：打开历史时报「PTC dispatch repeats subCallId」
 * 导致整场会话不可读时，把后一次执行占用的 tool-call id 整组改名后重开。
 *
 * 背景：模型复用了同一个 tool-call id（典型场景：/rewind 或 compaction 后
 * 模型上下文被截断，local 计数器从 run_code_1 重新数起），写入端不查重、
 * 追加成功，但读端 assertReleasedV4Relationships 用一张全会话不清空的
 * dispatches 表，遇到重复的 subCallId start 就判整份日志 corrupt。
 * codec 单例在闭包里 freeze，插件无法替换校验器；正确定位是在读端校验
 * 之前把日志改写成它能接受的形态（id 唯一化），只改数据、语义等价。
 *
 * 行为：
 *   方案 A（打开时自愈，本组件主体）：包装 ctx.sessionPersistence.open——
 *     读（打开历史）与写（断点续跑）共用的唯一入口。只捕获
 *     SessionPersistenceCorruptionError 且含「PTC dispatch repeats
 *     subCallId」的错误，从 message 的 (raw log: ...) 取出路径，修复后
 *     只重试一次；修不动或其他损坏原样抛出，绝不吞错。
 *   方案 B（启动全量体检，默认关）：fullScanOnStart 打开后，启动 5 秒
 *     后台扫描 sessions 根目录（默认 ~/.dsh/sessions），并发 4，只碰
 *     maxAgeDays 天内修改过的日志，赶在用户点开之前先修好。
 *
 * 落盘安全：同目录临时文件 → 原子 rename；覆盖前备份成
 *   session.v4.jsonl.zstd.corrupt-<时间戳>（每个会话最多留 3 份，且只留 7 天，
 *   超期的在下次修复或启动清扫时删除）；文件被占用
 *   时放弃并原样抛错，不留半成品。健康文件零改动（不重压、不动 mtime），
 *   重复修复第二次 no-op。
 *
 * 总开关 = 本行的 Loader 行开关（served/off）：cordis.patch.yml 里本行
 * 默认 `disabled: true`（防止新组件暴死影响历史加载），行开即启用。
 * 配置项（行 detail 页）：fullScanOnStart / maxAgeDays / root /
 * scanConcurrency，均 volatile，改动即时生效、不落盘。
 */

import fs from 'node:fs'
import path from 'node:path'
import { repairFile, sweepBackups } from './repair.js'

const CORRUPTION_MARKER = 'PTC dispatch repeats subCallId'
const RAW_LOG_RE = /\(raw log: (.+?)\)\s*$/

/** True only for the exact corruption this component knows how to fix. */
function isPtcDup(error) {
  if (error == null) return false
  const text = String(error.cause ?? error)
  const message = String(error.message ?? error)
  return text.includes(CORRUPTION_MARKER) || message.includes(CORRUPTION_MARKER)
}

/** Pull the raw-log path out of the wrapped error message. */
function rawLogPath(error) {
  const message = String(error?.message ?? error)
  const match = RAW_LOG_RE.exec(message)
  return match ? match[1] : undefined
}

function* walkSessions(root) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) yield* walkSessions(full)
    else if (entry.name === 'session.v4.jsonl.zstd') yield full
  }
}

export const inject = ['sessionPersistence']

const DEFAULTS = {
  fullScanOnStart: false,
  maxAgeDays: 30,
  root: undefined,
  scanConcurrency: 4,
}

// Minimal Standard Schema validator (cordis calls Config["~standard"].validate).
// No external dependency: returns { value } with defaults applied, or { issues }.
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-polish-ptc-log-repair',
    validate(config) {
      const value = { ...DEFAULTS, ...(config ?? {}) }
      const issues = []
      if (typeof value.fullScanOnStart !== 'boolean') issues.push({ message: 'fullScanOnStart must be a boolean', path: ['fullScanOnStart'] })
      if (typeof value.maxAgeDays !== 'number' || value.maxAgeDays < 0) issues.push({ message: 'maxAgeDays must be a non-negative number', path: ['maxAgeDays'] })
      if (value.root !== undefined && typeof value.root !== 'string') issues.push({ message: 'root must be a string', path: ['root'] })
      if (typeof value.scanConcurrency !== 'number' || value.scanConcurrency < 1) issues.push({ message: 'scanConcurrency must be a positive number', path: ['scanConcurrency'] })
      return issues.length > 0 ? { issues } : { value }
    },
  },
}

export function apply(ctx, config = DEFAULTS) {
  const target = ctx.sessionPersistence
  const original = target.open.bind(target)
  const logger = ctx.logger

  target.open = async function open(id, access, options) {
    try {
      return await original(id, access, options)
    } catch (error) {
      if (!isPtcDup(error)) throw error
      const logPath = rawLogPath(error)
      if (logPath === undefined) throw error
      logger.warn(`[ptc-log-repair] session "${id}": repairing repeated PTC subCallId in ${logPath}`)
      const report = repairFile(logPath)
      if (!report.changed) {
        logger.warn(`[ptc-log-repair] session "${id}": repair not applicable (${report.reason})`)
        throw error
      }
      logger.info(`[ptc-log-repair] session "${id}": renamed ${report.renamed.map(([a, b]) => `${a}→${b}`).join(', ')}; backup at ${report.backup}`)
      return await original(id, access, options)
    }
  }
  ctx.effect(() => () => {
    target.open = original
  }, 'ptc-log-repair: restore sessionPersistence.open')

  // 备份保留策略：启动 5 秒后清一次过期的 .corrupt-* 备份（与 fullScanOnStart 无关，
  // 只做目录名检查，不读文件内容）。
  const sweepRoot = config?.root ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'sessions')
  const sweepTimer = setTimeout(() => {
    try {
      sweepBackups(sweepRoot)
    } catch (error) {
      logger.warn(`[ptc-log-repair] backup sweep failed: ${String(error)}`)
    }
  }, 5000)
  ctx.effect(() => () => clearTimeout(sweepTimer), 'ptc-log-repair: cancel backup sweep')

  if (config?.fullScanOnStart) {
    const root = config.root ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'sessions')
    const maxAgeMs = (config.maxAgeDays ?? 30) > 0 ? (config.maxAgeDays ?? 30) * 24 * 3600 * 1000 : Infinity
    const concurrency = Math.max(1, Math.min(8, config.scanConcurrency ?? 4))
    // 卸载时置位：扫描每处理一个文件检查一次，避免卸载后仍在跑。
    let stopped = false
    const timer = setTimeout(() => {
      void (async () => {
        const candidates = []
        for (const file of walkSessions(root)) {
          try {
            if (Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) continue
          } catch {
            continue
          }
          candidates.push(file)
        }
        logger.info(`[ptc-log-repair] startup scan: ${candidates.length} log(s) under ${root}`)
        let repaired = 0
        let skipped = 0
        let cursor = 0
        async function worker() {
          while (!stopped && cursor < candidates.length) {
            const file = candidates[cursor++]
            const report = repairFile(file)
            if (report.changed) {
              repaired++
              logger.info(`[ptc-log-repair] repaired ${file}: ${report.renamed.map(([a, b]) => `${a}→${b}`).join(', ')}`)
            } else if (report.reason !== 'no repeated subCallId') {
              skipped++
              logger.warn(`[ptc-log-repair] skipped ${file}: ${report.reason}`)
            }
            // 让出事件循环：repairFile 是同步 IO，连续处理会卡住宿主。
            await new Promise((resolve) => setImmediate(resolve))
          }
        }
        await Promise.all(Array.from({ length: concurrency }, worker))
        logger.info(`[ptc-log-repair] startup scan done: ${repaired} repaired, ${skipped} skipped`)
      })().catch((error) => logger.warn(`[ptc-log-repair] startup scan failed: ${String(error)}`))
    }, 5000)
    ctx.effect(() => () => {
      stopped = true
      clearTimeout(timer)
    }, 'ptc-log-repair: cancel startup scan')
  }
}
