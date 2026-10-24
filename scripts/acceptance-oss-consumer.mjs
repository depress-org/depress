// PR-05 / #19. Real OSS pack/install/CLI/library acceptance, no publication/deploy.
// A nonzero verdict is intentional while #36 remains. --evidence-only changes
// process status for collection, NEVER the recorded releaseGate or findings.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, lstatSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
mkdirSync(join(root, '.tmp'), { recursive: true })
const work = mkdtempSync(join(root, '.tmp/oss-consumer-'))
const packs = join(work, 'packs'), consumer = join(work, 'consumer'), home = join(work, 'home')
for (const dir of [packs, consumer, home]) mkdirSync(dir)
const env = { PATH: process.env.PATH, HOME: home, TMPDIR: work, ASTRO_TELEMETRY_DISABLED: '1', NO_COLOR: '1', CI: '1' }
const findings = [], commands = [], inventory = []
function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  const log = join(work, label + '.log')
  writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''))
  commands.push({ label, command, args, exit: result.status, signal: result.signal, log })
  return result
}
for (const directory of ['core', 'wp-migrate', 'cli']) {
  const result = run('pack-' + directory, 'npm', ['pack', './packages/' + directory, '--json', '--pack-destination', packs])
  assert.equal(result.status, 0, 'Pack failed; see ' + work)
  const [pack] = JSON.parse(result.stdout)
  const archive = join(packs, pack.filename)
  const manifest = run('manifest-' + directory, 'tar', ['-xOf', archive, 'package/package.json'])
  assert.equal(manifest.status, 0)
  const pkg = JSON.parse(manifest.stdout)
  const themes = pack.files.filter(f => f.path.startsWith('bundled-themes/'))
  inventory.push({ name: pkg.name, filename: pack.filename, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), files: pack.files.length, bundledThemeFiles: themes.length, dependencies: pkg.dependencies ?? {} })
  if (directory === 'wp-migrate' && !themes.some(f => f.path.startsWith('bundled-themes/astrowind/'))) findings.push('Supported default AstroWind assets absent from engine tarball (#36)')
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith('@depress-org/') && range === '*') findings.push(`${pkg.name}: unconstrained public runtime dependency ${name} (#36)`)
    if (/^(?:workspace:|file:|link:)/.test(range)) findings.push(`${pkg.name}: non-registry runtime dependency ${name}`)
  }
}
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'pr05-oss-consumer', private: true, type: 'module', dependencies: Object.fromEntries(inventory.map(p => [p.name, 'file:' + join(packs, p.filename)])) }, null, 2))
assert.equal(run('install', 'npm', ['install', '--legacy-peer-deps'], consumer).status, 0, 'Consumer install failed')
assert.equal(lstatSync(join(consumer, 'node_modules/@depress-org/wp-migrate')).isSymbolicLink(), false)
const bin = join(consumer, 'node_modules/.bin/depress')
assert.equal(run('help', bin, ['--help'], consumer).status, 0)
const source = join(root, 'packages/cli/src/__fixtures__/offline-export.xml')
const defaultResult = run('default-migrate', bin, ['migrate', '--input', source, '--output', join(consumer, 'default-site')], consumer)
if (defaultResult.status !== 0) findings.push('Installed default CLI migration failed (#36/#26)')
const wpDir = join(work, 'wordpress'); mkdirSync(join(wpDir, 'wp-content/uploads/2026/10'), { recursive: true })
copyFileSync(join(root, 'fixtures/media-archive/photo.png'), join(wpDir, 'wp-content/uploads/2026/10/photo.png'))
writeFileSync(join(consumer, 'bad.xml'), '<rss><channel>broken')
writeFileSync(join(consumer, 'probe.mjs'), `
import assert from 'node:assert/strict';
import { runMigrate } from '@depress-org/depress/commands/migrate';
import { validateMigrationReport } from '@depress-org/wp-migrate';
import {readFile} from 'node:fs/promises';
await assert.rejects(runMigrate({input:'./bad.xml',output:'./invalid',theme:'scaffold'}));
const result=await runMigrate(${JSON.stringify({ input: join(root, 'fixtures/media-archive/export.xml'), db: join(root, 'fixtures/media-archive/database.sql'), wpDir, output: join(consumer, 'media-site'), theme: 'scaffold' })});
assert.equal((await validateMigrationReport(result.outputDir)).passed,true);
assert.deepEqual(await readFile(result.outputDir+'/public/media/photo.png'),await readFile(${JSON.stringify(join(root, 'fixtures/media-archive/photo.png'))}));
console.log('Installed library malformed-then-valid isolation, report and exact local media PASS');
`)
assert.equal(run('library-isolation-media', process.execPath, ['probe.mjs'], consumer).status, 0)
assert.equal(run('installed-media-check-build', bin, ['check', '--dir', join(consumer, 'media-site')], consumer).status, 0)
assert.equal(run('scaffold-migrate', bin, ['migrate', '--input', source, '--theme', 'scaffold', '--output', join(consumer, 'scaffold-site')], consumer).status, 0)
assert.equal(run('installed-scaffold-check-build', bin, ['check', '--dir', join(consumer, 'scaffold-site')], consumer).status, 0)
const lock = readFileSync(join(consumer, 'package-lock.json'))
assert.equal(run('same-lock-consumer-ci', 'npm', ['ci', '--legacy-peer-deps'], consumer).status, 0)
assert.deepEqual(readFileSync(join(consumer, 'package-lock.json')), lock)
assert.equal(run('reinstalled-cli', bin, ['--help'], consumer).status, 0)
const report = { schemaVersion: 1, node: process.version, work, releaseGate: findings.length ? 'NO-GO' : 'PASS_BOUNDED_OSS_ONLY', inventory, commands, findings, noPublicationOrDeployment: true }
writeFileSync(join(work, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (findings.length && !process.argv.includes('--evidence-only')) process.exitCode = 1
