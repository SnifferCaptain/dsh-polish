// Builds the top-level Host bundle entry consumed by the DSH loader.
// The file is intentionally empty at runtime; component Host halves are
// exported from their own subpaths. Keep the generated entry out of Git and
// regenerate it before packing a release.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const outputPath = path.join(root, 'lib', 'index.js')
const checkOnly = process.argv.includes('--check')
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check')
if (unknownArgs.length > 0) throw new Error('unknown argument: ' + unknownArgs.join(' '))

const expected = `export const name = 'dsh-polish'

// The bundle's OWN (top-level) host half is intentionally empty — it only
// exists because DSH bundle rows are loaded through the normal Cordis
// composition path. Most components (thinking-renderer, thinking-depth,
// composer-history, workspace-lru) are browser-only. Two carry their own
// NON-empty host halves: the timer component (\`dsh-polish/timer\`,
// timer/index.js) registers the timer tools per-agent; the mode-switch
// component (\`dsh-polish:mode-switch\`, mode-switch/index.js) switches a live
// session's agent preset (agentPresets.recompose) on a "..." menu request.
export function apply() {}
`

if (checkOnly) {
  if (!fs.existsSync(outputPath)) {
    console.error('lib/index.js is missing — run: node scripts/build-host-entry.cjs')
    process.exitCode = 1
  } else {
    const current = fs.readFileSync(outputPath, 'utf8')
    if (current !== expected) {
      console.error('lib/index.js is out of date — run: node scripts/build-host-entry.cjs')
      process.exitCode = 1
    } else {
      console.log('lib/index.js matches scripts/build-host-entry.cjs')
    }
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, expected)
  console.log('built lib/index.js')
}
