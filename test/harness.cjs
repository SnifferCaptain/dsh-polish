// Out-of-tree harness for dsh-polish's browser half (not shipped: `files` in
// package.json does not include test/).
//
// It loads the real lib/client.js factory under a minimal React runtime, runs
// `apply` against a fake cordis context, then drives the thinking-depth control
// and asserts the Remote payloads it sends.
//
//   node test/harness.cjs
'use strict'

const fs = require('node:fs')
const path = require('node:path')

let failures = 0
let checks = 0
function ok(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : '  -> ' + detail))
  }
}
function section(title) {
  console.log('\n== ' + title)
}

// --------------------------------------------------------------- fake DOM/React

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    attributes: {},
    id: '',
    textContent: '',
    isConnected: true,
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    removeAttribute(name) {
      delete this.attributes[name]
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
    },
    appendChild(child) {
      this.children.push(child)
      return child
    },
    remove() {},
  }
}

const documentStub = {
  head: { appendChild() {} },
  body: {},
  /** The element that would be `document.activeElement` when the composer is focused. */
  activeElement: null,
  /** type -> listener[] for document-level listeners (the recall keydown lives here). */
  __handlers: Object.create(null),
  getElementById() {
    return null
  },
  createElement(tag) {
    return makeElement(tag)
  },
  querySelectorAll() {
    return []
  },
  // Programmatic composer writes: `setText` selects all then inserts, so the fake
  // just mirrors the active element's text the way the Lexical root would.
  execCommand(command, ui, value) {
    const el = documentStub.activeElement
    if (!el) return false
    if (command === 'insertText') {
      el.textContent = value === null || value === undefined ? '' : String(value)
      return true
    }
    if (command === 'delete') {
      // Model the real editor: `delete` is intercepted but not applied (a clear
      // only lands via insertText over a selection), so this no-ops on purpose.
      // the "down at the newest clears" test therefore has to pass through
      // insertText, exactly like the shipped bug required.
      return true
    }
    return true
  },
  createRange() {
    return { selectNodeContents() {}, collapse() {} }
  },
  addEventListener(type, listener) {
    const arr = (documentStub.__handlers[type] = documentStub.__handlers[type] || [])
    arr.push(listener)
  },
  removeEventListener(type, listener) {
    const arr = documentStub.__handlers[type]
    if (!arr) return
    const at = arr.indexOf(listener)
    if (at >= 0) arr.splice(at, 1)
  },
}

globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (handle) => clearTimeout(handle),
  // The renderer ticks its elapsed-time chip once a second. Keep these real but
  // unref'ed so a stray timer can never hold the harness process open.
  setInterval: (fn, ms) => {
    const handle = setInterval(fn, ms)
    if (handle && typeof handle.unref === 'function') handle.unref()
    return handle
  },
  clearInterval: (handle) => clearInterval(handle),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (handle) => clearTimeout(handle),
  getSelection: () => ({ removeAllRanges() {}, addRange() {}, removeRange() {} }),
}
globalThis.document = documentStub
documentStub.documentElement = { style: {} }
globalThis.Element = function Element() {}
globalThis.HTMLElement = function HTMLElement() {}

// ---- visualize needs a few more globals the shipped code reads bare ----
const fakeStorage = {
  data: Object.create(null),
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null
  },
  setItem(key, value) {
    this.data[key] = String(value)
  },
  removeItem(key) {
    delete this.data[key]
  },
  clear() {
    this.data = Object.create(null)
  },
}
globalThis.localStorage = fakeStorage
window.localStorage = fakeStorage
// No CSS custom properties are exposed -> luminance read falls through to the
// media query, which reports a light theme (the mermaid init assertion relies
// on `theme: 'default'`).
globalThis.matchMedia = (query) => ({
  matches: /dark/.test(query) ? false : true,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
})
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' })
window.matchMedia = globalThis.matchMedia
window.getComputedStyle = globalThis.getComputedStyle
/**
 * The count of DOM-touching writes the patcher performs. In a real browser
 * every `textContent =` on a watched subtree also creates a mutation record,
 * even when the string is identical — that is what froze the shipped page
 * (scan rewrites its own output, the observer reschedules another scan).
 * This counter plays the same role here: the "steady rescan" test fails it
 * unless `setText`/`setStyle`/`setAttr` skip identical writes.
 */
let domWrites = 0
function countWrite() {
  domWrites += 1
}

// A recording MutationObserver: structural DOM writes are fanned out to live
// observers on a microtask, the way the browser batches. The depth patcher
// ignores the records themselves (it rescans on any change).
const mutationObservers = []
let mutationFlushScheduled = false
function emitMutation(record) {
  for (const obs of mutationObservers) obs.queue.push(record)
  if (mutationFlushScheduled) return
  mutationFlushScheduled = true
  Promise.resolve().then(() => {
    mutationFlushScheduled = false
    for (const obs of mutationObservers) {
      if (obs.queue.length === 0) continue
      const batch = obs.queue
      obs.queue = []
      try {
        obs.callback(batch)
      } catch (error) {
        /* a plugin must never break on its own observer */
      }
    }
  })
}
globalThis.MutationObserver = function (callback) {
  const obs = {
    callback,
    queue: [],
    observe() {},
    disconnect() {
      const at = mutationObservers.indexOf(obs)
      if (at >= 0) mutationObservers.splice(at, 1)
    },
  }
  mutationObservers.push(obs)
  return obs
}
// 0.4.37: the body stub carries DSW's theme attribute (data-ds-dark-theme)
// and emits attribute mutations, so the visualize theme observer can be
// driven behaviorally. Real MutationObservers only receive records matching
// their own observe() options; the fake broadcast is wider, which is why the
// shipped observers guard record types and node lists.
;(function () {
  const el = makeElement('body')
  const set = el.setAttribute.bind(el)
  const remove = el.removeAttribute.bind(el)
  el.setAttribute = function (name, value) {
    set(name, value)
    emitMutation({ type: 'attributes', target: el, attributeName: name })
  }
  el.removeAttribute = function (name) {
    remove(name)
    emitMutation({ type: 'attributes', target: el, attributeName: name })
  }
  documentStub.body = el
})()

/**
 * A minimal function-component runtime: hooks are stored per component function
 * so repeated calls observe state updates, which is enough to drive the panel's
 * open/closed and page switching.
 */
const hookStore = new Map()
function hooksFor(fn) {
  let slot = hookStore.get(fn)
  if (slot === undefined) {
    slot = { cells: [], cursor: 0 }
    hookStore.set(fn, slot)
  }
  return slot
}

const React = {
  Fragment: 'Fragment',
  createElement(type, props) {
    const children = []
    for (let i = 2; i < arguments.length; i++) children.push(arguments[i])
    return { type, props: props === null || props === undefined ? {} : props, children }
  },
  useState(initial) {
    const slot = hooksFor(React.__current)
    const index = slot.cursor++
    // Cells are sparse (useMemo/useEffect consume a cursor slot without a cell),
    // so assign by index rather than pushing.
    if (!(index in slot.cells)) slot.cells[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      slot.cells[index] = typeof next === 'function' ? next(slot.cells[index]) : next
    }
    return [slot.cells[index], setter]
  },
  useRef(initial) {
    const slot = hooksFor(React.__current)
    const index = slot.cursor++
    if (!(index in slot.cells)) slot.cells[index] = { current: initial }
    return slot.cells[index]
  },
  useMemo(factory, deps) {
    const slot = hooksFor(React.__current)
    const index = slot.cursor++
    const cell = slot.cells[index]
    if (cell === undefined || depsChanged(cell.deps, deps)) {
      slot.cells[index] = { deps, value: factory() }
    }
    return slot.cells[index].value
  },
  useEffect(effect, deps) {
    const slot = hooksFor(React.__current)
    const index = slot.cursor++
    const cell = slot.cells[index]
    if (cell === undefined || depsChanged(cell.deps, deps)) {
      if (cell !== undefined && typeof cell.cleanup === 'function') {
        try {
          cell.cleanup()
        } catch (error) {
          /* ignore */
        }
      }
      slot.cells[index] = { deps, cleanup: effect() }
    }
    return slot.cells[index].cleanup
  },
  useLayoutEffect(effect, deps) {
    return React.useEffect(effect, deps)
  },
}

function depsChanged(previous, next) {
  if (previous === undefined || next === undefined || next === null) return true
  if (previous.length !== next.length) return true
  for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) return true
  return false
}

function render(component, props) {
  const slot = hooksFor(component)
  slot.cursor = 0
  React.__current = component
  return component(props)
}

/** The durable per-session `modelSelection` projection, as the Host publishes it. */
const projectionState = { value: undefined }
function fakeUseProjection(key, selector) {
  if (key !== 'modelSelection') return undefined
  return selector === undefined ? projectionState.value : selector(projectionState.value)
}
function project(lastUsed, next) {
  projectionState.value = { lastUsed, next }
}

/** A fake layout for the track: 300px wide starting at x=100. */const FAKE_RECT = { left: 100, width: 300, top: 0, right: 400, bottom: 28, height: 28 }
function fakeElement() {
  return {
    clientWidth: 300,
    getBoundingClientRect: () => FAKE_RECT,
    contains: () => false,
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  }
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  visit(node)
  if (typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  // Function components inside the tree are rendered on the spot, so assertions
  // can reach the real DOM they produce.
  if (typeof node.type === 'function') {
    walk(render(node.type, node.props), visit)
    return
  }
  // React would attach refs; tests need them to reach the track's geometry.
  if (node.props && node.props.ref !== null && typeof node.props.ref === 'object') node.props.ref.current = fakeElement()
  if (node.children) for (const child of node.children) walk(child, visit)
}

function find(root, predicate) {
  let hit = null
  walk(root, (node) => {
    if (hit === null && node !== null && typeof node === 'object' && node.props !== undefined && predicate(node)) hit = node
  })
  return hit
}

function textOf(node) {
  let text = ''
  walk(node, (item) => {
    if (typeof item === 'string' || typeof item === 'number') text += String(item)
  })
  return text
}

// --------------------------------------------------------------- load bundle

const clientPath = path.join(__dirname, '..', 'lib', 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

let factory = null
globalThis.window.__ModuleLoader__ = {
  load(registration) {
    factory = registration.factory
  },
}
// eslint-disable-next-line no-eval
;(0, eval)(source)

const requireStub = (specifier) => {
  if (specifier === 'react') return React
  // Deliberately unavailable: exercises the inline-panel fallback.
  throw new Error('not seeded: ' + specifier)
}

// ---- the client-modules chunk channel: `require.async('./client.mermaid.js')`
// The real chunk is a 3.5MB classic script; the harness stands in for it with a
// controllable fake runtime. `mermaidChunk.shouldFail` drives the load-failure
// path; contents containing "BROKEN" drive the render-error path.
const mermaidChunk = { shouldFail: false }
const fakeMermaidApi = {
  initCalls: [],
  renderCalls: [],
  initialize(opts) {
    this.initCalls.push(opts)
  },
  render(id, text) {
    this.renderCalls.push({ id, text })
    if (String(text).indexOf('BROKEN') !== -1) {
      return Promise.reject(new Error('Parse error on line 1: BROKEN'))
    }
    return Promise.resolve({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#345"/></svg>',
    })
  },
}
requireStub.async = (spec) => {
  if (spec !== './client.mermaid.js') return Promise.reject(new Error('unexpected chunk: ' + spec))
  if (mermaidChunk.shouldFail) return Promise.reject(new Error('harness: mermaid chunk load failed'))
  return Promise.resolve({ default: fakeMermaidApi })
}

const mod = factory(requireStub)
ok('factory returns apply/inject', typeof mod.apply === 'function' && Array.isArray(mod.inject), JSON.stringify(mod.inject))

section('thinking-time: renderer shows an aligned elapsed-time chip')
ok('the renderer default enables showTime', source.indexOf('showTime: true') >= 0, 'RENDERER_DEFAULTS missing showTime')
ok('the engine wires showTime into its config', source.indexOf('showTime: RENDERER_DEFAULTS.showTime') >= 0)
ok(
  'the run start is the durable step/start timestamp, not the DOM or a local clock',
  source.indexOf('function currentStepStart(events)') >= 0 &&
    source.indexOf("ev.type !== 'step/start'") >= 0 &&
    source.indexOf("typeof ev.time === 'number'") >= 0 &&
    source.indexOf("typeof ev.seq === 'number'") >= 0,
)
ok(
  'the engine reads the viewed session from the shared registry and pages its events',
  source.indexOf('function refreshTimes(state)') >= 0 &&
    source.indexOf('sessionRegistryGet()') >= 0 &&
    source.indexOf('session.page({ address: address, throughSeq: throughSeq, maxMessages: 500 })') >= 0 &&
    source.indexOf('session.projections({ sessionId: sessionId })') >= 0,
)
ok(
  'elapsed is now minus the durable step start, with a wall-clock fallback until the first step/start lands',
  source.indexOf('Math.floor((now - state.eventStart) / 1000)') >= 0 &&
    source.indexOf('Math.floor((now - state.startedAt) / 1000)') >= 0,
)
ok(
  'the fragile DOM <time dateTime> start heuristic is gone',
  source.indexOf('turnStartTime') < 0 && source.indexOf('time[dateTime]') < 0,
)

// The event-step math is the only real decision about which timestamps count, so
// pull the shipped pure function out of the built bundle and exercise it directly.
function extractFunction(src, name) {
  const marker = 'function ' + name + '('
  const start = src.indexOf(marker)
  if (start < 0) return null
  let i = src.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth += 1
    else if (src[j] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, j + 1)
    }
  }
  return null
}
const ctsSrc = extractFunction(source, 'currentStepStart')
ok('currentStepStart ships and is self-contained (no sessionRegistry reference)', ctsSrc !== null && ctsSrc.indexOf('sessionRegistry') < 0, ctsSrc ? ctsSrc.slice(0, 40) : 'not found')
const currentStepStart = ctsSrc === null ? () => null : (0, eval)('(' + ctsSrc + ')')
const stepStart = (seq, time) => ({ type: 'step/start', seq, time })
ok('the newest step/start (by seq) is the current step start', currentStepStart([stepStart(1, 1000), stepStart(2, 5000)]) === 5000)
ok('non-step/start events are ignored', currentStepStart([{ type: 'user', time: 500, data: { source: 'user' } }, { type: 'assistant/message', time: 2000, seq: 9 }, stepStart(1, 1000)]) === 1000)
ok('missing/invalid timestamps are skipped, not treated as 0', currentStepStart([stepStart(1, undefined), stepStart(2, 700)]) === 700)
ok('no step/start -> null', currentStepStart([]) === null && currentStepStart([{ type: 'assistant/message', time: 1, seq: 1 }]) === null)
ok(
  'the chip catches up the moment the tab is visible again (background-safe)',
  source.indexOf("document.addEventListener('visibilitychange', onVisibility)") >= 0 &&
    source.indexOf("visibilityState === 'hidden'") >= 0 &&
    source.indexOf("document.removeEventListener('visibilitychange', onVisibility)") >= 0,
)
ok('the chip CSS uses tabular numerals so digits do not wobble', source.indexOf('.dshp-think-time { pointer-events: none; font-variant-numeric: tabular-nums') >= 0)
ok('the engine ticks the chip once a second', source.indexOf('window.setInterval(tick, 1000)') >= 0)
ok('stopping tears down the ticker and removes chips', source.indexOf('window.clearInterval(tickTimer)') >= 0 && source.indexOf('removeTimeChips()') >= 0)
ok('the settings row offers the showTime switch', source.indexOf("key: 'showTime'") >= 0)

// --------------------------------------------------------------- fake context

/**
 * Every apply's settings-watch subscription, so a test can re-fire `syncAll`
 * the way a live settings change would (the visualize kill-switch test).
 */
const mirrorSubscribers = []

const registrations = []
const remoteCalls = []
const state = { failNextSelect: false, failCatalog: false, catalog: null, historyRecords: [], historyLog: null, historyAsOf: undefined }
const catalog = {
  default: { provider: 'yapi', model: 'grok-4.6' },
  routableProviders: ['yapi'],
  groups: [
    {
      id: 'yapi',
      name: 'yapi',
      models: [
        {
          id: 'grok-4.6',
          name: 'grok-4.6',
          reasoning: {
            efforts: [
              { id: 'off', name: 'off' },
              { id: 'low', name: 'low' },
              { id: 'medium', name: 'medium' },
              { id: 'high', name: 'high' },
              { id: 'xhigh', name: 'xhigh' },
              { id: 'max', name: 'max' },
            ],
            defaultEffort: 'high',
          },
        },
        { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
         {
           id: 'codex-gpt',
           name: 'codex-gpt',
           reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] },
         },
      ],
    },
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-flash',
          name: 'deepseek-flash',
          reasoning: { efforts: [{ id: 'none', name: 'none' }, { id: 'high', name: 'high' }], defaultEffort: 'high' },
        },
      ],
    },
  ],
  failures: [],
}
state.catalog = catalog

function makeCtx(overrides) {
  const ctx = {
    effect(fn) {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    inject(deps, callback) {
      const child = makeCtx(Object.assign({}, overrides, { deps }))
      child.__deps = deps
      return callback(child) || (() => {})
    },
    on() {
      return () => {}
    },
    slots: {
      inject(key, callback) {
        return callback() || (() => {})
      },
      register(options, Component) {
        registrations.push({ options, Component })
        return () => {}
      },
    },
    configForms: {
      describe() {
        return {
          subscribe(fn) {
            mirrorSubscribers.push(fn)
            fn()
            return () => {
              const at = mirrorSubscribers.indexOf(fn)
              if (at >= 0) mirrorSubscribers.splice(at, 1)
            }
          },
          getSnapshot() {
            // Default keeps the historical shape; a section that needs the
            // real mirror shape (the prompts page reads `snap.view.namespaces`)
            // passes overrides.describeSnapshot.
            return overrides && overrides.describeSnapshot ? overrides.describeSnapshot() : { namespaces: [] }
          },
        }
      },
      get(namespace) {
        const served = overrides && overrides.namespaces ? overrides.namespaces.includes(namespace) : false
        const values =
          overrides && overrides.depthValues && namespace === 'dsh-polish:thinking-depth'
            ? overrides.depthValues
            : overrides && overrides.historyValues && namespace === 'dsh-polish:composer-history'
              ? overrides.historyValues
              : overrides && overrides.lruValues && namespace === 'dsh-polish:workspace-lru'
                ? overrides.lruValues
                : overrides && overrides.visualizeValues && namespace === 'dsh-polish:visualize'
                  ? overrides.visualizeValues
                  : overrides && overrides.promptsValues && namespace === 'dsh-polish:prompts'
                    ? overrides.promptsValues
                    : overrides && overrides.slimValues && namespace === 'dsh-polish:session-slim'
                      ? overrides.slimValues
                      : {}
        return {
          getSnapshot() {
            return served
              ? { status: 'ready', value: values, revision: 1, writable: true, user: {} }
              : { status: 'unavailable', revision: 0, writable: true, user: {} }
          },
          mutate() {
            return Promise.resolve(true)
          },
        }
      },
      whileServed(namespaces, register) {
        const served = new Set(overrides && overrides.namespaces ? overrides.namespaces : [])
        if (namespaces.every((name) => served.has(name))) return register(served) || (() => {})
        return () => {}
      },
    },
    remote: {
      $on(event, listener) {
        return () => {}
      },
      session: {
        modelCatalog() {
          remoteCalls.push({ method: 'modelCatalog' })
          if (state.failCatalog) return Promise.resolve({ ok: false, error: { code: 'boom', message: '目录炸了' } })
          return Promise.resolve({ ok: true, value: state.catalog })
        },
        selectModel(payload) {
          remoteCalls.push({ method: 'selectModel', payload })
          if (state.failNextSelect) {
            state.failNextSelect = false
            return Promise.resolve({ ok: false, error: { code: 'denied', message: '提供方拒绝' } })
          }
          if (state.failCatalog) return Promise.resolve({ ok: false, error: { code: 'boom', message: '目录炸了' } })
          return Promise.resolve({ ok: true, value: { selected: { provider: payload.provider, model: payload.model } } })
        },
        projections(payload) {
          remoteCalls.push({ method: 'projections', payload })
          return Promise.resolve({ ok: true, value: { asOfSeq: state.historyAsOf === undefined ? 100 : state.historyAsOf } })
        },
        page(payload) {
          remoteCalls.push({ method: 'page', payload })
          if (state.historyLog) {
            // Faithful stand-in for the session controller's paginate(): the log
            // is dense 0-based; the page is the contiguous range [cut, end) in
            // ascending seq; end = min(throughSeq+1, beforeSeq ?? throughSeq+1);
            // the scan walks DOWN from end counting user+assistant messages
            // (non-message events ride along but don't count) until maxMessages;
            // hasMore = cut > 0.
            const log = state.historyLog
            const end = Math.min(payload.throughSeq + 1, payload.beforeSeq === undefined ? payload.throughSeq + 1 : payload.beforeSeq)
            const maxMessages = payload.maxMessages || 200
            let cut = 0
            let count = 0
            for (let i = end - 1; i >= 0; i--) {
              const ev = log[i].event
              if (ev.type === 'user/message' || ev.type === 'assistant/message') {
                count += 1
                if (count >= maxMessages) {
                  cut = ev.seq
                  break
                }
              }
            }
            return Promise.resolve({ ok: true, value: { records: log.slice(cut, end), hasMore: cut > 0 } })
          }
          return Promise.resolve({ ok: true, value: { records: state.historyRecords || [], hasMore: false } })
        },
      },
    },
    __deps: [],
  }
  // Test-only seats: the workspace/sessions stores and the workspace reorder
  // Remote, so the LRU component can be driven without the real stores.
  if (overrides && overrides.workspaces) ctx.workspaces = overrides.workspaces
  if (overrides && overrides.sessions) ctx.sessions = overrides.sessions
  if (overrides && overrides.timer) ctx.timer = overrides.timer
  if (overrides && overrides.workspaceRemote) ctx.remote.workspace = overrides.workspaceRemote
  return ctx
}

section('apply() under a deployment that serves only the bundle namespace')
const emptyCtx = makeCtx({ namespaces: [] })
try {
  mod.apply(emptyCtx)
  ok('apply does not throw', true)
} catch (error) {
  ok('apply does not throw', false, error && error.stack ? error.stack.split('\n')[0] : String(error))
}
const keys = registrations.map((entry) => entry.options.name + ':' + (entry.options.key || entry.options.id))
ok('renderer row config page registered', keys.includes('plugins.row.config:dsh-polish#dsh-polish:thinking-renderer'), keys.join(', '))
ok('depth row config page registered', keys.includes('plugins.row.config:dsh-polish#dsh-polish:thinking-depth'), keys.join(', '))
ok(
  'the inert composer-history anchor is always present (like session-capture), even while its row is off',
  keys.includes('conversation.input.right:dsh-polish:composer-history'),
  keys.join(', '),
)
ok(
  'the whileServed-gated thinking-depth control stays out while its row is off',
  !keys.includes('conversation.input.right:dsh-polish:thinking-depth'),
  keys.join(', '),
)
ok(
  'the always-on session capture is registered so the time engine has a session',
  keys.includes('conversation.input.right:dsh-polish:session-capture'),
  keys.join(', '),
)
ok(
  'the workspace-lru row config page is registered',
  keys.includes('plugins.row.config:dsh-polish#dsh-polish:workspace-lru'),
  keys.join(', '),
)

const catalogRefreshCalls = []
const catalogRefreshTimers = []
const catalogRefreshCtx = makeCtx({
  namespaces: [],
  sessions: {
    refresh() {
      catalogRefreshCalls.push('refresh')
      return Promise.resolve()
    },
  },
  timer: {
    timeout(fn, delay) {
      catalogRefreshTimers.push({ fn, delay })
      return () => {}
    },
  },
})
mod.apply(catalogRefreshCtx)
ok(
  '0.4.101 schedules one delayed read-only session catalog refresh',
  catalogRefreshTimers.length === 1 && catalogRefreshTimers[0].delay === 1500,
)
catalogRefreshTimers[0].fn()
ok('0.4.101 executes the catalog refresh without opening or mutating a session', catalogRefreshCalls.length === 1)

// ---------------------------------------------------------------------------
// The shipped panel is not ours to replace: the model seat is a `single` slot
// that the shipped `ModelSelect` already occupies. So the patch is made where
// the user asked for it — inside the panel's own 推理等级 row — and these tests
// drive exactly that row, element by element.
// ---------------------------------------------------------------------------

const domRoots = []

// Elements the plugin builds itself (the injected slider) need the same
// behaviour as the shipped ones, so `createElement` hands out the real fake.
documentStub.createElement = (tag) => domEl(tag)
// The injected stylesheets are part of the deliverable, so keep them readable.
documentStub.head = {
  children: [],
  appendChild(child) {
    this.children.push(child)
  },
}
const injectedCss = () => documentStub.head.children.map((el) => String(el.textContent)).join('\n')

function matchesSelector(node, selector) {
  if (node === null || node === undefined || typeof node.getAttribute !== 'function') return false
  if (selector === '[aria-controls]') return node.getAttribute('aria-controls') !== null
  if (selector === '[role="menu"][id$="-menu"]') {
    return (
      node.getAttribute('role') === 'menu' &&
      typeof node.id === 'string' &&
      node.id.length > 5 &&
      node.id.slice(-5) === '-menu'
    )
  }
  // Component A's selectors are not exercised by this suite.
  return false
}

documentStub.querySelectorAll = (selector) => {
  const hits = []
  const visit = (node) => {
    if (node === null || node === undefined) return
    if (matchesSelector(node, selector)) hits.push(node)
    if (Array.isArray(node.children)) for (const child of node.children) visit(child)
  }
  for (const root of domRoots) visit(root)
  return hits
}

/**
 * Minimal single-selector matcher for the fake elements: tag, `.class`,
 * `[attr]`, `[attr="value"]`. Anything more complex (descendants, `:scope`)
 * returns false — the same conservative behaviour the old querySelector had.
 */
function matchSimpleSelector(node, selector) {
  if (node === null || node === undefined || typeof node.getAttribute !== 'function') return false
  const sel = String(selector).trim()
  if (sel.indexOf('.') === 0) {
    return String(node.className || '').split(/\s+/).indexOf(sel.slice(1)) !== -1
  }
  const attr = /^\[([a-z0-9-]+)(?:=["']([^"']*)["'])?\]$/i.exec(sel)
  if (attr) {
    const value = node.getAttribute(attr[1])
    if (attr[2] === undefined) return value !== null
    return value === attr[2]
  }
  return String(node.tagName || '').toLowerCase() === sel.toLowerCase()
}

function domEl(tag, attrs) {
  // Structural writes are recorded: element inserts/removals fan out to live
  // observers the way a real `childList + subtree` observer sees them, and
  // every set/remove of an attribute or a style property counts as a
  // DOM-touching write. The plugin under test must therefore reach a fixed
  // point — a scan whose own writes reschedule another scan forever freezes
  // the page, which an ever-growing `domWrites` would show. (Plain `textContent
  // =` is not counted: the double is a plain object, so only the explicit
  // `countWrite` calls register — and the production guard `setText` is what
  // keeps those quiet in a real browser.)
  const el = {
    tagName: String(tag).toUpperCase(),
    attributes: Object.assign({}, attrs || {}),
    children: [],
    parentElement: null,
    listeners: [],
    textContent: '',
    className: '',
    clientWidth: 300,
    id: '',
    nodeType: 1,
    isConnected: true,
    // Some older tests assign `.parentNode` directly; keep the two spellings in
    // lockstep so both read the same tree.
    get parentNode() {
      return this.parentElement
    },
    set parentNode(value) {
      this.parentElement = value
    },
    // Mirrors the real DOM for code elements: the renderer keeps each line in
    // a <span class="line">, so the element's child list is what readCodeText
    // must reconstruct newlines from. (Text nodes are not modelled — a code
    // element with no element children has an empty child list and readCodeText
    // falls back to textContent, same as the real plain-text case.)
    get childNodes() {
      return this.children
    },
    matches(selector) {
      return matchSimpleSelector(this, selector)
    },
    closest(selector) {
      let node = this
      while (node) {
        if (matchSimpleSelector(node, selector)) return node
        node = node.parentElement
      }
      return null
    },
    contains(other) {
      let node = other
      while (node) {
        if (node === this) return true
        node = node.parentElement
      }
      return false
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
      if (name === 'id') this.id = String(value)
      if (name === 'class') this.className = String(value)
      countWrite()
    },
    removeAttribute(name) {
      delete this.attributes[name]
      countWrite()
    },
    get style() {
      if (this.__style === undefined) {
        const backing = {}
        this.__style = new Proxy(backing, {
          set(target, name, value) {
            target[name] = value
            countWrite()
            return true
          },
        })
      }
      return this.__style
    },
    set style(value) {
      this.__style = value
    },
    appendChild(child) {
      this.children.push(child)
      child.parentElement = this
      emitMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
      return child
    },
    insertBefore(child, before) {
      // Mirror the real browser strictly: `before` must be a direct child of
      // `this` (real DOM throws HierarchyRequestError otherwise). The 0.4.50
      // visualize bug shipped exactly because this fake was lenient — a ref
      // that was a grandchild silently appended and no render ever happened.
      if (before !== null && this.children.indexOf(before) < 0) {
        const err = new Error('HierarchyRequestError: refNode is not a child of this node')
        err.code = 3
        throw err
      }
      const at = before === null ? this.children.length : this.children.indexOf(before)
      this.children.splice(at, 0, child)
      child.parentElement = this
      emitMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
      return child
    },
    removeChild(child) {
      const at = this.children.indexOf(child)
      if (at >= 0) this.children.splice(at, 1)
      child.parentElement = null
      child.isConnected = false
      emitMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
    },
    remove() {
      if (this.parentElement !== null) this.parentElement.removeChild(this)
      else this.isConnected = false
    },
    addEventListener(type, listener, capture) {
      this.listeners.push({ type, fn: listener, capture: capture === true })
    },
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      return FAKE_RECT
    },
    childOfClass(className) {
      return this.children.find((child) => child.className === className) || null
    },
    focus() {},
    /**
     * Enough of `querySelector` for the selectors the plugin code ships:
     * comma lists of tag / `.class` / `[attr]` / `[attr="value"]` — deep
     * descendant search, first hit wins.
     */
    querySelector(selector) {
      if (typeof selector !== 'string') return null
      const sels = selector.split(',').map((item) => item.trim()).filter(Boolean)
      let hit = null
      const visit = (node) => {
        if (hit !== null) return
        if (node !== this && sels.some((sel) => matchSimpleSelector(node, sel))) {
          hit = node
          return
        }
        if (Array.isArray(node.children)) for (const child of node.children) visit(child)
      }
      visit(this)
      return hit
    },
    fire(type, event) {
      for (const entry of this.listeners) if (entry.type === type) entry.fn(event)
    },
  }
  if (attrs && typeof attrs.id === 'string') el.id = attrs.id
  if (attrs && typeof attrs.class === 'string') el.className = attrs.class
  return el
}

/**
 * One open panel exactly as the shipped `ModelSelect` renders it: a menu whose
 * root pane holds a `button[role="menuitem"]` per row — 模型 first, 推理等级
 * second — portaled outside the composer, with the trigger back in the composer
 * next to the session tag.
 */
function shippedPanel(options) {
  const settings = options || {}
  const id = settings.id === undefined ? ':r1:-menu' : settings.id
  const modelRow = domEl('button', { role: 'menuitem' })
  const modelLabel = domEl('span')
  modelLabel.textContent = '模型'
  const modelValue = domEl('span')
  modelValue.textContent = 'grok-4.6'
  modelRow.appendChild(modelLabel)
  modelRow.appendChild(modelValue)
  modelRow.appendChild(domEl('svg'))

  const effortRow = domEl('button', { role: 'menuitem' })
  const label = domEl('span')
  label.textContent = settings.label === undefined ? '推理等级' : settings.label
  const value = domEl('span')
  value.textContent = settings.value === undefined ? 'high' : settings.value
  effortRow.appendChild(label)
  effortRow.appendChild(value)
  effortRow.appendChild(domEl('svg'))

  const menu = domEl('div', { id, role: 'menu' })
  menu.setAttribute('aria-label', '模型与推理等级')
  menu.appendChild(modelRow)
  if (settings.rows !== 1) menu.appendChild(effortRow)
   for (const tailLabel of settings.tailLabels || []) {
     const tail = domEl('button', { role: 'menuitem' })
     const tailName = domEl('span')
     tailName.textContent = tailLabel
     const tailValue = domEl('span')
     tailValue.textContent = '默认'
     tail.appendChild(tailName)
     tail.appendChild(tailValue)
     tail.appendChild(domEl('svg'))
     menu.appendChild(tail)
   }

  const composer = domEl('div')
  if (settings.tag !== false) {
    const tag = domEl('span')
    tag.setAttribute('data-dshp-session', settings.session === undefined ? 'session-1' : settings.session)
    composer.appendChild(tag)
  }
  composer.appendChild(domEl('button', { 'aria-controls': id, 'aria-haspopup': 'menu' }))
  domRoots.push(composer, menu)
  return { menu, modelRow, effortRow, label, value }
}

section('apply() with the depth row active (its namespace served)')
registrations.length = 0
remoteCalls.length = 0
const liveCtx = makeCtx({ namespaces: ['dsh-polish:thinking-depth', 'dsh-polish:thinking-renderer'] })
mod.apply(liveCtx)
const composerEntry = registrations.find((entry) => entry.options.id === 'dsh-polish:thinking-depth')
ok('session context registered', composerEntry !== undefined)
ok(
  'session context cell id is its own',
  composerEntry !== undefined && composerEntry.options.id === 'dsh-polish:thinking-depth',
  composerEntry && composerEntry.options.id,
)

const EffortControl = composerEntry.Component
const P1 = { sessionId: 'session-1', useProjection: fakeUseProjection }

const wait = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Render, let the async catalog land, then render once more the way React would
 * on the store's own notification, and let the scheduled scan run. Real panels
 * are only ever opened long after that first load, so this is just the harness
 * catching up with itself.
 */
async function settle(component, props) {
  const tree = render(component, props)
  await wait()
  render(component, props)
  await wait()
  return tree
}

/** Apply the bundle against a fresh fake context and return its session cell. */
function liveControlFor(overrides) {
  registrations.length = 0
  const ctx = makeCtx(overrides)
  mod.apply(ctx)
  const entry = registrations.find((item) => item.options.id === 'dsh-polish:thinking-depth')
  return entry === undefined ? null : entry.Component
}

