// Pure JSONC reference-table loader shared by the Host (served via the lazy
// GET route) and the tests. No dependencies, no I/O.

/** Strip line and block comments from JSONC, string-aware. */
export function stripJsonc(src) {
  let out = ''
  let inStr = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += n === undefined ? '' : n
        i++
      } else if (c === '"') inStr = false
      continue
    }
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && n === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && n === '*') {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  return out
}

/** Model names match case-insensitively with `-`, `.` and spaces ignored. */
export function normalizeModelName(value) {
  return String(value === undefined || value === null ? '' : value).normalize('NFKC').toLowerCase().replace(/[.\-\s]/g, '')
}

/**
 * Parse the JSONC reference file. Forward-compatible by design (the table is
 * maintained by hand, e.g. on GitHub): unknown fields are dropped, unknown
 * rows are accepted, a row without an `id` is skipped, and a key claimed by
 * two different rows is ambiguous — dropped, never guessed.
 *
 * Entry shape (all optional except `id`):
 *   { id, name?, aliases?, provider?, api?,
 *     contextWindow?, maxTokens?, image?, audio?,
 *     thinking?: { scheme: 'levels'|'budget'|'none', levels?: [{level, wire?}], min?, max?, default? },
 *     price?: { input?, output?, cacheRead?, cacheWrite?, currency?, unit?, source? } }
 */
export function parseReferenceFile(text) {
  const parsed = JSON.parse(stripJsonc(text))
  const models = Array.isArray(parsed.models) ? parsed.models : Array.isArray(parsed) ? parsed : []
  const claims = Object.create(null)
  for (const entry of models) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) continue
    const compact = { id }
    if (typeof entry.name === 'string' && entry.name.trim()) compact.name = entry.name.trim()
    if (Number.isFinite(entry.contextWindow)) compact.contextWindow = entry.contextWindow
    if (Number.isFinite(entry.maxTokens)) compact.maxTokens = entry.maxTokens
    if (typeof entry.image === 'boolean') compact.image = entry.image
    if (typeof entry.audio === 'boolean') compact.audio = entry.audio
    if (entry.thinking && typeof entry.thinking === 'object' && !Array.isArray(entry.thinking)) {
      const thinking = {}
      if (typeof entry.thinking.scheme === 'string') thinking.scheme = entry.thinking.scheme
      if (Array.isArray(entry.thinking.levels)) {
        const levels = []
        for (const level of entry.thinking.levels) {
          if (!level || typeof level !== 'object' || typeof level.level !== 'string') continue
          const item = { level: level.level }
          if (level.wire !== undefined) item.wire = typeof level.wire === 'string' ? level.wire : null
          levels.push(item)
        }
        if (levels.length) thinking.levels = levels
      }
      if (Number.isFinite(entry.thinking.min)) thinking.min = entry.thinking.min
      if (Number.isFinite(entry.thinking.max)) thinking.max = entry.thinking.max
      if (typeof entry.thinking.default === 'string') thinking.default = entry.thinking.default
      if (Object.keys(thinking).length) compact.thinking = thinking
    }
    if (entry.price && typeof entry.price === 'object' && !Array.isArray(entry.price)) {
      const price = {}
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) if (Number.isFinite(entry.price[key])) price[key] = entry.price[key]
      if (typeof entry.price.currency === 'string') price.currency = entry.price.currency
      if (typeof entry.price.unit === 'string') price.unit = entry.price.unit
      if (typeof entry.price.source === 'string') price.source = entry.price.source
      if (Object.keys(price).length) compact.price = price
    }
    const keys = [id].concat(Array.isArray(entry.aliases) ? entry.aliases : []).map(normalizeModelName).filter(Boolean)
    for (const key of keys) {
      if (!claims[key]) claims[key] = new Set()
      claims[key].add(compact)
    }
  }
  const lookup = Object.create(null)
  let ambiguous = 0
  for (const key of Object.keys(claims)) {
    const holders = claims[key]
    if (holders.size > 1) {
      ambiguous++
      continue
    }
    for (const entry of holders) lookup[key] = entry
  }
  const generated = parsed.generatedFrom && typeof parsed.generatedFrom === 'object' ? parsed.generatedFrom : {}
  return {
    schema: Number.isFinite(parsed.$schema) ? parsed.$schema : 1,
    count: models.length,
    ambiguous: ambiguous,
    priceTableVersion: Number.isFinite(generated.priceTableVersion) ? generated.priceTableVersion : undefined,
    lookup: lookup,
  }
}
