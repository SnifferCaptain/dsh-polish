import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { parseReferenceFile } from './reference.js'

/**
 * Better Model Config (v3): an in-row extension of the official Models page.
 *
 * This component registers no route, no adapter and no settings page of its
 * own. The browser half patches the official model rows in place (one entry
 * point: the official editor) and edits the official `llm-pi-ai` Config with
 * the same path ops the official editor writes. This Host half only
 *   - carries the row's live `enabled` switch, and
 *   - serves the read-only reference table (model-defaults.jsonc: pi-ai
 *     built-in catalog capabilities + token-usage prices) from a lazy GET
 *     route, so the ~1MB table is fetched once by the models page instead of
 *     being inlined into every page's HTML.
 *
 * The reference table is a default-only source: it initializes fields when a
 * model is added; it never modifies stored values, and prices are display
 * only (the official model schema has no price field).
 */
export const Config = z.object({
  /** Whether the in-row extensions and the /v1 guard are shown. */
  enabled: z.boolean().default(true).volatile(),
})

// connection.fetch is an explicit Host dependency; without this declaration
// Loader activation fails before the route can be registered.
export const inject = ['connection']

const REFERENCE_PATH = '/api/dshp/better-model-config/reference'

let referenceCache = null
function reference() {
  if (referenceCache === null) {
    try {
      const text = readFileSync(fileURLToPath(new URL('./model-defaults.jsonc', import.meta.url)), 'utf8')
      referenceCache = Object.assign({ ok: true }, parseReferenceFile(text))
    } catch (error) {
      // Fail open: the page still works, the reference line is just empty.
      referenceCache = { ok: false, lookup: {}, count: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return referenceCache
}

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.effect(
    function () {
      if (!ctx.connection || !ctx.connection.fetch || typeof ctx.connection.fetch.register !== 'function') return
      return ctx.connection.fetch.register({
        path: REFERENCE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async function () {
          const body = reference()
          const payload = {
            ok: body.ok,
            version: body.priceTableVersion,
            count: body.count,
            lookup: body.ok ? body.lookup : {},
          }
          if (body.error) payload.error = body.error
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=3600' },
          })
        },
      })
    },
    'dsh-polish: better-model-config reference route',
  )
}