;(async () => {
  await wait()

  section('the session cell is headless but identifiable')
  let tree = render(EffortControl, P1)
  ok(
    'it renders nothing but a session tag, out of the composer layout',
    tree !== null &&
      tree.type === 'span' &&
      tree.props['data-dshp-session'] === 'session-1' &&
      tree.props.hidden === true &&
      tree.props.style.display === 'none',
    tree === null ? 'rendered null' : JSON.stringify(tree.props),
  )
  ok('the catalog is requested on mount', remoteCalls.some((call) => call.method === 'modelCatalog'))
  await wait()

  section('a steady rescan writes nothing, so the page never freezes')
  // The patcher watches its own panel with a childList observer. Drive the
  // panel through the exact sequence a real open produces — panel appears,
  // scans fire off observer records, rescans follow — and the run must write
  // nothing once steady: every extra DOM write recreates the observer's own
  // trigger and freezes the shipped page, which this counter stands in for.
  const hangGuard = setTimeout(() => {
    console.log('  FAIL  rescans settle  ->  the observer kept firing')
    process.exit(1)
  }, 5000)
  domWrites = 0
  const freezePanel = shippedPanel({ session: 'session-1', id: ':r0:-menu' })
  await settle(EffortControl, P1)
  ok('the row is adopted', freezePanel.effortRow.getAttribute('data-dshp-row') === '1')
  // Opening one more panel exercises the same path once more; afterwards a
  // steady state must write nothing at all — the microtask queue drains here
  // because `settle` awaits, so any self-triggering write would show up.
  const probe = shippedPanel({ session: 'session-1', id: ':r0b:-menu' })
  await settle(EffortControl, P1)
  ok('the probed row still works', probe.effortRow.getAttribute('data-dshp-row') === '1')
  domWrites = 0
  await wait()
  await wait()
  ok('rescans settle', domWrites === 0, JSON.stringify(domWrites))
  clearTimeout(hangGuard)

  section('a second press while dragging is ignored, the row never sticks')
  const stuckPanel = probe.effortRow.childOfClass('dshp-eff-slider') !== null ? probe : freezePanel
  const stuckSlider = stuckPanel.effortRow.childOfClass('dshp-eff-slider')
  const stuckValue = stuckPanel.effortRow.childOfClass('dshp-eff-value')
  stuckSlider.fire('pointerdown', { clientX: 390, pointerId: 7 })
  ok('the first press starts a drag', stuckSlider.getAttribute('data-dshp-dragging') === '1', String(stuckSlider.getAttribute('data-dshp-dragging')))
  const dragWrites = remoteCalls.filter((call) => call.method === 'selectModel').length
  // A stray second press (synthetic replay, multi-touch) must not orphan the
  // gesture: the drag keeps tracking the original pointer only.
  stuckSlider.fire('pointerdown', { clientX: 110, pointerId: 9 })
  stuckSlider.fire('pointermove', { clientX: 110, pointerId: 9 })
  ok('the stray pointer moves nothing', stuckValue.textContent === 'max', stuckValue.textContent)
  stuckSlider.fire('pointermove', { clientX: 240, pointerId: 7 })
  ok('the original pointer still drives it', stuckValue.textContent === 'medium', stuckValue.textContent)
  // x=278 maps to stop 3 of 5 (lane starts at 114px and is 272px wide).
  // Release on the committed level so this gesture remains preview-only.
  stuckSlider.fire('pointermove', { clientX: 278, pointerId: 7 })
  stuckSlider.fire('pointerup', { clientX: 278, pointerId: 7 })
  ok('release retires the drag', stuckSlider.getAttribute('data-dshp-dragging') === null, String(stuckSlider.getAttribute('data-dshp-dragging')))
  await wait()
  ok('a preview-only gesture writes nothing', remoteCalls.filter((call) => call.method === 'selectModel').length === dragWrites)
  ok('and the row rests on the level in force', stuckSlider.getAttribute('aria-valuetext') === 'high', stuckSlider.getAttribute('aria-valuetext'))

  section('the shipped 推理等级 row becomes a slider, in place')
  const panel = shippedPanel({ session: 'session-1' })
  await settle(EffortControl, P1)
  ok('the row is claimed', panel.effortRow.getAttribute('data-dshp-row') === '1', String(panel.effortRow.getAttribute('data-dshp-row')))
  ok(
    'the row is re-laid out as two explicit grid rows with room for them',
    panel.effortRow.style.display === 'grid' &&
      panel.effortRow.style.gridTemplateColumns === '1fr auto' &&
      panel.effortRow.style.height === 'auto' &&
      panel.label.style.gridArea === '1 / 1',
    JSON.stringify(panel.effortRow.style),
  )
  ok(
    'the chevron and the shipped level name are hidden, not left to fill a row',
    panel.effortRow.children.filter((child) => child !== panel.label && child.style.display !== 'none' && !child.className).length === 0,
    panel.effortRow.children.map((child) => (child.className || child.tagName) + ':' + (child.style.display || 'shown')).join(','),
  )
  ok(
    'the 模型 row above is untouched',
    panel.modelRow.getAttribute('data-dshp-row') === null && panel.modelRow.children.length === 3 && panel.modelRow.style.display === undefined,
    JSON.stringify(panel.modelRow.children.length),
  )
  const slider = panel.effortRow.childOfClass('dshp-eff-slider')
  ok('a slider takes the row', slider !== null && slider.getAttribute('role') === 'slider', slider === null ? 'missing' : JSON.stringify(slider.attributes))
  ok('it spans the width under the two labels', slider !== null && slider.style.gridArea === '2 / 1 / 3 / 3', slider && slider.style.gridArea)
  ok('the shipped level name is replaced by one a drag can move', panel.value.style.display === 'none' && panel.effortRow.childOfClass('dshp-eff-value') !== null)
  ok('one step per declared level', slider !== null && slider.getAttribute('aria-valuemax') === '5', slider && String(slider.getAttribute('aria-valuemax')))
  ok(
    'it sits on the level the session is on',
    slider !== null && slider.getAttribute('aria-valuenow') === '3' && slider.getAttribute('aria-valuetext') === 'high',
    slider && slider.getAttribute('aria-valuenow') + '/' + slider.getAttribute('aria-valuetext'),
  )
  ok('it borrows the shipped row label', slider !== null && slider.getAttribute('aria-label') === '推理等级', slider && slider.getAttribute('aria-label'))
  const fill = slider.childOfClass('dshp-eff-fill')
  ok(
    'the fill grows from the left wall to the knob centre',
    fill !== null && fill.style.width === 'calc(14px + (100% - 28px) * 0.6)',
    fill && String(fill.style.width),
  )
  ok(
    'the fill is the sampled solid colour, not a slice of the ramp',
    fill !== null && fill.style.backgroundColor === '#4e53fa' && (fill.style.backgroundImage === undefined || fill.style.backgroundImage === ''),
    fill && String(fill.style.backgroundColor),
  )
  const gradient = String(slider.childOfClass('dshp-eff-ghost').style.backgroundImage)
  ok('ramp starts at light blue', gradient.indexOf('#9cc8ff') >= 0, gradient)
  ok('ramp ends at purple', gradient.indexOf('#a855f7') >= 0, gradient)
  ok('the neutral stop stays grey, off the ramp', gradient.indexOf('#8a8f98') >= 0, gradient)
  ok('mid ramp is interpolated, not just endpoints', gradient.indexOf('#4e53fa') >= 0, gradient)
  const dots = slider.children.filter((child) => child.className === 'dshp-eff-stop')
  ok(
    'one tick per level, kept s inside each track wall',
    dots.length === 6 &&
      dots[0].style.left === 'calc(14px + (100% - 28px) * 0)' &&
      dots[5].style.left === 'calc(14px + (100% - 28px) * 1)',
    dots.map((dot) => dot.style.left).join(','),
  )
  const valueSpan = panel.effortRow.childOfClass('dshp-eff-value')
  ok('the level name reads the current level', valueSpan !== null && valueSpan.textContent === 'high', valueSpan && valueSpan.textContent)
  ok('and keeps that level colour', valueSpan !== null && valueSpan.style.color !== '' && valueSpan.style.color !== '#8a8f98', valueSpan && String(valueSpan.style.color))

  section('programmatic moves glide, drags do not')
  const originalRaf = window.requestAnimationFrame
  const queuedFrames = []
  window.requestAnimationFrame = (callback) => {
    queuedFrames.push(callback)
    return queuedFrames.length
  }
  const startColor = fill.style.backgroundColor
  project({ provider: 'yapi', model: 'grok-4.6', reasoningEffort: 'max' }, null)
  render(EffortControl, P1)
  await Promise.resolve()
  ok('a projected move schedules an animation frame', queuedFrames.length > 0)
  let frameTime = 50
  while (queuedFrames.length > 0 && fill.style.backgroundColor === startColor) {
    const frame = queuedFrames.shift()
    frame(frameTime)
    frameTime += 50
  }
  const movingColor = fill.style.backgroundColor
  ok(
    'the fill samples a continuous colour between stops during the glide',
    movingColor !== startColor && movingColor !== '#7a50f6' && movingColor !== '#a855f7',
    movingColor,
  )
  ok('the moving level name samples the same colour', valueSpan.style.color === movingColor, valueSpan.style.color)
  while (queuedFrames.length > 0) queuedFrames.shift()(400)

  window.requestAnimationFrame = originalRaf
  project({ provider: 'yapi', model: 'grok-4.6', reasoningEffort: 'high' }, null)
  render(EffortControl, P1)
  await wait()
  const css = injectedCss()
  ok('the track is a full-width pill that wraps the knob', css.indexOf('left: 0 !important; right: 0 !important; top: 50% !important; height: 28px !important; margin-top: -14px !important; border-radius: 14px !important;') >= 0)
  ok('no CSS transition fights the pointer', !/\.dshp-eff-[^{]+\{[^}]*\btransition\s*:/.test(css), 'transition found in a slider rule')

  ok('the knob is a plain circle', css.indexOf('.dshp-eff-knob { position: absolute; top: 50% !important; width: 20px !important; height: 20px !important;') >= 0)
  ok('the value name carries no transition either', css.indexOf('.dshp-eff-value { min-width: 0;') >= 0)

  section('the row no longer opens the level list')
  const guard = panel.effortRow.listeners.find((entry) => entry.type === 'click')
  ok('a capture-phase listener guards the row', guard !== undefined && guard.capture === true)
  ok('it is the only click listener on the row', panel.effortRow.listeners.filter((entry) => entry.type === 'click').length === 1)
  let prevented = false
  let stopped = false
  guard.fn({
    preventDefault() {
      prevented = true
    },
    stopPropagation() {
      stopped = true
    },
  })
  ok('it cancels the drill for both mouse and keyboard', prevented && stopped)

  section('the slider is a keyboard control too')
  let keyPrevented = false
  let keyStopped = false
  const beforeKey = remoteCalls.filter((call) => call.method === 'selectModel').length
  slider.fire('keydown', {
    key: 'ArrowRight',
    preventDefault() {
      keyPrevented = true
    },
    stopPropagation() {
      keyStopped = true
    },
  })
  await wait()
  ok('an arrow key stays with the slider, not the panel', keyPrevented && keyStopped)
  const keyWrites = remoteCalls.filter((call) => call.method === 'selectModel')
  ok('it writes the neighbouring level', keyWrites.length === beforeKey + 1 && keyWrites[beforeKey].payload.reasoningEffort === 'xhigh', JSON.stringify(keyWrites[beforeKey] && keyWrites[beforeKey].payload))
  render(EffortControl, P1)
  await wait()
  ok('the row reports the level it is now on', slider.getAttribute('aria-valuetext') === 'xhigh', slider.getAttribute('aria-valuetext'))

  section('dragging the slider writes the session selection')
  const beforeDrag = remoteCalls.filter((call) => call.method === 'selectModel').length
  // Press at the far right end of the lane: x=390 of the 100..400 fake track
  // is the last stop (14px end inset on both sides).
  slider.fire('pointerdown', { clientX: 390, pointerId: 7 })
  ok('nothing is written before release', remoteCalls.filter((call) => call.method === 'selectModel').length === beforeDrag)
  ok(
    'the knob previews the target level',
    slider.childOfClass('dshp-eff-knob').style.left === 'calc(14px + (100% - 28px) * 1)',
    slider.childOfClass('dshp-eff-knob').style.left,
  )
  ok('the level name moves with the pointer', valueSpan.textContent === 'max', valueSpan.textContent)
  ok('and samples the colour under the pointer', valueSpan.style.color === '#a855f7', String(valueSpan.style.color))
  ok('the drag marks the slider', slider.getAttribute('data-dshp-dragging') === '1', String(slider.getAttribute('data-dshp-dragging')))
  // x=240 sits between stop 2 and stop 3 of 5: the name must already name the
  // nearest stop while the colour keeps sampling the pointer, not the stop.
  slider.fire('pointermove', { clientX: 240, pointerId: 7 })
  ok('the name keeps up mid-drag', valueSpan.textContent === 'medium', valueSpan.textContent)
  ok(
    'the colour travels between stops',
    valueSpan.style.color !== '' && valueSpan.style.color !== '#4e53fa' && valueSpan.style.color !== '#6f41f6',
    String(valueSpan.style.color),
  )
  slider.fire('pointerup', { clientX: 390, pointerId: 7 })
  ok('release retires the drag', slider.getAttribute('data-dshp-dragging') === null, String(slider.getAttribute('data-dshp-dragging')))
  await wait()
  const writes = remoteCalls.filter((call) => call.method === 'selectModel')
  ok('exactly one more selectModel call', writes.length === beforeDrag + 1, JSON.stringify(writes.length))
  ok(
    'payload carries session, route and the picked level id',
    writes.length === beforeDrag + 1 &&
      writes[beforeDrag].payload.sessionId === 'session-1' &&
      writes[beforeDrag].payload.provider === 'yapi' &&
      writes[beforeDrag].payload.model === 'grok-4.6' &&
      writes[beforeDrag].payload.reasoningEffort === 'max',
    JSON.stringify(writes[beforeDrag] && writes[beforeDrag].payload),
  )
  render(EffortControl, P1)
  await wait()
  ok('the row follows the accepted selection', slider.getAttribute('aria-valuenow') === '5', slider.getAttribute('aria-valuenow'))

  section('the durable selection projection is the source of truth')
  // The Host reports our own write back through the projection; that is what
  // retires the optimistic overlay.
  project({ provider: 'yapi', model: 'grok-4.6', reasoningEffort: 'max' }, null)
  render(EffortControl, P1)
  await wait()
  ok('it still shows the written level while it is confirmed', slider.getAttribute('aria-valuenow') === '5', slider.getAttribute('aria-valuenow'))

  // An external change must now win. Had the overlay not been retired, the
  // stale 'max' would stick here — so this is the confirmation test.
  project({ provider: 'yapi', model: 'grok-4.6', reasoningEffort: 'medium' }, null)
  render(EffortControl, P1)
  await wait()
  ok('an externally changed level wins after confirmation', slider.getAttribute('aria-valuetext') === 'medium', slider.getAttribute('aria-valuetext'))
  ok(
    'the fill follows it (medium is step 2 of 5)',
    slider.childOfClass('dshp-eff-fill').style.width === 'calc(14px + (100% - 28px) * 0.4)',
    String(slider.childOfClass('dshp-eff-fill').style.width),
  )

  // A model switched in DSH's OWN panel arrives purely as a projection change.
  const callsBefore = remoteCalls.filter((call) => call.method === 'selectModel').length
  project({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'none' }, null)
  render(EffortControl, P1)
  await wait()
  ok(
    'a model switched in DSH itself re-scales the slider',
    slider.getAttribute('aria-valuemax') === '1' && slider.getAttribute('aria-valuetext') === 'none',
    slider.getAttribute('aria-valuemax') + '/' + slider.getAttribute('aria-valuetext'),
  )
  const shrunk = slider.children.filter((child) => child.className === 'dshp-eff-stop')
  ok('surplus ticks are hidden, not left behind', shrunk.length === 6 && shrunk[2].style.display === 'none', shrunk.map((dot) => dot.style.display || 'shown').join(','))
  ok('reading it wrote nothing', remoteCalls.filter((call) => call.method === 'selectModel').length === callsBefore)

  project(undefined, undefined)
  render(EffortControl, P1)
  await wait()
  ok('with no projection the catalog default comes back', slider.getAttribute('aria-valuetext') === 'high', slider.getAttribute('aria-valuetext'))

  section('the Codex menu keeps effort working when extra rows follow it')
   const codexPanel = shippedPanel({ session: 'session-1', id: ':r5:-menu', tailLabels: ['速度', '输出详略'] })
   render(EffortControl, P1)
   await wait()
   ok('Codex-style four-row menu adopts its middle effort row', codexPanel.effortRow.getAttribute('data-dshp-row') === '1')
   ok('Codex speed row remains a normal menu item', codexPanel.menu.children[2].children.length === 3 && codexPanel.menu.children[2].getAttribute('data-dshp-row') === null)
   ok('Codex verbosity row remains a normal menu item', codexPanel.menu.children[3].children.length === 3 && codexPanel.menu.children[3].getAttribute('data-dshp-row') === null)

   section('Codex Provider default remains a clearable slider stop')
   project({ provider: 'yapi', model: 'codex-gpt', reasoningEffort: 'high' }, null)
   render(EffortControl, P1)
   await wait()
   ok('models without a declared default expose a Provider default stop', slider.getAttribute('aria-valuemax') === '2' && slider.getAttribute('aria-valuetext') === 'high', slider.getAttribute('aria-valuemax') + '/' + slider.getAttribute('aria-valuetext'))
   const beforeDefaultPick = remoteCalls.filter((call) => call.method === 'selectModel').length
   slider.fire('keydown', { key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} })
    slider.fire('keydown', { key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} })
   slider.fire('keydown', { key: 'Home', preventDefault() {}, stopPropagation() {} })
    const defaultPick = remoteCalls.filter((call) => call.method === 'selectModel')[beforeDefaultPick + 2]
   ok('choosing Provider default clears reasoningEffort', defaultPick !== undefined && defaultPick.payload.reasoningEffort === undefined, JSON.stringify({ pick: defaultPick, calls: remoteCalls.filter((call) => call.method === 'selectModel') }))
   project({ provider: 'yapi', model: 'grok-4.6', reasoningEffort: 'high' }, null)
   render(EffortControl, P1)
   await wait()

   section('panels that are not that row are left alone')
  const stranger = shippedPanel({ session: 'session-1', id: ':r2:-menu', label: '其它' })
  const soloModel = shippedPanel({ session: 'session-1', id: ':r3:-menu', rows: 1 })
  render(EffortControl, P1)
  await wait()
  ok(
    'a second row that is not 推理等级 is untouched',
    stranger.effortRow.getAttribute('data-dshp-row') === null && stranger.effortRow.children.length === 3,
    JSON.stringify(stranger.effortRow.children.length),
  )
  ok('a model with no levels has only the 模型 row', soloModel.modelRow.children.length === 3 && soloModel.effortRow.getAttribute('data-dshp-row') === null)

  section('with two sessions mounted and no tag, nothing is guessed')
  const secondSession = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'] })
  await settle(EffortControl, P1)
  await settle(secondSession, { sessionId: 'session-2', useProjection: fakeUseProjection })
  // Only now, with two sessions live and no tag to tell them apart:
  const untagged = shippedPanel({ session: 'session-1', id: ':r4:-menu', tag: false })
  await settle(EffortControl, P1)
  ok('an unclaimed panel keeps the shipped row', untagged.effortRow.getAttribute('data-dshp-row') === null, String(untagged.effortRow.getAttribute('data-dshp-row')))

  section('the summary reports what the patcher sees')
  // The summary line is the field diagnostic: with a panel open it must name
  // the claim, and while the row is off it must say why instead of going
  // silent.
  const DepthPage = registrations.find((entry) => entry.options.key === 'dsh-polish#dsh-polish:thinking-depth').Component
  function summaryText(values) {
    const slot = { cursor: 0, cells: [] }
    hookStore.set(DepthPage, slot)
    React.__current = DepthPage
    const rendered = DepthPage({
      view: 'summary',
      form: { state: { status: 'ready', value: values === undefined ? {} : values } },
    })
    return textOf(rendered)
  }
  ok('an adopted panel is counted', summaryText().indexOf('滑条 4') >= 0, summaryText())
  ok('and the first skip names its cause', summaryText().indexOf('跳过：不是推理等级行') >= 0, summaryText())
  const offSummaryControl = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'], depthValues: { showInComposer: false } })
  render(offSummaryControl, { sessionId: 'session-7', useProjection: fakeUseProjection })
  await wait()
  await wait()
  ok('a switched-off row names its own cause', summaryText({ showInComposer: false }).indexOf('模型面板保持原样') >= 0, summaryText({ showInComposer: false }))

  section('the settings form uses the shipped button and switch tokens')
  const formCss = injectedCss()
  ok(
    'the primary button borrows the shipped primary pair',
    formCss.indexOf('.dshp-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);') >= 0,
    'dshp-btn-primary rule',
  )
  ok('its hover state borrows the shipped hover', formCss.indexOf('.dshp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }') >= 0)
  ok('no hard-coded white text on a themed fill', formCss.indexOf('.dshp-btn-primary') >= 0 && formCss.indexOf('brand-primary); color: #fff') < 0)
  ok('the switch thumb reads the theme thumb token', formCss.indexOf('background: var(--dsw-alias-switch-thumb);') >= 0)
  ok('and the switch track reads the shipped primary fill', formCss.indexOf('.dshp-switch[aria-checked="true"] { background: var(--dsw-alias-button-primary-fill); }') >= 0)
  ok('focus rings use the shipped focus pair', formCss.indexOf('var(--dsw-focus-ring-width)') >= 0 && formCss.indexOf('var(--dsw-focus-ring-color') >= 0)

  section('the palette setting is honoured')
  const monoControl = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'], depthValues: { palette: 'mono' } })
  const monoPanel = shippedPanel({ session: 'session-4', id: ':r9:-menu' })
  await settle(monoControl, { sessionId: 'session-4', useProjection: fakeUseProjection })
  const monoSlider = monoPanel.effortRow.childOfClass('dshp-eff-slider')
  const monoGradient = monoSlider === null ? '' : String(monoSlider.childOfClass('dshp-eff-ghost').style.backgroundImage)
  ok('mono palette swaps the ramp', monoGradient.indexOf('#c3c8d0') >= 0 && monoGradient.indexOf('#33373d') >= 0, monoGradient)

  section('labels = false drops the level name')
  const plainControl = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'], depthValues: { labels: false } })
  const plainPanel = shippedPanel({ session: 'session-6', id: ':r10:-menu' })
  await settle(plainControl, { sessionId: 'session-6', useProjection: fakeUseProjection })
  const plainValue = plainPanel.effortRow.childOfClass('dshp-eff-value')
  ok(
    'the name goes and the slider stays',
    plainValue !== null && plainValue.textContent === '' && plainPanel.effortRow.childOfClass('dshp-eff-slider') !== null,
    plainValue === null ? 'missing' : JSON.stringify(plainValue.textContent),
  )

  section('showInComposer = false leaves the shipped panel alone')
  const offControl = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'], depthValues: { showInComposer: false } })
  const offPanel = shippedPanel({ session: 'session-7', id: ':r11:-menu' })
  ok('it renders nothing', render(offControl, { sessionId: 'session-7', useProjection: fakeUseProjection }) === null)
  await wait()
  ok(
    'the shipped row is untouched',
    offPanel.effortRow.getAttribute('data-dshp-row') === null && offPanel.effortRow.children.length === 3,
    JSON.stringify(offPanel.effortRow.children.length),
  )

  section('a rejected write is reported on the row itself')
  state.failNextSelect = true
  const failControl = liveControlFor({ namespaces: ['dsh-polish:thinking-depth'] })
  const failPanel = shippedPanel({ session: 'session-8', id: ':r12:-menu' })
  await settle(failControl, { sessionId: 'session-8', useProjection: fakeUseProjection })
  const failSlider = failPanel.effortRow.childOfClass('dshp-eff-slider')
  ok('the slider is there', failSlider !== null)
  ok('and it starts clean', failSlider !== null && failSlider.getAttribute('data-dshp-state') === '', failSlider && String(failSlider.getAttribute('data-dshp-state')))
  failSlider.fire('pointerdown', { clientX: 390, pointerId: 9 })
  failSlider.fire('pointerup', { clientX: 390, pointerId: 9 })
  await wait()
  render(failControl, { sessionId: 'session-8', useProjection: fakeUseProjection })
  await wait()
  ok(
    'the failure shows as a ring on the row, not a new panel',
    failSlider.getAttribute('data-dshp-state') === 'error' && failSlider.getAttribute('aria-invalid') === 'true',
    failSlider.getAttribute('data-dshp-state'),
  )
  ok('and the level it kept is the old one', failSlider.getAttribute('aria-valuetext') === 'high', failSlider.getAttribute('aria-valuetext'))
  const failValue = failPanel.effortRow.childOfClass('dshp-eff-value')
  ok('the name snaps back to the level that is still in force', failValue !== null && failValue.textContent === 'high', failValue === null ? 'missing' : failValue.textContent)
  ok('the reason is available on hover, in place', failSlider.title === '提供方拒绝', String(failSlider.title))
  state.failNextSelect = false

  // ---------------------------------------------------------------------------
  // composer-history (component C): up-arrow recall of this session's user msgs.
  // ---------------------------------------------------------------------------

  section('composer-history: wired into the shipped bundle')
  ok('the recall engine is present', source.indexOf('function createComposerHistory()') >= 0)
  ok('the per-session anchor component is present', source.indexOf('function makeHistorySession(childCtx, engine)') >= 0)
  ok('it writes the session tag into the composer tool row', source.indexOf("'data-dshp-history': String(sessionId)") >= 0)
  ok('it recalls only user-typed messages (type user/message + source.kind user)', source.indexOf("ev.type !== 'user/message'") >= 0 && source.indexOf("data.source.kind !== 'user'") >= 0)
  ok('it orders history newest-first for recall', source.indexOf('newestFirst') >= 0)
  ok('it pages the session through remote.session', source.indexOf('remoteSession.page(request)') >= 0 && source.indexOf('remoteSession.projections(') >= 0)
  ok(
    'it writes the recall via insertText with a beforeinput fallback',
    source.indexOf("document.execCommand('insertText', false, text)") >= 0 && source.indexOf("'beforeinput'") >= 0,
  )
  ok(
    'it prefers the composer setDraft face over the DOM when available (the reliable clear)',
    source.indexOf('actions.setDraft(text)') >= 0 && source.indexOf('props.inputActions') >= 0,
  )
  ok('the row id is wired into the browser half', source.indexOf("'dsh-polish:composer-history'") >= 0)
  ok('the row has its own config page', source.indexOf('key: ROW_KEY_HISTORY') >= 0)
  ok(
    'a user edit commits the recalled draft and exits recall: capture input listener + own-write guard (0.4.43)',
    source.indexOf("document.addEventListener('input', onInput, true)") >= 0 &&
      source.indexOf('var lastWrite = null') >= 0 &&
      source.indexOf('function guardWrite(input, text)') >= 0 &&
      source.indexOf('if (w && w.input === input && Date.now() < w.until && currentText(input) === w.text) return') >= 0,
  )
  ok(
    'deep paging pulls older pages on demand at the oldest entry (0.4.50): fetchOlder, the beforeSeq cursor over ALL events, and the capped recall list',
    source.indexOf('function fetchOlder(sessionId, remoteSession)') >= 0 &&
      source.indexOf('function minSeqOf(records)') >= 0 &&
      source.indexOf('beforeSeq: h.cursor') >= 0 &&
      source.indexOf('HISTORY_RECALL_MAX') >= 0 &&
      source.indexOf('older.hasMore && !older.deep') >= 0,
  )

  section('composer-history: anchor always present (inert); behaviour gated by the served row')
  {
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: [] }))
    const offKeys = registrations.map((entry) => entry.options.name + ':' + (entry.options.key || entry.options.id))
    ok('the config page registers even while the row is off', offKeys.includes('plugins.row.config:dsh-polish#dsh-polish:composer-history'))
    ok('the inert session anchor is present even while the row is off (behaviour is gated separately)', offKeys.includes('conversation.input.right:dsh-polish:composer-history'))
  }
  {
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const onKeys = registrations.map((entry) => entry.options.name + ':' + (entry.options.key || entry.options.id))
    ok('the session anchor registers when its row is on', onKeys.includes('conversation.input.right:dsh-polish:composer-history'))
    ok('the config page registers when its row is on', onKeys.includes('plugins.row.config:dsh-polish#dsh-polish:composer-history'))
  }

  section('composer-history: the up-arrow recall state machine')
  function fireKeydown(key) {
    const ev = { key, defaulted: false, preventDefault() { this.defaulted = true } }
    const handlers = (documentStub.__handlers['keydown'] || []).slice()
    for (const fn of handlers) fn(ev)
    return ev
  }
  {
    // This session's log: three user messages, one assistant reply and one blank
    // user entry (the last two must be ignored), ordered oldest -> newest by seq.
    state.historyRecords = [
      { event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first message' }] } } },
      { event: { seq: 2, type: 'assistant/message', data: { source: { kind: 'assistant' }, content: 'a reply that must not be recalled' } } },
      { event: { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second message' }] } } },
      { event: { seq: 4, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'third message' }] } } },
      { event: { seq: 5, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '   ' }] } } },
    ]
    remoteCalls.length = 0

    // A bare composer: the session anchor and the editable as siblings.
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-hist')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable

    // Isolate this apply's keydown handler, then mount + publish its session.
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    ok('the recall session cell is registered', cell !== undefined)
    const tree = render(cell.Component, { sessionId: 'sess-hist' })
    ok(
      'the anchor renders a hidden session span',
      tree !== null && tree.type === 'span' && tree.props['data-dshp-history'] === 'sess-hist' && tree.props.hidden === true,
      tree === null ? 'null' : JSON.stringify(tree.props),
    )

    let ev = fireKeydown('ArrowUp')
    ok('up on an empty field is intercepted to start recall', ev.defaulted === true)
    await wait()
    ok('the page request targets this session', remoteCalls.some((c) => c.method === 'page' && c.payload.address.sessionId === 'sess-hist'))
    ok('the most recent user message is recalled', editable.textContent === 'third message', JSON.stringify(editable.textContent))

    ev = fireKeydown('ArrowUp')
    ok('the next up steps to the older message', editable.textContent === 'second message', JSON.stringify(editable.textContent))
    ev = fireKeydown('ArrowUp')
    ok('up keeps stepping to the oldest message', editable.textContent === 'first message', JSON.stringify(editable.textContent))
    ev = fireKeydown('ArrowUp')
    ok('up at the oldest stays put (no index wrap)', editable.textContent === 'first message', JSON.stringify(editable.textContent))

    ev = fireKeydown('ArrowDown')
    ok('down steps back to the newer message', editable.textContent === 'second message', JSON.stringify(editable.textContent))
    ev = fireKeydown('ArrowDown')
    ok('down reaches the newest message again', editable.textContent === 'third message', JSON.stringify(editable.textContent))
    ev = fireKeydown('ArrowDown')
    ok('down at the newest clears the field and exits recall', editable.textContent === '', JSON.stringify(editable.textContent))

    // After the newest-down already cleared the field and ended recall, a fresh
    // draft (no recall active) leaves the caret to the browser.
    editable.textContent = 'third message!'
    ev = fireKeydown('ArrowUp')
    ok('with recall ended, up on a draft is left to the caret', ev.defaulted !== true)
  }

  section('composer-history: recall writes through the composer setDraft (the reliable clear)')
  {
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    state.historyRecords = [
      { event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: '1' } } },
      { event: { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: '2' } } },
      { event: { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: '3' } } },
    ]
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-draft')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    // The composer's public setDraft face, mirroring the real inputActions: it
    // sets the full draft AND reflects it in the (fake) editor DOM — exactly the
    // way DSH's editor.update does. Records the last full draft requested.
    let draft = ''
    const inputActions = { setDraft: (t) => { draft = t; editable.textContent = t } }
    render(cell.Component, { sessionId: 'sess-draft', inputActions })

    fireKeydown('ArrowUp') // empty -> most recent ('3')
    await wait()
    ok('recall fills through setDraft (the reliable path), not the DOM', draft === '3', JSON.stringify(draft))
    fireKeydown('ArrowUp') // -> '2'
    ok('up steps to the older message via setDraft', draft === '2', JSON.stringify(draft))
    fireKeydown('ArrowUp') // -> '1'
    ok('up reaches the oldest via setDraft', draft === '1', JSON.stringify(draft))
    fireKeydown('ArrowDown') // -> '2'
    ok('down steps back to the newer message via setDraft', draft === '2', JSON.stringify(draft))
    fireKeydown('ArrowDown') // -> '3' (the newest)
    ok('down reaches the newest via setDraft', draft === '3', JSON.stringify(draft))
    fireKeydown('ArrowDown') // index 0 -> blank
    ok('down at the newest CLEARS the draft to "" via setDraft and exits recall', draft === '', JSON.stringify(draft))
    documentStub.activeElement = null
  }

  section('composer-history: a fast second ↑ cannot reset recall while setDraft is still landing')
  {
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    state.historyRecords = [
      { event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: 'older' } } },
      { event: { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: 'newer' } } },
    ]
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-race')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    let draft = ''
    // Simulate the asynchronous editor path: setDraft accepts the value, but
    // the DOM has not reflected it when the user presses ↑ again.
    const inputActions = { setDraft: (t) => { draft = t } }
    render(cell.Component, { sessionId: 'sess-race', inputActions })
    fireKeydown('ArrowUp')
    await wait()
    ok('race setup recalls the newest message through setDraft', draft === 'newer', JSON.stringify(draft))
    ok('race setup leaves the DOM temporarily blank', editable.textContent === '', JSON.stringify(editable.textContent))
    fireKeydown('ArrowUp')
    ok('a fast second ↑ advances to the older message instead of resetting to newest', draft === 'older', JSON.stringify(draft))
    documentStub.activeElement = null
  }

  section('composer-history: recall is index-driven, so multi-line entries never drop to the caret')
  {
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    // The newer entry is multi-line — the exact case that used to break: a stray
    // input event / whitespace-normalised text read as a "user edit" and dropped
    // the recall to the caret. Now navigation is purely by index, so it cannot.
    state.historyRecords = [
      { event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'alpha' }] } } },
      { event: { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'beta\nbeta2' }] } } },
    ]
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-hist3')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    render(cell.Component, { sessionId: 'sess-hist3' })

    fireKeydown('ArrowUp') // empty -> most recent (the multi-line entry)
    await wait()
    ok('recall starts on the first up (multi-line entry)', editable.textContent === 'beta\nbeta2')

    // Stepping across our own (multi-line) writes must never drop to the caret.
    fireKeydown('ArrowUp')
    ok('up steps to the older message', editable.textContent === 'alpha')
    fireKeydown('ArrowDown')
    ok('down steps back onto the multi-line entry', editable.textContent === 'beta\nbeta2')
    fireKeydown('ArrowDown')
    ok('down at the newest clears and exits recall', editable.textContent === '')
    documentStub.activeElement = null
  }

  section('composer-history: disabled by setting leaves the caret alone')
  {
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'], historyValues: { enabled: false } }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    render(cell.Component, { sessionId: 'sess-hist2' })
    const editable = domEl('div')
    editable.isContentEditable = true
    editable.textContent = ''
    documentStub.activeElement = editable
    const ev = fireKeydown('ArrowUp')
    ok('with the row disabled, up on an empty field is not intercepted', ev.defaulted !== true)
    documentStub.activeElement = null
  }

  section('composer-history: deep paging pulls older pages on demand at the oldest entry (0.4.50)')
  {
    // A dense log of 225 user + 225 assistant messages (seq 0..449). HISTORY_PAGE_MAX
    // is 200 MESSAGES (user+assistant), so the first page holds the newest 100 user
    // messages (U125..U224); a second — at the boundary must pull the next 100
    // (U25..U124) via beforeSeq — landing exactly on the 200-message recall cap.
    state.historyLog = []
    for (let i = 0; i < 225; i++) {
      state.historyLog.push({ event: { seq: 2 * i, type: 'user/message', data: { source: { kind: 'user' }, content: 'U' + i } } })
      state.historyLog.push({ event: { seq: 2 * i + 1, type: 'assistant/message', data: { source: { kind: 'assistant' }, content: 'A' + i } } })
    }
    state.historyAsOf = 449
    state.historyRecords = []
    remoteCalls.length = 0
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-deep')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable
    render(cell.Component, { sessionId: 'sess-deep' })

    const pageCalls = () => remoteCalls.filter((c) => c.method === 'page')
    let ev = fireKeydown('ArrowUp') // empty -> recall begins at the most recent
    await wait()
    ok(
      'the first page reads the newest 200 messages (throughSeq = asOf, no beforeSeq)',
      pageCalls().length === 1 && pageCalls()[0].payload.throughSeq === 449 && pageCalls()[0].payload.beforeSeq === undefined,
      JSON.stringify(pageCalls().map((c) => c.payload)),
    )
    ok('recall starts on the most recent user message', editable.textContent === 'U224', JSON.stringify(editable.textContent))

    for (let i = 0; i < 99; i++) fireKeydown('ArrowUp') // step to the oldest cached (U125)
    ok('at the oldest cached entry', editable.textContent === 'U125', JSON.stringify(editable.textContent))

    ev = fireKeydown('ArrowUp') // boundary: pull the next older page
    await wait()
    ok('the boundary up is intercepted to pull the older page', ev.defaulted === true)
    ok(
      'the second page is anchored at the original asOf and cut at the first page cursor (beforeSeq 250)',
      pageCalls().length === 2 &&
        pageCalls()[1].payload.throughSeq === 449 &&
        pageCalls()[1].payload.beforeSeq === 250 &&
        pageCalls()[1].payload.maxMessages === 200,
      JSON.stringify(pageCalls().map((c) => c.payload)),
    )
    ok('the boundary up lands on the newest message of the older page (U124)', editable.textContent === 'U124', JSON.stringify(editable.textContent))

    for (let i = 0; i < 99; i++) fireKeydown('ArrowUp') // step to the oldest cached (U25)
    ok('stepping older reaches the oldest merged entry', editable.textContent === 'U25', JSON.stringify(editable.textContent))

    const callsBeforeCap = pageCalls().length
    fireKeydown('ArrowUp') // boundary at the cap: no third fetch
    await wait()
    ok('at the recall cap the boundary up does not fetch another page', pageCalls().length === callsBeforeCap, String(pageCalls().length))
    ok('at the recall cap the boundary up stays on the oldest entry', editable.textContent === 'U25', JSON.stringify(editable.textContent))

    for (let i = 0; i < 100; i++) fireKeydown('ArrowDown') // back to the seam
    ok('down crosses the page seam back onto the first page (no network)', editable.textContent === 'U125', JSON.stringify(editable.textContent))
    ok('crossing the seam used no network', pageCalls().length === callsBeforeCap, String(pageCalls().length))
    fireKeydown('ArrowDown')
    ok('down keeps walking toward the newest', editable.textContent === 'U126', JSON.stringify(editable.textContent))
    documentStub.activeElement = null
    state.historyLog = null
    state.historyAsOf = undefined
  }

  section('composer-history: tool traffic rides pages but never counts; a user-less page still advances the cursor (0.4.50)')
  {
    // seq 0: a tool event. seq 1..250: assistant replies. seq 251..300: tool
    // events (NOT counted against maxMessages). seq 301: the only user message.
    // Page 1 (200 counted messages) therefore cuts at seq 52 — proving the 50
    // tool events in the range did not count — and carries ONE user message.
    // The boundary — fetches [0..52): assistant-only, no user message; the
    // cursor still walks to 0 and hasMore turns off, with the text unchanged.
    state.historyLog = [{ event: { seq: 0, type: 'tool/call', data: { name: 't0' } } }]
    for (let i = 1; i <= 250; i++) {
      state.historyLog.push({ event: { seq: i, type: 'assistant/message', data: { source: { kind: 'assistant' }, content: 'a' + i } } })
    }
    for (let i = 0; i < 50; i++) {
      state.historyLog.push({ event: { seq: 251 + i, type: 'tool/call', data: { name: 't' + (1 + i) } } })
    }
    state.historyLog.push({ event: { seq: 301, type: 'user/message', data: { source: { kind: 'user' }, content: 'new one' } } })
    state.historyAsOf = 301
    state.historyRecords = []
    remoteCalls.length = 0
    documentStub.__handlers['keydown'] = []
    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-tool')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable
    render(cell.Component, { sessionId: 'sess-tool' })

    const pageCalls = () => remoteCalls.filter((c) => c.method === 'page')
    fireKeydown('ArrowUp') // empty -> the only user message
    await wait()
    ok('recall shows the only user message', editable.textContent === 'new one', JSON.stringify(editable.textContent))

    fireKeydown('ArrowUp') // boundary: the older page holds no user message
    await wait()
    ok(
      'the older page is cut where 200 COUNTED messages end (beforeSeq 52, tools did not count)',
      pageCalls().length === 2 &&
        pageCalls()[1].payload.throughSeq === 301 &&
        pageCalls()[1].payload.beforeSeq === 52,
      JSON.stringify(pageCalls().map((c) => c.payload)),
    )
    ok('a user-less page leaves the field on the same (only) user message', editable.textContent === 'new one', JSON.stringify(editable.textContent))

    const callsAfter = pageCalls().length
    fireKeydown('ArrowUp') // cursor is now at 0 -> hasMore off -> no third fetch
    await wait()
    ok('after the user-less page walks the cursor to the log start, no further fetch happens', pageCalls().length === callsAfter, String(pageCalls().length))
    ok('the field still holds the only user message', editable.textContent === 'new one', JSON.stringify(editable.textContent))
    documentStub.activeElement = null
    state.historyLog = null
    state.historyAsOf = undefined
  }

  // ---------------------------------------------------------------------------
  // workspace-lru (component D): reorder the project groups by each workspace's
  // newest session (LRU), through DSH's own persisted remote.workspace.
  // ---------------------------------------------------------------------------

  function makeWorkspaceWorld() {
    // Committed (creation) order A,B,C,D over paths /a../d.
    const items = [
      { workspaceId: 'wsA', path: '/a', createdAt: '1970-01-01T00:00:10Z', title: 'A' },
      { workspaceId: 'wsB', path: '/b', createdAt: '1970-01-01T00:00:20Z', title: 'B' },
      { workspaceId: 'wsC', path: '/c', createdAt: '1970-01-01T00:00:30Z', title: 'C' },
      { workspaceId: 'wsD', path: '/d', createdAt: '1970-01-01T00:00:40Z', title: 'D' },
    ]
    // LRU: C(1000) > A(900) > D(850) > B(800); every group has a session, so the
    // createdAt fallback is not the deciding factor here.
    const byId = {
      s1: { sessionId: 's1', cwd: '/c', updatedAt: 1000 },
      s2: { sessionId: 's2', cwd: '/a', updatedAt: 900 },
      s3: { sessionId: 's3', cwd: '/b', updatedAt: 800 },
      s4: { sessionId: 's4', cwd: '/d', updatedAt: 850 },
    }
    const calls = []
    const orderIds = () => items.map((item) => item.workspaceId)
    // The LRU drives the reorder through the workspace SERVICE face
    // `workspaces.insertBefore(workspaceId, beforeWorkspaceId)` (two positional
    // args, like WorkspaceController.insertBefore) — NOT the raw remote, which
    // takes one object. It mutates the committed order + records the calls.
    const workspaces = {
      list: { getSnapshot: () => ({ items: items, archivedSessionIds: [] }) },
      insertBefore(id, before) {
        calls.push({ id: id, before: before === undefined ? null : before })
        const at = items.findIndex((item) => item.workspaceId === id)
        if (at < 0) return Promise.resolve({ ok: false, error: { code: 'unknown', message: 'unknown workspace' } })
        const [moved] = items.splice(at, 1)
        if (before === undefined) items.push(moved) // omitted anchor appends to the end
        else {
          const to = items.findIndex((item) => item.workspaceId === before)
          items.splice(to < 0 ? items.length : to, 0, moved)
        }
        return Promise.resolve({ ok: true, value: { workspaceIds: orderIds() } })
      },
    }
    // Kept as an alias so the (now-unused) remote seat still resolves if a test
    // references it; the LRU no longer calls it.
    const workspaceRemote = { insertBefore: workspaces.insertBefore }
    const sessions = { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId: byId }) } }
    return {
      items: items,
      byId: byId,
      calls: calls,
      orderIds: orderIds,
      workspaceRemote: workspaceRemote,
      workspaces: workspaces,
      sessions: sessions,
    }
  }

  section('workspace-lru: a desynced list is re-sorted to LRU, then idempotent')
  {
    const world = makeWorkspaceWorld()
    const lruOverrides = {
      namespaces: ['dsh-polish:workspace-lru'],
      workspaces: world.workspaces,
      sessions: world.sessions,
      workspaceRemote: world.workspaceRemote,
    }
    registrations.length = 0
    mod.apply(makeCtx(lruOverrides))
    await wait()
    ok(
      'the committed [A,B,C,D] is re-sorted to the LRU [C,A,D,B]',
      world.orderIds().join(',') === 'wsC,wsA,wsD,wsB',
      world.orderIds().join(','),
    )
    ok('the reorder is driven through the workspaces.insertBefore service', world.calls.length >= 1, JSON.stringify(world.calls))
    // A converged list must be a no-op: a fresh engine on the same order writes
    // nothing (no reorder loop).
    const settledCalls = world.calls.length
    mod.apply(makeCtx(lruOverrides))
    await wait()
    ok('a converged list is a no-op (idempotent, no reorder loop)', world.calls.length === settledCalls, JSON.stringify(world.calls.length - settledCalls))
  }

  section('workspace-lru: touching a workspace moves it to the front in one call')
  {
    const world = makeWorkspaceWorld()
    // Establish the LRU order [C,A,D,B] as if an earlier resort already did.
    world.items.splice(0, 4, world.items[2], world.items[0], world.items[3], world.items[1])
    // Now workspace A is used: its newest session outranks C's.
    world.byId.s2.updatedAt = 1100
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.workspaceRemote,
      }),
    )
    await wait()
    ok('the touched workspace jumps to the front', world.orderIds().join(',') === 'wsA,wsC,wsD,wsB', world.orderIds().join(','))
    ok(
      'and it takes exactly one insertBefore (move-to-front, not a resort)',
      world.calls.length === 1 && world.calls[0].id === 'wsA' && world.calls[0].before === 'wsC',
      JSON.stringify(world.calls),
    )
  }

  section('workspace-lru: off (row unserved) leaves the committed order alone')
  {
    const world = makeWorkspaceWorld()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: [],
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.workspaceRemote,
      }),
    )
    await wait()
    ok(
      'an unserved row writes no reorder',
      world.calls.length === 0 && world.orderIds().join(',') === 'wsA,wsB,wsC,wsD',
      world.orderIds().join(',') + ' / ' + world.calls.length,
    )
  }

  section('workspace-lru: disabled by its own setting stays off while served')
  {
    const world = makeWorkspaceWorld()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: false },
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.workspaceRemote,
      }),
    )
    await wait()
    ok(
      'a served-but-disabled row writes no reorder',
      world.calls.length === 0 && world.orderIds().join(',') === 'wsA,wsB,wsC,wsD',
      world.orderIds().join(',') + ' / ' + world.calls.length,
    )
  }

  section('workspace-lru: path normalisation (case / slash / trailing) still matches cwd to path')
  {
    // Windows-style mismatch: committed order is [Y, X] (creation order), but
    // X's session is the newest. X's workspace path is `C:\Proj` while its
    // session cwd is `c:/proj/` (case + slash + trailing-slash differences).
    // Without normalisation the lookup misses and X falls back to createdAt
    // (older than Y) — no reorder. With normPath they match — X jumps to front.
    const items = [
      { workspaceId: 'wsY', path: 'D:\\Other', createdAt: '1970-01-01T00:00:20Z', title: 'Y' },
      { workspaceId: 'wsX', path: 'C:\\Proj', createdAt: '1970-01-01T00:00:10Z', title: 'X' },
    ]
    const byId = {
      sx: { sessionId: 'sx', cwd: 'c:/proj/', updatedAt: 2000 },
      sy: { sessionId: 'sy', cwd: 'D:\\Other', updatedAt: 1000 },
    }
    const calls = []
    const orderIds = () => items.map((item) => item.workspaceId)
    const workspaces = {
      list: { getSnapshot: () => ({ items: items, archivedSessionIds: [] }) },
      insertBefore(id, before) {
        calls.push({ id: id, before: before === undefined ? null : before })
        const at = items.findIndex((item) => item.workspaceId === id)
        const [moved] = items.splice(at, 1)
        if (before === undefined) items.push(moved)
        else {
          const to = items.findIndex((item) => item.workspaceId === before)
          items.splice(to < 0 ? items.length : to, 0, moved)
        }
        return Promise.resolve({ ok: true, value: { workspaceIds: orderIds() } })
      },
    }
    const workspaceRemote = { insertBefore: workspaces.insertBefore }
    const sessions = { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId: byId }) } }
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        workspaces: workspaces,
        sessions: sessions,
        workspaceRemote: workspaceRemote,
      }),
    )
    await wait()
    ok(
      'case/slash/trailing mismatch still ranks the newest workspace first',
      orderIds().join(',') === 'wsX,wsY' && calls.length >= 1,
      orderIds().join(',') + ' / ' + JSON.stringify(calls),
    )
  }

  section('timer: host half — per-agent registration + minimal-preset exclusion + fire')
  {
    // The timer's core is its HOST half (timer/index.js), which imports
    // @deepseek-ai/schemastery + @deepseek-ai/dsh-tools + @deepseek-ai/dsh-llm
    // (none installed here). Load it by stubbing those imports, then drive apply
    // against a fake ctx and assert the tool registration + the fire path.
    // The real bundle registers tools the way dsh-browser does:
    //   import { defineTool } from '@deepseek-ai/dsh-tools'
    //   export const inject = ['tools', ...]
    //   ctx.tools.register(defineTool({ ..., output: { schema, render }, execute }))
    // (NOT the sandbox `harness` global — a profile bundle receives the real
    //  cordis ctx, and `harness` is only present in the dynamic-code VM sandbox.)
    global.__z = {
      object: (o) => o,
      boolean: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
      string: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
      number: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
      array: (inner) => ({ inner: inner, default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
      dict: (inner) => ({ inner: inner, default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
    }
    global.__defineTool = (options) => options
    global.__createUserMessage = (input) => Object.assign({ role: 'user' }, input)
    var timerRaw = fs.readFileSync(path.join(__dirname, '..', 'timer', 'index.js'), 'utf8')
    // /g matters: the module docstring quotes the exact import/export lines as
    // examples, so a first-match-only replace would hit the comment, not the code.
    var tsrc = timerRaw
      .replace(/import z from '@deepseek-ai\/schemastery'/g, 'var z = global.__z')
      .replace(/import \{ defineTool \} from '@deepseek-ai\/dsh-tools'/g, 'var defineTool = global.__defineTool')
      .replace(/import \{ createUserMessage \} from '@deepseek-ai\/dsh-llm'/g, 'var createUserMessage = global.__createUserMessage')
      .replace(/export const Config/g, 'global.__timerConfig')
      .replace(/export const inject/g, 'global.__timerInject')
      .replace(/export function apply/g, 'global.__timerApply = function apply')
    ;(0, eval)(tsrc)
    var applyTimer = global.__timerApply
    ok('timer host half loads', typeof applyTimer === 'function')
    ok(
      'timer uses the real bundle tool API (defineTool from dsh-tools, no harness global)',
      /import\s*\{\s*defineTool\s*\}\s*from\s*'@deepseek-ai\/dsh-tools'/.test(timerRaw) &&
        /import\s*\{\s*createUserMessage\s*\}\s*from\s*'@deepseek-ai\/dsh-llm'/.test(timerRaw) &&
        timerRaw.indexOf('harness.defineTool') < 0 &&
        timerRaw.indexOf('harness.registerTool') < 0,
    )
    ok(
      'timer declares inject incl. tools/timer/sessionController/sessions/settings/agents/agentPresets',
      Array.isArray(global.__timerInject) &&
        [
          'tools',
          'timer',
          'sessionController',
          'sessions',
          'settings',
          'agents',
          'agentPresets',
        ].every((s) => global.__timerInject.indexOf(s) >= 0),
    )

    function makeTimerCtx() {
      var state = {
        tools: [],
        intervals: [],
        settings: [],
        settingsUpdates: [],
        resolves: [],
        flushes: [],
        followups: [],
        effects: [],
        onHandlers: {},
        agents: new Map(),
      }
      // The new timer uses `export const inject = [...]` and reaches every
      // service on the TOP-LEVEL ctx (not a child from ctx.inject), so the fake
      // exposes all of them directly on ctx.
      var ctx = {
        fiber: 'fiber',
        tools: {
          register: (tool) => {
            state.tools.push(tool)
            return () => {
              var i = state.tools.indexOf(tool)
              if (i >= 0) state.tools.splice(i, 1)
            }
          },
        },
        interval: (cb, delay) => {
          var rec = { cb: cb, delay: delay, disposed: false, dispose: () => (rec.disposed = true) }
          state.intervals.push(rec)
          return rec.dispose
        },
        timeout: (cb, delay) => {
          var rec = { cb: cb, delay: delay, disposed: false, dispose: () => (rec.disposed = true) }
          state.intervals.push(rec)
          return rec.dispose
        },
        sessionController: {
          resolveAgent: (sid) => {
            state.resolves.push(sid)
            return Promise.resolve({
              agent: {
                session: { id: sid },
                followup: (msg) => state.followups.push({ sid: sid, msg: msg }),
              },
            })
          },
        },
        sessions: { flush: (session) => { state.flushes.push(session); return Promise.resolve() } },
        settings: {
          configure: (opts) => state.settings.push(opts),
          update: (ns, patch) => {
            state.settingsUpdates.push({ ns: ns, patch: patch })
            return Promise.resolve()
          },
        },
        effect: (fn, label) => {
          var d = fn()
          state.effects.push({ label: label, dispose: d })
          return () => d && d()
        },
        agents: {
          list: () => Array.from(state.agents.values()),
          get: (id) => (state.agents.has(id) ? state.agents.get(id) : undefined),
        },
agentPresets: {
          composedPreset: (agentCtx) => {
            for (var a of state.agents.values()) if (a.ctx === agentCtx) return a._presetId
            return undefined
          },
        },
        on: (event, handler) => {
          state.onHandlers[event] = handler
          return () => {
            delete state.onHandlers[event]
          }
        },
        state: state,
      }
      return ctx
    }

    // Helpers to drive the per-agent registration the way DSH would:
    //   agent/created fires with { agent }; the host reads
    //   agentPresets.composedPreset(agent.ctx) and, for NON-minimal agents,
    //   registers the two tools into agent.ctx.tools (a minimal agent gets none).
    function addFakeAgent(ctx, id, presetId) {
      var agentTools = []
      var agentCtx = {
        tools: {
          register: (tool) => {
            agentTools.push(tool)
            return () => {
              var i = agentTools.indexOf(tool)
              if (i >= 0) agentTools.splice(i, 1)
            }
          },
        },
      }
      var agent = { id: id, ctx: agentCtx, session: { id: id }, _tools: agentTools, _presetId: presetId }
      ctx.state.agents.set(id, agent)
      return agent
    }
    function fireCreated(ctx, agent) {
      var h = ctx.state.onHandlers['agent/created']
      if (h) h({ agent: agent })
    }
    function firePreset(ctx, sessionId) {
      var h = ctx.state.onHandlers['agent-preset/selected']
      if (h) h(sessionId)
    }
    function fireDisposed(ctx, agent) {
      var h = ctx.state.onHandlers['agent/disposed']
      if (h) h({ agent: agent })
    }
    function byAgentName(agent) {
      var m = {}
      agent._tools.forEach((t) => (m[t.name] = t))
      return m
    }

    // Pre-existing agents (created before this row loaded) are registered at
    // setup via ctx.agents.list() — the minimal one is skipped.
    var preCtx = makeTimerCtx()
    addFakeAgent(preCtx, 'pre-standard', 'standard')
    addFakeAgent(preCtx, 'pre-minimal', 'minimal')
    applyTimer(preCtx, { enabled: true })
    ok('settings page auto:false', preCtx.state.settings.length === 1 && preCtx.state.settings[0].auto === false)
    ok(
      'pre-existing non-minimal agent registered at setup',
      preCtx.state.agents.get('pre-standard')._tools.length === 2,
    )
    ok('pre-existing minimal agent NOT registered at setup', preCtx.state.agents.get('pre-minimal')._tools.length === 0)

    // New agents arrive via agent/created.
    var tctx = makeTimerCtx()
    applyTimer(tctx, { enabled: true })
    ok('top-level ctx.tools is no longer used (per-agent now)', tctx.state.tools.length === 0)

    var agentA = addFakeAgent(tctx, 'agentA', 'standard')
    fireCreated(tctx, agentA)
    ok('non-minimal agent gets both timer tools on agent/created', agentA._tools.length === 2)

    var agentM = addFakeAgent(tctx, 'agentM', 'minimal')
    fireCreated(tctx, agentM)
    ok('minimal agent gets NO timer tools on agent/created', agentM._tools.length === 0)

    var byName = byAgentName(agentA)
    ok('timer_set + timer_cancel present on the registered agent', !!byName.timer_set && !!byName.timer_cancel)
    ok(
      'timer_set params well-formed',
      byName.timer_set &&
        byName.timer_set.parameters &&
        byName.timer_set.parameters.minutes &&
        byName.timer_set.parameters.minutes.required === true,
    )
    // The real ToolService.register THROWS unless the tool declares
    // output { schema, render } — this was the second latent bug.
    ok(
      'timer_set declares output { schema, render }',
      byName.timer_set &&
        byName.timer_set.output &&
        byName.timer_set.output.schema &&
        byName.timer_set.output.schema.type === 'object' &&
        byName.timer_set.output.schema.properties &&
        typeof byName.timer_set.output.render === 'function',
    )
    ok(
      'timer_cancel declares output { schema, render }',
      byName.timer_cancel &&
        byName.timer_cancel.output &&
        byName.timer_cancel.output.schema &&
        byName.timer_cancel.output.schema.type === 'object' &&
        typeof byName.timer_cancel.output.render === 'function',
    )

    var setRes = byName.timer_set.execute({ minutes: 1, message: '记得喝水' }, { agent: { session: { id: 'sess-T1' } } })
    ok('timer_set ok + echoes', setRes && setRes.ok === true && setRes.message === '记得喝水' && setRes.repeats === 1 && !!setRes.id)
    ok('interval scheduled for 60000ms', tctx.state.intervals.length === 1 && tctx.state.intervals[0].delay === 60000)

    // host->client data channel: the host writes the active-timer session ids
    // into the VOLATILE activeTimerSessionIds field; the client paints the row
    // clock from it. Assert the host side of that contract here.
    function lastActiveIds() {
      var u = tctx.state.settingsUpdates[tctx.state.settingsUpdates.length - 1]
      return u && u.patch ? u.patch.activeTimerSessionIds : undefined
    }
    function lastActiveFireAt() {
      var u = tctx.state.settingsUpdates[tctx.state.settingsUpdates.length - 1]
      return u && u.patch ? u.patch.activeTimerFireAt : undefined
    }
    ok(
      'set writes the session id into the volatile activeTimerSessionIds',
      Array.isArray(lastActiveIds()) && lastActiveIds().join(',') === 'sess-T1',
    )
    var t1FireAt = lastActiveFireAt() && lastActiveFireAt()['sess-T1']
    ok(
      'set writes the fire time into the volatile activeTimerFireAt (~now + 60000)',
      typeof t1FireAt === 'number' && t1FireAt > Date.now() + 55000 && t1FireAt < Date.now() + 65000,
    )

    tctx.state.intervals[0].cb()
    await wait()
    ok('fire resolves the session agent', tctx.state.resolves.length === 1 && tctx.state.resolves[0] === 'sess-T1')
    ok(
      'fire injects a user message (role user, timer source, text intact)',
      tctx.state.followups.length === 1 &&
        tctx.state.followups[0].msg.role === 'user' &&
        tctx.state.followups[0].msg.content[0].text === '记得喝水' &&
        tctx.state.followups[0].msg.source.kind === 'dsh-polish-timer',
    )
    ok('fire flushes the session', tctx.state.flushes.length === 1)
    ok('single-shot timer self-disposed after firing', tctx.state.intervals[0].disposed === true)
    ok(
      'final fire clears the session from activeTimerSessionIds',
      Array.isArray(lastActiveIds()) && lastActiveIds().length === 0,
    )
    ok(
      'final fire clears the session from activeTimerFireAt',
      lastActiveFireAt() !== undefined && Object.keys(lastActiveFireAt()).length === 0,
    )

    // a fresh LIVE timer (not yet fired) for the cancel test
    var liveRes = byName.timer_set.execute({ minutes: 2, message: '取消' }, { agent: { session: { id: 'sess-T1b' } } })
    var liveInterval = tctx.state.intervals[tctx.state.intervals.length - 1]
    var cancelRes = byName.timer_cancel.execute({ id: liveRes.id }, { agent: { session: { id: 'sess-T1b' } } })
    ok('timer_cancel on a live timer ok', cancelRes && cancelRes.ok === true)
    ok('timer_cancel disposed the interval', liveInterval && liveInterval.disposed === true)
    ok(
      'cancelling a live timer clears the session from activeTimerSessionIds',
      Array.isArray(lastActiveIds()) && lastActiveIds().length === 0,
    )
    var cancelMissing = byName.timer_cancel.execute({ id: 'nope' }, { agent: { session: { id: 'sess-T1b' } } })
    ok('timer_cancel on unknown id -> ok:false', cancelMissing && cancelMissing.ok === false)

    // repeats=2 keeps the interval alive after the 1st fire, stops after the 2nd.
    byName.timer_set.execute({ minutes: 0.5, repeats: 2, message: 'tick' }, { agent: { session: { id: 'sess-T2' } } })
    var iv2 = tctx.state.intervals[tctx.state.intervals.length - 1]
    ok('repeats=2 scheduled at 30000ms', iv2 && iv2.delay === 30000)
    iv2.cb()
    await wait()
    ok('repeats=2 NOT disposed after 1st fire', iv2.disposed === false)
    var t2FireAt = lastActiveFireAt() && lastActiveFireAt()['sess-T2']
    ok(
      'repeats=2 refreshes the fire time after the 1st fire (~now + 30000)',
      typeof t2FireAt === 'number' && t2FireAt > Date.now() + 25000 && t2FireAt < Date.now() + 35000,
    )
    ok(
      'repeats=2 still active after 1st fire (icon stays until the final fire)',
      Array.isArray(lastActiveIds()) && lastActiveIds().join(',') === 'sess-T2',
    )
    iv2.cb()
    await wait()
    ok('repeats=2 disposed after 2nd fire', iv2.disposed === true)
    ok(
      'repeats=2 final fire clears the session from activeTimerSessionIds',
      Array.isArray(lastActiveIds()) && lastActiveIds().length === 0,
    )

    var badRes = byName.timer_set.execute({ minutes: 0 }, { agent: { session: { id: 'sess-T3' } } })
    ok('minutes=0 rejected', badRes && badRes.ok === false)

    // Live preset change (best-effort re-eval): switching to minimal unregisters,
    // switching back to a normal preset re-registers.
    agentA._presetId = 'minimal'
    firePreset(tctx, 'agentA')
    ok('switching an agent to minimal unregisters its timer tools', agentA._tools.length === 0)
    agentA._presetId = 'standard'
    firePreset(tctx, 'agentA')
    ok('switching back to standard re-registers its timer tools', agentA._tools.length === 2)

    // agent/disposed clears bookkeeping; a fresh agent/created re-registers.
    fireDisposed(tctx, agentA)
    fireCreated(tctx, agentA)
    ok('after dispose, agent/created re-registers', agentA._tools.length === 2)

    var offCtx = makeTimerCtx()
    applyTimer(offCtx, { enabled: false })
    ok(
      'enabled:false registers no tools and wires no handlers',
      offCtx.state.tools.length === 0 && !offCtx.state.onHandlers['agent/created'],
    )
  }

  section('timer: client half — row clock wiring (source)')
  {
    ok(
      'the clock component paints only when the row session has an active timer',
      source.indexOf('function makeTimerLeadingIcon(store)') >= 0 &&
        source.indexOf('var key = String(sessionId)') >= 0 &&
        source.indexOf('state.sessionIds.indexOf(key) >= 0') >= 0,
    )
    ok(
      'applyTimerActive reads the volatile activeTimerSessionIds + fireAt into the store',
      source.indexOf('function applyTimerActive(ctx)') >= 0 &&
        source.indexOf('Array.isArray(read.value.activeTimerSessionIds)') >= 0 &&
        source.indexOf('activeTimerFireAt') >= 0 &&
        source.indexOf('function pushActive(ids, fireAt, source)') >= 0 &&
        source.indexOf('timerActiveStore.set({ sessionIds: list, fireAt: fires })') >= 0,
    )
    ok(
      'startTimerPoll does a fresh remote.settings.describe() read of activeTimerSessionIds',
      source.indexOf('function startTimerPoll(remoteSettings)') >= 0 &&
        source.indexOf('remoteSettings && remoteSettings.describe ? remoteSettings.describe()') >= 0 &&
        source.indexOf('view.namespaces') >= 0 &&
        source.indexOf('namespaces[i].ns === NS_TIMER') >= 0 &&
        source.indexOf('interval = setInterval(readActive, 1500)') >= 0,
    )
    ok(
      'apply.js wires the poll behind its own remote.settings injection',
      source.indexOf("ctx.inject(['remote', 'remote.settings']") >= 0 &&
        source.indexOf('startTimerPoll(child.remote.settings)') >= 0,
    )
    ok(
      'apply.js registers the clock in the row LEADING seat (idle-only slot)',
      source.indexOf("ctx.slots.inject('sidebar.session.row.leading'") >= 0 &&
        source.indexOf("id: 'dsh-polish:timer-icon'") >= 0,
    )
    ok(
      'the clock icon shows a live "remaining + fire clock" tooltip on hover',
      source.indexOf('function timerTooltip(fireAt, now)') >= 0 &&
        source.indexOf('function formatRemaining(ms)') >= 0 &&
        source.indexOf('function fireClockLabel(fireAt, now)') >= 0 &&
        source.indexOf('title: timerTooltip(fireAt, now)') >= 0,
    )
    ok(
      'the tooltip remaining time ticks once a second via useNow (idle rows do not tick)',
      source.indexOf('function useNow(active, intervalMs)') >= 0 &&
        source.indexOf('useNow(active, 1000)') >= 0,
    )
    ok(
      'startTimerPoll reads the volatile activeTimerFireAt and feeds pushActive',
      source.indexOf('row.value.activeTimerFireAt') >= 0 &&
        source.indexOf('pushActive(ids, fireAt,') >= 0,
    )
  }

  // ---------------------------------------------------------------------------
  // timer (0.4.49): disabled by default — the official dsh-schedule (自动化任务)
  // fully covers it: persistent across restarts, after/at/every/daily/weekly/
  // cron selectors, last-missed catch-up, delivery history, sidebar task page,
  // and a session-row clock mark in the SAME sidebar.session.row.leading seat.
  // The component code is kept intact: re-enabling the row switch restores the
  // pre-0.4.49 behavior (in-memory countdown, non-persistent).
  // ---------------------------------------------------------------------------

  section('timer: 0.4.49 — the bundle ships the row disabled (official dsh-schedule supersedes)')
  {
    const patch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    const idx = patch.indexOf("- id: 'dsh-polish:timer'")
    ok(
      'the bundle ships the timer row disabled by default',
      idx >= 0 && /disabled: true/.test(patch.slice(idx, idx + 300)),
      patch.slice(Math.max(0, idx - 80), idx + 300),
    )
    ok(
      'the row comment documents the official dsh-schedule supersede (0.4.49)',
      idx >= 0 &&
        /dsh-schedule/.test(patch.slice(Math.max(0, idx - 1200), idx)) &&
        /0\.4\.49/.test(patch.slice(Math.max(0, idx - 1200), idx)),
    )
    ok(
      'the client timer page carries the official-supersede note',
      source.indexOf('TIMER_OFFICIAL_NOTE') >= 0 &&
        source.indexOf('dsh-schedule') >= 0 &&
        source.indexOf('自动化任务') >= 0 &&
        source.indexOf('本计时器组件') >= 0,
    )
    ok(
      'the host Config default stays enabled (row switch remains the master switch)',
      fs.readFileSync(path.join(__dirname, '..', 'timer', 'index.js'), 'utf8').indexOf('enabled: z.boolean().default(true)') >= 0,
    )
  }

  section('mode-switch: host half — volatile request — recompose — result')
  {
    // The core is its HOST half (mode-switch/index.js), which imports only
    // @deepseek-ai/schemastery. Load it by stubbing that import, then drive apply
    // against a fake ctx: the client writes a volatile `request`, the host polls
    // ctx.settings.describe(), calls agentPresets.recompose, appends
    // agent-preset/selected, and writes back `result`.
    // A fully-chainable fake schemastery: every builder/chain method returns a
    // shared object that also re-exposes all the chain methods, so any
    // z.x().a().b()... chain in the source evaluates without error. (The real
    // schemastery has no .optional(); our source uses .default({}).volatile().)
    function zchain() {
      var s = {}
      ;[
        'optional',
        'volatile',
        'default',
        'is',
        'required',
        'min',
        'max',
        'step',
        'loose',
        'hidden',
        'comment',
        'description',
      ].forEach(function (m) {
        s[m] = function () {
          return s
        }
      })
      return s
    }
    global.__z = {
      object: (fields) => {
        var s = zchain()
        s.fields = fields
        return s
      },
      boolean: () => zchain(),
      string: () => zchain(),
      number: () => zchain(),
      array: (inner) => zchain(),
    }
    var modeRaw = fs.readFileSync(path.join(__dirname, '..', 'mode-switch', 'index.js'), 'utf8')
    var msrc = modeRaw
      .replace(/import z from '@deepseek-ai\/schemastery'/g, 'var z = global.__z')
      .replace(/export const Config/g, 'global.__modeSwitchConfig')
      .replace(/export const inject/g, 'global.__modeSwitchInject')
      .replace(/export function apply/g, 'global.__modeSwitchApply = function apply')
    ;(0, eval)(msrc)
    var applyModeSwitch = global.__modeSwitchApply
    ok('mode-switch host half loads', typeof applyModeSwitch === 'function')
    ok(
      'mode-switch declares inject incl. settings/agents/sessionController/agentPresets/timer',
      Array.isArray(global.__modeSwitchInject) &&
        ['settings', 'agents', 'sessionController', 'agentPresets', 'timer'].every((s) => global.__modeSwitchInject.indexOf(s) >= 0),
    )
    ok(
      'mode-switch switches via agentPresets.recompose (not select — select blocks non-blank)',
      modeRaw.indexOf('agentPresets.recompose') >= 0 && modeRaw.indexOf('agentPresets.select') < 0,
    )
    ok(
      'mode-switch polls the volatile channel with ctx.settings.describe() + writes result via update',
      modeRaw.indexOf('ctx.settings.describe()') >= 0 && modeRaw.indexOf('ctx.settings.update(NS, { result: result })') >= 0,
    )
    ok(
      'mode-switch appends agent-preset/selected after a successful recompose (drives the timer re-sync)',
      modeRaw.indexOf("agent.session.append('agent-preset/selected'") >= 0,
    )

    function makeModeSwitchCtx() {
      var state = {
        settingsValue: {},
         resolvedAgents: new Map(),
         resolveAgentErrors: new Map(),
         resolveAgentCalls: [],
        settingsRevision: 0,
        settingsUpdates: [],
        configures: [],
        effects: [],
        intervals: [],
        agents: new Map(),
        recomposes: [],
        appends: [],
        currentPresets: new Map(),
        recomposeFail: null,
      }
      var ctx = {
        fiber: 'fiber',
        settings: {
          configure: (opts) => state.configures.push(opts),
          describe: () => [{ ns: 'dsh-polish:mode-switch', revision: state.settingsRevision, value: state.settingsValue }],
          update: (ns, patch) => {
            state.settingsUpdates.push({ ns: ns, patch: patch })
            state.settingsValue = Object.assign({}, state.settingsValue, patch)
            state.settingsRevision += 1
            return Promise.resolve()
          },
        },
        agents: {
          list: () => Array.from(state.agents.values()),
          get: (id) => (state.agents.has(id) ? state.agents.get(id) : undefined),
        },
sessionController: {
           resolveAgent: (id) => {
             state.resolveAgentCalls.push(id)
             if (state.resolveAgentErrors.has(id)) {
               var error = state.resolveAgentErrors.get(id)
               return { then: () => ({ catch: (reject) => reject(error) }) }
             }
             var resumed = state.resolvedAgents.get(id)
             if (resumed !== undefined) return { then: (resolve) => { resolve({ agent: resumed }); return { catch: () => {} } } }
             return { then: () => ({ catch: (reject) => reject(new Error('session not found')) }) }
           },
         },
         agentPresets: {
          // A synchronous thenable: on the success path .then(success) runs
          // success() immediately and its .catch is a no-op; on the fail path it
          // returns a thenable whose .catch drives failure(err) — so the async
          // code path is exercised without a real microtask (sync harness).
          recompose: (agentCtx, preset) => {
            state.recomposes.push({ ctx: agentCtx, preset: preset })
            if (state.recomposeFail) return { then: (res, rej) => ({ catch: (c) => c(state.recomposeFail) }) }
             state.currentPresets.set(agentCtx.agent, preset)
            return { then: (res) => { res(); return { catch: () => {} } } }
          },
        },
        interval: (cb, delay) => {
          var rec = { cb: cb, delay: delay, disposed: false, dispose: () => (rec.disposed = true) }
          state.intervals.push(rec)
          return rec
        },
        effect: (fn, label) => {
          var d = fn()
          state.effects.push({ label: label, dispose: d })
          return () => d && d()
        },
        state: state,
      }
      ctx.agentPresets.composedPreset = (agentCtx) => state.currentPresets.get(agentCtx.agent) || ''
      return ctx
    }

    var warned = []
    var realWarn = console.warn
    console.warn = (m) => warned.push(m)

    function addAgent(ctx, id) {
      var agent = {
        id: id,
        ctx: { agent: id },
        session: { id: id, append: (event, payload) => ctx.state.appends.push({ id: id, event: event, payload: payload }) },
      }
      ctx.state.agents.set(id, agent)
      return agent
    }
    // Simulate the CLIENT writing the volatile request.
    function writeRequest(ctx, sessionId, preset, nonce, action) {
      ctx.state.settingsValue = { request: { sessionId: sessionId, preset: preset, nonce: nonce, action: action || 'switch' } }
    }
    function tick(ctx) {
      if (ctx.state.intervals.length > 0) ctx.state.intervals[0].cb()
    }

    // enabled: configure(auto:false) + a 1s poll interval, but no request yet.
    var mctx = makeModeSwitchCtx()
    applyModeSwitch(mctx, { enabled: true })
    ok('mode-switch enabled configures the settings page auto:false', mctx.state.configures.length === 1 && mctx.state.configures[0].auto === false)
    ok('mode-switch enabled starts a 1s poll interval', mctx.state.intervals.length === 1 && mctx.state.intervals[0].delay === 1000)
    ok('mode-switch does nothing with no request', mctx.state.recomposes.length === 0 && mctx.state.settingsUpdates.length === 0)

    // A real request: the client asks to switch agentA — minimal (nonce 1).
    var agentA = addAgent(mctx, 'agentA')
    writeRequest(mctx, 'agentA', 'minimal', 1)
    tick(mctx)
    ok(
      'mode-switch recomposes the named agent to the requested preset',
      mctx.state.recomposes.length === 1 && mctx.state.recomposes[0].preset === 'minimal' && mctx.state.recomposes[0].ctx === agentA.ctx,
    )
    ok(
      'mode-switch appends agent-preset/selected after a successful recompose',
      mctx.state.appends.length === 1 &&
        mctx.state.appends[0].event === 'agent-preset/selected' &&
        mctx.state.appends[0].payload.agentPreset === 'minimal',
    )
    ok(
      'mode-switch writes back a result with the same nonce (ok)',
      mctx.state.settingsValue.result && mctx.state.settingsValue.result.nonce === 1 && mctx.state.settingsValue.result.ok === true,
    )

    // A re-poll at the same nonce must NOT re-process (nonce gating).
    tick(mctx)
    tick(mctx)
    ok('mode-switch is idempotent per nonce (no re-recompose)', mctx.state.recomposes.length === 1 && mctx.state.appends.length === 1)

    // A newer nonce re-triggers.
    writeRequest(mctx, 'agentA', 'standard', 2)
    tick(mctx)
    ok(
      'mode-switch re-triggers on a newer nonce',
      mctx.state.recomposes.length === 2 &&
        mctx.state.recomposes[1].preset === 'standard' &&
        mctx.state.settingsValue.result.nonce === 2 &&
        mctx.state.settingsValue.result.ok === true,
    )

    // A cold session is visible in the sidebar but absent from agents.get()
     // after a DSH restart; sessionController.resolveAgent must resume it first.
     var coldAgent = addAgent(mctx, 'cold-agent')
     mctx.state.agents.delete('cold-agent')
     mctx.state.resolvedAgents.set('cold-agent', coldAgent)
     writeRequest(mctx, 'cold-agent', 'standard', 3)
     tick(mctx)
     ok('mode-switch resumes a cold session before recomposing', mctx.state.resolveAgentCalls.indexOf('cold-agent') >= 0 && mctx.state.recomposes[2].ctx === coldAgent.ctx)
     ok('cold-session switch writes an ok result', mctx.state.settingsValue.result.nonce === 3 && mctx.state.settingsValue.result.ok === true)
     mctx.state.resolveAgentErrors.set('resume-fail', new Error('resume boom'))
     writeRequest(mctx, 'resume-fail', 'standard', 4)
     tick(mctx)
     ok('resume failure is reported without recomposing', mctx.state.settingsValue.result.nonce === 4 && mctx.state.settingsValue.result.ok === false && mctx.state.recomposes.length === 3)

     // A failed recompose is reported (ok:false + error) and does NOT append.
    mctx.state.recomposeFail = 'preset boom'
    writeRequest(mctx, 'agentA', 'broken', 5)
    tick(mctx)
    ok(
      'a failed recompose writes ok:false with the error',
      mctx.state.settingsValue.result.nonce === 5 && mctx.state.settingsValue.result.ok === false && mctx.state.settingsValue.result.error === 'preset boom',
    )
    ok('a failed recompose does NOT append agent-preset/selected', mctx.state.appends.length === 3)

    // An unknown session is reported (ok:false, no recompose).
    mctx.state.recomposeFail = null
    writeRequest(mctx, 'missing', 'minimal', 6)
    tick(mctx)
    ok(
      'an unknown session writes ok:false without recomposing',
      mctx.state.recomposes.length === 4 && mctx.state.settingsValue.result.nonce === 6 && mctx.state.settingsValue.result.ok === false,
       JSON.stringify({ recomposes: mctx.state.recomposes.length, result: mctx.state.settingsValue.result, resolves: mctx.state.resolveAgentCalls }),
    )

    writeRequest(mctx, 'agentA', '', 7, 'current')
    tick(mctx)
    ok('current-mode lookup marks the live preset without recomposing', mctx.state.recomposes.length === 4 && mctx.state.settingsValue.result.currentPreset === 'standard' && mctx.state.settingsValue.result.sessionId === 'agentA')
    var previousResolveCalls = mctx.state.resolveAgentCalls.length
    writeRequest(mctx, 'cold-agent', '', 8, 'current')
    tick(mctx)
    ok('current-mode lookup does not resume cold sessions', mctx.state.resolveAgentCalls.length === previousResolveCalls && mctx.state.settingsValue.result.ok === false)

    // disabled: configures the page but starts NO poll interval.
    var offCtx = makeModeSwitchCtx()
    applyModeSwitch(offCtx, { enabled: false })
    ok('mode-switch disabled configures the page but starts no poll', offCtx.state.configures.length === 1 && offCtx.state.intervals.length === 0)

    console.warn = realWarn
    void warned
  }

  section('mode-switch: client half — "..." menu wiring (source)')
  {
    var buildSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-client.cjs'), 'utf8')
    ok(
      'the client defines the "..." menu component + the result poll',
      source.indexOf('function makeModeSwitchMenu(child)') >= 0 &&
        source.indexOf('function startModeSwitchResultPoll(remoteSettings)') >= 0,
    )
    ok(
      'the result poll logs each nonce at most once (the result stays in the row config forever)',
      source.indexOf('lastLoggedNonce = 0') >= 0 &&
        source.indexOf("result.nonce !== lastLoggedNonce") >= 0,
    )
    ok(
      'the client lists presets via remote.agentPresets.list() and parses {presets: [...]}',
      source.indexOf('child.remote.agentPresets') >= 0 &&
        source.indexOf("typeof agentPresets.list !== 'function'") >= 0 &&
        source.indexOf('function extractModePresets(response)') >= 0 &&
        source.indexOf('Array.isArray(roster.presets)') >= 0 &&
         source.indexOf("typeof response.ok === 'boolean'") >= 0 &&
         source.indexOf('response.value') >= 0,
     )
     var extractModePresets = eval('(' + extractFunction(source, 'extractModePresets') + ')')
     ok('wrapped agent preset success is unwrapped into menu rows', extractModePresets({ ok: true, value: { presets: [{ id: 'minimal', name: 'Minimal' }] } })[0].id === 'minimal')
     ok('failed agent preset response does not become a fake menu row', extractModePresets({ ok: false, error: { message: 'denied' } }).length === 0)
     ok(
       'the list failure path warns instead of silently pretending success',
       source.indexOf("response.ok === false") >= 0 && source.indexOf('预设列表读取失败') >= 0,
    )
    ok(
      'mode-switch reads the live current preset without waking cold sessions', modeRaw.indexOf('function resolveCurrentPreset(request)') >= 0 && modeRaw.indexOf('composedPreset(agent.ctx)') >= 0 && modeRaw.indexOf("request.action === 'current'") >= 0)
     ok(
       'clicking a preset writes the volatile request (sessionId/preset/nonce) via remote.settings.update',
      source.indexOf('function requestModeSwitch(child, sessionId, presetId)') >= 0 &&
        source.indexOf('NS_MODE_SWITCH') >= 0 &&
        source.indexOf("request: { sessionId: String(sessionId), preset: presetId, nonce: nonce, action: 'switch' }") >= 0,
    )
    ok(
      'mode switch renders a compact two-level preset submenu',
      source.indexOf('切换模式') >= 0 && source.indexOf("aria-haspopup': 'menu'") >= 0 && source.indexOf("role: 'menu'") >= 0 && source.indexOf("'preset-' + preset.id") >= 0 && source.indexOf('currentPreset') >= 0,
    )
    ok(
      'the preset list is a separate portaled card beside the menu (no clipped absolute flyout)',
      source.indexOf('dshp-mode-switch-card') >= 0 &&
        source.indexOf("require('react-dom')") >= 0 &&
        source.indexOf('modeSwitchReactDOM(') >= 0 &&
        source.indexOf("document.body") >= 0 &&
        source.indexOf("left: 'calc(100% - 3px)'") < 0 &&
        source.indexOf('dshp-mode-switch-submenu') < 0 &&
        source.indexOf('dshp-mode-switch-expander') < 0,
    )
    ok(
      'the card anchors to the menu card rect, right side with left flip, and follows scroll/resize',
      source.indexOf("closest('[role=\"menu\"]')") >= 0 &&
        source.indexOf('MODE_SWITCH_CARD_WIDTH') >= 0 &&
        source.indexOf('addEventListener(\'scroll\', reposition, true)') >= 0,
    )
    ok(
      'the card opens and closes only on click (no hover state changes)',
      source.indexOf("onMouseEnter: function () { setExpanded(true) }") < 0 &&
        source.indexOf('dshp-mode-switch-submenu-anchor') < 0 &&
        source.indexOf('if (cardOpen) closeCard()') >= 0,
    )
    ok(
      'card pointerdown stops propagation so the menu treats it as inside, and a pick switches + closes both',
      source.indexOf('onPointerDown: function (event) { event.stopPropagation() }') >= 0 &&
        source.indexOf('props.useMenuOpenState') >= 0 &&
        source.indexOf('openState[1](false)') >= 0 &&
        source.indexOf('dshp-mode-switch-item') >= 0,
    )
    ok(
      'the card shares the Menu surface tokens and is content-sized (no fixed 220px slab)',
      source.indexOf('--dsw-menu-surface-fill') >= 0 &&
        source.indexOf('backdropFilter') >= 0 &&
        source.indexOf('--dsw-elevation-prominent') >= 0 &&
        source.indexOf("width: 'max-content'") >= 0 &&
        source.indexOf("minWidth: '150px'") >= 0 &&
        source.indexOf("width: MODE_SWITCH_CARD_WIDTH + 'px'") < 0,
    )
    ok(
      'apply.js wires the menu behind remote.agentPresets + gates it on the served row (whileServed)',
      source.indexOf("ctx.inject(['remote', 'remote.agentPresets', 'remote.settings']") >= 0 &&
        source.indexOf('child.configForms.whileServed([NS_MODE_SWITCH]') >= 0 &&
        source.indexOf("child.slots.inject('sidebar.workspaces.session.menu.item'") >= 0 &&
        source.indexOf("id: 'dsh-polish:mode-switch'") >= 0,
    )
    ok('the client source is in the build list', buildSrc.indexOf('src/client/mode-switch/mode-switch.js') >= 0)
  }

  section('prompts: host half — systemPrompt section + assembly capture')
  {
    var promptsRaw = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'index.js'), 'utf8')
    ok(
      'Config carries the library (active/custom) + a volatile preview channel',
      promptsRaw.indexOf('active: z.string().default(\'default\')') >= 0 &&
        promptsRaw.indexOf("custom: z") >= 0 &&
         promptsRaw.indexOf('activeByPreset: z.dict(z.string()).default({}).volatile()') >= 0 &&
        promptsRaw.indexOf('preview: z') >= 0 &&
        promptsRaw.indexOf('.volatile()') >= 0,
    )
    ok(
      'injects settings + systemPrompt + timer',
      promptsRaw.indexOf("export const inject = ['settings', 'systemPrompt', 'timer', 'agents', 'agentPresets', 'connection']") >= 0,
    )
    ok(
      '0.4.54: all client-written fields are volatile (rc.1 rejects non-volatile runtime writes -> "保存被拒绝")',
      promptsRaw.indexOf("active: z.string().default('default').volatile()") >= 0 &&
        promptsRaw.indexOf('    .default([])\n    .volatile(),') >= 0 &&
        promptsRaw.indexOf('toolPrompts: z.dict(z.string()).default({}).volatile()') >= 0 &&
        promptsRaw.indexOf("toolPromptMode: z.string().default('append').volatile()") >= 0,
    )
    ok(
      '0.4.91: the custom prompt is registered PER AGENT; append = own section (complete:false), replace = SAME-NAME takeover of the persona slot (complete:true)',
      promptsRaw.indexOf('agent.ctx.systemPrompt.section({') >= 0 &&
        promptsRaw.indexOf('name: plan.name') >= 0 &&
        promptsRaw.indexOf('interpolate: false') >= 0 &&
        promptsRaw.indexOf('complete: plan.complete') >= 0 &&
        promptsRaw.indexOf("plan = { name: PERSONA_PREFIX_SECTION, complete: true }") >= 0 &&
        promptsRaw.indexOf("plan = { name: SECTION_NAME, complete: false }") >= 0 &&
        promptsRaw.indexOf('syncGlobalSection') < 0 &&
        promptsRaw.indexOf('var registered = null') < 0,
    )
    ok(
      'the section text is a live closure (content edits need no re-registration)',
      promptsRaw.indexOf('var cur = currentSpec(reg.presetId)') >= 0 &&
        promptsRaw.indexOf('registeredByAgent.set(agent.id, reg)') >= 0,
    )
    ok(
      're-registration happens only when the active id, mode or slot changes',
      promptsRaw.indexOf('var key =') >= 0 &&
        promptsRaw.indexOf('old.key === key') >= 0 &&
        promptsRaw.indexOf('ctx.interval(syncSection, 1000)') >= 0,
    )
    ok(
      'captures the assembly waterfall without altering the result',
      promptsRaw.indexOf("ctx.on('system-prompt/assemble', onAssemble)") >= 0 &&
        promptsRaw.indexOf('Promise.resolve(next())') >= 0 &&
        promptsRaw.indexOf('return transformed') >= 0,
    )
    ok(
      'renders previews with the real renderPrompt when importable, lenient fallback otherwise',
      promptsRaw.indexOf("import('@deepseek-ai/dsh-system-prompt')") >= 0 &&
        promptsRaw.indexOf('typeof mod.renderPrompt === \'function\'') >= 0 &&
        promptsRaw.indexOf('function renderLenient(sections, variables)') >= 0,
    )
    ok(
      '0.4.40: replace mode renders only the user text; append mode renders the non-tool sections',
      promptsRaw.indexOf("effective = captureMode === 'replace' && mine ? String(mine.text || '') : renderSections(bodyWithMine, variables)") >= 0,
    )
    ok(
      '0.4.40 two-layer preview: tool sections excluded from every layer, template keeps raw {{vars}}, variable legend captured',
      promptsRaw.indexOf('function isToolSection(name)') >= 0 &&
        promptsRaw.indexOf("name.indexOf('tool:') === 0") >= 0 &&
        promptsRaw.indexOf("name.indexOf('tools:') === 0") >= 0 &&
        promptsRaw.indexOf('function joinRaw(list)') >= 0 &&
        promptsRaw.indexOf('effectiveTemplate: effectiveTemplate,') >= 0 &&
        promptsRaw.indexOf('defaultTemplate: defaultTemplate,') >= 0 &&
        promptsRaw.indexOf('toolText') < 0 &&
        promptsRaw.indexOf('toolCount') < 0 &&
        promptsRaw.indexOf('function variableList(variables)') >= 0,
    )
    ok(
      'the volatile preview schema carries the template/variable fields and no tool fields',
      promptsRaw.indexOf("effectiveTemplate: z.string().default('')") >= 0 &&
        promptsRaw.indexOf("defaultTemplate: z.string().default('')") >= 0 &&
        promptsRaw.indexOf("toolText: z.string().default('')") < 0 &&
        promptsRaw.indexOf('toolCount: z.number().default(0)') < 0,
    )
    ok(
      'default final form is the non-tool sections without the custom section',
      promptsRaw.indexOf('defaultText = renderSections(body, variables)') >= 0,
    )
    ok(
      'cleanup disposes the per-agent sections and the waterfall listener',
      promptsRaw.indexOf('registeredByAgent.forEach(function (reg) { disposeRegistration(reg) })') >= 0 &&
        promptsRaw.indexOf('stopCapture()') >= 0,
    )
    ok(
      '0.4.91: the four built-in templates are read from DSH OWN preset definitions (readDocument + preset-scope assembly) - no model call, no probe',
      promptsRaw.indexOf('ctx.agentPresets.readDocument(mode.id)') >= 0 &&
        promptsRaw.indexOf('ctx.agentPresets.acquireScope(presetId)') >= 0 &&
        promptsRaw.indexOf('ctx.systemPrompt.assemble({ scope: key })') >= 0 &&
        promptsRaw.indexOf('function readPersonaRow(text)') >= 0 &&
        promptsRaw.indexOf('function publishBuiltins()') >= 0 &&
        promptsRaw.indexOf('builtins: z') >= 0 &&
        promptsRaw.indexOf("id: 'builtin:' + mode.id") >= 0,
    )
    ok(
      '0.4.92: the built-in template resolution can never block the publication (per-step timeout) and prefers a LIVE agent of that preset (no retain/dispose, no model call)',
      promptsRaw.indexOf('function withBuiltinTimeout(promise, fallback)') >= 0 &&
        promptsRaw.indexOf('var BUILTIN_STEP_TIMEOUT_MS = 4000') >= 0 &&
        promptsRaw.indexOf('withBuiltinTimeout(ctx.agentPresets.readDocument(mode.id), null)') >= 0 &&
        promptsRaw.indexOf('withBuiltinTimeout(assemblePresetPrompt(mode.id), null)') >= 0 &&
        promptsRaw.indexOf('function scopeKeyOfCtx(ctxObj)') >= 0 &&
        promptsRaw.indexOf('ctx.agentPresets.composedPreset(agent.ctx)') >= 0 &&
        promptsRaw.indexOf('scopeKeyOfCtx(agent.ctx)') >= 0 &&
        promptsRaw.indexOf('function isOwnSection(section)') >= 0,
    )
    ok(
      '0.4.93: the built-in templates are also served by a host route (a second, read-only channel besides the settings row)',
      promptsRaw.indexOf("path: '/api/dshp/prompts/builtins'") >= 0 &&
        promptsRaw.indexOf('function builtinsSnapshot()') >= 0 &&
        promptsRaw.indexOf("'agentPresets', 'connection'") >= 0 &&
        promptsRaw.indexOf('dsh-polish: prompts builtins route') >= 0,
    )
    ok(
      '0.4.92: every resolved preset is published immediately (one slow preset cannot hide the other three)',
      promptsRaw.indexOf('builtinCache = Object.assign({}, builtinCache, next)') >= 0 &&
        promptsRaw.indexOf('publishBuiltins()') >= 0,
    )
    ok(
      '0.4.91: preset-scope probe assemblies never feed the preview capture (they are not an agent assembly)',
      promptsRaw.indexOf('probeScopes.has(scope)') >= 0 &&
        promptsRaw.indexOf('probeScopes.add(key)') >= 0,
    )
    ok(
      '0.4.91: a preset whose persona is complete (minimal) gets the custom text through the persona slot (append = persona + custom)',
      promptsRaw.indexOf('function personaIsComplete(presetId)') >= 0 &&
        promptsRaw.indexOf("spec.mode === 'replace' || personaComplete") >= 0 &&
        promptsRaw.indexOf("base ? base + '\\n\\n' + cur.content : cur.content") >= 0,
    )
  }

  section('prompts: host capture really produces the two layers (0.4.40 behavioral)')
  {
    // The source asserts above can pass while a list goes unfilled (the
    // `others` regression shipped that way), so run the real apply() + a
    // realistic assembly through the waterfall and check every layer.
    var promptsHostSrc = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'index.js'), 'utf8')
    promptsHostSrc = promptsHostSrc.replace("import z from '@deepseek-ai/schemastery'", 'const z = globalThis.__Z_STUB__')
    promptsHostSrc = promptsHostSrc.replace(/export const (Config|inject)/g, 'exports.$1')
    // applyToolPrompt 必须先行处理——'export function apply' 是它的前缀；
    // 保留函数声明（模块内 rewriteToolDescriptions 按名字引用它；命名函数表达式
    // 会丢掉模块作用域绑定），再补一行挂到 exports：
    promptsHostSrc = promptsHostSrc.replace('export function applyToolPrompt', 'function applyToolPrompt')
    promptsHostSrc = promptsHostSrc.replace('export function apply', 'exports.apply = function apply')
    promptsHostSrc += '\nexports.applyToolPrompt = applyToolPrompt;'
    const zChain = new Proxy(function () {}, {
      get: (t, p) => (p === Symbol.toPrimitive ? () => 'z' : zChain),
      apply: () => zChain,
    })
    globalThis.__Z_STUB__ = zChain
    const hostMod = { exports: {} }
    new Function('module', 'exports', 'require', promptsHostSrc)(hostMod, hostMod.exports, require)

    const hostValue = { enabled: true, active: 'default', custom: [], preview: {} }
    const written = []
    let hostAssemble = null
    const hostCtx = {
      effect(fn) {
        return typeof fn() === 'function' ? fn() : () => {}
      },
      on(event, handler) {
        if (event !== 'system-prompt/assemble') throw new Error('unexpected event ' + event)
        hostAssemble = handler
        return () => {
          hostAssemble = null
        }
      },
      interval() {
        return { dispose() {} }
      },
      settings: {
        configure() {},
        describe() {
          return [{ ns: 'dsh-polish:prompts', revision: 1, value: hostValue }]
        },
        update(ns, patch) {
          Object.assign(hostValue, patch)
          if (patch.preview) written.push(patch.preview)
          return Promise.resolve(true)
        },
      },
      systemPrompt: {
        section(spec) {
          globalThis.__HOST_SECTION__ = spec
          return function dispose() {
            globalThis.__HOST_SECTION__ = null
          }
        },
      },
    }
    hostMod.exports.apply(hostCtx, { enabled: true })
    const hostAssembly = {
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'deployment:persona-prefix', text: 'You are a coding agent powered by the {{model}} model.' },
        { name: 'tool:read', text: 'Use the read tool, not shell commands like cat.' },
        { name: 'tools:sdk', text: 'Tools SDK overview.' },
        { name: 'deployment:persona-suffix', text: 'Your working directory is C:\\work.' },
      ],
      contexts: [],
      tools: [{ name: 'read' }],
      variables: { model: 'qwen3.8-27b', provider: 'deepseek' },
    }
    hostAssemble(hostAssembly, {}, () => Promise.resolve(hostAssembly))
    await wait()
    const hp = written[written.length - 1]
    ok('the capture wrote a preview with all layers', !!hp, 'written=' + String(written.length))
    if (hp) {
      ok('final form is rendered: {{model}} substituted, NO tool sections', hp.effective.indexOf('qwen3.8-27b') >= 0 && hp.effective.indexOf('Use the read tool') < 0 && hp.effective.indexOf('Tools SDK overview') < 0, hp.effective.slice(0, 120))
      ok('default final form is the non-tool sections without the custom section', hp.defaultText.indexOf('qwen3.8-27b') >= 0 && hp.defaultText.indexOf('working directory') >= 0 && hp.defaultText.indexOf('Use the read tool') < 0, hp.defaultText.slice(0, 120))
      ok('template layer keeps {{model}} and excludes tool sections', hp.effectiveTemplate.indexOf('{{model}}') >= 0 && hp.effectiveTemplate.indexOf('Use the read tool') < 0, hp.effectiveTemplate.slice(0, 100))
      ok('default template layer is the non-tool sections (regression: shipped empty)', hp.defaultTemplate.indexOf('{{model}}') >= 0 && hp.defaultTemplate.indexOf('working directory') >= 0, JSON.stringify(hp.defaultTemplate).slice(0, 100))
      ok('no tool layer at all: the preview carries no tool text/count', hp.toolText === undefined && hp.toolCount === undefined)
      ok('the variable legend maps placeholder to current value', Array.isArray(hp.variables) && hp.variables.some((v) => v.name === 'model' && v.value === 'qwen3.8-27b'))
    }
  }

  section('prompts: tool prompt rewrites tool descriptions (0.4.45 behavioral)')
  {
    // 纯函数矩阵 + 水幕集成：改写不得改变 assembly（header 持有自己的副本）；
    // capture 记录的必须是改写**前**的原始描述（用户写追加文本的参照物）。
    var promptsHostSrc2 = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'index.js'), 'utf8')
    promptsHostSrc2 = promptsHostSrc2.replace("import z from '@deepseek-ai/schemastery'", 'const z = globalThis.__Z_STUB__')
    promptsHostSrc2 = promptsHostSrc2.replace(/export const (Config|inject)/g, 'exports.$1')
    promptsHostSrc2 = promptsHostSrc2.replace('export function applyToolPrompt', 'function applyToolPrompt')
    promptsHostSrc2 = promptsHostSrc2.replace('export function apply', 'exports.apply = function apply')
    promptsHostSrc2 += '\nexports.applyToolPrompt = applyToolPrompt;'
    const hostMod2 = { exports: {} }
    new Function('module', 'exports', 'require', promptsHostSrc2)(hostMod2, hostMod2.exports, require)
    const atp = hostMod2.exports.applyToolPrompt

    const tools = [
      { name: 'read', description: 'Read a file.' },
      { name: 'create_goal', description: 'Create a goal.' },
      { name: 'web_search', description: 'Search the web.' },
    ]
    const appended = atp(tools, { create_goal: 'Only when the user explicitly asks.' }, 'append')
    ok('append 模式：原描述 + 空行 + 文本', appended[1].description === 'Create a goal.\n\nOnly when the user explicitly asks.')
    ok('append 模式：未命中的工具保留原引用（不无谓复制）', appended[0] === tools[0] && appended[2] === tools[2])
    const replaced = atp(tools, { create_goal: 'Only create when the user requests.' }, 'replace')
    ok('replace 模式：整份原描述被替换', replaced[1].description === 'Only create when the user requests.')
    ok('无任何改动时返回原数组引用（调用方据此不动 assembly）', atp(tools, {}, 'append') === tools && atp(tools, { nope: 'x' }, 'append') === tools && atp(tools, { create_goal: '   ' }, 'append') === tools)
    ok('非数组、非对象入参原样放行', atp(null, {}, 'append') === null && atp(tools, null, 'append') === tools)
    ok('尾部保留：改动项之后的工具不丢失', atp([{ name: 'a' }, { name: 'b' }, { name: 'c', description: 'c' }], { b: 'B2' }, 'append').map(function (t) { return t.name }).join(',') === 'a,b,c')

    const hostValue2 = {
      enabled: true,
      active: 'default',
      custom: [],
      preview: {},
      toolPrompts: { create_goal: '仅当用户明确要求时创建目标' },
      toolPromptMode: 'append',
    }
    let hostAssemble2 = null
    const toolPreviewWrites = []
    const hostCtx2 = {
      effect(fn) {
        return typeof fn() === 'function' ? fn() : () => {}
      },
      on(event, handler) {
        if (event !== 'system-prompt/assemble') throw new Error('unexpected event ' + event)
        hostAssemble2 = handler
        return function () {
          hostAssemble2 = null
        }
      },
      interval() {
        return { dispose() {} }
      },
      settings: {
        configure() {},
        describe() {
          return [{ ns: 'dsh-polish:prompts', revision: 1, value: hostValue2 }]
        },
        update(ns, patch) {
          Object.assign(hostValue2, patch)
          if (patch.toolPreview) toolPreviewWrites.push(patch.toolPreview)
          return Promise.resolve(true)
        },
      },
      systemPrompt: {
        section(spec) {
          return function dispose() {}
        },
      },
    }
    hostMod2.exports.apply(hostCtx2, { enabled: true })
    const assembly2 = {
      sections: [{ name: 'harness:identity', text: 'identity' }],
      contexts: [],
      tools: [
        { name: 'read', description: 'Read a file.', parameters: {} },
        { name: 'create_goal', description: 'Create a persisted goal that keeps this session working.', parameters: {} },
      ],
      variables: {},
    }
    const out2 = await hostAssemble2(assembly2, {}, function () {
      return Promise.resolve(assembly2)
    })
    ok('水幕返回新 assembly，原对象不被改写', out2 !== assembly2 && assembly2.tools[1].description === 'Create a persisted goal that keeps this session working.')
    ok('create_goal 描述 = 原描述 + 空行 + 用户文本', out2.tools[1].description === 'Create a persisted goal that keeps this session working.\n\n仅当用户明确要求时创建目标')
    ok('未配置的工具不受影响（同引用）', out2.tools[0] === assembly2.tools[0])
    // 0.4.85：并集列表按 lastSeen 降序（同刻按名字序）——按名字取项，不按索引。
    var capturedGoal2 = toolPreviewWrites[0].tools.find(function (t) { return t.name === 'create_goal' })
    ok('capture 记录的是原始描述（改写前）', toolPreviewWrites.length === 1 && capturedGoal2.description === 'Create a persisted goal that keeps this session working.')
    ok('toolPreview 带 name + description + 来源元数据（lastSeen 时间戳；不带 parameters 体量）', toolPreviewWrites[0].tools.every(function (t) { return t.parameters === undefined && typeof t.lastSeen === 'number' && typeof t.sessionId === 'string' }))

    hostValue2.toolPromptMode = 'replace'
    const out3 = await hostAssemble2(assembly2, {}, function () {
      return Promise.resolve(assembly2)
    })
    ok('replace 模式：模型只看到用户文本', out3.tools[1].description === '仅当用户明确要求时创建目标')
    hostValue2.enabled = false
    const out4 = await hostAssemble2(assembly2, {}, function () {
      return Promise.resolve(assembly2)
    })
    ok('行停用：整份 assembly 原样放行（同引用）', out4 === assembly2)
  }

  section('prompts: client half — 提示词设置 page + row switch')
  {
    var promptsClientRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'prompts', 'prompts.js'), 'utf8')
    ok(
      '0.4.93 prompts client: the built-in templates come from the host route as well (second channel besides the settings row)',
      promptsClientRaw.indexOf("fetch('/api/dshp/prompts/builtins')") >= 0 &&
        promptsClientRaw.indexOf('var remoteList = Array.isArray(remoteBuiltins)') >= 0 &&
        promptsClientRaw.indexOf('setRemoteBuiltins(data.builtins)') >= 0,
    )
    ok(
      '0.4.94: the built-in caption is NOT a child of the <pre> (the minimal template showed a second line inside the text box)',
      promptsClientRaw.indexOf("className: 'dshp-preview-meta'") >= 0 &&
        promptsClientRaw.indexOf('内置模板内容（直接来自 DSH 的 preset 定义') < 0 &&
        promptsClientRaw.indexOf("'内置模板'") >= 0,
    )
    var uiStyles094 = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'styles.js'), 'utf8')
    ok(
      '0.4.94: buttons never text-wrap or overflow (nowrap + no shrink + ellipsis in the shared stylesheet)',
      uiStyles094.indexOf('.dshp-btn {') >= 0 &&
        uiStyles094.indexOf('white-space: nowrap; flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis;') >= 0 &&
        uiStyles094.indexOf('.dshp-btn-sm {') >= 0,
    )
    ok(
      '0.4.94: the preview control row wraps as whole buttons and the refresh note sits on its own line',
      promptsClientRaw.indexOf("rowGap: '6px', flexWrap: 'wrap'") >= 0 &&
        promptsClientRaw.indexOf("refreshNote ? React.createElement('div', { className: 'dshp-note'") >= 0,
    )
    var slimClient094 = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'session-slim', 'session-slim.js'), 'utf8')
    ok(
      '0.4.94: the noisy "xxx（yyy）" copy is gone from the prompts + slim pages',
      promptsClientRaw.indexOf('4 个内置模板（每模式一个，只读）') < 0 &&
        promptsClientRaw.indexOf('整份替换会丢弃 DSH 默认提示词') < 0 &&
        promptsClientRaw.indexOf('内容按字面量注入（不做变量替换）') < 0 &&
        promptsClientRaw.indexOf('只改工具描述文本（不改参数/行为）') < 0 &&
        slimClient094.indexOf('把长会话的当前窗口压成 checkpoint') < 0 &&
        slimClient094.indexOf('批量瘦身（筛选命中') < 0,
    )
    var promptsBuildSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-client.cjs'), 'utf8')
    ok(
      'defines the settings section page and the row config page',
      source.indexOf('function makePromptsSettingsPage(ctx)') >= 0 &&
        source.indexOf('function makePromptsRowPage(ctx)') >= 0,
    )
    ok(
      'the section registers settings.section (id prompts, order 25) only while the namespace is served',
      source.indexOf("ctx.configForms.whileServed([NS_PROMPTS]") >= 0 &&
        source.indexOf("ctx.slots.inject('settings.section'") >= 0 &&
        source.indexOf("id: 'prompts', order: 25") >= 0 &&
        source.indexOf("'提示词设置'") >= 0,
    )
    ok(
      'the page offers 当前生效/默认 tabs and a 复制 button (clipboard with fallback)',
      source.indexOf("'当前生效'") >= 0 &&
        source.indexOf("'默认'") >= 0 &&
        source.indexOf("'复制'") >= 0 &&
        source.indexOf('navigator.clipboard.writeText') >= 0 &&
        source.indexOf("document.execCommand('copy')") >= 0,
    )
    ok(
      '0.4.40 preview is source × view: 模板/最终形态 only — no tool view, no tool text',
      source.indexOf("'模板'") >= 0 &&
        source.indexOf("'最终形态'") >= 0 &&
        source.indexOf("'工具说明'") < 0 &&
        source.indexOf("view === 'tools'") < 0 &&
        source.indexOf('preview.toolText') < 0 &&
        source.indexOf("view === 'template'") >= 0 &&
        source.indexOf("preview.effectiveTemplate") >= 0 &&
        source.indexOf("varLegend.push('{{' + vv.name + '}} = ' + vv.value)") >= 0,
    )
    ok(
      'ships the four one-click templates in append mode',
      source.indexOf("'节省'") >= 0 &&
        source.indexOf("'谨慎'") >= 0 &&
        source.indexOf("'牧羊人'") >= 0 &&
        source.indexOf("'文科生'") >= 0,
    )
    ok(
      'the library is written atomically as one custom-array op with name/content validation',
      source.indexOf("path: ['custom']") >= 0 &&
        source.indexOf('PROMPTS_MAX_NAME = 24') >= 0 &&
        source.indexOf('PROMPTS_MAX_CONTENT = 20000') >= 0,
    )
    ok(
      'deleting the active prompt falls back to the default prompt in the same atomic write',
      source.indexOf("if (active === entry.id) ops.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: 'default' })") >= 0,
    )
    ok(
      '0.4.90 single-column layout: section/head/card/preview classes + 当前配置 section with a nowrap preset segmented control (radio rows removed to kill wrapping)',
      source.indexOf("className: 'dshp-section'") >= 0 &&
        source.indexOf("className: 'dshp-section-head'") >= 0 &&
        source.indexOf("className: 'dshp-card'") >= 0 &&
        source.indexOf("className: 'dshp-preview'") >= 0 &&
        source.indexOf("'当前配置'") >= 0 &&
        source.indexOf("flexWrap: 'nowrap'") >= 0,
    )
    ok(
      'the style sheet ships the new layout classes (card/preview/radio-row)',
      source.indexOf('.dshp-card {') >= 0 &&
        source.indexOf('.dshp-preview {') >= 0 &&
        source.indexOf('.dshp-radio-row {') >= 0,
    )
    ok(
      'the row page is the live kill switch and re-registers behind its row key',
      source.indexOf("key: ROW_KEY_PROMPTS") >= 0 &&
        source.indexOf('启用自定义系统提示词') >= 0,
    )
    ok(
      '0.4.45 two top-level tabs (系统提示词、工具提示) share the one row form',
      source.indexOf("'系统提示词'") >= 0 &&
        source.indexOf("'工具提示'") >= 0 &&
        source.indexOf("var [page, setPage] = React.useState('system')") >= 0 &&
        source.indexOf("if (page === 'tools')") >= 0 &&
        source.indexOf('pageTabs') >= 0,
    )
    ok(
      '0.4.45 tool tab: per-tool textarea drafts + 追加/整份替换 mode + save writes both fields',
      source.indexOf('TOOL_PROMPT_MAX = 2000') >= 0 &&
        source.indexOf('value.toolPreview') >= 0 &&
        source.indexOf("path: ['toolPromptMode']") >= 0 &&
        source.indexOf("path: ['toolPrompts']") >= 0 &&
        source.indexOf("name: 'dshp-tool-prompts-mode'") >= 0 &&
        source.indexOf('原始描述') >= 0 &&
        source.indexOf('保存工具提示') >= 0,
    )
    ok(
      '0.4.45 host config: persistent toolPrompts dict + mode + volatile toolPreview channel',
      promptsRaw.indexOf('toolPrompts: z.dict(z.string()).default({})') >= 0 &&
        promptsRaw.indexOf("toolPromptMode: z.string().default('append')") >= 0 &&
        promptsRaw.indexOf('toolPreview: z') >= 0,
    )
    ok(
      '0.4.45 host wiring: rewrite after capture in the same waterfall, live config read, fail-soft pass-through',
      promptsRaw.indexOf('function applyToolPrompt(tools, overrides, mode)') >= 0 &&
        promptsRaw.indexOf('writeToolPreview(assembly.tools, context)') >= 0 &&
        promptsRaw.indexOf('return rewriteToolDescriptions(transformed)') >= 0 &&
        promptsRaw.indexOf("var mode = value.toolPromptMode === 'replace' ? 'replace' : 'append'") >= 0,
    )
    ok('the client source is in the build list', promptsBuildSrc.indexOf('src/client/prompts/prompts.js') >= 0)
    ok(
      '0.4.65 render crash fix: the empty-editor hint reads editor.content, no bare `content` after a ternary line break',
      promptsClientRaw.indexOf('? editor.content.trim().length === 0') >= 0 &&
        !/\?\s*\n\s*content\.trim\(\)/.test(promptsClientRaw),
    )
    ok(
      '0.4.65 revision-gated re-render superseded by 0.4.78: the rev-only gate is gone (a volatile write that does not advance the row revision no longer freezes the page forever); the value-signature gate takes over',
      promptsClientRaw.indexOf('function readRowRevision()') < 0 &&
        promptsClientRaw.indexOf('if (rev === lastRev) return') < 0 &&
        promptsClientRaw.indexOf('function rowSig()') >= 0,
    )
    ok(
      '0.4.85 host: the tool list = union of recent per-session captures (supersedes the 0.4.65 stable-capture gate — the gate froze the list on the first-captured set, and a high-frequency single-tool background assembly session could pin the list to that one tool forever while the main session never landed; refresh re-published exactly that set); prompt preview TEXT keeps the 5s stability gate',
      promptsHostSrc2.indexOf('var TOOLS_RECENT_MS = 15 * 60 * 1000') >= 0 &&
         promptsHostSrc2.indexOf('var PROMPTS_STABLE_MS = 5000') >= 0 &&
        promptsHostSrc2.indexOf('var toolSeen = {}') >= 0 &&
        promptsHostSrc2.indexOf('origin && origin.agent') >= 0 &&
        promptsHostSrc2.indexOf('function unionList()') >= 0 &&
        promptsHostSrc2.indexOf('Date.now() - previewCandidateAt >= PROMPTS_STABLE_MS') >= 0 &&
        promptsHostSrc2.indexOf('now - toolCandidateAt >= PROMPTS_STABLE_MS') < 0,
    )
    ok(
      '0.4.65 preset templates updated to the current toolset (subagent_fork / workflow / office / humanizer / review-agent)',
      promptsClientRaw.indexOf('subagent_fork') >= 0 &&
        promptsClientRaw.indexOf('workflow') >= 0 &&
        promptsClientRaw.indexOf('office') >= 0 &&
        promptsClientRaw.indexOf('humanizer') >= 0 &&
        promptsClientRaw.indexOf('review-agent') >= 0,
    )
    ok(
      '0.4.68 host refresh: refreshNonce field + promoteLatest adopts the latest capture on nonce change',
      promptsHostSrc2.indexOf('refreshNonce: z.number().default(0).volatile()') >= 0 &&
        promptsHostSrc2.indexOf('function promoteLatest()') >= 0 &&
        promptsHostSrc2.indexOf("flushToolUnion('toolPreview(union-change)')") >= 0 &&
        promptsHostSrc2.indexOf('latestPreviewPatch = buildPreviewPatch(') >= 0 &&
        promptsHostSrc2.indexOf('if (nonce !== 0) promoteLatest()') >= 0,
    )
    ok(
      '0.4.68 client refresh buttons: tools tab + system preview tab write refreshNonce',
      promptsClientRaw.indexOf('function requestRefresh()') >= 0 &&
        promptsClientRaw.indexOf("path: ['refreshNonce']") >= 0 &&
        promptsClientRaw.indexOf('刷新工具列表') >= 0 &&
        promptsClientRaw.indexOf("'刷新'") >= 0,
    )
    // ---- 0.4.77: save robustness + activation + overflow fixes ----
    ok(
      '0.4.77 save: submit/refresh no longer pin the render-time revision (stale revisions get rejected whenever the row is rewritten between render and click; the controller re-reads the snapshot at write time when omitted)',
      promptsClientRaw.indexOf('form.mutate(ops, form.state.revision)') < 0 &&
        promptsClientRaw.indexOf('Promise.resolve(form.mutate(ops)).then(') >= 0 &&
        promptsClientRaw.indexOf("value: Date.now() }])") >= 0,
    )
    ok(
      '0.4.77 save: newly created custom entries are activated (the old flow stored the entry without writing active, so the saved prompt never took effect and the feature looked dead)',
      promptsClientRaw.indexOf("saveOps.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: entry.id })") >= 0 &&
        promptsClientRaw.indexOf('var saveOps = [{ op: \'set\', path: [\'custom\'], value: next }]') >= 0,
    )
    ok(
      '0.4.77 tool tab: an explicit unsaved-changes marker next to the save button (drafts vs stored comparison, so a lost save is visible)',
      promptsClientRaw.indexOf('var toolDirty = false') >= 0 &&
        promptsClientRaw.indexOf("className: 'dshp-note' }, '未保存')") >= 0,
    )
    var promptsNoWrapCount = (promptsClientRaw.match(/flexWrap: 'nowrap'/g) || []).length
    ok(
      '0.4.90 overflow: the key rows (preset selector, preview control, library) use nowrap so the page no longer squishes into line wraps (the user-reported 挤换行)',
      promptsNoWrapCount >= 3,
    )
    ok(
      '0.4.90 preset selector: short segmented tabs (标准/ptc/创造/极简) with full label+note in a title tooltip - the wrapping per-preset dropdown rows are gone',
      promptsClientRaw.indexOf('presetTabLabel') >= 0 && promptsClientRaw.indexOf('title: preset.label') >= 0 && promptsClientRaw.indexOf("path: ['activeByPreset', selectedPreset]") >= 0 && promptsClientRaw.indexOf("className: 'dshp-select'") >= 0,
    )
    ok(
      '0.4.77 overflow: both multi-line editors use the dedicated .dshp-textarea class (the 32px .dshp-select class made textareas render at select height)',
      (promptsClientRaw.match(/className: 'dshp-textarea'/g) || []).length >= 2 &&
        promptsClientRaw.indexOf("minHeight: '180px', fontFamily: 'inherit'") < 0,
    )
    var promptsStylesRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'styles.js'), 'utf8')
    ok(
      '0.4.77 styles: .dshp-textarea + previously-missing .dshp-radio rules, form/card min-width guards, note/hint overflow-wrap for long unbroken tokens',
      promptsStylesRaw.indexOf(".dshp-textarea { box-sizing: border-box; width: 100%; min-height: 56px;") >= 0 &&
        promptsStylesRaw.indexOf('.dshp-radio { display: flex; align-items: center; gap: 6px; cursor: pointer; }') >= 0 &&
        promptsStylesRaw.indexOf('padding: 2px 0; min-width: 0; max-width: 100%;') >= 0 &&
        promptsStylesRaw.indexOf('padding: 12px; min-width: 0; border:') >= 0 &&
        (promptsStylesRaw.match(/overflow-wrap: anywhere/g) || []).length >= 2,
    )
    // ---- 0.4.78: diag self-check + value-signature render gate + refresh re-publish ----
    var promptsHostRaw = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'index.js'), 'utf8')
    ok(
      '0.4.85 host: deployment diagnostics are removed from the Config surface',
      promptsHostRaw.indexOf('diag: z.string().default(\'\').volatile()') < 0 &&
        promptsHostRaw.indexOf('function pushDiag') < 0 &&
        promptsHostRaw.indexOf('function diagServedText') < 0 &&
        promptsHostRaw.indexOf('pushDiag(findRow())') < 0,
    )
    ok(
      '0.4.85 host: settings writes no longer expose deployment diagnostics',
      promptsHostRaw.indexOf('function stampWrite(promise)') >= 0 &&
        promptsHostRaw.indexOf("' REJECTED: '") < 0 &&
        promptsHostRaw.indexOf("flushToolUnion('toolPreview(first-capture)')") >= 0 &&
        promptsHostRaw.indexOf("flushToolUnion('toolPreview(union-change)')") >= 0,
    )
    ok(
      '0.4.85 host: refresh force re-publishes the current union (the 0.4.78 「点刷新必有反馈」property kept: whatever state the union is in, one write happens)',
      promptsHostRaw.indexOf("flushToolUnion('refresh toolPreview (re-published union)')") >= 0 &&
         promptsHostRaw.indexOf('function hydrateToolUnion(value)') >= 0 &&
        promptsHostRaw.indexOf("latestToolFull !== null && latestToolFull !== toolShownFull && latestToolList") < 0,
    )
    ok(
      '0.4.85 host: the waterfall second argument carries the agent/session identity (captured per tool); the 1s poll runs the 15-minute TTL sweep; writes only on shape change (a pure lastSeen update never writes — no re-render storm)',
      promptsHostRaw.indexOf('capture(transformed, context)') >= 0 &&
        promptsHostRaw.indexOf('function toolUnionSig(list)') >= 0 &&
        promptsHostRaw.indexOf("flushToolUnion('toolPreview(union-sweep)')") >= 0 &&
        promptsHostRaw.indexOf('var TOOLS_RECENT_MS = 15 * 60 * 1000') >= 0,
    )
    ok(
      '0.4.78 client: render gate is a value signature of the row (revision alone misses volatile updates that do not advance it) + a 5s proactive mirror.load()',
      promptsClientRaw.indexOf('function rowSig()') >= 0 &&
        promptsClientRaw.indexOf('tp.updatedAt || 0,') >= 0 &&
        promptsClientRaw.indexOf('var timer = setInterval(function () {') >= 0 &&
        promptsClientRaw.indexOf('var p = mirror.load()') >= 0 &&
        promptsClientRaw.indexOf('clearInterval(timer)') >= 0,
    )
    ok(
      '0.4.85 client: deployment debug diagnostics are removed from the tools page',
      promptsClientRaw.indexOf("'宿主自检 ' + value.diag") < 0 &&
        promptsClientRaw.indexOf('var receivedInfo =') < 0 &&
        promptsClientRaw.indexOf("'客户端收到 ' + receivedInfo") < 0,
    )
    ok(
      '0.4.78 client: unsaved-changes marker compares key-sorted entries (JSON.stringify key order produced false positives)',
      promptsClientRaw.indexOf('var key1 = Object.keys(uns1).sort()') >= 0 &&
        promptsClientRaw.indexOf('JSON.stringify(uns1) !== JSON.stringify(uns2)') < 0,
    )
    ok(
      '0.4.85 client: each tool row still shows the original description, without deployment diagnostics',
      promptsClientRaw.indexOf("' | tools[0]: '") < 0 &&
        promptsClientRaw.indexOf("title: '原始描述',") >= 0,
    )
    var promptsPatch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    var promptsPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    ok(
      'patch yml ships the prompts row, disabled by default',
      promptsPatch.indexOf("id: 'dsh-polish:prompts'") >= 0 &&
        promptsPatch.indexOf("name: 'dsh-polish/prompts'") >= 0 &&
        promptsPatch.lastIndexOf('disabled: true') > promptsPatch.lastIndexOf("id: 'dsh-polish:prompts'"),
    )
    ok(
      'the package exports the prompts subpath and ships the directory at 0.4.85',
      promptsPkg.version === '0.4.101' &&
        promptsPkg.exports['./prompts'] &&
        promptsPkg.exports['./prompts'].default === './prompts/index.js' &&
        promptsPkg.files.indexOf('prompts/') >= 0,
    )
  }

  section('prompts: settings page renders the two preview layers (0.4.40 behavioral)')
  {
    // Mount the real page against a fake ctx with a fully populated preview
    // and click through source × view — the `others` regression shipped
    // with empty layers and a tool view that did not belong here, so both
    // must be exercised.
    registrations.length = 0
    const previewFixture = {
      effective: 'FINAL-EFFECTIVE qwen3.8-27b',
      defaultText: 'FINAL-DEFAULT qwen3.8-27b',
      effectiveTemplate: 'TEMPLATE-EFFECTIVE {{model}} placeholder kept',
      defaultTemplate: 'TEMPLATE-DEFAULT {{model}} placeholder kept',
      variables: [
        { name: 'model', value: 'qwen3.8-27b' },
        { name: 'provider', value: 'deepseek' },
      ],
      updatedAt: Date.now(),
    }
    // The real mirror's `view.namespaces` is an array of {ns} entries; the
    // page's served check reads entry.ns, not the raw string.
    const promptsNs = ['dsh-polish:prompts']
    const pctx = makeCtx({
      namespaces: promptsNs,
      describeSnapshot: () => ({ namespaces: promptsNs, view: { namespaces: [{ ns: 'dsh-polish:prompts' }] } }),
      promptsValues: { enabled: true, active: 'default', custom: [], preview: previewFixture },
    })
    mod.apply(pctx)
    const entry = registrations.find((r) => r.options.name === 'settings.section' && r.options.id === 'prompts')
    ok('the prompts settings section is registered while served', entry !== undefined)
    const Page = entry && entry.Component
    function textOf(node) {
      if (node === null || node === undefined) return ''
      if (typeof node === 'string') return node
      if (Array.isArray(node)) return node.map(textOf).join('')
      return textOf(node.children)
    }
    function preOf(tree) {
      let found = null
      walk(tree, (node) => {
        if (found === null && node && node.type === 'pre') found = node
      })
      return found
    }
    function buttonOf(tree, label) {
      let found = null
      walk(tree, (node) => {
        if (found === null && node && node.type === 'button' && textOf(node).indexOf(label) === 0) found = node
      })
      return found
    }
    let tree = render(Page, {})
    await wait()
    tree = render(Page, {})
    let pre = preOf(tree)
    ok('the preview card renders', pre !== null)
    ok(
      'default view is the template: placeholder kept, no tool notes',
      textOf(pre).indexOf('TEMPLATE-EFFECTIVE') >= 0 && textOf(pre).indexOf('{{model}}') >= 0 && textOf(pre).indexOf('TOOL-TEXT') < 0,
      textOf(pre).slice(0, 120),
    )
    ok('the variable legend shows the current values', textOf(tree).indexOf('{{model}} = qwen3.8-27b') >= 0)
    ok(
      'no 工具说明 view exists (prompt component shows no tool content)',
      buttonOf(tree, '工具说明') === null && textOf(tree).indexOf('工具说明') < 0,
    )

  buttonOf(tree, '最终形态').props.onClick()
    tree = render(Page, {})
    pre = preOf(tree)
    ok(
      'the final view shows the rendered text (model substituted, no tool sections)',
      textOf(pre).indexOf('FINAL-EFFECTIVE') >= 0 && textOf(pre).indexOf('qwen3.8-27b') >= 0 && textOf(pre).indexOf('{{model}}') < 0,
      textOf(pre).slice(0, 120),
    )

  buttonOf(tree, '默认').props.onClick()
    tree = render(Page, {})
    pre = preOf(tree)
    ok(
      'the default source in the final view shows defaultText',
      textOf(pre).indexOf('FINAL-DEFAULT') >= 0 && textOf(pre).indexOf('FINAL-EFFECTIVE') < 0,
      textOf(pre).slice(0, 120),
    )

    buttonOf(tree, '模板').props.onClick()
    tree = render(Page, {})
    pre = preOf(tree)
    ok(
      'the default source in the template view shows defaultTemplate (regression: shipped empty)',
      textOf(pre).indexOf('TEMPLATE-DEFAULT') >= 0 && textOf(pre).indexOf('{{model}}') >= 0 && textOf(pre).indexOf('TEMPLATE-EFFECTIVE') < 0,
      textOf(pre).slice(0, 120),
    )
  }

  section('skill-loader and literal $/￥ mentions')
  {
    var skillLoaderRaw = fs.readFileSync(path.join(__dirname, '..', 'skill-loader', 'index.js'), 'utf8')
    var mentionRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'skill', 'skill-mention.js'), 'utf8')
    var skillBuildRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-client.cjs'), 'utf8')
    ok('skill-loader registers a skills provider and picker services', skillLoaderRaw.indexOf("export const inject = ['skills', 'fs', 'settings', 'timer']") >= 0 && skillLoaderRaw.indexOf('ctx.skills.registerProvider') >= 0)
    ok('skill-loader stays inside the DSH fs execution world', skillLoaderRaw.indexOf("from 'fs/promises'") < 0 && skillLoaderRaw.indexOf("from 'path'") < 0 && skillLoaderRaw.indexOf('ctx.fs.readText') >= 0)
    ok('skill-loader returns the markdown body required by DSH', skillLoaderRaw.indexOf('content: parsed.content.trim()') >= 0 && skillLoaderRaw.indexOf('content: parsed.body.trim()') >= 0)
    ok('skill-loader protects list/get name changes', skillLoaderRaw.indexOf('candidate.baseName || candidate.name') >= 0)
    ok('the client bundle includes a literal $/￥ skill picker', skillBuildRaw.indexOf('src/client/skill/skill-mention.js') >= 0 && mentionRaw.indexOf('function makeSkillMentionPicker') >= 0)
    ok('typing a trigger is not rewritten; selection immediately expands to a literal [name](path)', mentionRaw.indexOf("var replacement = '[' + skill.name + ']'") >= 0 && mentionRaw.indexOf('SELECTED_SKILL_MARKER') < 0)
    ok('no send-time rewriting: the host no longer hooks agent/pre-step', skillLoaderRaw.indexOf("ctx.on('agent/pre-step'") < 0 && skillLoaderRaw.indexOf('expandSelectedSkillText') < 0)
    ok('composer overlay is the registered picker surface', fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'runtime', 'apply.js'), 'utf8').indexOf("child.slots.inject('conversation.input.overlay'") >= 0)
    var queryFn = extractFunction(mentionRaw, 'parseSkillQueryText')
    var parseQuery = queryFn ? (0, eval)('(' + queryFn + ')') : () => null
    ok('a bare dollar opens suggestions but does not itself invoke a skill', parseQuery('$') && parseQuery('$').query === '')
    ok('a fullwidth trigger filters by the skill name', parseQuery('Use ￥Codex-skill') && parseQuery('Use ￥Codex-skill').query === 'codex-skill')
    ok('embedded currency and LaTeX closing dollars are not trigger tokens', parseQuery('price$100') === null && parseQuery('$x$') === null)
    // 0.4.62 — Tab-select forensics (rc.1 empty-composer regression): every
    // picker decision records its branch; the record lands in the keep-effort
    // row's volatile diagnostics so one failed Tab is explainable from the
    // patch file, and the Tab root resolution no longer dies on an odd
    // event.target.
    ok('0.4.62 the picker records select branches into keep-effort diagnostics', mentionRaw.indexOf('diag.skillDiag = rec') >= 0 && mentionRaw.indexOf("child.configForms.get(NS_KEEP_EFFORT)") >= 0 && mentionRaw.indexOf("path: ['diagnostics']") >= 0)
    ok('0.4.62 insertSkillMention reports the exact failing branch', mentionRaw.indexOf("return 'token-mismatch'") >= 0 && mentionRaw.indexOf("return 'no-text-point'") >= 0 && mentionRaw.indexOf("return 'exec-failed:'") >= 0 && mentionRaw.indexOf("if (exec === true) return ''") >= 0)
    ok('0.4.62 the Tab path falls back to the menu root when event.target misses the composer', mentionRaw.indexOf('usedFallback') >= 0 && mentionRaw.indexOf("branch: 'root-mismatch'") >= 0 && mentionRaw.indexOf("view.root.isConnected") >= 0)
    ok('0.4.62 a composing Tab/Enter is recorded before being swallowed', mentionRaw.indexOf("'select-swallowed'") >= 0 && mentionRaw.indexOf("branch: 'composing'") >= 0)
    ok('0.4.62 menu open/close snapshots the live composer DOM', mentionRaw.indexOf('function skillDiagSnapshot') >= 0 && mentionRaw.indexOf('root.outerHTML.slice(0, 1500)') >= 0 && mentionRaw.indexOf("event: opened ? 'open' : 'close'") >= 0)
    ok('0.4.62 the skill picker child injects configForms for the diag sink', fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'runtime', 'apply.js'), 'utf8').indexOf("ctx.inject(['remote', 'remote.settings', 'configForms']") >= 0)
    // 0.4.64 — on-screen forensics: the row-config channel is racy (the host
    // keep-effort backstop snapshots diagnostics at apply time and its flush
    // rewrites the whole field, clobbering the client record), so the
    // picker decision is rendered on-page at the moment it happens.
    ok('0.4.64 the picker decision renders an on-screen diag overlay', mentionRaw.indexOf('function skillDiagOverlay') >= 0 && mentionRaw.indexOf("document.getElementById('dshp-skill-diag')") >= 0 && mentionRaw.indexOf('skillDiagOverlay(record)') >= 0 && mentionRaw.indexOf('12000') >= 0)
    ok('0.4.64 the diag sink never returns null (overlay works without configForms)', mentionRaw.indexOf('if (!formOk) return null') < 0 && mentionRaw.indexOf('if (!formOk) return') >= 0)
    // 0.4.66 — the Tab-insert root cause is identified: execCommand
    // ('insertText') no-ops in this Lexical composer (the 0.4.12
    // composer-history finding) — it reports success while Lexical's
    // beforeinput handler declines the raw-DOM edit, so the menu closed
    // "ok" with nothing inserted and the keyup re-opened the list. The
    // write now goes through the composer's inputActions.setDraft (a
    // session-scoped slot prop, the same face voice input uses) and is
    // verified against the live composer text before the menu closes.
    // On-screen forensics are off (user request).
    ok('0.4.66 the on-screen diag forensics are switched off', mentionRaw.indexOf('var SKILL_DIAG_OFF = true') >= 0 && mentionRaw.indexOf('if (SKILL_DIAG_OFF) return function () {}') >= 0)
    ok('0.4.66 the insert writes through inputActions.setDraft (the editor.update channel)', mentionRaw.indexOf('function insertSkillMention(view, skill, inputActions)') >= 0 && mentionRaw.indexOf('inputActions.setDraft(newText)') >= 0 && mentionRaw.indexOf("return 'setDraft:' + newText") >= 0)
    ok('0.4.66 the picker reads the session-scoped inputActions prop and verifies the write before closing', mentionRaw.indexOf('var inputActions = props && props.inputActions') >= 0 && mentionRaw.indexOf('function insertAndClose(view, skill, inputActions, onDone)') >= 0 && mentionRaw.indexOf("onDone('setDraft-unverified')") >= 0)
  }

  section('notify: client half — pure event classification')
  {
    // The core decision (what counts as "completed" vs "needs your attention")
    // is a self-contained pure function; extract it from the built bundle and
    // exercise it directly, the way currentStepStart is tested.
    var cnSrc = extractFunction(source, 'classifyNotifyEvent')
    ok(
      'classifyNotifyEvent ships and is self-contained (no registry/audio refs)',
      cnSrc !== null && cnSrc.indexOf('sessionRegistry') < 0 && cnSrc.indexOf('notifyAudio') < 0,
      cnSrc ? cnSrc.slice(0, 40) : 'not found',
    )
    var classify = cnSrc === null ? () => null : (0, eval)('(' + cnSrc + ')')
    ok('turn/end reason.completed -> complete', classify({ type: 'turn/end', seq: 5, data: { reason: { kind: 'completed' } } }) === 'complete')
    ok('turn/end reason.aborted -> not a completion', classify({ type: 'turn/end', seq: 5, data: { reason: { kind: 'aborted' } } }) === null)
    ok('turn/end reason.error -> not a completion', classify({ type: 'turn/end', seq: 5, data: { reason: { kind: 'error' } } }) === null)
    ok('turn/end without a reason -> null', classify({ type: 'turn/end', seq: 5, data: {} }) === null)
    ok('approval/asked -> attention:approval', classify({ type: 'approval/asked', seq: 6 }) === 'attention:approval')
    ok('tool/call ask_user_question -> attention:question', classify({ type: 'tool/call', seq: 7, data: { name: 'ask_user_question' } }) === 'attention:question')
    ok('tool/call exit_plan_mode -> attention:plan-review', classify({ type: 'tool/call', seq: 8, data: { name: 'exit_plan_mode' } }) === 'attention:plan-review')
    ok('tool/call an unrelated tool -> null', classify({ type: 'tool/call', seq: 9, data: { name: 'read' } }) === null)
    ok(
      'step/end, assistant message, and null -> null',
      classify({ type: 'step/end', seq: 10 }) === null && classify({ type: 'assistant/message', seq: 11 }) === null && classify(null) === null,
    )
  }

  section('notify: client half — wiring + defaults (source)')
  {
    ok(
      'the engine reads the viewed session via the shared registry (no remote tap)',
      source.indexOf('function createNotify()') >= 0 && source.indexOf('sessionRegistryGet()') >= 0,
    )
    ok(
      'polling is durable-log based (projections + page)',
      source.indexOf('session.projections({ sessionId: sessionId })') >= 0 &&
        source.indexOf('session.page({ address: address, throughSeq: asOf, maxMessages: NOTIFY_PAGE_MAX })') >= 0,
    )
    ok('only NEW events (seq > prevSeq) fire', source.indexOf('seq <= prevSeq) continue') >= 0)
    ok('a different viewed session re-baselines (no historical fire)', source.indexOf('currentSession !== sessionId') >= 0)
    ok(
      'four independent toggles, all default OFF',
      source.indexOf('NOTIFY_DEFAULTS = { completeSound: false, completeNotify: false, attentionSound: false, attentionNotify: false }') >= 0,
    )
    ok(
      'sound is synthesized (Web Audio) and guarded',
      source.indexOf('function playCompletionSound()') >= 0 && source.indexOf('function playAttentionSound()') >= 0 && source.indexOf('window.AudioContext') >= 0,
    )
    ok(
      'notification uses the Web Notification API, guarded',
      source.indexOf('function showSystemNotification') >= 0 && source.indexOf('typeof Notification !== ') >= 0,
    )
    ok(
      'the notify row, defaults and page are wired',
      source.indexOf("var NS_NOTIFY = 'dsh-polish:notify'") >= 0 && source.indexOf('ROW_KEY_NOTIFY') >= 0 && source.indexOf('function NotifyPage(props)') >= 0,
    )
    ok(
      'apply.js creates, starts, stops and syncs the notify engine',
      source.indexOf('notifyEngine = createNotify()') >= 0 &&
        source.indexOf('notifyEngine.start()') >= 0 &&
        source.indexOf('notifyEngine.stop()') >= 0 &&
        source.indexOf('function syncNotify()') >= 0,
    )
  }

  section('notify: host half — trivial Config + apply')
  {
    global.__z = {
      object: (o) => o,
      boolean: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
    }
    var nsrc = fs
      .readFileSync(path.join(__dirname, '..', 'notify', 'index.js'), 'utf8')
      .replace(/import z from '@deepseek-ai\/schemastery'/, 'var z = global.__z')
      .replace(/export const Config/, 'global.__notifyConfig')
      .replace(/export function apply/, 'global.__notifyApply = function apply')
    ;(0, eval)(nsrc)
    var applyNotify = global.__notifyApply
    ok('notify host half loads', typeof applyNotify === 'function')
    var ncfg = global.__notifyConfig
    ok(
      'Config exposes all four independent switches',
      ncfg && ncfg.completeSound && ncfg.completeNotify && ncfg.attentionSound && ncfg.attentionNotify,
    )
    ok('all four switches default off (host source)', (nsrc.match(/\.default\(false\)/g) || []).length >= 4)
    var nctxState = { settings: [] }
    var nctx = {
      fiber: 'fiber',
      inject: (services, cb) =>
        cb({
          settings: { configure: (opts) => nctxState.settings.push(opts) },
          effect: (fn) => fn(),
        }),
    }
    applyNotify(nctx)
    ok('host apply configures auto:false', nctxState.settings.length === 1 && nctxState.settings[0].auto === false)
  }

  // ---------------------------------------------------------------------------
  // shell-local (component H): opencode mode. The component does NOT register a
  // second ctx.shell (duplicate-service throws at load); it wraps the existing
  // sandboxed executor's execute() to take the executor's own
  // `danger-full-access` branch — the unconfined base path, byte-for-byte the
  // profile shim's execution. Default off; restored on row unload.
  // ---------------------------------------------------------------------------

  section('shell-local: bundle row is disabled by default')
  {
    const patch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    ok(
      'the shell-local row exists and ships disabled',
      /dsh-polish:shell-local'[\s\S]{0,220}?disabled: true/.test(patch),
      patch.slice(patch.indexOf('shell-local') - 80, patch.indexOf('shell-local') + 140),
    )
    ok(
      'the subpath export is wired in package.json',
      /"\.\/shell-local"[\s\S]{0,80}?shell-local\/index\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')),
    )
  }

  section('shell-local: host half — the wrapper takes the danger-full-access branch and restores')
  {
    global.__z = {
      object: (o) => o,
      boolean: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }),
    }
    const slRaw = fs.readFileSync(path.join(__dirname, '..', 'shell-local', 'index.js'), 'utf8')
    const slsrc = slRaw
      .replace(/import z from '@deepseek-ai\/schemastery'/g, 'var z = global.__z')
      .replace(/export const Config/g, 'global.__shellLocalConfig')
      .replace(/export function apply/g, 'global.__shellLocalApply = function apply')
    ;(0, eval)(slsrc)
    const applyShellLocal = global.__shellLocalApply
    ok('shell-local host half loads', typeof applyShellLocal === 'function')
    ok('Config carries the volatile enabled switch', !!global.__shellLocalConfig && !!global.__shellLocalConfig.enabled)

    // A sandboxed-executor stand-in: execute on the PROTOTYPE (like the real
    // class), so `delete instance.execute` falls back to it on restore.
    function makeShellWorld(settingsValue) {
      const state = { seenSpecs: [], intervals: [], settings: [] }
      const proto = {
        execute(spec) {
          state.seenSpecs.push(spec)
          return 'done:' + (spec && spec.sandboxPolicy ? spec.sandboxPolicy.mode : 'none')
        },
      }
      const executor = Object.assign(Object.create(proto), { sandboxMode: 'workspace-write' })
      const settings = {
        configure: (opts) => state.settings.push(opts),
        describe: () => (settingsValue === null ? [] : [{ ns: 'dsh-polish:shell-local', revision: 1, value: settingsValue }]),
      }
      const ctx = {
        fiber: 'fiber',
        effect(fn) {
          return fn() || (() => {})
        },
        inject(deps, callback) {
          if (deps.indexOf('shell') >= 0) {
            return (
              callback({
                shell: executor,
                settings: settings,
                interval(cb, delay) {
                  const rec = { cb, delay, disposed: false, dispose: () => (rec.disposed = true) }
                  state.intervals.push(rec)
                  return rec
                },
                effect(fn) {
                  return fn() || (() => {})
                },
              }) || (() => {})
            )
          }
          return (
            callback({
              settings: settings,
              effect(fn) {
                return fn() || (() => {})
              },
            }) || (() => {})
          )
        },
      }
      return { state, executor, ctx }
    }

    // enabled: the wrapper activates immediately (first poll is synchronous).
    const on = makeShellWorld({ enabled: true })
    applyShellLocal(on.ctx)
    ok('enabled activates the wrapper on the executor', on.executor.hasOwnProperty('execute'))
    ok('the poller runs on a 1.5s interval', on.state.intervals.length === 1 && on.state.intervals[0].delay === 1500, JSON.stringify(on.state.intervals.map((r) => r.delay)))
    ok('host apply configures auto:false', on.state.settings.length === 1 && on.state.settings[0].auto === false)

    const callSpec = { sandboxPolicy: { mode: 'workspace-write', workspaceRoot: '/w' }, command: 'Get-Date' }
    const out = on.executor.execute.call(on.executor, callSpec)
    ok('a sandboxed-mode call is retargeted to danger-full-access', on.state.seenSpecs.length === 1 && on.state.seenSpecs[0].sandboxPolicy.mode === 'danger-full-access', JSON.stringify(on.state.seenSpecs))
    ok('the original spec is not mutated (a fresh copy is passed)', callSpec.sandboxPolicy.mode === 'workspace-write' && on.state.seenSpecs[0] !== callSpec)
    ok('other spec fields survive the retarget', on.state.seenSpecs[0].command === 'Get-Date' && on.state.seenSpecs[0].sandboxPolicy.workspaceRoot === '/w')
    ok('the base path ran (no confine involved)', out === 'done:danger-full-access', out)

    // A call that already carries danger-full-access passes through untouched.
    const dfaSpec = { sandboxPolicy: { mode: 'danger-full-access' }, command: 'echo ok' }
    on.executor.execute.call(on.executor, dfaSpec)
    ok('an existing danger-full-access spec is passed through as-is', on.state.seenSpecs.length === 2 && on.state.seenSpecs[1] === dfaSpec)

    // The live switch: a world whose row value is enabled:false never wraps
    // (the poller only activates when the served value says so).
    const off = makeShellWorld({ enabled: false })
    applyShellLocal(off.ctx)
    ok('a served row with enabled:false never wraps', !off.executor.hasOwnProperty('execute') || off.executor.execute === off.executor.__proto__.execute)

    const noRow = makeShellWorld(null)
    applyShellLocal(noRow.ctx)
    ok('no row value at all (unserved) never wraps', !noRow.executor.hasOwnProperty('execute'))
  }

  section('shell-local: a non-sandboxed executor (local shim) is left alone')
  {
    // The profile shim's executor exposes sandboxMode but its base execute
    // ignores the policy —�?the wrapper would be an inert no-op. The component
    // still wraps it (it cannot know the base semantics); assert the wrap is
    // harmless: calls still land on the original function.
    global.__z = global.__z || { object: (o) => o, boolean: () => ({ default: () => ({ volatile: () => ({}), is: () => ({}) }) }) }
    const slsrc2 = fs
      .readFileSync(path.join(__dirname, '..', 'shell-local', 'index.js'), 'utf8')
      .replace(/import z from '@deepseek-ai\/schemastery'/g, 'var z = global.__z')
      .replace(/export const Config/g, 'global.__shellLocalConfig2')
      .replace(/export function apply/g, 'global.__shellLocalApply2 = function apply')
    ;(0, eval)(slsrc2)
    const state = { seen: [] }
    const proto = { execute(spec) { state.seen.push(spec); return 'local' } }
    const executor = Object.assign(Object.create(proto), { sandboxMode: 'workspace-write' })
    const settings = { configure: () => {}, describe: () => [{ ns: 'dsh-polish:shell-local', revision: 1, value: { enabled: true } }] }
    const ctx = {
      fiber: 'fiber',
      effect(fn) { return fn() || (() => {}) },
      inject(deps, callback) {
        if (deps.indexOf('shell') >= 0) {
          return (
            callback({
              shell: executor,
              settings: settings,
              interval(cb) { return { dispose() {} } },
              effect(fn) { return fn() || (() => {}) },
            }) || (() => {})
          )
        }
        return (callback({ settings: settings, effect(fn) { return fn() || (() => {}) } }) || (() => {}))
      },
    }
    global.__shellLocalApply2(ctx)
    const out = executor.execute.call(executor, { sandboxPolicy: { mode: 'workspace-write' }, command: 'x' })
    ok('a local-shape executor still executes (wrapper is inert or passthrough)', out === 'local' && state.seen.length === 1, out)
  }

  // ---------------------------------------------------------------------------
  // workspace-lru subagent catalog LRU: the header 子智能体 catalog is in
  // creation order (an append-only fold with no reorder API). The component
  // re-sorts the cached catalog array in place, keyed on byId[child].
  // updatedAt (createdAt fallback), behind its own switch — independent of the
  // workspace-group LRU.
  // ---------------------------------------------------------------------------

  function makeSubagentWorld() {
    const childA = { id: 'childA', createdAt: 100, mode: 'continuable', label: 'a' }
    const childB = { id: 'childB', createdAt: 200, mode: 'continuable', label: 'b' }
    const childC = { id: 'childC', createdAt: 300, mode: 'one-shot', label: 'c' }
    const catalog = [childA, childB, childC] // creation order
    const byId = {
      p1: { id: 'p1', updatedAt: 10 },
      childA: { id: 'childA', updatedAt: 1000 },
      childB: { id: 'childB', updatedAt: 3000 },
      childC: { id: 'childC', updatedAt: 2000 },
    }
    const items = []
    const calls = []
    const workspaces = {
      list: { getSnapshot: () => ({ items: items, archivedSessionIds: [] }) },
      insertBefore() {
        calls.push({})
        return Promise.resolve({ ok: true })
      },
    }
    // The real sessions store is a snapshot store: subscribers are notified
    // synchronously inside setState, before React renders. Model that with a
    // plain listener list the test can fire.
    const storeSubs = []
    const sessions = {
      list: {
        getSnapshot: () => ({
          ids: Object.keys(byId),
          byId: byId,
          projectionsBySession: { p1: { values: { subagentCatalog: catalog }, state: 'idle', error: null } },
        }),
        subscribe(fn) {
          storeSubs.push(fn)
          return () => {
            const at = storeSubs.indexOf(fn)
            if (at >= 0) storeSubs.splice(at, 1)
          }
        },
      },
    }
    return {
      catalog,
      byId,
      calls,
      workspaces,
      sessions,
      remote: { insertBefore: workspaces.insertBefore },
      storeSubs,
      fireStore() {
        for (let i = 0; i < storeSubs.length; i++) storeSubs[i]()
      },
    }
  }

  // The catalog sorts on OPEN, not on a timer. The engine installs a
  // document-level CAPTURE listener for the three open paths (click,
  // mouseenter-hover, keydown-ArrowDown) tagged `__dshpCatalogLru`; the
  // document stub keeps registered handlers in `__handlers[type]`.
  function fireSubagentTrigger(type, targetEl) {
    const handlers = ((globalThis.document.__handlers && globalThis.document.__handlers[type]) || []).filter((h) => h && h.__dshpCatalogLru === true)
    if (handlers.length === 0) return 0
    handlers[handlers.length - 1]({ type: type, target: targetEl })
    return 1
  }
  function subagentTriggerTarget() {
    return { closest: (sel) => (sel === 'button[aria-haspopup="tree"]' ? { tagName: 'BUTTON' } : null) }
  }
  function inertTarget() {
    return { closest: () => null }
  }

  section('workspace-lru: subagent catalogs are sorted in place at open time, not by a timer')
  {
    const world = makeSubagentWorld()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: true, subagent: true },
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.remote,
      }),
    )
    await wait()
    ok(
      'while closed, the poll leaves the creation order alone',
      world.catalog[0].id === 'childA' && world.catalog[1].id === 'childB' && world.catalog[2].id === 'childC',
      world.catalog.map((c) => c.id).join(','),
    )
    // A click anywhere else does not sort.
    ok('an unrelated click registers the same inert path', fireSubagentTrigger('click', inertTarget()) === 1)
    ok('and it sorts nothing', world.catalog[0].id === 'childA' && world.catalog[2].id === 'childC', world.catalog.map((c) => c.id).join(','))
    // Opening via click: the capture listener sorts BEFORE the portal renders.
    fireSubagentTrigger('click', subagentTriggerTarget())
    ok(
      'a trigger click sorts the creation-order [A,B,C] to LRU [B,C,A] in place',
      world.catalog[0].id === 'childB' && world.catalog[1].id === 'childC' && world.catalog[2].id === 'childA',
      world.catalog.map((c) => c.id).join(','),
    )
    // Opening again (already LRU) is a stable no-op.
    fireSubagentTrigger('click', subagentTriggerTarget())
    ok('re-opening is idempotent (stable, no writes)', world.calls.length === 0 && world.catalog[0].id === 'childB', world.catalog.map((c) => c.id).join(','))
    // Hover-open (mouseenter) sorts too — simulate a fresh frame landing out
    // of order (C,A,B) and then the user hovering the trigger.
    world.catalog.push(world.catalog.shift()) // [C,A,B]
    ok('the hover path is registered for mouseenter', fireSubagentTrigger('mouseenter', subagentTriggerTarget()) === 1)
    ok('and it re-sorts to [B,C,A] before the hover delay elapses', world.catalog[0].id === 'childB' && world.catalog[1].id === 'childC' && world.catalog[2].id === 'childA', world.catalog.map((c) => c.id).join(','))
  }

  section('workspace-lru: the subagent switch is independent of the workspace LRU')
  {
    // Off (explicitly): the switch is default-ON, so opting out requires
    // subagent:false — even a trigger click must not sort.
    const off = makeSubagentWorld()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: true, subagent: false },
        workspaces: off.workspaces,
        sessions: off.sessions,
        workspaceRemote: off.remote,
      }),
    )
    await wait()
    fireSubagentTrigger('click', subagentTriggerTarget())
    ok(
      'subagent explicitly off keeps creation order even at open time',
      off.catalog[0].id === 'childA' && off.catalog[1].id === 'childB' && off.catalog[2].id === 'childC',
      off.catalog.map((c) => c.id).join(','),
    )

    // On while the workspace-group LRU is disabled: catalogs still sort on
    // open, and no workspace reorder call happens.
    const solo = makeSubagentWorld()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: false, subagent: true },
        workspaces: solo.workspaces,
        sessions: solo.sessions,
        workspaceRemote: solo.remote,
      }),
    )
    await wait()
    fireSubagentTrigger('click', subagentTriggerTarget())
    ok(
      'subagent on sorts the catalog on open while the workspace LRU is off',
      solo.catalog[0].id === 'childB' && solo.catalog[2].id === 'childA',
      solo.catalog.map((c) => c.id).join(','),
    )
    ok('and it writes no workspace reorder', solo.calls.length === 0, String(solo.calls.length))
  }

  section('workspace-lru: subagent LRU falls back to createdAt when a child has no activity yet')
  {
    // childC has no byId entry (no activity recorded): its LRU key is
    // createdAt (300), older than childB's updatedAt (3000) but newer than
    // childA's updatedAt (1000)? No — 300 < 1000, so expected order:
    // B(3000), A(1000), C(300-createdAt).
    const world = makeSubagentWorld()
    delete world.byId.childC
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: true, subagent: true },
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.remote,
      }),
    )
    await wait()
    fireSubagentTrigger('click', subagentTriggerTarget())
    ok(
      'a child without byId activity falls back to createdAt',
      world.catalog[0].id === 'childB' && world.catalog[1].id === 'childA' && world.catalog[2].id === 'childC',
      world.catalog.map((c) => c.id).join(','),
    )
  }

  section('workspace-lru: an open catalog stays LRU-ordered when a background session re-folds the store')
  {
    // The user-visible bug: while the dropdown is OPEN, any subagent event
    // from ANY session re-folds the parent's projection into a fresh,
    // creation-ordered wire array — React re-renders the open list out of
    // LRU order. The fix subscribes to the sessions snapshot store and
    // re-sorts synchronously inside the notification, before the render.
    const world = makeSubagentWorld()
    const [childA, childB, childC] = world.catalog.slice()
    registrations.length = 0
    mod.apply(
      makeCtx({
        namespaces: ['dsh-polish:workspace-lru'],
        lruValues: { enabled: true, subagent: true },
        workspaces: world.workspaces,
        sessions: world.sessions,
        workspaceRemote: world.remote,
      }),
    )
    await wait()
    ok('the sessions-store watch is armed (one subscriber)', world.storeSubs.length === 1, String(world.storeSubs.length))

    // The document stub gains a controllable probe for the aria-expanded query.
    const savedProbe = Object.prototype.hasOwnProperty.call(documentStub, 'querySelector') ? documentStub.querySelector : undefined
    documentStub.querySelector = () => (globalThis.__dshpCatalogOpen ? { tagName: 'BUTTON' } : null)
    try {
      globalThis.__dshpCatalogOpen = false
      // A background session's dispatch re-folds the catalog out of order.
      world.catalog.length = 0
      world.catalog.push(childC, childA, childB)
      world.fireStore()
      ok(
        'while CLOSED, store notifications keep the catalog in LRU order (no open-race window)',
        world.catalog[0].id === 'childB' && world.catalog[1].id === 'childC' && world.catalog[2].id === 'childA',
        world.catalog.map((c) => c.id).join(','),
      )
      // The user opens the dropdown: the imminent render must see LRU order.
      globalThis.__dshpCatalogOpen = true
      world.fireStore()
      ok(
        'while OPEN, the same store notification re-sorts [C,A,B] to LRU [B,C,A] synchronously',
        world.catalog[0].id === 'childB' && world.catalog[1].id === 'childC' && world.catalog[2].id === 'childA',
        world.catalog.map((c) => c.id).join(','),
      )
      // Another background fold while still open: sorted again.
      world.catalog.length = 0
      world.catalog.push(childA, childC, childB)
      world.fireStore()
      ok('a further re-fold while open is re-sorted too', world.catalog[0].id === 'childB' && world.catalog[1].id === 'childC' && world.catalog[2].id === 'childA', world.catalog.map((c) => c.id).join(','))
      world.fireStore()
      ok('repeated notifications are idempotent', world.catalog[0].id === 'childB' && world.catalog[2].id === 'childA', world.catalog.map((c) => c.id).join(','))
    } finally {
      delete globalThis.__dshpCatalogOpen
      if (savedProbe === undefined) delete documentStub.querySelector
      else documentStub.querySelector = savedProbe
    }
  }

  section('composer-history: a user edit commits the recalled draft and exits recall (0.4.43)')
  {
    documentStub.__handlers['keydown'] = []
    documentStub.__handlers['input'] = []
    state.historyRecords = [
      { event: { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first message' }] } } },
      { event: { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second message' }] } } },
    ]
    remoteCalls.length = 0
    const composer = domEl('div')
    const anchor = domEl('span')
    anchor.setAttribute('data-dshp-history', 'sess-edit')
    composer.appendChild(anchor)
    const editable = domEl('div')
    editable.isContentEditable = true
    composer.appendChild(editable)
    editable.parentNode = composer
    documentStub.activeElement = editable

    registrations.length = 0
    mod.apply(makeCtx({ namespaces: ['dsh-polish:composer-history'] }))
    const cell = registrations.find((entry) => entry.options.id === 'dsh-polish:composer-history')
    const tree = render(cell.Component, { sessionId: 'sess-edit' })
    ok('the session cell registers for the edit-exit test', cell !== undefined && tree !== null)

    const fireKey = (key) => {
      const ev = { key, defaulted: false, preventDefault() { this.defaulted = true } }
      const handlers = (documentStub.__handlers['keydown'] || []).slice()
      for (const fn of handlers) fn(ev)
      return ev
    }
    // An `input` event on the focused composer: set the field text FIRST, the
    // way the browser does (the handler re-reads the current text).
    const fireInput = (target, text) => {
      editable.textContent = text
      const ev = { type: 'input', target: target }
      const handlers = (documentStub.__handlers['input'] || []).slice()
      for (const fn of handlers) fn(ev)
    }

    let ev = fireKey('ArrowUp')
    await wait()
    ok('recall starts on the newest user message', editable.textContent === 'second message', JSON.stringify(editable.textContent))

    // The recall FILL itself can surface an input event — it must NOT end the
    // recall (the guard recognises our own (input, text) pair).
    fireInput(editable, 'second message')
    ev = fireKey('ArrowUp')
    ok('our own fill is not misread as a user edit (recall still navigates)', ev.defaulted === true && editable.textContent === 'first message', JSON.stringify(editable.textContent))

    // A genuine edit: the field text differs from what we wrote.
    fireInput(editable, 'first message EDITED')
    ev = fireKey('ArrowUp')
    ok('after a user edit, up is left to the caret', ev.defaulted !== true)
    ev = fireKey('ArrowDown')
    ok('after a user edit, down is left to the caret too', ev.defaulted !== true)
    ok('the edited draft stays exactly as the user left it', editable.textContent === 'first message EDITED', JSON.stringify(editable.textContent))

    // The exit was clean: a fresh empty-field recall starts normally.
    editable.textContent = ''
    ev = fireKey('ArrowUp')
    await wait()
    ok('a fresh recall can start after the edit-exit', ev.defaulted === true && editable.textContent === 'second message', JSON.stringify(editable.textContent))
  }

  section('shell-local + LRU subagent: wiring in the built client')
  {
    ok('the shell-local row key + page are wired', source.indexOf("var ROW_KEY_SHELL_LOCAL = 'dsh-polish#dsh-polish:shell-local'") >= 0 && source.indexOf('function ShellLocalPage(props)') >= 0)
    ok('the LRU engine receives the independent subagent switch', source.indexOf('subagent: read.served && read.value.subagent === true') >= 0)
    ok('the subagent field is a default-ON independent toggle', source.indexOf("key: 'subagent'") >= 0 && source.indexOf('LRU_DEFAULTS = { enabled: true, subagent: true }') >= 0)
    ok('the in-place catalog re-sort is present with its frozen guard', source.indexOf('function sortSubagentCatalogs') >= 0 && source.indexOf('Object.isFrozen(catalog)') >= 0)
    ok('the LRU form coerces both booleans toward the default (on), no field-specific branch', source.indexOf("field.key === 'subagent'") === -1)
    ok('the catalog listener is capture-registered for all three open paths', source.indexOf("document.addEventListener('click', catalogListener, capture)") >= 0 && source.indexOf("document.addEventListener('mouseenter', catalogListener, capture)") >= 0 && source.indexOf("document.addEventListener('keydown', catalogListener, capture)") >= 0)
    ok('the trigger is addressed by the unique aria-haspopup=tree button', source.indexOf("target.closest('button[aria-haspopup=\"tree\"]')") >= 0)
    const pollAt = source.indexOf('if (!enabled || inFlight) return')
    // The slice ends at the store-watch function: the TIMER (poll) must not
    // sort — the 0.4.43 store subscription is a separate event-driven leg.
    const pollEnd = source.indexOf('function onSessionsStoreUpdate', pollAt)
    ok('the poll no longer sorts catalogs (no timer work while closed)', pollAt >= 0 && pollEnd > pollAt && source.slice(pollAt, pollEnd).indexOf('sortSubagentCatalogs') === -1)
    // And the store watch is event-driven, not timed: it subscribes to the
    // sessions snapshot store and sorts only while a dropdown is open.
    ok(
      'the store watch keeps catalogs LRU-sorted on every sessions-store update (0.4.90 race fix)',
      source.indexOf('storeUnsubscribe = list.subscribe(onSessionsStoreUpdate)') >= 0 &&
        source.indexOf("document.querySelector('button[aria-haspopup=\"tree\"][aria-expanded=\"true\"]')") >= 0 &&
        source.indexOf('if (!subagent) return') >= 0 &&
        source.indexOf('if (!anyCatalogOpen()) return') < 0 &&
        source.indexOf('startStoreWatch()') >= 0 &&
        source.indexOf('stopStoreWatch()') >= 0,
    )
  }

  // =========================================================================
  // visualize (component I) — ```svg / ```mermaid fences rendered in chat.
  // =========================================================================

  const vis = window.__DSH_POLISH_VISUALIZE_TEST__
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  section('visualize: pure detectors (kind / fingerprint / aspect)')
  ok('test hooks are exported', vis !== null && typeof vis.detectKind === 'function')
  if (vis) {
    ok('svg: bare <svg', vis.detectKind('<svg viewBox="0 0 1 1"></svg>') === 'svg')
    ok('svg: xml prolog + svg', vis.detectKind('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>') === 'svg')
    ok('svg: leading whitespace tolerated', vis.detectKind('  \n<svg width="1"></svg>') === 'svg')
    ok('html is not svg', vis.detectKind('<div><p>hi</p></div>') === null)
    ok('mermaid: flowchart with arrows', vis.detectKind('graph LR\nA --> B') === 'mermaid')
    ok('mermaid: sequenceDiagram by participant', vis.detectKind('sequenceDiagram\nparticipant A\nA->>B: x') === 'mermaid')
    ok('mermaid: stateDiagram-v2', vis.detectKind('stateDiagram-v2\n[*] --> A') === 'mermaid')
    ok('mermaid: gantt by section line', vis.detectKind('gantt\ntitle Roadmap\nsection Phase 1\na: 3d') === 'mermaid')
    ok('mermaid: pie by ": label, n" line', vis.detectKind('pie\ntitle Share\n: A, 40\n: B, 60') === 'mermaid')
    ok('a bare keyword with no mermaid syntax is not a diagram', vis.detectKind('graph\nvar x = 1') === null)
    ok('code that merely mentions a type word is not a diagram', vis.detectKind('def graph(x):\n    return x') === null)
    ok('class hints win (future DSH native language class)', vis.detectKind('whatever', 'language-svg') === 'svg' && vis.detectKind('whatever', 'language-mermaidjs') === 'mermaid' && vis.detectKind('whatever', 'language-mmd') === 'mermaid')
    ok('fingerprint: stable for equal text', vis.fingerprint('abc') === vis.fingerprint('abc'))
    ok('fingerprint: tail changes are seen', vis.fingerprint('a'.repeat(300) + '1') !== vis.fingerprint('a'.repeat(300) + '2'))
    ok('fingerprint: head changes are seen', vis.fingerprint('1' + 'a'.repeat(300)) !== vis.fingerprint('2' + 'a'.repeat(300)))
    ok('viewBox ratio 2:1', vis.svgAspect('<svg viewBox="0 0 800 400">') === 2)
    ok('viewBox with comma separator', vis.svgAspect("<svg viewBox='0 0 600, 300'>") === 2)
    ok('no viewBox -> null', vis.svgAspect('<svg width="10"></svg>') === null)
    ok('bad viewBox -> null', vis.svgAspect('<svg viewBox="0 0 abc def"></svg>') === null)
  }

  section('visualize: sanitize strips the dangerous, keeps the art')
  function svgNode(tag, attrs, kids) {
    const node = {
      nodeType: 1,
      tagName: tag,
      parentNode: null,
      childNodes: [],
      _attrs: (attrs || []).map((a) => ({ name: a[0], value: a[1] })),
      get attributes() {
        return this._attrs
      },
      getAttribute(name) {
        const hit = this._attrs.find((a) => a.name === name)
        return hit ? hit.value : null
      },
      removeAttribute(name) {
        const at = this._attrs.findIndex((a) => a.name === name)
        if (at >= 0) this._attrs.splice(at, 1)
      },
      removeChild(child) {
        const at = this.childNodes.indexOf(child)
        if (at >= 0) this.childNodes.splice(at, 1)
        child.parentNode = null
      },
    }
    for (const child of kids || []) {
      child.parentNode = node
      node.childNodes.push(child)
    }
    return node
  }
  function hasTag(node, tag) {
    if (!node || node.nodeType !== 1) return false
    if (String(node.tagName).toLowerCase() === tag) return true
    for (const child of node.childNodes || []) if (hasTag(child, tag)) return true
    return false
  }
  function findTag(node, tag) {
    if (!node || node.nodeType !== 1) return null
    if (String(node.tagName).toLowerCase() === tag) return node
    for (const child of node.childNodes || []) {
      const hit = findTag(child, tag)
      if (hit) return hit
    }
    return null
  }
  if (vis) {
    const bad = svgNode('svg', [['viewBox', '0 0 10 10']], [
      svgNode('defs', [], [svgNode('linearGradient', [['id', 'g1']], [svgNode('stop', [['offset', '0']])])]),
      svgNode('rect', [['fill', 'red']]),
      svgNode('script', [], []),
      svgNode('foreignObject', []),
      svgNode('image', [['href', 'https://evil.example/x.png']]),
      svgNode('use', [['href', '#g1']]),
      svgNode('use', [['href', 'https://evil.example/u.svg']]),
      svgNode('a', [['href', 'https://evil.example']]),
      svgNode('a', [['href', '#anchor']]),
      svgNode('circle', [['onclick', 'alert(1)'], ['style', 'background:url(https://evil.example)'], ['fill', 'red']]),
      svgNode('path', [['xlink:href', 'https://evil.example/p.svg']]),
    ])
    const dropped = vis.sanitizeSvgNode(bad)
    ok('script/foreignObject/image nodes are removed', !hasTag(bad, 'script') && !hasTag(bad, 'foreignobject') && !hasTag(bad, 'image') && dropped >= 4)
    const extUse = (function scan(n, found) {
      if (!n || n.nodeType !== 1) return found
      const t = String(n.tagName).toLowerCase()
      const h = n.getAttribute && n.getAttribute('href')
      if (t === 'use' && h && h.charAt(0) !== '#') found.use = true
      if (t === 'a' && h && h.charAt(0) !== '#') found.a = true
      for (const child of n.childNodes || []) scan(child, found)
      return found
    })(bad, {})
    ok('external references are dropped while internal #refs survive', extUse.use !== true && extUse.a !== true && hasTag(bad, 'use') && hasTag(bad, 'a'))
    const circle = findTag(bad, 'circle')
    const path = findTag(bad, 'path')
    ok('event attrs and dangerous styles are stripped, benign attrs kept', circle !== null && circle.getAttribute('onclick') === null && circle.getAttribute('style') === null && circle.getAttribute('fill') === 'red')
    ok('external xlink:href on a plain element is stripped', path !== null && path.getAttribute('xlink:href') === null)
    ok('art (defs/gradient/rect) survives', hasTag(bad, 'defs') && hasTag(bad, 'lineargradient') && hasTag(bad, 'rect'))
  }

  // ----------------------- the live DOM sections (one apply, one engine) ----

  const SVG_A = '<svg viewBox="0 0 10 10"><rect/></svg>'
  const SVG_PREFIX = 'data:image/svg+xml;charset=utf-8,'
  const parseCalls = []
  const sanitizeSawScript = []
  let lastParsed = ''
  /**
   * The overrides object of the one "live" visualize apply, shared by every
   * DOM section below. Mutating it in place + re-firing `mirrorSubscribers`
   * is the harness equivalent of a live settings change (the kill-switch).
   */
  const liveOverrides = {
    namespaces: ['dsh-polish:visualize'],
    visualizeValues: { svg: true, mermaid: true },
  }
  const reFireSettings = async () => {
    for (const fn of mirrorSubscribers) {
      try {
        fn()
      } catch (error) {}
    }
    await sleep(5)
  }
  vis.setSettleMs(2, 5)
  vis.setParseSvg((text) => {
    parseCalls.push(text)
    lastParsed = String(text)
    if (String(text).indexOf('BROKENSVG') !== -1) return null
    return svgNode('svg', [['viewBox', '0 0 200 100']], [
      svgNode('defs', [], [svgNode('linearGradient', [['id', 'g1']], [svgNode('stop', [['offset', '0']])])]),
      svgNode('script', [], []),
      svgNode('rect', [['fill', 'red']]),
    ])
  })
  // Echo the tail of the parsed text into the serialized document so re-renders
  // are distinguishable in the img src (a fixed output would hide stale commits).
  vis.setSerializeSvg((root) => {
    sanitizeSawScript.push(hasTag(root, 'script'))
    return '<svg viewBox="0 0 200 100"><text>' + lastParsed.slice(-24) + '</text></svg>'
  })

  /**
   * Build a detached DSH code card exactly as the shipped 0.2.1-rc.1 web
   * renderer emits it: card > banner + div[data-code-block-content] > pre >
   * code. The content wrapper is the shape that silently killed 0.4.50
   * (insertBefore with a grandchild ref throws HierarchyRequestError).
   */
  function makeVisCard(content) {
    const code = domEl('code')
    code.textContent = content
    const pre = domEl('pre')
    pre.setAttribute('class', 'plain')
    pre.appendChild(code)
    const contentDiv = domEl('div')
    contentDiv.setAttribute('data-code-block-content', '1')
    contentDiv.appendChild(pre)
    const card = domEl('div')
    card.setAttribute('class', 'md-code-block')
    const banner = domEl('div')
    banner.setAttribute('data-code-block-banner', '1')
    card.appendChild(banner)
    card.appendChild(contentDiv)
    return { card, pre, code, banner, content: contentDiv }
  }
  /** The older flat shape (pre a direct child of the card) — still supported. */
  function makeFlatVisCard(content) {
    const code = domEl('code')
    code.textContent = content
    const pre = domEl('pre')
    pre.appendChild(code)
    const card = domEl('div')
    card.setAttribute('class', 'md-code-block')
    const banner = domEl('div')
    banner.setAttribute('data-code-block-banner', '1')
    card.appendChild(banner)
    card.appendChild(pre)
    return { card, pre, code, banner, content: card }
  }
  const visContainerOf = (card) => card.querySelector('.dshp-vis')
  const imgSrcOf = (container) => {
    const img = container && container.querySelector('img')
    return img ? img.getAttribute('src') : null
  }

  section('visualize: an svg fence becomes a sanitized <img>, pre hidden, toggleable')
  {
    registrations.length = 0
    mod.apply(makeCtx(liveOverrides))
    await sleep(5)
    const keys = registrations.map((entry) => entry.options.name + ':' + (entry.options.key || entry.options.id))
    ok('the visualize row config page is registered', keys.includes('plugins.row.config:dsh-polish#dsh-polish:visualize'), keys.join(', '))

    const statsBefore = vis.statsStore.get()
    const m1 = makeVisCard(SVG_A)
    const msg1 = domEl('div')
    msg1.appendChild(m1.card)
    await sleep(30)
    const c1 = visContainerOf(m1.card)
    const src1 = imgSrcOf(c1)
    ok(
      'the container sits in the pre parent layer, directly before the pre (rc.1 nested card)',
      c1 !== null &&
        c1.parentElement === m1.pre.parentElement &&
        c1.parentElement.children.indexOf(c1) === c1.parentElement.children.indexOf(m1.pre) - 1,
      'c1=' + String(!!c1) + ' preParent=' + String(m1.pre.parentElement && m1.pre.parentElement.getAttribute('data-code-block-content')),
    )
    ok(
      'the image is a data-url svg (inert context)',
      typeof src1 === 'string' && src1.indexOf(SVG_PREFIX) === 0 && decodeURIComponent(src1.slice(SVG_PREFIX.length)).indexOf('<svg') === 0,
      'src1=' + String(src1).slice(0, 90),
    )
    ok('the pre is hidden in diagram view', m1.pre.style.display === 'none')
    const toggle1 = c1 && c1.querySelector('button')
    ok('the toggle offers 代码 back to the source', toggle1 !== null && toggle1.textContent === '代码')
    ok('the parsed tree was sanitized before serialization (no script reached the img)', sanitizeSawScript.length > 0 && sanitizeSawScript.every((seen) => seen === false))
    const statsAfter = vis.statsStore.get()
    ok('stats counted the svg render', statsAfter.svg === statsBefore.svg + 1 && statsAfter.mermaid === statsBefore.mermaid)

    // A re-mounted identical block (virtualization) must come from the cache.
    const parseBefore = parseCalls.length
    const m1b = makeVisCard(SVG_A)
    const msg1b = domEl('div')
    msg1b.appendChild(m1b.card)
    await sleep(30)
    ok('identical re-mounted content serves from the render cache (no re-parse)', visContainerOf(m1b.card) !== null && imgSrcOf(visContainerOf(m1b.card)) !== null && parseCalls.length === parseBefore)

    // The older flat shape (pre a direct child of the card) must keep working
    // in the same pass — identical content, so this also re-proves the cache.
    const mf = makeFlatVisCard(SVG_A)
    const msgf = domEl('div')
    msgf.appendChild(mf.card)
    await sleep(30)
    const cf = visContainerOf(mf.card)
    ok(
      'the flat card (pre a direct child) renders too, container directly before the pre in the card',
      cf !== null && cf.parentElement === mf.card && mf.card.children.indexOf(cf) === mf.card.children.indexOf(mf.pre) - 1 && imgSrcOf(cf) !== null,
      'cf=' + String(!!cf),
    )

    toggle1.fire('click', {})
    ok('toggling shows the source (pre visible, img hidden, label 图示)', m1.pre.style.display === '' && c1.querySelector('img').style.display === 'none' && toggle1.textContent === '图示')
    ok('the choice is persisted for later blocks', fakeStorage.getItem('dshp-visualize-view') === 'code')
    toggle1.fire('click', {})
    ok('toggling back restores the diagram', m1.pre.style.display === 'none' && c1.querySelector('img').style.display === 'inline-block')
  }

  section('visualize: mermaid fences render through the lazily loaded chunk')
  {
    const statsBefore = vis.statsStore.get()
    const m2 = makeVisCard('graph LR\nA --> B\nB --> C')
    const msg2 = domEl('div')
    msg2.appendChild(m2.card)
    await sleep(40)
    const c2 = visContainerOf(m2.card)
    const src2 = imgSrcOf(c2)
    ok('the mermaid fence rendered an svg image', typeof src2 === 'string' && decodeURIComponent(src2).indexOf('<rect') !== -1)
    ok('the runtime initialized once: strict, no auto-start, light theme', fakeMermaidApi.initCalls.length === 1 && fakeMermaidApi.initCalls[0].securityLevel === 'strict' && fakeMermaidApi.initCalls[0].startOnLoad === false && fakeMermaidApi.initCalls[0].theme === 'default')
    ok('the exact fence text was handed to mermaid.render', fakeMermaidApi.renderCalls.some((call) => call.text === 'graph LR\nA --> B\nB --> C'))
    const statsAfter = vis.statsStore.get()
    ok('stats counted the mermaid render and the ready runtime', statsAfter.mermaid === statsBefore.mermaid + 1 && statsAfter.mermaidState === 'ready')

    // Two queued blocks: the serial queue renders both, in order.
    const before = fakeMermaidApi.renderCalls.length
    const m3 = makeVisCard('sequenceDiagram\nparticipant A\nA->>B: hi')
    const m4 = makeVisCard('pie\ntitle X\n: A, 5\n: B, 3')
    const msg3 = domEl('div')
    msg3.appendChild(m3.card)
    msg3.appendChild(m4.card)
    await sleep(60)
    ok('queued mermaid blocks both render (serial, idle-yielded)', fakeMermaidApi.renderCalls.length === before + 2 && visContainerOf(m3.card) !== null && visContainerOf(m4.card) !== null)

    // A parse error degrades to the code view with a status line.
    const errorsBefore = vis.statsStore.get().errors
    // Must carry a mermaid structural token (the detector refuses a bare
    // keyword) while still tripping the fake runtime's BROKEN rejection.
    const m5 = makeVisCard('graph LR\nA --> BROKEN')
    const msg5 = domEl('div')
    msg5.appendChild(m5.card)
    await sleep(60)
    const c5 = visContainerOf(m5.card)
    const status5 = c5 && c5.querySelector('.dshp-vis-status')
    ok('a mermaid parse error degrades to code + status line', c5 !== null && status5 !== null && status5.textContent.indexOf('Parse error') !== -1, 'c5=' + String(!!c5) + ' status=' + String(status5 && status5.textContent) + ' img=' + String(imgSrcOf(c5)).slice(0, 50) + ' renders=' + fakeMermaidApi.renderCalls.map((c) => c.text.slice(0, 12)).join('|'))
    ok('the source stays visible on error', m5.pre.style.display === '', 'pre.display=' + String(m5.pre.style.display))
    ok('the error is counted', vis.statsStore.get().errors >= errorsBefore + 1, 'errors=' + vis.statsStore.get().errors + ' before=' + errorsBefore)
  }

  section('visualize: the rc.1 line-span DOM (newlines absent from textContent) still renders mermaid')
  {
    // The rc.1 renderer keeps every line in a <span class="line"> with only a
    // single space between lines, so code.textContent is a flattened one-line
    // string. readCodeText must rebuild the newlines from the line spans —
    // otherwise mermaid parses "flowchart LR A[...]" and dies on NEWLINE.
    function makeLineSpanCard(lines) {
      const code = domEl('code')
      lines.forEach((line, i) => {
        if (i > 0) {
          // the renderer's inter-line separator: a single space text node
          // (not modelled as a node in the fake — absence of it only tightens
          // the test: the spans alone must carry the structure)
        }
        const sp = domEl('span')
        sp.className = 'line'
        sp.textContent = line
        code.appendChild(sp)
      })
      // Flattened like the real renderer's textContent — newlines are GONE.
      code.textContent = lines.join(' ')
      const pre = domEl('pre')
      pre.setAttribute('class', 'plain')
      pre.appendChild(code)
      const contentDiv = domEl('div')
      contentDiv.setAttribute('data-code-block-content', '1')
      contentDiv.appendChild(pre)
      const card = domEl('div')
      card.setAttribute('class', 'md-code-block')
      const banner = domEl('div')
      banner.setAttribute('data-code-block-banner', '1')
      card.appendChild(banner)
      card.appendChild(contentDiv)
      return { card, pre, code, content: contentDiv }
    }

    const m6 = makeLineSpanCard(['flowchart LR', 'A[release] --> B[build]', 'B --> C[harness]'])
    const msg6 = domEl('div')
    msg6.appendChild(m6.card)
    await sleep(60)
    const c6 = visContainerOf(m6.card)
    const status6 = c6 && c6.querySelector('.dshp-vis-status')
    ok('the line-span card renders without a parse error', imgSrcOf(c6) !== null && (status6 === null || status6.textContent === ''), 'img=' + String(imgSrcOf(c6)).slice(0, 40) + ' status=' + String(status6 && status6.textContent))
    ok('mermaid received the NEWLINE-REBUILT text (not the flattened textContent)', fakeMermaidApi.renderCalls.some((call) => call.text === 'flowchart LR\nA[release] --> B[build]\nB --> C[harness]'), 'calls=' + fakeMermaidApi.renderCalls.map((c) => JSON.stringify(c.text.slice(0, 24))).join('|'))
  }

  section('visualize: a theme flip re-renders rendered mermaid (0.4.37)')
  {
    // Self-contained: render one fresh card in the current (light) theme,
    // then flip DSW's theme attribute on <body> back and forth.
    const mA = makeVisCard('graph TD\nP --> Q\nQ --> R')
    const msgA = domEl('div')
    msgA.appendChild(mA.card)
    await sleep(120)
    ok('the fresh card renders before the flip', imgSrcOf(visContainerOf(mA.card)) !== null)

    // Flip dark: the engine must re-init mermaid as dark AND re-render the
    // live block (its cache entry is theme-stamped, so this is a real
    // re-render, not a cache hit).
    const initBefore = fakeMermaidApi.initCalls.length
    const renderBefore = fakeMermaidApi.renderCalls.length
    document.body.setAttribute('data-ds-dark-theme', '1')
    await sleep(150)
    ok(
      'the flip re-initialized mermaid with the dark theme',
      fakeMermaidApi.initCalls.length === initBefore + 1 && fakeMermaidApi.initCalls[initBefore].theme === 'dark',
      'inits=' + fakeMermaidApi.initCalls.map((c) => c.theme).join('|'),
    )
    ok(
      'the live mermaid block was re-rendered for the new theme',
      fakeMermaidApi.renderCalls.length > renderBefore && imgSrcOf(visContainerOf(mA.card)) !== null,
      'renders=' + String(fakeMermaidApi.renderCalls.length - renderBefore),
    )

    // Flip back: the ORIGINAL light render (cached under the #l key) is
    // served again — no spurious re-init, block still displaying.
    document.body.removeAttribute('data-ds-dark-theme')
    await sleep(150)
    ok(
      'flipping back serves the cached light render (no spurious re-init)',
      fakeMermaidApi.initCalls.length === initBefore + 1 && imgSrcOf(visContainerOf(mA.card)) !== null,
      'inits=' + fakeMermaidApi.initCalls.map((c) => c.theme).join('|'),
    )

    // A NEW block rendered while the engine still believes it is dark must
    // re-initialize as light first.
    const initBefore2 = fakeMermaidApi.initCalls.length
    const mB = makeVisCard('graph LR\nX --> Y\nY --> Z')
    const msgB = domEl('div')
    msgB.appendChild(mB.card)
    await sleep(150)
    ok(
      'a fresh render in the light theme re-initializes mermaid as default',
      fakeMermaidApi.initCalls.length === initBefore2 + 1 && fakeMermaidApi.initCalls[initBefore2].theme === 'default',
      'inits=' + fakeMermaidApi.initCalls.map((c) => c.theme).join('|'),
    )
  }

  section('visualize: streaming re-settles, coalesces, and honors the rerender budget')
  {
    const p0 = parseCalls.length
    const m6 = makeVisCard(SVG_A)
    const msg6 = domEl('div')
    msg6.appendChild(m6.card)
    await sleep(30)
    const c6 = visContainerOf(m6.card)
    const img6 = c6 && c6.querySelector('img')
    ok('the block rendered once settled', img6 !== null && decodeURIComponent(img6.getAttribute('src')).indexOf('<rect') !== -1)
    const p1 = parseCalls.length

    // Two rapid changes inside one settle window coalesce into a single render.
    m6.code.textContent = '<svg viewBox="0 0 10 10"><text x="1">t1</text></svg>'
    emitMutation({ type: 'childList', target: m6.code, addedNodes: [domEl('span')], removedNodes: [] })
    m6.code.textContent = '<svg viewBox="0 0 10 10"><text x="2">t2</text></svg>'
    emitMutation({ type: 'childList', target: m6.code, addedNodes: [domEl('span')], removedNodes: [] })
    await sleep(30)
    ok('rapid changes coalesce into one settle (one parse, latest content)', parseCalls.length === p1 + 1 && decodeURIComponent(img6.getAttribute('src')).indexOf('t2') !== -1, 'extra parses=' + (parseCalls.length - p1) + ' src=' + String(decodeURIComponent(img6 && img6.getAttribute('src') || '')).slice(0, 60))

    const bump = (content) => {
      m6.code.textContent = content
      emitMutation({ type: 'childList', target: m6.code, addedNodes: [domEl('span')], removedNodes: [] })
    }
    bump('<svg viewBox="0 0 10 10"><ellipse/></svg>')
    await sleep(30)
    bump('<svg viewBox="0 0 10 10"><polygon/></svg>')
    await sleep(30)
    ok('re-renders within budget follow the stream', decodeURIComponent(img6.getAttribute('src')).indexOf('polygon') !== -1, 'src=' + String(decodeURIComponent(img6 && img6.getAttribute('src') || '')).slice(0, 60) + ' parses=' + (parseCalls.length - p0))
    const pBudget = parseCalls.length
    bump('<svg viewBox="0 0 10 10"><line/></svg>')
    await sleep(30)
    ok('the rerender budget is then exhausted (long streams cannot storm)', decodeURIComponent(img6.getAttribute('src')).indexOf('polygon') !== -1 && parseCalls.length === pBudget, 'src=' + String(decodeURIComponent(img6 && img6.getAttribute('src') || '')).slice(0, 60) + ' parses=' + (parseCalls.length - p0) + ' budget=' + (pBudget - p0))
  }

  section('visualize: oversized content, removal, and the volatile kill switch')
  {
    const pBig = parseCalls.length
    const m7 = makeVisCard('<svg viewBox="0 0 1 1">' + 'x'.repeat(100001) + '</svg>')
    const msg7 = domEl('div')
    msg7.appendChild(m7.card)
    await sleep(30)
    const c7 = visContainerOf(m7.card)
    const status7 = c7 && c7.querySelector('.dshp-vis-status')
    ok('oversized content stays code with a status line', status7 !== null && status7.textContent.indexOf('内容过大') !== -1 && m7.pre.style.display === '')
    ok('oversized content is never parsed', parseCalls.length === pBig)

    // Removal: the track is forgotten, later "changes" render nothing.
    const m8 = makeVisCard(SVG_A)
    const msg8 = domEl('div')
    msg8.appendChild(m8.card)
    await sleep(30)
    ok('the block rendered before removal', visContainerOf(m8.card) !== null)
    const pAfter = parseCalls.length
    msg8.removeChild(m8.card)
    m8.code.textContent = '<svg viewBox="0 0 1 1"><text>gone</text></svg>'
    emitMutation({ type: 'childList', target: m8.code, addedNodes: [domEl('span')], removedNodes: [] })
    await sleep(30)
    ok('a removed block is forgotten (no re-render after removal)', parseCalls.length === pAfter && msg8.children.length === 0)

    // Kill switch: both volatile toggles off -> new blocks stay plain code.
    liveOverrides.visualizeValues.svg = false
    liveOverrides.visualizeValues.mermaid = false
    await reFireSettings()
    const pOff = parseCalls.length
    const m9 = makeVisCard(SVG_A)
    const msg9 = domEl('div')
    msg9.appendChild(m9.card)
    await sleep(30)
    ok('row on but both sub-switches off: no container, no parse', visContainerOf(m9.card) === null && parseCalls.length === pOff)

    // Flip svg back on: new blocks render again (and from the cache).
    liveOverrides.visualizeValues.svg = true
    await reFireSettings()
    const m10 = makeVisCard(SVG_A)
    const msg10 = domEl('div')
    msg10.appendChild(m10.card)
    await sleep(30)
    ok('flipping the svg switch on live renders new blocks (cached: no parse)', visContainerOf(m10.card) !== null && parseCalls.length === pOff)

    // mermaid stays off while svg is on: a mermaid block is only a candidate.
    const m11 = makeVisCard('graph LR\nA --> B')
    const msg11 = domEl('div')
    msg11.appendChild(m11.card)
    await sleep(30)
    const mmdBefore = fakeMermaidApi.renderCalls.length
    ok('the disabled kind stays a plain code block (no render call)', visContainerOf(m11.card) === null && fakeMermaidApi.renderCalls.length === mmdBefore)

    // Flip mermaid on: the already-tracked candidate is re-promoted without any
    // new DOM insertion (the setConfig promotion pass).
    liveOverrides.visualizeValues.mermaid = true
    await reFireSettings()
    await sleep(55)
    const c11 = visContainerOf(m11.card)
    // Exactly one render for m11; the earlier error block (m5) is legitimately
    // re-promoted too, so the count is a lower bound + a membership check.
    ok(
      're-enabling the kind promotes already-tracked candidates',
      c11 !== null &&
        imgSrcOf(c11) !== null &&
        fakeMermaidApi.renderCalls.length >= mmdBefore + 1 &&
        fakeMermaidApi.renderCalls.slice(mmdBefore).some((call) => call.text === 'graph LR\nA --> B'),
      'container=' + String(!!c11) + ' renders=' + (fakeMermaidApi.renderCalls.length - mmdBefore),
    )
  }

  section('visualize: a failed chunk load degrades to code + status')
  {
    // Kill the live engine so it does not also track the block below.
    liveOverrides.visualizeValues.svg = false
    liveOverrides.visualizeValues.mermaid = false
    await reFireSettings()
    mermaidChunk.shouldFail = true
    const failOverrides = { namespaces: ['dsh-polish:visualize'], visualizeValues: { svg: false, mermaid: true } }
    registrations.length = 0
    mod.apply(makeCtx(failOverrides))
    await sleep(5)
    const m12 = makeVisCard('graph LR\nA --> B')
    const msg12 = domEl('div')
    msg12.appendChild(m12.card)
    await sleep(80)
    const c12 = visContainerOf(m12.card)
    const status12 = c12 && c12.querySelector('.dshp-vis-status')
    ok('the load failure surfaces as a status line, code stays visible', status12 !== null && status12.textContent.indexOf('chunk load failed') !== -1 && m12.pre.style.display === '')
    ok('the runtime state is marked failed', vis.statsStore.get().mermaidState === 'failed')
    mermaidChunk.shouldFail = false
  }

  section('visualize: wiring in the built client')
  {
    ok('namespace / row key / engine / page are wired', source.indexOf("var NS_VISUALIZE = 'dsh-polish:visualize'") >= 0 && source.indexOf("var ROW_KEY_VISUALIZE = 'dsh-polish#dsh-polish:visualize'") >= 0 && source.indexOf('function createVisualize()') >= 0 && source.indexOf('function VisualizePage(props)') >= 0)
    ok('the mermaid runtime is a package-local chunk, no CDN', source.indexOf("require.async('./client.mermaid.js')") >= 0)
    ok('strict security + inert img display', source.indexOf("securityLevel: 'strict'") >= 0 && source.indexOf('data:image/svg+xml;charset=utf-8') >= 0)
    ok(
      'the container anchors on the pre parent layer (rc.1 nested card + rc.2 flat card both safe)',
      source.indexOf('var host = entry.pre.parentNode || entry.card') >= 0 && source.indexOf('host.insertBefore(container, entry.pre)') >= 0,
    )
    ok(
      'dark detection trusts the DSW body attribute, the cache key carries the theme, and flips re-render',
      source.indexOf("hasAttribute('data-ds-dark-theme')") >= 0 &&
        source.indexOf("fp + (isDarkTheme() ? '#d' : '#l')") >= 0 &&
        source.indexOf('function rethemeMermaid()') >= 0 &&
        source.indexOf("attributeFilter: ['data-ds-dark-theme']") >= 0,
    )
    // The chunk must ship BESIDE the client entry (lib/client.js): the Host
    // resolves require.async('./client.<x>.js') against dirname(clientPath).
    const chunkPath = path.join(__dirname, '..', 'lib', 'client.mermaid.js')
    const chunk = fs.existsSync(chunkPath) ? fs.readFileSync(chunkPath, 'utf8') : ''
    ok('lib/client.mermaid.js is built and self-registering', chunk.indexOf('dsh-polish mermaid chunk v11.17.0') >= 0 && chunk.indexOf("'dsh-polish/client.mermaid.js'") >= 0 && chunk.indexOf('__ModuleLoader__.load') >= 0)
    ok(
      'the chunk factory follows the loader convention (factory(require), returns its own module.exports — the loader injects no exports/module)',
      chunk.indexOf('factory: function (require) {') >= 0 && chunk.indexOf('var module = { exports: {} }') >= 0 && chunk.indexOf('return module.exports') >= 0 && chunk.indexOf('function (require, exports, module)') === -1,
    )
    ok('no stray chunk copy at the package root (that location is never served)', fs.existsSync(path.join(__dirname, '..', 'client.mermaid.js')) === false)
    const patch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    const atRow = patch.indexOf("id: 'dsh-polish:visualize'")
    ok('the bundle patch ships the visualize row, disabled by default', atRow >= 0 && patch.indexOf("name: 'dsh-polish/visualize'", atRow) !== -1 && patch.slice(atRow, atRow + 500).indexOf('disabled: true') !== -1)
  }

  section('thinking preview: collapsed window pinned to bottom, no free scroll (0.4.53; instant pin 0.4.55; rc.1 DOM 0.4.56)')
  {
    var tpEngine = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'thinking-renderer', 'engine.js'), 'utf8')
    var tpStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'styles.js'), 'utf8')
    var tpBuilt = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
    // 0.4.56 根因（运行中 shell 的 DisclosureRow 实测 DOM）：rc.1 里
    // [data-open] 下第一个直接子元素是 div[data-disclosure-header] 头包装
    // （data-disclosure-row 内移一层），旧逻辑把头包装当正文——钉底打在头
    // 包装上（非滚动容器）而 CSS 裁剪命中文本正文，窗口永远钉在顶端。
    var tpBodyFn = extractFunction(tpEngine, 'reasoningBody')
    ok(
      '0.4.56: reasoningBody skips the rc.1 header wrapper (data-disclosure-header), not just the rc.2 row',
      tpBodyFn !== null &&
        tpBodyFn.indexOf("child.hasAttribute('data-disclosure-row')") >= 0 &&
        tpBodyFn.indexOf("child.hasAttribute('data-disclosure-header')") >= 0 &&
        tpBodyFn.indexOf('continue') >= 0,
    )
    ok(
      '0.4.56: preview + folding CSS exclude the rc.1 header wrapper (clip the body, not the header)',
      tpStyles.indexOf(':not([data-disclosure-row]):not([data-disclosure-header])') >= 0 &&
        tpStyles.indexOf('] > :not([data-disclosure-row])\'') < 0,
    )
    ok(
      'the preview window is overflow-y hidden (the user cannot scroll it; programmatic pin still works)',
      tpStyles.indexOf("'  overflow-y: hidden;',") >= 0 && tpStyles.indexOf("'  overflow-y: auto;',") < 0,
    )
    // 0.4.55 根因：Chromium 实测 scroll-behavior: smooth 下 plain
    // `scrollTop = scrollHeight` 赋值不生效（平滑动画被流式更新打断，
    // 窗口钉死在顶端）——smooth 必须从预览 CSS 里消失。
    ok(
      '0.4.55: no scroll-behavior smooth left on the preview (it made the plain scrollTop pin a no-op)',
      tpStyles.indexOf('scroll-behavior: smooth') < 0 && tpStyles.indexOf('scroll-behavior: auto') < 0,
    )
    // 0.4.55：程序化钉底用 behavior:'instant' 单帧赋值（CSS 平滑滚动在
    // Chromium 下会让 plain 赋值 no-op）；0.4.59 起由 chaseBottom 追逐环
    // 逐帧写入。body 不是滚动容器时只向上找一级 [data-open]，不碰页面
    // 大滚动条。
    var tpPinFn = extractFunction(tpEngine, 'chaseBottom')
    ok(
      '0.4.55: the pin writes instant single-frame (instant + plain fallback) so CSS smooth can never no-op it',
      tpPinFn !== null &&
        tpPinFn.indexOf("behavior: 'instant'") >= 0 &&
        tpPinFn.indexOf('entry.el.scrollTop = next') >= 0,
    )
    var tpFollowFn = extractFunction(tpEngine, 'followLatest')
    ok(
      'followLatest drives the bottom unconditionally while the preview is up (no user-suspend gate), body else one-level [data-open] host',
      tpFollowFn !== null &&
        tpFollowFn.indexOf('chaseBottom(root, body, state)') >= 0 &&
        tpFollowFn.indexOf('hasAttribute(\'data-open\')') >= 0 &&
        tpFollowFn.indexOf('!state.follow') < 0,
    )
    ok(
      'the built client carries the instant pinned-bottom preview (hidden overflow, instant pin, no old suspend gate, no smooth, rc.1 header excluded)',
      tpBuilt.indexOf('overflow-y: hidden') >= 0 &&
        tpBuilt.indexOf("'  overflow-y: auto;',") < 0 &&
        tpBuilt.indexOf("behavior: 'instant'") >= 0 &&
        tpBuilt.indexOf('scroll-behavior: smooth') < 0 &&
        tpBuilt.indexOf(':not([data-disclosure-header])') >= 0 &&
        tpBuilt.indexOf("if (!state.follow || root.getAttribute(PREVIEW_ATTR) !== '1') return") < 0,
    )
    // 0.4.59：「跟随时长」followMs（0-2000ms，默认 300）取代 0.4.57 的
    // followSmooth（0-100）。0.4.57 的缓动是事件驱动（流式突变才推一步，
    // 被 API 帧率绑架）；0.4.59 改为实时 rAF 追逐环 + EMA/pure-pursuit
    // 指数逼近：next = top + (target-top)·(1-e^(-dt/τ))，τ = t/3（约 t
    // 毫秒收敛 95%），target 每帧重测（追踪移动目标），收敛 <1px 精确
    // 到位并停环，t=0/减动态即时。
    var tpHost = fs.readFileSync(path.join(__dirname, '..', 'thinking-renderer', 'index.js'), 'utf8')
    var tpConsts = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'constants.js'), 'utf8')
    var tpApply = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'runtime', 'apply.js'), 'utf8')
    var tpForms = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'settings', 'forms.js'), 'utf8')
    ok(
      '0.4.59: followMs is a volatile row config (0-2000, default 300) and followSmooth is gone',
      tpHost.indexOf('followMs: z.natural().max(2000).default(300).volatile(),') >= 0 && tpHost.indexOf('followSmooth') < 0,
    )
    ok(
      '0.4.59: default 300 flows apply.js (clamped 0-2000) into engine config + setConfig change detection',
      tpConsts.indexOf('followMs: 300') >= 0 &&
        tpApply.indexOf('followMs: num(read.value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000)') >= 0 &&
        tpEngine.indexOf('config.followMs !== next.followMs') >= 0 &&
        tpEngine.indexOf('followMs: RENDERER_DEFAULTS.followMs') >= 0,
    )
    ok(
      '0.4.59: chaseBottom is a real-time rAF loop — EMA pure-pursuit (tau = ms/3, exp(-dt/tau)), re-measures target each frame, snaps and stops on convergence',
      tpPinFn !== null &&
        tpPinFn.indexOf('var tau = ms / 3') >= 0 &&
        tpPinFn.indexOf('Math.exp(-dt / tau)') >= 0 &&
        tpPinFn.indexOf('entry.raf = requestAnimationFrame(frame)') >= 0 &&
        tpPinFn.indexOf('stopChase(entry)') >= 0 &&
        tpPinFn.indexOf('target - next < 1') >= 0,
    )
    ok(
      '0.4.60: no prefers-reduced-motion silent fallback in the chase (Windows 11 "Animation effects" off maps to reduce; explicit t=0 is the only off switch)',
      tpPinFn !== null &&
        tpPinFn.indexOf('prefersReducedMotion') < 0 &&
        tpEngine.indexOf('function prefersReducedMotion') < 0,
    )
    ok(
      '0.4.61: the chase loop persists through an idle tail (max(ms,500)ms) after convergence — bursty-stream glides chain end-to-end, decoupled from chunk timing',
      tpPinFn !== null &&
        tpPinFn.indexOf('entry.lastGrowthAt = now') >= 0 &&
        tpPinFn.indexOf('Math.max(ms, 500)') >= 0,
    )
    ok(
      '0.4.61: first-seen elements are instant-pinned when chase starts (pinnedEls WeakSet) — 0.4.56 open-pinned baseline, no top-flash on remount',
      tpPinFn !== null &&
        tpPinFn.indexOf('state.pinnedEls') >= 0 &&
        tpEngine.indexOf('pinnedEls: new WeakSet()') >= 0,
    )
    ok(
      '0.4.63: the chase target is the last real text line bottom (text floor), not the geometric container bottom — trailing empty structure no longer counts as "the bottom"',
      tpEngine.indexOf('function textFloorTarget') >= 0 &&
        tpEngine.indexOf('function lastTextNode') >= 0 &&
        tpEngine.indexOf('entry.textFloor') >= 0 &&
        tpPinFn.indexOf('Math.min(geoTarget, entry.textFloor)') >= 0,
    )
    ok(
      '0.4.63: the instant pin and the frame both fall back to the geometric floor only when no usable text exists',
      tpPinFn.indexOf('var floor0 = textFloorTarget(el)') >= 0 &&
        tpPinFn.indexOf('if (floor0 === null) floor0 = el.scrollHeight - el.clientHeight') >= 0,
    )
    var tpStopFn = extractFunction(tpEngine, 'stop')
    ok(
      '0.4.59: the engine tracks every chase loop in a Set and stop() cancels them all',
      tpEngine.indexOf('var chases = new Set()') >= 0 &&
        tpEngine.indexOf('chases.add(entry)') >= 0 &&
        tpEngine.indexOf('chases.delete(entry)') >= 0 &&
        tpStopFn !== null &&
        tpStopFn.indexOf('stopChase(running[c])') >= 0,
    )
    ok(
      '0.4.59: the settings page exposes 跟随时长（毫秒）(0-2000 step 50) and the built client carries followMs (no followSmooth left)',
      tpForms.indexOf("key: 'followMs'") >= 0 &&
        tpForms.indexOf('跟随时长（毫秒）') >= 0 &&
        tpForms.indexOf('max: 2000') >= 0 &&
        tpBuilt.indexOf('followMs') >= 0 &&
        tpBuilt.indexOf('followSmooth') < 0,
    )
  }

  section('keep-effort: per-(session, model) effort memory (0.4.34)')
  {
    var keRaw = fs.readFileSync(path.join(__dirname, '..', 'keep-effort', 'index.js'), 'utf8')
    var kePkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    var kePatch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    ok('the row injects settings/timer only (0.4.54: llm is an activation gate, not a hard dependency)', keRaw.indexOf("export const inject = ['settings', 'timer']") >= 0 && keRaw.indexOf("'llm'") < 0)
    ok('0.4.54: llm is read lazily per request with fail-open/degraded fallbacks', keRaw.indexOf('llm = ctx.llm') >= 0 && keRaw.indexOf('if (!llm) return Promise.resolve(true)') >= 0 && keRaw.indexOf('if (!llm) return Promise.resolve(undefined)') >= 0)
    ok('0.4.54: module load marker for post-restart triage (import ok / row inactive / write failed)', keRaw.indexOf("console.warn('[dshp keep-effort] module loaded @' + VERSION)") >= 0)
    ok('it hooks the agent/request waterfall (same seam as the core model-selection)', keRaw.indexOf("ctx.on('agent/request'") >= 0 && keRaw.indexOf('var resolved = await next()') >= 0)
    ok('the payload agent + the persisted request header drive the decision', keRaw.indexOf('payload && payload.agent') >= 0 && keRaw.indexOf('agent.session.requestHeader()') >= 0)
    ok('capability is validated via llm.resolveCallConfig and any error fails open', keRaw.indexOf('ctx.llm') >= 0 && keRaw.indexOf('resolveCallConfig') >= 0 && keRaw.indexOf('.catch(function () {') >= 0)
    ok('an unexpected failure passes the request through untouched', keRaw.indexOf('继承决策异常，原样放行') >= 0 && keRaw.indexOf('return resolved') >= 0)
    ok('records persist in the row config, debounced and capped at 100 sessions', keRaw.indexOf("ROW_ID = 'dsh-polish:keep-effort'") >= 0 && keRaw.indexOf('MAX_SESSIONS = 100') >= 0 && keRaw.indexOf('effortRecords') >= 0 && keRaw.indexOf('FLUSH_INTERVAL_MS = 5000') >= 0)
    ok('the row page mirror + carryOnDefault are volatile; the master switch is the row', keRaw.indexOf('enabled: z.boolean().default(true).volatile()') >= 0 && keRaw.indexOf('carryOnDefault: z.boolean().default(true).volatile()') >= 0)
    // 0.4.43: the waterfall config often carries NO effort (the model's own
    // default is materialised in prepareCall, after the waterfall) —�?the
    // recorded value must be the EFFECTIVE effort, materialised + cached, so
    // memory accumulates on the common "UI switched model, no effort picked"
    // path instead of staying empty forever.
    ok('the recorded effort falls back to the materialised model default (effective = requested ?? default)', keRaw.indexOf('var recordedEffort = finalEffort') >= 0 && keRaw.indexOf('if (recordedEffort === undefined) recordedEffort = await effectiveDefaultOf(llm, provider, model)') >= 0 && keRaw.indexOf('record(sessionId, provider, model, recordedEffort)') >= 0)
    ok('the materialised default is cached per route to keep the request path cheap', keRaw.indexOf('var defaultCache = new Map()') >= 0 && keRaw.indexOf('function effectiveDefaultOf(llm, provider, model)') >= 0 && keRaw.indexOf('if (defaultCache.has(key)) return Promise.resolve(defaultCache.get(key))') >= 0)
    // 0.4.43: runtime diagnostics persist in the row config so a silent
    // no-carry is finally observable: apply marker, fire count, and the full
    // last decision (route / prev / current / remembered / default / support /
    // verdict) without changing the user-facing silence.
    ok('a diagnostics snapshot persists in the row config (observable silence)', keRaw.indexOf('diagnostics: z.dict(z.any()).default({}).volatile()') >= 0 && keRaw.indexOf('function noteDiag(patch)') >= 0 && keRaw.indexOf('lastDecision: decision') >= 0 && keRaw.indexOf('appliedAt: Date.now()') >= 0 && keRaw.indexOf('lastRemembered') >= 0 && keRaw.indexOf('lastSupported') >= 0)
    // 0.4.53 根因：rc.1 的 settings.update 只允许运行期写 volatile 字段
    // （dsh-settings：“Config field ... is not volatile”）。这两个运行期写入
    // 的字段当时是全部组件里仅有的漏标 → 每次写盘必失败 → 退避 → 停手，
    // 记忆从未落盘。
    ok('0.4.53: both runtime-written fields are volatile (rc.1 rejects non-volatile runtime writes)', keRaw.indexOf('effortRecords: z.dict(z.dict(z.string())).default({}).volatile(),') >= 0 && keRaw.indexOf('diagnostics: z.dict(z.any()).default({}).volatile(),') >= 0)
    ok('the diagnostics field uses only the installed schemastery 3.18 API (no unknown schema)', keRaw.indexOf('z.unknown') === -1 && keRaw.indexOf('z.any()') >= 0)
    ok('flush writes records and diagnostics in one debounced update', keRaw.indexOf('if (Object.keys(diag).length > 0) patch.diagnostics = Object.assign({}, diag)') >= 0 && keRaw.indexOf('if (!dirty && !diagDirty) return') >= 0)
    // 0.4.47（0.4.45 事故修复）：settings.update 是 HMR 事务，插件重载期间
    // 被拒时绝不能 5s 重试一次；诊断里也不能有每请求都变的键。
    ok('a failed write backs off with a cap and parks instead of retrying forever', keRaw.indexOf('var MAX_FLUSH_FAILURES = 20') >= 0 && keRaw.indexOf('if (Date.now() < flushBlockedUntil) return') >= 0 && keRaw.indexOf('暂停写盘') >= 0)
    ok('per-request counters never enter the persisted diagnostics', keRaw.indexOf('fired: fired') === -1 && keRaw.indexOf('var liveFired = 0') >= 0 && keRaw.indexOf('delete diag.fired') >= 0 && keRaw.indexOf('firstFiredAt') >= 0)
    ok('a real route change resets the failure budget', keRaw.indexOf('flushFailures = 0') >= 0 && keRaw.indexOf('flushBlockedUntil = 0') >= 0)
    // 0.4.53（rc.1 静默失效修复）：apply 全程 fail-soft（configure/interval/
    // 卸载 effect 的注册异常不得中断 apply），settings.update 不假设返回
    // thenable（沙箱守卫下裸调 .then 会把每次 flush 变失败→退避→停手），
    // apply 尾部立即写盘并带 version——patch 文件几秒内应出现 config 块，
    // 块缺失即「行未被 Loader 激活」，诊断可判读。
    ok('0.4.53: side-channel registration failures cannot abort apply (fail-soft, recorded as setupError)', keRaw.indexOf('try {\n    ctx.effect(function () {') >= 0 && keRaw.indexOf('setupError') >= 0)
    ok('0.4.53: the settings.update return is not assumed thenable (defensive .then)', keRaw.indexOf("typeof update.then === 'function'") >= 0)
      keRaw.indexOf("VERSION = '0.4.101'") >= 0 && keRaw.indexOf('noteDiag({ appliedAt: Date.now(), enabled: true, version: VERSION })') >= 0 && keRaw.lastIndexOf('try {\n    flush()') > keRaw.indexOf('appliedAt: Date.now()')

    // The carry decision is the whole component: pull the shipped pure function
    // out and exercise the matrix directly.
    var keFn = extractFunction(keRaw, 'decideCarry')
    ok('decideCarry ships and is self-contained', keFn !== null, keFn ? keFn.slice(0, 40) : 'not found')
    var decide = keFn === null ? () => null : (0, eval)('(' + keFn + ')')
    var prevQwen = { provider: 'a100', model: 'qwen3.8-27b' }
    ok('route change with an absent effort inherits the remembered effort', decide(prevQwen, 'openai-codex', 'gpt-6-luna', undefined, 'xhigh', true, undefined) === 'xhigh')
    ok('a new-model default-filled effort yields to the remembered effort (carryOnDefault)', decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'max', 'xhigh', true, 'max') === 'xhigh')
    ok('strict mode only inherits an absent effort', decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'max', 'xhigh', false, 'max') === null && decide(prevQwen, 'openai-codex', 'gpt-6-luna', undefined, 'xhigh', false, 'max') === 'xhigh')
    ok('an explicit user effort choice wins over the remembered one', decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'low', 'xhigh', true, 'max') === null)
    ok('a current effort that is neither the remembered one nor the default is untouched', decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'high', 'xhigh', true, 'max') === null)
    ok('no remembered effort for the new model -> no carry', decide(prevQwen, 'openai-codex', 'gpt-6-luna', undefined, undefined, true, undefined) === null && decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'max', '', true, 'max') === null)
    ok('the same route is never touched (the core loop inherits there)', decide(prevQwen, 'a100', 'qwen3.8-27b', undefined, 'medium', true, undefined) === null)
    ok('a first request (no persisted header yet) still carries the remembered effort', decide(null, 'a100', 'qwen3.8-27b', undefined, 'xhigh', true, undefined) === 'xhigh')
    ok('the current effort equal to the remembered one needs no change', decide(prevQwen, 'openai-codex', 'gpt-6-luna', 'xhigh', 'xhigh', true, 'max') === null)

    var keAtRow = kePatch.lastIndexOf("id: 'dsh-polish:keep-effort'")
    ok('the bundle patch ships the keep-effort row, enabled by default (no disabled flag on the row)', keAtRow >= 0 && kePatch.indexOf("name: 'dsh-polish/keep-effort'", keAtRow) !== -1 && kePatch.slice(keAtRow, keAtRow + 400).indexOf('disabled') < 0)
      kePkg.version === '0.4.101' && kePkg.exports['./keep-effort'] && kePkg.exports['./keep-effort'].default === './keep-effort/index.js' && kePkg.files.indexOf('keep-effort/') >= 0
    var keNestPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'keep-effort', 'package.json'), 'utf8'))
    ok('the nested component package declares no dsh.client (subpath isolation)', keNestPkg.name === 'dsh-polish-keep-effort' && keNestPkg.dsh === undefined && !!keNestPkg.exports && !!keNestPkg.exports['.'])
  }

  section('keep-effort: a failing settings write backs off instead of storming (0.4.47 behavioral)')
  {
    // 0.4.45 事故：settings.update 在插件 HMR 重载期间被拒
    // （"HMR transactions cannot be nested"），旧实现每 5s 重试一次并打一行
    // 日志 — 实测 1054 次失败后 host 堆涨到 2.2GB，FATAL heap OOM，exit 134。
    // 这里用真实模型 + 永远拒绝的 update 复现，断言重试有上限、日志有上限。
    var keSrcBE = fs.readFileSync(path.join(__dirname, '..', 'keep-effort', 'index.js'), 'utf8')
    keSrcBE = keSrcBE.replace("import z from '@deepseek-ai/schemastery'", 'const z = globalThis.__Z_STUB__')
    keSrcBE = keSrcBE.replace(/export\s*\{[^}]*\}/g, '')
    keSrcBE = keSrcBE.replace(/export const (Config|inject)/g, 'exports.$1')
    keSrcBE = keSrcBE.replace('export function apply', 'exports.apply = function apply')
    var keZ = new Proxy(function () {}, {
      get: (t, p) => (p === Symbol.toPrimitive ? () => 'z' : keZ),
      apply: () => keZ,
    })
    globalThis.__Z_STUB__ = keZ
    var keMod = { exports: {} }
    new Function('module', 'exports', 'require', keSrcBE)(keMod, keMod.exports, require)

    var beUpdates = 0
    var beWarns = []
    var beInterval = null
    var beRealWarn = console.warn
    var beRealNow = Date.now
    var beNow = 1000000000
    console.warn = function (msg) {
      beWarns.push(String(msg))
    }
    Date.now = function () {
      return beNow
    }
    try {
      var beCtx = {
        fiber: { name: 'ke-be' },
        effect(fn) {
          var d = fn()
          return typeof d === 'function' ? d : function () {}
        },
        on(event) {
          if (event !== 'agent/request') throw new Error('unexpected event ' + event)
          return function () {}
        },
        interval(fn) {
          beInterval = fn
          return function () {}
        },
        settings: {
          configure() {},
          update() {
            beUpdates += 1
            // 同步 thenable：让失败回调在本次 flush() 调用内立刻执行，
            // 测试循环才能在同一个 for 里推进退避状态机（真实路径是 promise）。
            return {
              then(_ok, fail) {
                fail(new Error('HMR transactions cannot be nested'))
              },
            }
          },
        },
        llm: {
          resolveCallConfig() {
            return Promise.resolve({ reasoningEffort: 'high' })
          },
        },
      }
      keMod.exports.apply(beCtx, { enabled: true })
      ok('the failing-update fixture wires the interval flush', typeof beInterval === 'function')

      // 200 tick × 5s = 16 分钟：旧实现会尝试 200 次、打 200 行日志。
      for (var beTick = 0; beTick < 200; beTick++) {
        beNow += 5000
        beInterval()
      }
      ok('retries are capped instead of hammering every interval', beUpdates <= 22, 'attempts=' + beUpdates)
      ok('a permanent failure logs a few lines, not one per interval', beWarns.length <= 4, 'warns=' + beWarns.length)
      var beCountAtCap = beUpdates
      for (var beCool = 0; beCool < 60; beCool++) {
        beNow += 5000
        beInterval()
      }
      ok('after the cap the write is parked (no further attempts)', beUpdates === beCountAtCap, 'attempts=' + beUpdates)
      ok('the park note is logged exactly once', beWarns.filter((m) => m.indexOf('暂停写盘') >= 0).length === 1)
    } finally {
      console.warn = beRealWarn
      Date.now = beRealNow
    }
  }

  section('keep-effort: client-side sync — save on effort switch, restore on model switch (0.4.58)')
  {
    // 0.4.58 架构翻转：官方模型选择器在切模型时把新模型的 defaultEffort 烙进
    // 选择并走 remote.session.selectModel 提交（"跳到默认"的根源）；持久化
    // modelSelection 投影（{lastUsed, next}，next = pending ?? lastUsed）是
    // 选择器 UI 与这里共同读取的唯一事实源。client 侧监听投影、用选择器自己
    // 的 API 应答两个时刻：effort 变化 → 立即写 effortRecords；模型变化 →
    // 有记忆且与当前不同时 selectModel 恢复。宿主侧 listener 降级为兜底
    // （agent-preset 等非 UI 路径的请求级记录），两者写同一字段、revision 保护。
    var ekRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'keep-effort', 'effort-keeper.js'), 'utf8')
    var ekApply = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'runtime', 'apply.js'), 'utf8')
    var ekBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-client.cjs'), 'utf8')
    var ekConsts = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'constants.js'), 'utf8')
    ok(
      '0.4.58: the component watches the durable modelSelection projection (no DOM)',
      ekRaw.indexOf("useProjection('modelSelection', selectProjection, sameSelection)") >= 0,
    )
    ok(
      '0.4.58: a model switch restores the remembered effort through the selector\'s own selectModel, fail-open',
      ekRaw.indexOf('prev.provider !== cur.provider || prev.model !== cur.model') >= 0 &&
        ekRaw.indexOf('remembered !== undefined && remembered !== cur.reasoningEffort') >= 0 &&
        ekRaw.indexOf('childCtx.remote.session.selectModel({') >= 0 &&
        ekRaw.indexOf('reasoningEffort: remembered,') >= 0,
    )
    ok(
      '0.4.58: an effort switch persists immediately via configForms.mutate; the provider-default stop drops the record',
      ekRaw.indexOf("path: ['effortRecords']") >= 0 &&
        ekRaw.indexOf('form.mutate(') >= 0 &&
        ekRaw.indexOf('delete model[route]') >= 0 &&
        ekRaw.indexOf('cur.reasoningEffort !== prev.reasoningEffort') >= 0,
    )
    ok(
      '0.4.58: the record mirror follows the row config store (host-side writes included), sessions LRU-capped',
      ekRaw.indexOf('form.subscribe(refresh)') >= 0 &&
        ekRaw.indexOf('effortRecords') >= 0 &&
        ekRaw.indexOf('KEEP_EFFORT_MAX_SESSIONS = 100') >= 0,
    )
    ok(
      '0.4.58: wired as a session occupant behind the keep-effort row switch (whileServed)',
      ekConsts.indexOf("var NS_KEEP_EFFORT = 'dsh-polish:keep-effort'") >= 0 &&
        ekApply.indexOf('whileServed([NS_KEEP_EFFORT]') >= 0 &&
        ekApply.indexOf("id: 'dsh-polish:keep-effort', order: 60") >= 0 &&
        ekApply.indexOf('makeEffortKeeper(child)') >= 0,
    )
    ok(
      '0.4.58: the built client carries the effort keeper',
      ekBuild.indexOf("src/client/keep-effort/effort-keeper.js") >= 0 && source.indexOf('makeEffortKeeper') >= 0,
    )
  }

  section('skill mention: immediate [name](path) expansion (0.4.42)')
  {
    var skRaw = fs.readFileSync(path.join(__dirname, '..', 'skill-loader', 'index.js'), 'utf8')
    var skMentionRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'skill', 'skill-mention.js'), 'utf8')
    var skPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    ok('selection expands the token into a literal markdown reference, never a hidden marker', skMentionRaw.indexOf("var replacement = '[' + skill.name + ']'") >= 0 && skMentionRaw.indexOf("(path ? '(' + path + ')' : '')") >= 0 && skMentionRaw.indexOf('SELECTED_SKILL_MARKER') < 0 && skMentionRaw.indexOf('\\u2063') < 0)
    var skQueryFn = extractFunction(skMentionRaw, 'parseSkillQueryText')
    var skParseQuery = skQueryFn ? (0, eval)('(' + skQueryFn + ')') : () => null
    ok('the empty-composer token may sit at offset 0 (no leading space needed)', !!skParseQuery('$skill') && skParseQuery('$skill').start === 0 && skParseQuery('$skill').query === 'skill')
    ok('a leading space the user typed is preserved (token starts at 1)', !!skParseQuery(' $skill') && skParseQuery(' $skill').start === 1)
    ok('Tab confirms from the composer; Enter only confirms with the menu focused', skMentionRaw.indexOf("event.key === 'Tab' || (event.key === 'Enter' && !targetIsComposer)") >= 0)
    ok('the replace re-verifies the live draft and never reuses a detached DOM anchor', skMentionRaw.indexOf('text.slice(start, start + token.length) !== token') >= 0 && skMentionRaw.indexOf('if (typeof root.focus === \'function\') root.focus()') >= 0 && skMentionRaw.indexOf('view.anchorNode') < 0)
    ok('the blue-span decoration engine and its apply.js wiring are gone', source.indexOf('createSkillMentionDecoration') === -1 && source.indexOf('dshp-skill-ref') === -1 && source.indexOf('syncSkillRef') === -1)
    ok('the host no longer rewrites sent messages (no marker, no pre-step)', skRaw.indexOf('SELECTED_SKILL_MARKER') < 0 && skRaw.indexOf("ctx.on('agent/pre-step'") < 0 && skRaw.indexOf('expandSelectedSkillText') < 0)
      skPkg.version === '0.4.101'
  }

  section('session-slim: K-suffix, message derivation, chunking, tree walk, fold (0.4.75 pure functions)')
  {
    var slimHost = fs.readFileSync(path.join(__dirname, '..', 'session-slim', 'index.js'), 'utf8')

    // nextArchiveTitle is self-contained: exercise the K rule directly.
    var naFn = extractFunction(slimHost, 'nextArchiveTitle')
    ok('nextArchiveTitle ships and is self-contained', naFn !== null && naFn.indexOf('escapeRegExp') < 0, naFn ? naFn.slice(0, 40) : 'not found')
    var nextArchiveTitle = naFn === null ? () => null : (0, eval)('(' + naFn + ')')
    ok('no suffix, no siblings -> 原名@1', nextArchiveTitle('Foo', []) === 'Foo@1')
    ok('siblings Foo@1/Foo@3 -> next is Foo@4 (never Foo@3@1)', nextArchiveTitle('Foo', ['Foo', 'Foo@1', 'Foo@3']) === 'Foo@4')
    ok('an already-suffixed title counts its own K and continues the series', nextArchiveTitle('Foo@3', ['Foo@1', 'Foo@3']) === 'Foo@4')
    ok('unrelated projects (different bases) are ignored', nextArchiveTitle('Foo', ['Bar@9', 'Foo-Bar@2']) === 'Foo@1')
    ok('base names with regex metacharacters cannot collide (a.b matches only a.b@N)', nextArchiveTitle('a.b', ['a.b@2', 'ab@9']) === 'a.b@3')
    ok('blank titles are refused (the caller errors out)', nextArchiveTitle('', ['Foo@1']) === null && nextArchiveTitle(null, []) === null)

    // descendantsOf is the tree walk behind 0.4.74 folding + archive cascade.
    var descFn = extractFunction(slimHost, 'descendantsOf')
    ok('descendantsOf ships and is self-contained', descFn !== null, descFn ? descFn.slice(0, 40) : 'not found')
    var descendantsOf = descFn === null ? function () { return [] } : (0, eval)('(' + descFn + ')')
    var descTree = { a: ['b', 'c'], b: ['d', 'e'], c: [], d: ['f'] }
    ok('descendantsOf collects the full multi-level tree', JSON.stringify(descendantsOf('a', descTree).sort()) === JSON.stringify(['b', 'c', 'd', 'e', 'f']) && descendantsOf('c', descTree).length === 0)
    ok('descendantsOf survives a cycle (the root is not its own descendant)', JSON.stringify(descendantsOf('a', { a: ['b'], b: ['a'] }).sort()) === JSON.stringify(['b']))

    // foldRows is the pure fold behind the row table (0.4.75: the 0.4.74
    // inline version reassigned rows=[] then iterated rows.length === 0 and
    // dropped EVERY row, leaving the table permanently empty).
    var foldFn = extractFunction(slimHost, 'foldRows')
    ok('foldRows ships and is self-contained', foldFn !== null && foldFn.indexOf('rows = []') < 0, foldFn ? foldFn.slice(0, 40) : 'not found')
    // foldRows calls the sibling pure function descendantsOf -> eval both in one scope.
    var foldRows =
      descFn === null || foldFn === null
        ? function () {
            return []
          }
        : new Function([descFn, foldFn, 'return foldRows'].join('\n'))()
    function mkRow(id, extra) {
      return Object.assign({ id: id, parent: null, events: 0, fileBytes: null, running: false, live: false }, extra || {})
    }
    var foldTree = { m: ['c1', 'c2'], c1: ['g1'] }
    var folded = foldRows(
      [
        mkRow('m', { events: 100, fileBytes: 1000 }),
        mkRow('c1', { parent: 'm', events: 50, fileBytes: 500, running: true }),
        mkRow('c2', { parent: 'm', events: 25, fileBytes: 250, live: true }),
        mkRow('g1', { parent: 'c1', events: 10, fileBytes: 100 }),
        mkRow('orphan', { parent: 'gone', events: 7, fileBytes: 70 }),
      ],
      foldTree,
    )
    ok('foldRows keeps only top-level rows and the orphan (no data hidden)', folded.length === 2 && folded.some(function (r) { return r.id === 'm' }) && folded.some(function (r) { return r.id === 'orphan' }))
    var fm = folded.filter(function (r) { return r.id === 'm' })[0]
    ok('foldRows sums the WHOLE tree (grandchild included): events 185, bytes 1850', fm && fm.events === 185 && fm.fileBytes === 1850, JSON.stringify(fm))
    ok('foldRows tree-ORs running/live and records every descendant', fm && fm.running === true && fm.live === true && JSON.stringify(fm.subIds.slice().sort()) === JSON.stringify(['c1', 'c2', 'g1']) && fm.subCount === 3)
    ok('foldRows with an empty corpus keeps every row as its own top-level', foldRows([mkRow('a', { events: 5 })], []).length === 1)
    ok('foldRows on empty input returns empty (no crash)', foldRows([], {}).length === 0)

    // deriveMessage is the verbatim dsh-session port: exercise the type matrix.
    var dmFn = extractFunction(slimHost, 'deriveMessage')
    ok('deriveMessage ships and is self-contained', dmFn !== null, dmFn ? dmFn.slice(0, 40) : 'not found')
    var deriveMessage = dmFn === null ? () => null : (0, eval)('(' + dmFn + ')')
    var userEv = { type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }
    ok('user/message passes the data through', deriveMessage(userEv) === userEv.data)
    var asstEv = { type: 'assistant/message', seq: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } } }
    ok('assistant/message unwraps data.message', deriveMessage(asstEv).role === 'assistant')
    ok('an empty assistant message is dropped (null)', deriveMessage({ type: 'assistant/message', seq: 3, data: { message: { role: 'assistant', content: [] } } }) === null)
    var toolEv = { type: 'tool/result', seq: 4, data: { message: { role: 'tool', content: [{ type: 'tool_result', content: 'ok' }] } } }
    ok('tool/result carries its message', deriveMessage(toolEv) === toolEv.data.message)
    ok('non-message events are null', deriveMessage({ type: 'turn/start', seq: 5, data: {} }) === null && deriveMessage(null) === null)

    // The estimator + chunker ship as one pure block (shared helpers).
    var estTextFn = extractFunction(slimHost, 'estimateTextTokens')
    var estMsgFn = extractFunction(slimHost, 'estimateMessageTokens')
    var truncFn = extractFunction(slimHost, 'truncateMessage')
    var chunkFn = extractFunction(slimHost, 'chunkMessages')
    ok('the estimator + chunker all ship', estTextFn !== null && estMsgFn !== null && truncFn !== null && chunkFn !== null)
    var slimPures =
      estTextFn === null
        ? null
        : new Function(
            [
              'var OVERSIZED_TOKENS = 60000',
              estTextFn,
              estMsgFn,
              truncFn,
              chunkFn,
              'return { t: estimateTextTokens, m: estimateMessageTokens, c: chunkMessages }',
            ].join('\n'),
          )()
    ok('CJK weighs ~1 token/char, latin ~3.5 chars/token', slimPures && slimPures.t('') === 0 && slimPures.t('你好') === 2 && slimPures.t('hello world') === 4)
    ok('an oversized single message is truncated before chunking', function () {
      if (!slimPures) return false
      var huge = { role: 'user', content: [{ type: 'text', text: 'x'.repeat(400000) }] }
      var chunks = slimPures.c([huge], 24000)
      return chunks.length === 1 && slimPures.m(chunks[0].messages[0]) <= 60000 && chunks[0].messages[0].content[0].text.indexOf('…slim-trimmed…') >= 0
    }())
    ok('greedy packing packs until the budget and preserves order', function () {
      if (!slimPures) return false
      var big = { role: 'user', content: [{ type: 'text', text: 'y'.repeat(70000) }] } // ~20000 tokens each
      var bigChunks = slimPures.c([big, big, big], 24000)
      if (bigChunks.length !== 3) return false
      var small = { role: 'user', content: [{ type: 'text', text: 'z'.repeat(30000) }] } // ~8572 tokens each
      var smallChunks = slimPures.c([small, small, small, small], 24000)
      return smallChunks.length === 2 && smallChunks[0].messages.length === 2 && smallChunks[1].messages.length === 2 && smallChunks[0].tokens <= 24000 && smallChunks[1].tokens <= 24000
    }())

    // 0.4.80: surfaceFromEvents — readSurface events → compaction input.
    var surfFn = extractFunction(slimHost, 'surfaceFromEvents')
    ok('surfaceFromEvents ships and is self-contained', surfFn !== null, surfFn ? surfFn.slice(0, 40) : 'not found')
    var surfPures =
      surfFn === null || estTextFn === null || estMsgFn === null || dmFn === null
        ? null
        : new Function([estTextFn, estMsgFn, dmFn, surfFn, 'return { s: surfaceFromEvents }'].join('\n'))()
    ok('0.4.80: surface events → messages in order, LAST request/header wins tools, tokens summed', function () {
      if (!surfPures) return false
      var evs = [
        { type: 'system/message', seq: 0, data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
        { type: 'request/header', seq: 1, data: { header: { tools: [{ name: 'a' }] } } },
        { type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
        { type: 'assistant/message', seq: 3, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } } },
        { type: 'request/header', seq: 4, data: { header: { tools: [{ name: 'b' }, { name: 'c' }] } } },
        { type: 'turn/start', seq: 5, data: { turn: 1 } },
      ]
      var out = surfPures.s(evs)
      return (
        out.messages.length === 3 &&
        out.messages[0].role === 'system' &&
        out.messages[1].role === 'user' &&
        out.messages[2].role === 'assistant' &&
        out.tools !== null &&
        out.tools.length === 2 &&
        out.tools[1].name === 'c' &&
        out.sourceTokens === slimPures.m(out.messages[0]) + slimPures.m(out.messages[1]) + slimPures.m(out.messages[2])
      )
    }())
    ok('0.4.80: surfaceFromEvents tolerates empty/malformed input', surfPures !== null && surfPures.s([]).messages.length === 0 && surfPures.s(null).tools === null && surfPures.s(null).sourceTokens === 0)
  }

  section('session-slim: host routes, worker guards, pipeline order (0.4.75 source)')
  {
    var slimHostSrc = fs.readFileSync(path.join(__dirname, '..', 'session-slim', 'index.js'), 'utf8')
    ok('row config: five volatile fields (0.4.73: event count is the ONLY filter, default 5000, no file-size threshold)', slimHostSrc.indexOf('minEvents: z.number().default(5000).volatile()') >= 0 && slimHostSrc.indexOf('minFileBytes') < 0 && slimHostSrc.indexOf('compactProvider: z.string().default(\'\').volatile()') >= 0 && slimHostSrc.indexOf('compactModel: z.string().default(\'\').volatile()') >= 0 && slimHostSrc.indexOf('compactEffort: z.string().default(\'\').volatile()') >= 0 && slimHostSrc.indexOf('batchSize: z.number().default(3).volatile()') >= 0)
    ok('0.4.74 parent-child folding: lineage from sessionQuery.listSessions (the sidebar own corpus), DSH own subagent predicate (origin + parentSession), descendants folded into the top row (events/fileBytes summed, running/live tree-OR, subIds kept for the cascade)', slimHostSrc.indexOf('ctx.sessionQuery.listSessions(null)') >= 0 && slimHostSrc.indexOf("ch.origin === 'subagent' && ch.parentSession") >= 0 && slimHostSrc.indexOf("nextChildren[ch.parentSession].push(ch.id)") >= 0 && slimHostSrc.indexOf('r.events = (r.events || 0) + (dr.events || 0)') >= 0 && slimHostSrc.indexOf('r.running = r.running || dr.running') >= 0 && slimHostSrc.indexOf('r.subIds = desc') >= 0 && slimHostSrc.indexOf('r.subCount = desc.length') >= 0)
    ok('0.4.75 regression: the fold is a standalone pure function called from buildRows (the 0.4.74 inline fold reassigned rows=[] then iterated length 0 and dropped EVERY row, leaving the table permanently empty)', slimHostSrc.indexOf('function foldRows(allRows, children) {') >= 0 && slimHostSrc.indexOf('rows = foldRows(rows, children)') >= 0 && slimHostSrc.indexOf('rows = []\n      for (var ri') < 0)
    ok('0.4.75 corpus lineage has its own 60s TTL with stale-on-failure reuse and force-clear (the full zstd-header scan is an order of magnitude costlier than the 10s metric rebuild)', slimHostSrc.indexOf('CORPUS_TTL_MS = 60000') >= 0 && slimHostSrc.indexOf('var corpusCache = { at: 0, byId: null, children: null }') >= 0 && slimHostSrc.indexOf('if (force && corpusCache.byId) corpusCache = { at: 0, byId: null, children: null }') >= 0)
    ok('0.4.74 corpus failure falls back to the 0.4.73 whole-class subagent skip (live header.origin, cold subagent projection row)', slimHostSrc.indexOf("!haveCorpus && s.header && s.header.origin === 'subagent'") >= 0 && slimHostSrc.indexOf('!haveCorpus && rowsMap && rowsMap.subagent && rowsMap.subagent.val') >= 0)
    ok('0.4.74 rows are async with a single-flight rebuild and a sync cache for enqueue (the corpus list is async; 0.4.75 buildRows takes force to clear the corpus cache)', slimHostSrc.indexOf('async function buildRows(force) {') >= 0 && slimHostSrc.indexOf('rows: await buildRows(force)') >= 0 && slimHostSrc.indexOf('async function rowsNow(force) {') >= 0 && slimHostSrc.indexOf('rowsBuilding') >= 0 && slimHostSrc.indexOf('function cachedRowById(id) {') >= 0 && slimHostSrc.indexOf('var row = cachedRowById(id)') >= 0)
    ok('the installed schemastery 3.18 API only (no z.number().int())', slimHostSrc.indexOf('z.number().int') < 0 && slimHostSrc.indexOf('z.int') < 0)
    ok('eight fetch routes over the connection service (NOT volatile settings for row data)', slimHostSrc.indexOf('ctx.connection.fetch.register') >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/state'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/handoff-state'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/slim'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/refresh'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/stop'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/handoff'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/test-call'") >= 0 && slimHostSrc.indexOf('ctx.settings.update(NS') < 0)
    ok('every route declares requestBody buffered (0.4.73: an undeclared GET route makes the bridge build a body-carrying GET Request, which the connection layer answers 400; core /api/file GET/HEAD is declared the same way)', (slimHostSrc.match(/requestBody: 'buffered',\s+fetch:/g) || []).length === 8)
    ok('running sessions are skipped TREE-WIDE (0.4.74: main or any subagent descendant, row.running is the tree OR)', slimHostSrc.indexOf('agent.status === \'running\'') >= 0 && slimHostSrc.indexOf('if (row.running) {') >= 0 && slimHostSrc.indexOf('SLIM_RUNNING') >= 0 && slimHostSrc.indexOf('会话或其子代理正在进行中，已跳过') >= 0)
    ok('0.4.74 whole-tree activity pre-check via the DSH own waterfall (the same gate archiveSession uses internally) before ANY mutation (fail fast, no half-renamed state)', slimHostSrc.indexOf("'workspace/session-activity'") >= 0 && slimHostSrc.indexOf('SLIM_ACTIVE') >= 0 && slimHostSrc.lastIndexOf('SLIM_ACTIVE') < slimHostSrc.lastIndexOf('job.phase = \'renaming\''))
    ok('0.4.74 archive cascades to every subagent: archiveSession is NOT cascading (dsh-workspace source writes a single id), so each row.subIds descendant is archived explicitly after the main', slimHostSrc.lastIndexOf('archiveSession(subIds[si], {})') < slimHostSrc.lastIndexOf('archiveSession(id, {})') && slimHostSrc.indexOf('archivedSubagents: archivedSubs') >= 0)
    ok('metrics come from materialized surfaces: projcache + stat + projections (no zstd decompress); the transcript step reads the CURRENT context window (0.4.80)', slimHostSrc.indexOf("homePath('storages', 'session_projcache', 'sessions')") >= 0 && slimHostSrc.indexOf('session.v4.jsonl.zstd') >= 0 && slimHostSrc.indexOf('fs.statSync') >= 0 && slimHostSrc.indexOf('ctx.sessionQuery.readSurface(id)') >= 0 && slimHostSrc.indexOf('contextPressure') >= 0 && slimHostSrc.indexOf('modelSelection') >= 0)
    ok('same instruction as the built-in compaction (verbatim checkpoint structure)', slimHostSrc.indexOf('## Primary Request and Intent') >= 0 && slimHostSrc.indexOf('<compacted-summary> block, it is a PRIOR checkpoint') >= 0 && slimHostSrc.indexOf('This is an automatically generated checkpoint condensing an earlier span') >= 0)
    ok('map-reduce for long transcripts: 24k-token chunks, per-part digests (parallel pool), tree reduce (0.4.79: the old flat single merge could never hold 409 part texts in one call context)', slimHostSrc.indexOf('CHUNK_BUDGET_TOKENS = 24000') >= 0 && slimHostSrc.indexOf('function summarizeTranscript(target, transcript, tools, sessionId, job, chunkBudget)') >= 0 && slimHostSrc.indexOf('COMBINE_PREAMBLE') >= 0 && slimHostSrc.indexOf('while (level.length > 1)') >= 0)
    ok('the compact model is validated before the first call', slimHostSrc.indexOf('ctx.llm.resolveCallConfig({') >= 0 && slimHostSrc.indexOf('SLIM_MODEL_INVALID') >= 0)
    ok('0.4.85 P0 pipeline order: summarize -> create/seed -> attach -> select model -> rename new -> rename/archive old only after new is ready; no blind retry', slimHostSrc.indexOf('job.phase = \'renaming\'') >= 0 && slimHostSrc.indexOf('job.phase = \'archiving\'') >= 0 && slimHostSrc.indexOf('job.phase = \'creating\'') >= 0 && slimHostSrc.indexOf('job.phase = \'seeding\'') >= 0 && slimHostSrc.lastIndexOf('ctx.agents.create(') < slimHostSrc.lastIndexOf('sessionController.rename({ sessionId: newId, title: row.title })') && slimHostSrc.lastIndexOf('sessionController.rename({ sessionId: newId, title: row.title })') < slimHostSrc.lastIndexOf('sessionController.rename({ sessionId: id, title: archiveTitle })') && slimHostSrc.lastIndexOf('sessionController.rename({ sessionId: id, title: archiveTitle })') < slimHostSrc.lastIndexOf('archiveSession(id, {})') && slimHostSrc.indexOf('selectModel({') >= 0 && slimHostSrc.indexOf('fallbackArgs') < 0)
    ok('0.4.85 P0 failures remain visible with phase/error code/new id/side-effect journal', slimHostSrc.indexOf("job.errorCode = error && error.code ? String(error.code) : 'SLIM_FAILED'") >= 0 && slimHostSrc.indexOf("job.newSessionState = 'unknown'") >= 0 && slimHostSrc.indexOf('job.sideEffects = sideEffects') >= 0 && slimHostSrc.indexOf('sideEffects: j.sideEffects || null') >= 0 && slimHostSrc.indexOf('sideEffects: currentJob.sideEffects || null') >= 0 && slimHostSrc.indexOf('failedSubIds') >= 0 && slimHostSrc.indexOf('unknownSubIds') >= 0)
     ok('0.4.86 ghost-session guard uses the sidebar-visible session corpus (SessionListValue.items), not the broad persisted corpus', slimHostSrc.indexOf('ctx.sessionController.list()') >= 0 && slimHostSrc.indexOf('visibleResult.items') >= 0 && slimHostSrc.indexOf('if (!s || !visibleById[s.id]) continue') >= 0 && slimHostSrc.indexOf('if (!visibleById[id]) continue') >= 0)
     ok('0.4.86 replacement safety: retain the create handle, require new-session visibility before old archive; 0.4.90 success path NO LONGER disposes (replacement stays a live idle session like a DSH fork), disposes only on failure paths', slimHostSrc.indexOf('newHandle = await ctx.agents.create(createArgs)') >= 0 && slimHostSrc.indexOf('newHandle.dispose()') >= 0 && slimHostSrc.indexOf('SLIM_NEW_NOT_VISIBLE') >= 0 && slimHostSrc.indexOf('sideEffects.newAgentStopped') >= 0 && slimHostSrc.indexOf('sideEffects.newVisible') >= 0 && slimHostSrc.indexOf("sideEffects.newAgentStopped = 'skipped'") >= 0 && slimHostSrc.indexOf("job.phase = 'stopping-new-agent'") < 0)
     ok('0.4.86 replacement inherits the original agent preset in durable session metadata', slimHostSrc.indexOf('liveAgentPreset = s.header') >= 0 && slimHostSrc.indexOf('agentPreset: coldHeader') >= 0 && slimHostSrc.indexOf('seedMeta.agentPreset') >= 0)
      ok('0.4.98 seed establishes a protected empty system head before the checkpoint, completes a turn, and lets Session append the sole inherited end-seed marker; this prevents restart-time system/message surface corruption', slimHostSrc.indexOf("import { BlockAssembler, createSystemMessage, createUserMessage }") >= 0 && slimHostSrc.indexOf("var seedSystemMessage = createSystemMessage('')") >= 0 && slimHostSrc.indexOf("type: 'turn/start', seq: 0") >= 0 && slimHostSrc.indexOf("type: 'step/start', seq: 1") >= 0 && slimHostSrc.indexOf("type: 'system/message', seq: 2") >= 0 && slimHostSrc.indexOf("message: seedSystemMessage") >= 0 && slimHostSrc.indexOf("type: 'user/message', seq: 3") >= 0 && slimHostSrc.indexOf("type: 'step/end', seq: 4") >= 0 && slimHostSrc.indexOf("type: 'turn/end', seq: 5") >= 0 && slimHostSrc.indexOf('inheritedEventCount: seedEvents.length') >= 0 && slimHostSrc.indexOf('isSeeded: true') >= 0 && slimHostSrc.indexOf('attachSession(newId)') >= 0 && slimHostSrc.indexOf("source: { kind: 'dsh-polish-session-slim' }") >= 0)
    ok('0.4.99 background handoff: the Host pauses before archiving and accepts a matching Client mainView acknowledgement, with timeout fallback', slimHostSrc.indexOf("job.phase = 'handoff'") >= 0 && slimHostSrc.indexOf('function waitForMainHandoff(job, newSessionId)') >= 0 && slimHostSrc.indexOf('function acknowledgeMainHandoff(body)') >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/handoff-state'") >= 0 && slimHostSrc.indexOf("path: '/api/dshp/session-slim/handoff'") >= 0 && slimHostSrc.indexOf('await waitForMainHandoff(job, newId)') >= 0 && slimHostSrc.indexOf('handoff: currentJob.handoff || null') >= 0)
     var seedBlockStart = slimHostSrc.indexOf('var seedEvents = [')
     var seedBlockEnd = slimHostSrc.indexOf('var seedMeta = {', seedBlockStart)
     var seedBlock = seedBlockStart >= 0 && seedBlockEnd > seedBlockStart ? slimHostSrc.slice(seedBlockStart, seedBlockEnd) : ''
      ok('0.4.98 seed block places protected system/message before checkpoint and omits a hand-written end-seed marker', seedBlock.indexOf("type: 'turn/start', seq: 0") >= 0 && seedBlock.indexOf("type: 'step/start', seq: 1") >= 0 && seedBlock.indexOf("type: 'system/message', seq: 2") >= 0 && seedBlock.indexOf("type: 'user/message', seq: 3") >= 0 && seedBlock.indexOf("type: 'step/end', seq: 4") >= 0 && seedBlock.indexOf("type: 'turn/end', seq: 5") >= 0 && seedBlock.indexOf("type: 'session/end-seed'") < 0)
     ok('new session returns to its workspace (create with workspaceId attaches)', slimHostSrc.indexOf('ctx.workspaceRegistry.resolveByPath(row.cwd)') >= 0 && slimHostSrc.indexOf('SLIM_WORKSPACE_LOOKUP_FAILED') >= 0 && slimHostSrc.indexOf('lineageComplete: !corpusLookupFailed && haveCorpus') >= 0 && slimHostSrc.indexOf('SLIM_LINEAGE_UNAVAILABLE') >= 0)
      ok('0.4.90 P0: replacement is TOP-LEVEL (seedMeta has NO parentSession) so it is not a child of the soon-archived old session and stays sidebar-visible', (function () {
        var ms = slimHostSrc.indexOf('var seedMeta = {')
        var me = ms >= 0 ? slimHostSrc.indexOf('}', ms) : -1
        var block = ms >= 0 && me > ms ? slimHostSrc.slice(ms, me + 1) : ''
        return block.indexOf('parentSession') < 0 && block.indexOf('isSeeded: true') >= 0
      }()) && slimHostSrc.indexOf("sideEffects.newAgentStopped = 'skipped'") >= 0)
      ok('0.4.90 P0: ensureNewVisible requires the replacement to be a LIVE agent (ctx.agents.get) AND in sessionController.list AND NOT blank (blank sessions are hidden by the sidebar) before the old session is archived', slimHostSrc.indexOf('ctx.agents.get(newId)') >= 0 && slimHostSrc.lastIndexOf('ensureNewVisible()') < slimHostSrc.lastIndexOf('archiveSession(id, {})') && slimHostSrc.indexOf('SLIM_NEW_NOT_VISIBLE') >= 0 && slimHostSrc.indexOf('foundBlank === true') >= 0)
    ok('0.4.85 slim host: enqueue also deduplicates the current in-flight session, not only queued items', slimHostSrc.indexOf('currentJob && currentJob.sessionId === id') >= 0)
     ok('the worker is serial with a batch rhythm and a stop gate', slimHostSrc.indexOf('workerBusy = true') >= 0 && slimHostSrc.indexOf('BATCH_GAP_MS = 3000') >= 0 && slimHostSrc.indexOf('function stopQueue()') >= 0 && slimHostSrc.indexOf('checkCancel(job)') >= 0)
    ok('summary guards: non-empty, not tiny, before anything is renamed or archived', slimHostSrc.indexOf('SLIM_SUMMARY_TINY') >= 0 && slimHostSrc.indexOf('slim.summary.length < 200') >= 0 && slimHostSrc.lastIndexOf('SLIM_SUMMARY_TINY') < slimHostSrc.lastIndexOf('job.phase = \'renaming\''))
    ok('the memory bar reports total/used/rss/pid of the host process', slimHostSrc.indexOf('os.totalmem()') >= 0 && slimHostSrc.indexOf('os.freemem()') >= 0 && slimHostSrc.indexOf('process.memoryUsage()') >= 0 && slimHostSrc.indexOf('pid: process.pid') >= 0)
    var slimPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    var slimPatch = fs.readFileSync(path.join(__dirname, '..', 'cordis.patch.yml'), 'utf8')
    var slimAtRow = slimPatch.lastIndexOf("id: 'dsh-polish:session-slim'")
    ok('the bundle patch ships the session-slim row, disabled by default', slimAtRow >= 0 && slimPatch.indexOf("name: 'dsh-polish/session-slim'", slimAtRow) !== -1 && slimPatch.slice(slimAtRow, slimAtRow + 400).indexOf('disabled: true') >= 0)
      slimPkg.version === '0.4.101' && slimPkg.exports['./session-slim'] && slimPkg.exports['./session-slim'].default === './session-slim/index.js' && slimPkg.files.indexOf('session-slim/') >= 0
    var slimNestPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'session-slim', 'package.json'), 'utf8'))
    ok('the nested component package declares no dsh.client (subpath isolation)', slimNestPkg.name === 'dsh-polish-session-slim' && slimNestPkg.dsh === undefined && !!slimNestPkg.exports && !!slimNestPkg.exports['.'])
  }

  section('session-slim: settings page (0.4.74 client)')
  {
    var slimClientRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'session-slim', 'session-slim.js'), 'utf8')
    var slimApply = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'runtime', 'apply.js'), 'utf8')
    var slimConsts = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'constants.js'), 'utf8')
    var slimBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-client.cjs'), 'utf8')
    ok('the page polls the host state route every 2.5s (fetch, same origin as /api/file)', slimClientRaw.indexOf("SLIM_STATE_PATH = '/api/dshp/session-slim/state'") >= 0 && slimClientRaw.indexOf('SLIM_POLL_MS = 2500') >= 0 && slimClientRaw.indexOf('setInterval(poll, SLIM_POLL_MS)') >= 0)
    ok('user spec columns: 项目/会话名称/事件数/大小/上下文/默认模型/状态/进行中/瘦身 (0.4.85: 大小 简化自 zstd 原始大小，全文进表头 tooltip；0.4.79: + 默认模型)', slimClientRaw.indexOf("'项目', '会话名称', '事件数', '大小', '子代理', '上下文', '默认模型', '状态', '进行中', '瘦身'") >= 0)
    ok('batch buttons: filtered list + all idle + stop; single-row 瘦身 button', slimClientRaw.indexOf('批量瘦身 · 筛选 ') >= 0 && slimClientRaw.indexOf('批量瘦身 · 全部 ') >= 0 && slimClientRaw.indexOf('停止队列') >= 0 && slimClientRaw.indexOf("var buttonLabel = isPending ? '提交中…' : inQueue ? '已入队' : isCurrent || row.running ? '处理中…' : '瘦身'") >= 0)
    ok('0.4.85 slim client: single and batch submissions lock immediately, show feedback, use queued count, refresh state, and release the lock on failure', slimClientRaw.indexOf('var [slimPendingIds, setSlimPendingIds] = React.useState({})') >= 0 && slimClientRaw.indexOf('var slimPendingRef = React.useRef({})') >= 0 && slimClientRaw.indexOf('按钮已锁定') >= 0 && slimClientRaw.indexOf('按钮已恢复，可重试') >= 0 && slimClientRaw.indexOf("typeof result.queued === 'number'") >= 0 && slimClientRaw.indexOf('return slimGetState().then(function (data)') >= 0)
     ok('the 3-colour memory bar: DSH rss / other used / free over system total', slimClientRaw.indexOf('#e5534b') >= 0 && slimClientRaw.indexOf('#e0a63f') >= 0 && slimClientRaw.indexOf('系统总内存 ') >= 0 && slimClientRaw.indexOf('DSH 进程 ') >= 0)
    ok('queue section shows in-progress phases and done results/errors', slimClientRaw.indexOf('处理队列') >= 0 && slimClientRaw.indexOf('slimPhaseLabel(job.phase)') >= 0 && slimClientRaw.indexOf('archiveTitle') >= 0)
     ok('0.4.86 slim client labels the new-agent stop and sidebar-visibility verification phases', slimClientRaw.indexOf("'stopping-new-agent': '停止新 agent 中'") >= 0 && slimClientRaw.indexOf("'verifying-new': '确认新会话可见中'") >= 0)
      ok('0.4.99 slim client keeps the operation in the background: a served watcher detects handoff, retains the replacement as mainView, and retries the acknowledgement', slimClientRaw.indexOf("var SLIM_HANDOFF_STATE_PATH = '/api/dshp/session-slim/handoff-state'") >= 0 && slimClientRaw.indexOf("var SLIM_HANDOFF_PATH = '/api/dshp/session-slim/handoff'") >= 0 && slimClientRaw.indexOf('function startSessionSlimBackground(child)') >= 0 && slimClientRaw.indexOf('child.uiWorkspace.openSession(job.newSessionId)') >= 0 && slimClientRaw.indexOf('child.sessions.list.getSnapshot()') >= 0 && slimClientRaw.indexOf("claimedKey = ''") >= 0 && slimApply.indexOf("ctx.inject(['sessions', 'uiWorkspace', 'configForms']") >= 0 && slimApply.indexOf('dsh-polish: session slim main handoff') >= 0)
      ok('0.4.101 refreshes the authoritative Client catalog after plugin startup without resuming agents or mutating storage', slimApply.indexOf("ctx.inject(['sessions', 'timer']") >= 0 && slimApply.indexOf('child.sessions.refresh()') >= 0 && slimApply.indexOf('child.timer.timeout(refreshCatalog, 1500)') >= 0 && slimApply.indexOf('dsh-polish: refresh session catalog after startup') >= 0)
    ok('settings card writes all five fields in one mutate (0.4.73: minFileBytes removed — event count is the only filter)', slimClientRaw.indexOf("path: ['minEvents']") >= 0 && slimClientRaw.indexOf('minFileBytes') < 0 && slimClientRaw.indexOf("path: ['compactProvider']") >= 0 && slimClientRaw.indexOf("path: ['compactEffort']") >= 0 && slimClientRaw.indexOf("path: ['batchSize']") >= 0 && slimClientRaw.indexOf('row.events >= minEvents') >= 0)
    var slimStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'client', 'shared', 'styles.js'), 'utf8')
