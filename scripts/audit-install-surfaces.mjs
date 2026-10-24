// #26: independent installation graphs; root overrides do not ship with a CLI.
// Evidence collection only. Findings stay NO-GO; Release's risk/audit gates apply.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, '.tmp'), { recursive: true })
const work = await mkdtemp(join(root, '.tmp/install-audits26-'))
const home = join(work, 'home'), packs = join(work, 'packs')
await mkdir(home); await mkdir(packs)
const env = { PATH: process.env.PATH, HOME: home, TMPDIR: work, CI: '1', NO_COLOR: '1', ASTRO_TELEMETRY_DISABLED: '1' }
function run(cwd, args) {
  const r = spawnSync('npm', args, { cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  return r
}
const dependencies = {}
for (const directory of ['core', 'wp-migrate', 'cli']) {
  const p = run(root, ['pack', './packages/' + directory, '--ignore-scripts', '--json', '--pack-destination', packs])
  assert.equal(p.status, 0, p.stderr)
  const [manifest] = JSON.parse(p.stdout)
  dependencies[manifest.name] = 'file:' + join(packs, manifest.filename)
}
const results = []
for (const [name, manifest] of [
  ['installed-cli', { name: 'independent-cli-audit26', private: true, dependencies }],
  ['standalone-example', JSON.parse(await readFile(join(root, 'examples/mamas-blog/package.json'), 'utf8'))],
]) {
  const cwd = join(work, name); await mkdir(cwd)
  await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest, null, 2))
  const install = run(cwd, ['install', '--ignore-scripts', '--legacy-peer-deps'])
  await writeFile(join(cwd, 'install.log'), install.stdout + install.stderr)
  assert.equal(install.status, 0, install.stderr)
  for (const omit of [false, true]) {
    const args = ['audit', ...(omit ? ['--omit=dev'] : []), '--json']
    const r = run(cwd, args)
    const audit = JSON.parse(r.stdout)
    assert(audit.metadata?.vulnerabilities, 'Registry audit failed instead of returning an inventory')
    assert.equal(r.status, audit.metadata.vulnerabilities.total === 0 ? 0 : 1)
    await writeFile(join(cwd, omit ? 'production-audit.json' : 'full-audit.json'), r.stdout)
    results.push({ surface: name, command: args, exit: r.status, vulnerabilities: audit.metadata.vulnerabilities, packages: Object.keys(audit.vulnerabilities) })
  }
}
const report = { node: process.version, work, results, release: results.some(r => r.exit) ? 'NO-GO' : 'audit-clean-not-release-authorization' }
await writeFile(join(work, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (report.release === 'NO-GO' && !process.argv.includes('--evidence-only')) process.exitCode = 1
