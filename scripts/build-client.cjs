// Builds the single browser entry consumed by DSH from maintainable sections.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const sources = [
  'src/client/loader.js',
  'src/client/shared/constants.js',
  'src/client/shared/styles.js',
  'src/client/shared/session-registry.js',
  'src/client/thinking-renderer/engine.js',
  'src/client/thinking-depth/shared.js',
  'src/client/thinking-depth/patcher.js',
  'src/client/keep-effort/effort-keeper.js',
  'src/client/composer-history/composer-history.js',
  'src/client/workspace-lru/workspace-lru.js',
  'src/client/visualize/visualize.js',
  'src/client/notify/notify.js',
  'src/client/settings/forms.js',
  'src/client/timer/timer-icon.js',
  'src/client/mode-switch/mode-switch.js',
  'src/client/prompts/prompts.js',
  'src/client/skill/skill-mention.js',
  'src/client/session-slim/session-slim.js',
  'src/client/runtime/apply.js',
]
const outputPath = path.join(root, 'lib', 'client.js')
const checkOnly = process.argv.includes('--check')
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check')
if (unknownArgs.length > 0) throw new Error('unknown argument: ' + unknownArgs.join(' '))

const built = Buffer.concat(sources.map((name) => fs.readFileSync(path.join(root, name))))
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

if (checkOnly) {
  const current = fs.readFileSync(outputPath)
  if (!current.equals(built)) {
    console.error('lib/client.js is out of date')
    console.error('  current: ' + digest(current))
    console.error('  source:  ' + digest(built))
    process.exitCode = 1
  } else {
    console.log('lib/client.js matches src/client (' + digest(built) + ')')
  }
} else {
  fs.writeFileSync(outputPath, built)
  console.log('built lib/client.js (' + digest(built) + ')')
}