slimClientRaw.indexOf('按事件数筛选') >= 0 && slimClientRaw.indexOf('子代理折叠进父会话') >= 0 && slimClientRaw.indexOf('留空 = 用各会话自己的模型') >= 0 && slimClientRaw.indexOf('「事件数 ≥」是唯一筛选口径') < 0
    ok('0.4.74 rows tag their subagent count and the done detail reports the cascade', slimClientRaw.indexOf("'子代理'") >= 0 && slimClientRaw.indexOf("typeof row.subCount === 'number' ? slimFmtInt(row.subCount) : '0'") >= 0 && slimClientRaw.indexOf('colSpan: 10') >= 0 && slimClientRaw.indexOf('连带归档子代理 ') >= 0 && slimClientRaw.indexOf('主会话 + 子代理合计') >= 0)
    ok('0.4.73 shared primitives exist: .dshp-flabel / .dshp-text-input / .dshp-btn-sm with focus styles', slimStyles.indexOf('.dshp-flabel') >= 0 && slimStyles.indexOf('.dshp-text-input') >= 0 && slimStyles.indexOf('.dshp-btn-sm') >= 0 && slimStyles.indexOf('.dshp-text-input:focus-visible') >= 0)
    ok('0.4.77 save: the slim settings page also stops pinning the render-time revision (same configForms contract as the prompts page)', slimClientRaw.indexOf('form.mutate(ops, form.state.revision)') < 0 && slimClientRaw.indexOf('Promise.resolve(form.mutate(ops)).then(') >= 0)
    // ---- 0.4.78: LLM stream timeout + visible in-flight job + watchdog + stable table ----
    var slimHostRaw = fs.readFileSync(path.join(__dirname, '..', 'session-slim', 'index.js'), 'utf8')
    ok('0.4.78 slim host: LLM stream gets an idle timeout (120s without data) + a per-call hard cap — the old for-await hung forever on a stalled provider and froze the whole queue', slimHostRaw.indexOf('LLM_IDLE_TIMEOUT_MS = 120000') >= 0 && slimHostRaw.indexOf('LLM_CALL_HARD_MS = 30 * 60000') >= 0 && slimHostRaw.indexOf('function withTimeout(promise, ms, message)') >= 0 && slimHostRaw.indexOf('step = await withTimeout(iter.next(), LLM_IDLE_TIMEOUT_MS,') >= 0 && slimHostRaw.indexOf("try { iter.return() } catch (abortErr) {}") >= 0 && slimHostRaw.indexOf('SLIM_LLM_TIMEOUT') >= 0)
    ok('0.4.78 slim host: the in-flight job is exposed in /state (it used to vanish between queue.shift() and completion — the user saw only 排队 with no 进行中)', slimHostRaw.indexOf('var currentJob = null') >= 0 && slimHostRaw.indexOf('currentJob = job // 0.4.78') >= 0 && slimHostRaw.indexOf('current: currentJob') >= 0)
    ok('0.4.78 slim host: watchdog force-settles a stuck job after its hard cap (0.4.79: raised 20min -> 4h — a 409-chunk session legitimately takes hours even in parallel; a single LLM call stays capped by LLM_CALL_HARD_MS); stale guard prevents double settlement and recovers a desynced busy flag; pump guards against sync exceptions', slimHostRaw.indexOf('SLIM_JOB_HARD_MS = 4 * 60 * 60000') >= 0 && slimHostRaw.indexOf('function watchdogTick()') >= 0 && slimHostRaw.indexOf("ctx.interval(watchdogTick, 5000)") >= 0 && slimHostRaw.indexOf('currentJob.stale = true') >= 0 && slimHostRaw.indexOf('if (job.stale) return') >= 0 && slimHostRaw.indexOf("'timer', // 0.4.78") >= 0)
    // ---- 0.4.79: 空文本重试 / 并行 map / 树形 reduce / 分片进度 / 模型校验 ----
    ok('0.4.79 slim host: an empty summary text retries once without reasoning effort (high/max effort can burn the whole maxTokens budget on reasoning and return empty content); a still-empty result carries usage stats so the user can see where the tokens went', slimHostRaw.indexOf('function targetWithoutEffort(target)') >= 0 && slimHostRaw.indexOf('retriedWithoutEffort: true') >= 0 && slimHostRaw.indexOf('usageText(retry.usage)') >= 0 && slimHostRaw.indexOf('usageText(result.usage)') >= 0)
    ok('0.4.79 slim host: the chunk map runs through a bounded parallel pool (SUMMARIZE_CONCURRENCY=4, deterministic output order) — the old sequential await loop took hours on a 409-chunk session', slimHostRaw.indexOf('SUMMARIZE_CONCURRENCY = 4') >= 0 && slimHostRaw.indexOf('function mapPool(items, limit, fn)') >= 0 && slimHostRaw.indexOf('mapPool(chunks, SUMMARIZE_CONCURRENCY,') >= 0)
    ok('0.4.79 slim host: the flat single-call reduce is a tree reduce (MERGE_GROUP_SIZE=4 per round until one remains) — 409 part texts can never fit one call context', slimHostRaw.indexOf('MERGE_GROUP_SIZE = 4') >= 0 && slimHostRaw.indexOf('function mergeCall(target, body, sessionId, round)') >= 0 && slimHostRaw.indexOf('while (level.length > 1)') >= 0)
    ok('0.4.79 slim host: per-chunk progress is exposed as currentJob.detail in /state (the in-flight row can show 分片 p/total instead of a featureless 模型总结中)', slimHostRaw.indexOf('detail: currentJob.detail') >= 0 && slimHostRaw.indexOf('progress("分片 " + done + "/" + chunks.length)') >= 0)
    ok('0.4.79 slim host: /validate-model route asks ctx.llm.resolveCallConfig (the same verdict slimOne applies) so an unregistered provider id gets a readable error instead of dying mid-queue', slimHostRaw.indexOf("path: '/api/dshp/session-slim/validate-model'") >= 0)
    // ---- 0.4.80: 当前上下文窗口单次压缩（用户拍板：= /compact 一次）----
    ok('0.4.80 slim host: the transcript step reads the CURRENT context window via sessionQuery.readSurface (live-preferred, cold replay, no agent) — the full durable log is neither read nor summarized', slimHostRaw.indexOf('ctx.sessionQuery.readSurface(id)') >= 0 && slimHostRaw.indexOf('surfaceFromEvents(') >= 0 && slimHostRaw.indexOf('SLIM_SURFACE_FAILED') >= 0)
    ok('0.4.80 slim host: window fits one call → single /compact-shaped compaction; window from resolveModelInfo.contextWindow with a conservative 32k fallback; output budget capped at DSH headroom 65536', slimHostRaw.indexOf('ctx.llm.resolveModelInfo(provider, model)') >= 0 && slimHostRaw.indexOf('surf.sourceTokens <= inputBudget') >= 0 && slimHostRaw.indexOf('COMPACTION_MAX_OUTPUT = 65536') >= 0 && slimHostRaw.indexOf('COMPACTION_OUTPUT_FLOOR = 8192') >= 0)
    ok('0.4.80 slim host: over-budget windows fall back to the 0.4.79 chunked map-reduce over the WINDOW (chunk budget clamped to the input budget), not the full log', slimHostRaw.indexOf('Math.min(CHUNK_BUDGET_TOKENS, inputBudget)') >= 0)
    ok('0.4.80 slim host: the injected checkpoint carries the native <compacted-summary> framing (indistinguishable from a built-in /compact artifact, so a later built-in compaction merges it as a PRIOR checkpoint)', slimHostRaw.indexOf("SUMMARY_OPEN_TAG = '<compacted-summary>'") >= 0 && slimHostRaw.indexOf("SUMMARY_CLOSE_TAG = '</compacted-summary>'") >= 0)
    // ---- 0.4.81: 空文本真因（finish 错误传播）+ 测试调用 + 表格自适应 ----
    ok('0.4.81 slim host: callSlimLlm checks the stream finish state (error/aborted/max-tokens) and throws the provider REAL error — before, provider-side failures were swallowed as 「empty text + all-zero usage」', slimHostRaw.indexOf('var finish = assembler.finish') >= 0 && slimHostRaw.indexOf('SLIM_LLM_FINISH_ERROR') >= 0 && slimHostRaw.indexOf('SLIM_LLM_MAX_TOKENS') >= 0)
    ok('0.4.81 slim host: /test-call route makes a real minimal LLM call through the same callSlimLlm (validate-model only proves the route is registered)', slimHostRaw.indexOf("path: '/api/dshp/session-slim/test-call'") >= 0 && slimHostRaw.indexOf("slim-test-call") >= 0)
    ok('0.4.81 slim host: job failures are logged to the host console ([dshp slim] prefix — DSH desktop has no runtime log files on disk)', slimHostRaw.indexOf("ctx.logger.warn('[dshp slim] '") >= 0)
    ok('0.4.81 slim client: the compact-model card has a 测试调用 button wired to /test-call with an inline result line', slimClientRaw.indexOf("SLIM_TESTCALL_PATH = '/api/dshp/session-slim/test-call'") >= 0 && slimClientRaw.indexOf('function runModelTest()') >= 0 && slimClientRaw.indexOf('测试调用') >= 0)
    ok('0.4.81 slim client: the table uses percentage columns (adaptive to the panel width; 0.4.78 fixed px widths overlapped on narrow panels) with a lower 640px floor', slimClientRaw.indexOf("minWidth: '640px'") >= 0 && slimClientRaw.indexOf("width: '16%'") >= 0 && slimClientRaw.indexOf("width: '14%'") >= 0)
    ok('0.4.85 slim client: overlap fix + row concision — context cell overflow ellipsis (0.4.81 nowrap cell had no clipping: long labels spilled into the next column) + short context label (1.8M/1M · 173%, full precision in tooltip) + project column = folder name (full path in tooltip) + subagent count moved to its own column + default-model column shows the model name only', slimClientRaw.indexOf('function slimFmtShortNum(n)') >= 0 && slimClientRaw.indexOf('function slimProjectName(row)') >= 0 && slimClientRaw.indexOf("whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }), title:") >= 0 && slimClientRaw.indexOf("'子代理'") >= 0 && slimClientRaw.indexOf("typeof row.subCount === 'number' ? slimFmtInt(row.subCount) : '0'") >= 0 && slimClientRaw.indexOf('colSpan: 10') >= 0)
    ok('0.4.85 slim client: context short units use one consistent decimal SI scale (M /1e6, k /1e3)', slimClientRaw.indexOf('(n / 1000000)') >= 0 && slimClientRaw.indexOf('(n / 1000)') >= 0)
     ok('0.4.85 slim client: done rows are concise (one line, full detail in tooltip); failure rows wrap the full error in red (the user explicitly asked for detailed failure reasons)', slimClientRaw.indexOf('var detailStyle = okJob') >= 0 && slimClientRaw.indexOf("wordBreak: 'break-word', overflowWrap: 'anywhere'") >= 0 && slimClientRaw.indexOf("'归档为 ' + (job.detail.archiveTitle") >= 0)
    ok('0.4.81 prompts client: the tool row shows the original description by default (3-line clamp) and the textarea has an explicit 留空=保持原描述 label — the data always arrived (客户端收到 line proved it), the row must not read as empty', promptsClientRaw.indexOf('WebkitLineClamp: 3') >= 0 && promptsClientRaw.indexOf('自定义提示词 · 留空保持原描述') >= 0)
    ok('0.4.85/0.4.90 prompts client: union-semantics header text + per-row 捕获于/session provenance (a union list can contain tools from other sessions - the source must be visible); preset selection is a segmented control (presetTabs)', promptsClientRaw.indexOf('各会话工具集并集，保留 15 分钟') >= 0 && promptsClientRaw.indexOf("'捕获于 ' + new Date(tool.lastSeen).toLocaleTimeString()") >= 0 && promptsClientRaw.indexOf('PROMPTS_PRESETS') >= 0 && promptsClientRaw.indexOf('presetTabs') >= 0)
     ok('0.4.86 prompts client does not fall back to standard preview for minimal and does not ship host/client debug rows', promptsClientRaw.indexOf("selectedPreset === 'standard' && value.preview") >= 0 && promptsClientRaw.indexOf('宿主自检') < 0 && promptsClientRaw.indexOf('客户端收到') < 0 && promptsClientRaw.indexOf('receivedInfo') < 0)
     ok('0.4.90 prompts host keys the preview bucket by the session header agentPreset (composedPreset kept only as fallback - it always returned undefined because context.scope is the agent, not a context) and restores the persisted tool union after reload', promptsHostRaw.indexOf('sessionHeader.agentPreset') >= 0 && promptsHostRaw.indexOf('composedPreset(context.scope)') >= 0 && promptsHostRaw.indexOf('function hydrateToolUnion(value)') >= 0 && promptsHostRaw.indexOf('hydrateToolUnion(findValue())') >= 0)
