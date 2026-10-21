// Quick logic test for the skill-loader host row: discovery + frontmatter parse +
// conflict suffix + get(). Uses a mock ctx and a temp skills tree (no DSH host).
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../skill-loader/index.js'

const base = await mkdtemp(join(tmpdir(), 'dshp-skill-loader-test-'))
const dshSkills = join(base, 'dsh-skills')
const codexSkills = join(base, 'codex-skills')
await mkdir(join(dshSkills, 'unique-skill'), { recursive: true })
await mkdir(join(dshSkills, 'conflict-skill'), { recursive: true })
await mkdir(join(codexSkills, 'conflict-skill'), { recursive: true })
await writeFile(join(dshSkills, 'unique-skill', 'SKILL.md'), '---\nname: unique-skill\ndescription: A unique skill.\n---\n\n# Unique\nBody.\n')
await writeFile(join(dshSkills, 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict from dsh.\n---\n\n# Conflict (dsh)\nBody.\n')
await writeFile(join(codexSkills, 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict from codex.\n---\n\n# Conflict (codex)\nBody.\n')

let providerFactory = null
const ctx = {
  fiber: 'test-fiber',
  settings: { configure: () => {} },
  logger: { warn: () => {}, error: () => {} },
  skills: { registerProvider: (factory) => { providerFactory = factory } },
}

apply(ctx, {
  enabled: true,
  roots: [
    { path: dshSkills, source: 'dsh', rank: 400, skipSystem: true },
    { path: codexSkills, source: 'codex', rank: 400, skipSystem: true },
  ],
})

if (!providerFactory) throw new Error('provider factory not registered')
const provider = providerFactory({ signal: new AbortController().signal })
const list = await provider.list({})
const names = list.map((s) => s.name).sort()
console.log('LISTED:')
for (const s of list) console.log('  ' + s.name + '  (source=' + s.source + ', desc="' + s.description + '")')
console.log('NAMES:', JSON.stringify(names))

const expect = ['conflict-skill-codex', 'conflict-skill-dsh', 'unique-skill']
const ok = JSON.stringify(names) === JSON.stringify(expect)
console.log(ok ? 'PASS: conflict suffix + unique no-suffix' : 'FAIL: expected ' + JSON.stringify(expect))

// get() should read the body of the suffixed dsh conflict skill.
const conflictDsh = list.find((s) => s.name === 'conflict-skill-dsh')
const full = await provider.get(conflictDsh, { signal: new AbortController().signal })
console.log('GET conflict-dsh: name=' + full.name + ' desc="' + full.description + '" modelInvocable=' + full.invocation.modelInvocable + ' userInvocable=' + full.invocation.userInvocable + ' resourceBase=' + full.resourceBase.path)
const getOk = full.name === 'conflict-skill-dsh' && full.description === 'Conflict from dsh.' && full.resourceBase.path.endsWith('conflict-skill')

console.log(getOk ? 'PASS: get() reads body + resourceBase' : 'FAIL: get() mismatch')
process.exit(ok && getOk ? 0 : 1)
