'use strict'

const fs = require('node:fs')
const path = require('node:path')

const sourcePath = path.join(__dirname, '..', 'skill-loader', 'index.js')
let source = fs.readFileSync(sourcePath, 'utf8')
source = source
  .replace(/^import .*\r?\n/gm, '')
  .replace('export const Config', 'const Config')
  .replace('export const inject', 'const inject')
  .replace('export function apply', 'function apply')

function chain() {
  const value = {}
  for (const method of ['default', 'volatile', 'optional', 'is', 'required']) value[method] = () => value
  return value
}
const z = { object: () => chain(), array: () => chain(), string: () => chain(), number: () => chain(), boolean: () => chain() }
const moduleObject = { exports: {} }
new Function('z', 'module', 'exports', source + '\nmodule.exports = { Config, inject, apply }')(z, moduleObject, moduleObject.exports)
const { apply, inject } = moduleObject.exports

let checks = 0
let failures = 0
function ok(label, condition, detail) {
  checks += 1
  if (condition) console.log('PASS', label)
  else {
    failures += 1
    console.log('FAIL', label, detail || '')
  }
}

// A deterministic in-memory implementation of DSH's abstract fs service. The
// production provider must never import node:fs or bypass this execution world.
const dirs = new Map()
const files = new Map()
function target(displayPath) {
  return { displayPath, targetKey: displayPath }
}
function addDir(displayPath, entries) {
  dirs.set(displayPath, entries)
}
function addSkill(root, name, body, description) {
  const dir = path.join(root, name)
  const file = path.join(dir, 'SKILL.md')
  addDir(dir, [{ name: 'SKILL.md', type: 'file', target: target(file) }])
  files.set(file, `---\nname: ${name}\ndescription: ${description}\nuser-invocable: true\n---\n\n${body}\n`)
  return dir
}
const claude = 'C:/virtual/claude'
const opencode = 'C:/virtual/opencode'
addDir(claude, [
  { name: 'hello-skill', type: 'directory', target: target(path.join(claude, 'hello-skill')) },
  { name: 'same-skill', type: 'directory', target: target(path.join(claude, 'same-skill')) },
])
addDir(opencode, [{ name: 'same-skill', type: 'directory', target: target(path.join(opencode, 'same-skill')) }])
addSkill(claude, 'hello-skill', 'Hello body', 'Hello description')
addSkill(claude, 'same-skill', 'Claude body', 'Duplicate')
addSkill(opencode, 'same-skill', 'OpenCode body', 'Duplicate')
const abstractFs = {
  resolve(displayPath) {
    if (!dirs.has(displayPath)) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' })
    return Promise.resolve(target(displayPath))
  },
  listDir(rootTarget) {
    return Promise.resolve((dirs.get(rootTarget.displayPath) || []).slice())
  },
  readText(fileTarget) {
    if (!files.has(fileTarget.displayPath)) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' })
    return Promise.resolve(files.get(fileTarget.displayPath))
  },
}

let provider
let providerDisposer
const settingsUpdates = []
const warnings = []
const ctx = {
  fiber: {},
  fs: abstractFs,
  logger: { warn: (message) => warnings.push(message) },
  settings: {
    configure: () => () => {},
    describe: () => [{ ns: 'dsh-polish:skill-loader', value: { catalog: [] } }],
    update: async (ns, patch) => { settingsUpdates.push({ ns, patch }) },
  },
  interval: () => () => {},
  effect(fn) {
    providerDisposer = fn()
    return providerDisposer
  },
  skills: {
    registerProvider(create) {
      provider = create({ signal: { throwIfAborted() {} }, invalidate() {} })
      return () => { provider = undefined }
    },
    async list(options) { return provider.list(options || {}) },
    async get(name, options) {
      const candidates = await provider.list(options || {})
      const candidate = candidates.find((item) => item.name === name)
      return candidate ? provider.get(candidate, options || {}) : undefined
    },
  },
}
apply(ctx, {
  enabled: true,
  roots: [
    { path: claude, source: 'claude', rank: 400, skipSystem: true },
    { path: opencode, source: 'opencode', rank: 400, skipSystem: true },
  ],
  suffixOnlyConflicts: true,
})
ok('skill loader injects the abstract fs service', Array.isArray(inject) && inject.join(',') === 'skills,fs,settings,timer')
ok('provider registers synchronously', provider !== undefined && typeof providerDisposer === 'function')

;(async () => {
  const list = await provider.list({})
  ok('list discovers user skills', list.some((item) => item.name === 'hello-skill'))
  ok('conflicts receive stable source suffixes', list.some((item) => item.name === 'same-skill-claude') && list.some((item) => item.name === 'same-skill-opencode'))
  ok('list candidates do not leak the markdown body', list.every((item) => item.content === undefined))
  const hello = list.find((item) => item.name === 'hello-skill')
  const loaded = await provider.get(hello, {})
  ok('get returns trimmed markdown content', loaded && loaded.content === 'Hello body')
  ok('get returns directory resource base', loaded && loaded.resourceBase && loaded.resourceBase.path.endsWith(path.join('claude', 'hello-skill')))

  const helloPath = path.join(claude, 'hello-skill', 'SKILL.md')
  files.set(helloPath, '---\nname: renamed-skill\ndescription: Renamed\n---\nChanged\n')
  ok('list/get identity changes are rejected', (await provider.get(hello, {})) === undefined)
  let aborted = false
  try {
    await provider.list({ signal: { throwIfAborted() { throw new Error('aborted') } } })
  } catch (error) {
    aborted = error && error.message === 'aborted'
  }
  ok('discovery honors AbortSignal', aborted)
  ok('skill loader injects settings and timer for picker catalog', Array.isArray(inject) && inject.join(',') === 'skills,fs,settings,timer')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const catalogUpdate = settingsUpdates.find((item) => item.ns === 'dsh-polish:skill-loader' && Array.isArray(item.patch.catalog))
  ok('Host publishes summaries for the Client picker', !!catalogUpdate && catalogUpdate.patch.catalog.some((item) => item.name === 'same-skill-claude' && item.path.includes(path.join('same-skill', 'SKILL.md'))))
  // 0.4.42: the Host no longer rewrites sent messages — the Client expands
  // a selected token into [name](path) at selection time, so there is no
  // marker to resolve and no agent/pre-step hook left to remove.
  ok('0.4.42: no send-time rewriting remains in the shipped host', source.indexOf('expandSelectedSkillText') < 0 && source.indexOf('agent/pre-step') < 0 && source.indexOf('SELECTED_SKILL_MARKER') < 0)
  console.log(failures > 0 ? `FAILED: ${failures} of ${checks} checks` : `ALL PASS (${checks} checks)`)
  if (failures > 0) process.exitCode = 1
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