promptsClientRaw.indexOf("className: 'dshp-preview-meta'") >= 0 && promptsClientRaw.indexOf('不需要模型调用') < 0
      ok('0.4.97 slim host: the replacement carries the MODE composition (the preset mount) - without it the new session had none of the mode tools and the model answered 「我没有对应的工具」', slimHostSrc.indexOf("ctx.agentPresets.mount(agentCtx, resolvedPresetId)") >= 0 && slimHostSrc.indexOf('if (setup) createArgs.setup = setup') >= 0 && slimHostSrc.indexOf("'agentPresets', // 0.4.97") >= 0 && slimHostSrc.indexOf("ctx.tools.schemas(newAgent).length") >= 0 && slimHostSrc.indexOf('模式组合 ') >= 0)
      ok('0.4.91 slim host: the failing route (provider/model) is in the message, and a provider-side failure (balance/credential/rate limit) falls back to the session own last-used route', slimHostRaw.indexOf("'（' + route + '）'") >= 0 && slimHostRaw.indexOf('function isProviderRouteFailure(error)') >= 0 && slimHostRaw.indexOf('function fallbackRoute(lastUsed, failedTarget)') >= 0 && slimHostRaw.indexOf('slim = await runSummary(fallback)') >= 0 && slimHostRaw.indexOf('回退到会话自身模型') >= 0)
slimClientRaw.indexOf('瘦身使用：') >= 0
      ok('0.4.90 prompts model: four read-only per-mode built-ins, injective defaults, and legacy default normalization', promptsClientRaw.indexOf('var PROMPTS_BUILTINS = [') >= 0 && promptsClientRaw.indexOf("'builtin:standard'") >= 0 && promptsClientRaw.indexOf("'builtin:ptc'") >= 0 && promptsClientRaw.indexOf("'builtin:cordis'") >= 0 && promptsClientRaw.indexOf("'builtin:minimal'") >= 0 && promptsClientRaw.indexOf("activeRaw !== 'default' ? activeRaw : 'builtin:' + selectedPreset") >= 0 && promptsClientRaw.indexOf('不可编辑') >= 0 && promptsHostRaw.indexOf("return 'builtin:' + presetId") >= 0 && promptsHostRaw.indexOf("active.indexOf('builtin:') === 0") >= 0)
    ok('0.4.78 slim client: the in-flight job renders in the queue section (▶ + phase + elapsed), the stop button stays enabled while busy', slimClientRaw.indexOf('var currentJob = state && state.current ? state.current : null') >= 0 && slimClientRaw.indexOf("slimPhaseLabel(currentJob.phase)") >= 0 && slimClientRaw.indexOf("disabled: queue.length === 0 && !(state && state.busy)") >= 0)
    ok('0.4.78 slim client: the table uses a fixed layout with explicit column widths (auto layout made columns jump on every 2.5s poll = 「列表项到处乱飞」)', slimClientRaw.indexOf("tableLayout: 'fixed'") >= 0 && slimClientRaw.indexOf("minWidth: '640px'") >= 0 && slimClientRaw.indexOf("React.createElement('colgroup', null,") >= 0 && slimClientRaw.indexOf("maxWidth: '320px'") < 0)
    ok('0.4.79 slim client: the compact-model text inputs are dropdowns fed by remote.session.modelCatalog() — the same remote contract as the composer picker; only real registered provider/model ids are offerable (root-cause fix for 「no adapter registered for provider deepseek」)', slimClientRaw.indexOf('ctx.remote.session.modelCatalog()') >= 0 && slimClientRaw.indexOf("React.createElement('select', { style: selectStyle") >= 0 && slimClientRaw.indexOf('setCatalog') >= 0)
    ok('0.4.79 slim client: live model availability via /validate-model (debounced on draft change; the ✓/✗ line shows the same verdict slimOne will apply)', slimClientRaw.indexOf("SLIM_VALIDATE_PATH = '/api/dshp/session-slim/validate-model'") >= 0 && slimClientRaw.indexOf('setModelCheck') >= 0)
    ok('0.4.79 slim client: the 默认模型 column shows the model a direct compact would inherit (host row provider/model/effort = modelSelection.lastUsed)', slimClientRaw.indexOf('默认模型') >= 0 && slimClientRaw.indexOf("row.provider + '/' + (row.model || '?')") >= 0)
    ok('0.4.79 slim client: the in-flight row renders job.detail (分片 p/total progress from the host)', slimClientRaw.indexOf('currentJob.detail') >= 0)
    ok('0.4.73 action buttons on the shared pill primitives (primary batch, danger stop, small row button)', slimClientRaw.indexOf("className: 'dshp-btn dshp-btn-primary'") >= 0 && slimClientRaw.indexOf("className: 'dshp-btn-sm'") >= 0 && slimClientRaw.indexOf("className: 'dshp-btn', onClick: requestRefresh") >= 0)
    ok('wired as settings.section 会话瘦身 behind the row switch (whileServed)', slimConsts.indexOf("var NS_SESSION_SLIM = 'dsh-polish:session-slim'") >= 0 && slimApply.indexOf('whileServed([NS_SESSION_SLIM]') >= 0 && slimApply.indexOf("id: 'session-slim', order: 30") >= 0 && slimApply.indexOf("'会话瘦身'") >= 0 && slimApply.indexOf('makeSessionSlimSettingsPage(child)') >= 0 && slimApply.indexOf("ctx.inject(['remote', 'remote.session']") >= 0)
    ok('the build script concatenates the slim page into the client entry', slimBuild.indexOf('src/client/session-slim/session-slim.js') >= 0 && source.indexOf('makeSessionSlimSettingsPage') >= 0)

    // Behavioral: mount the real page with a fixture state and a fetch stub.
    registrations.length = 0
    var slimStateFixture = {
      rows: [
        { id: 's-big', project: 'projA', cwd: 'C:\\projA', title: '大会话', events: 9000, fileBytes: 812000, ctxTokens: 180000, ctxWindow: 262144, live: false, running: false, archived: false, subCount: 3, subIds: ['c1', 'c2', 'c3'] },
        { id: 's-idle', project: 'projA', cwd: 'C:\\projA', title: '待瘦身会话', events: 8000, fileBytes: 500000, ctxTokens: 200000, ctxWindow: 262144, live: true, running: false, archived: false },
         { id: 's-small', project: 'projA', cwd: 'C:\\projA', title: '小会话', events: 12, fileBytes: 40000, ctxTokens: 3000, ctxWindow: 262144, live: true, running: false, archived: false },
        { id: 's-cur', project: 'projB', cwd: 'C:\\projB', title: '当前瘦身会话', events: 7000, fileBytes: 400000, ctxTokens: 90000, ctxWindow: 262144, live: true, running: false, archived: false },
         { id: 's-run', project: 'projB', cwd: 'C:\\projB', title: '进行中会话', events: 500, fileBytes: 400000, ctxTokens: 90000, ctxWindow: 262144, live: true, running: true, archived: false },
        { id: 's-old', project: 'projB', cwd: 'C:\\projB', title: '归档的老会话', events: 700, fileBytes: 600000, ctxTokens: 120000, ctxWindow: 262144, live: false, running: false, archived: true },
      ],
      memory: { total: 32212254720, used: 20132659200, free: 12079595520, rss: 1800000000, heapUsed: 900000000, pid: 4242 },
      queue: [{ key: 's-big:x', sessionId: 's-big', title: '大会话', phase: 'summarizing', error: null, at: Date.now() - 1000, startedAt: Date.now() - 900, finishedAt: null }],
      current: { key: 's-cur:z', sessionId: 's-cur', title: '正在瘦身会话', phase: 'summarizing', error: null, detail: '分片 37/409', at: Date.now() - 5000, startedAt: Date.now() - 4000, finishedAt: null },
      done: [{ key: 's-old:y', sessionId: 's-old', title: '已归档会话', phase: 'done', detail: { newSessionId: 'aaaa1111', archiveTitle: '已归档会话@1', archivedSubagents: 2, summaryChars: 4200, modelInherited: true }, error: null, at: Date.now() - 60000, startedAt: Date.now() - 59000, finishedAt: Date.now() - 50000 }],
      busy: true,
      now: Date.now(),
    }
    var slimFetchCalls = []
    var realFetch = globalThis.fetch
    globalThis.fetch = function (url, opts) {
      slimFetchCalls.push({ url: String(url), opts: opts })
      if (String(url).indexOf('/api/dshp/session-slim/state') >= 0) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(slimStateFixture) } })
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ queued: 0 }) } })
    }
    try {
      var slimNs = ['dsh-polish:session-slim']
      var slimCtx = makeCtx({
        namespaces: slimNs,
        describeSnapshot: function () {
          return { namespaces: slimNs, view: { namespaces: [{ ns: 'dsh-polish:session-slim', revision: 1 }] } }
        },
        slimValues: { enabled: true, minEvents: 5000, compactProvider: '', compactModel: '', compactEffort: '', batchSize: 3 },
      })
      mod.apply(slimCtx)
      var slimEntry = registrations.find(function (r) {
        return r.options.name === 'settings.section' && r.options.id === 'session-slim'
      })
      ok('the 会话瘦身 settings section is registered while served', slimEntry !== undefined)
      var SlimPage = slimEntry && slimEntry.Component
      function slimTextOf(node) {
        if (node === null || node === undefined) return ''
        if (typeof node === 'string') return node
        if (Array.isArray(node)) return node.map(slimTextOf).join('')
        return slimTextOf(node.children)
      }
      var slimTree = render(SlimPage, {})
      await wait()
      slimTree = render(SlimPage, {})
      var slimText = slimTextOf(slimTree)
      ok('rows render with their metrics (9,000 events, 793.0 KB, context percent) and the subagent-count tag (0.4.74 folding)', slimText.indexOf('大会话') >= 0 && slimText.indexOf('9,000') >= 0 && slimText.indexOf('793.0 KB') >= 0 && slimText.indexOf('68.7%') >= 0 && slimText.indexOf('200k/262.1k') >= 0 && slimText.indexOf('子代理') >= 0 && slimText.indexOf('2000k') < 0, slimText.slice(0, 200))
      var bigSlimRow = null
       walk(slimTree, function (node) {
         if (bigSlimRow === null && node && node.type === 'tr' && slimTextOf(node).indexOf('大会话') >= 0) bigSlimRow = node
       })
       var bigSlimCells = bigSlimRow && Array.isArray(bigSlimRow.children) ? bigSlimRow.children.filter(function (child) { return child && child.type === 'td' }) : []
       ok('0.4.85: subagent count is an independent table cell, not part of the session name', bigSlimCells.length === 10 && slimTextOf(bigSlimCells[1]).indexOf('+3子代理') < 0 && slimTextOf(bigSlimCells[4]) === '3')
       ok('archived rows are hidden by default', slimText.indexOf('归档的老会话') < 0)
      ok('the running row is not slim-eligible (button label 进行中)', slimText.indexOf('进行中会话') >= 0)
      ok('the memory bar carries the fixture totals', slimText.indexOf('30.00 GB') >= 0 && slimText.indexOf('pid 4242') >= 0)
      ok('the queue shows the in-progress phase and the done result (0.4.85: one-line result 归档为 X · 新会话 id; full cascade incl. subagent count lives in the row tooltip)', slimText.indexOf('模型总结中') >= 0 && slimText.indexOf('新会话 aaaa1111') >= 0 && slimText.indexOf('归档为 已归档会话@1') >= 0)
      ok('0.4.78: the in-flight job renders in the queue section with its phase instead of vanishing from 排队', slimText.indexOf('正在瘦身会话') >= 0 && slimText.indexOf('模型总结中') >= 0)
      var currentSlimButton = null
       walk(slimTree, function (node) {
         if (currentSlimButton !== null || !node || node.type !== 'tr' || slimTextOf(node).indexOf('当前瘦身会话') < 0) return
         walk(node, function (child) {
           if (currentSlimButton === null && child && child.type === 'button' && slimTextOf(child) === '处理中…') currentSlimButton = child
         })
       })
       ok('0.4.85: a row matching state.current is visibly processing and disabled', currentSlimButton !== null && currentSlimButton.props.disabled === true)
       ok('0.4.79: the in-flight row shows the host job detail (分片 37/409 progress)', slimText.indexOf('分片 37/409') >= 0)
      // Batch math (0.4.73): eligible = events>=5000 (sole criterion) && !running && !archived(visible)
      // -> only s-big qualifies (s-run is running, s-small too small, s-old hidden+archived).
      var batchBtn = null
      walk(slimTree, function (node) {
        if (batchBtn === null && node && node.type === 'button' && slimTextOf(node).indexOf('批量瘦身 · 筛选') === 0) batchBtn = node
      })
      ok('the filtered batch button counts exactly the qualifying idle row', batchBtn !== null && batchBtn.children.join('').indexOf('1 个') >= 0, batchBtn ? batchBtn.children.join('') : 'not found')
      var idleBtn = null
      walk(slimTree, function (node) {
        if (idleBtn === null && node && node.type === 'button' && slimTextOf(node).indexOf('批量瘦身 · 全部') === 0) idleBtn = node
      })
      ok('the idle batch button covers every non-running, non-queued, non-current visible row (2 of 5)', idleBtn !== null && idleBtn.children.join('').indexOf('2 个') >= 0, idleBtn ? idleBtn.children.join('') : 'not found')
      if (batchBtn) {
        batchBtn.props.onClick()
        await wait()
        var slimPost = slimFetchCalls.filter(function (c) {
          return c.url.indexOf('/api/dshp/session-slim/slim') >= 0
        })
        ok('clicking the filtered batch POSTs exactly the qualifying id', slimPost.length >= 1 && JSON.parse(slimPost[slimPost.length - 1].opts.body).ids.join(',') === 's-idle')
         slimTree = render(SlimPage, {})
         var pendingSlimButton = null
         walk(slimTree, function (node) {
           if (pendingSlimButton === null && node && node.type === 'button' && slimTextOf(node) === '提交中…') pendingSlimButton = node
         })
         var postClickText = slimTextOf(slimTree)
         ok('0.4.85: after the POST starts, the button immediately shows 提交中 and is disabled', pendingSlimButton !== null && pendingSlimButton.props.disabled === true && postClickText.indexOf('没有新增任务') >= 0)
       }
    } finally {
      globalThis.fetch = realFetch
    }
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILED') + '  (' + checks + ' checks)')
  process.exit(failures === 0 ? 0 : 1)
})()
