import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { migrateSite } from '../packages/cli/dist/services/migrate.js'
import { buildSite, defaultSpawn } from '../packages/cli/dist/services/deploy.js'
import { validateMigrationReport } from '../packages/wp-migrate/dist/index.js'
import { verifyKeystaticConsumer } from './keystatic-consumer.mjs'
import { verifyLocalRuntime } from './local-runtime.mjs'

// Complete DEFAULT theme, no symlinked node_modules, config rewrite or removed demos.
const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, '.tmp'), { recursive: true })
const work = await mkdtemp(join(root, '.tmp/default-consumer26-'))
const site = join(work, 'site'), wpDir = join(work, 'wordpress'), input = join(work, 'export.xml')
await mkdir(wpDir)
const media = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVxoAAAAASUVORK5CYII=', 'base64')
await writeFile(join(wpDir, 'photo.png'), media)
const xml = (await readFile(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8'))
  .replace('<p>First body marker alpha.</p>', '<p>First body marker alpha.</p><img src="https://fixture.invalid/photo.png" alt="Theme media context">')
  .replace('</channel>', '<item><title>Photo</title><wp:post_id>105</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>photo</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://fixture.invalid/photo.png</wp:attachment_url><wp:post_mime_type>image/png</wp:post_mime_type></item></channel>')
await writeFile(input, xml)
const result = await migrateSite({ input, output: site, wpDir })
assert.equal(result.posts, 2)
// AstroWind has no imported pagesDir and its Markdown report grammar is not yet
// proven. Preserve the existing fail-closed quality gate; a build is NOT a GO.
assert.equal(result.qualityPassed, false)
assert.equal((await validateMigrationReport(site)).passed, false)
const report = JSON.parse(await readFile(result.reportPath, 'utf8'))
assert.notEqual(report.items.find(i => i.id === 103).status, 'migrated', 'Unsupported imported page was falsely accepted')
const traced = async (cmd, args, opts) => {
  console.log(`Stage: ${args.join(' ')}`)
  const r = await defaultSpawn(cmd, args, opts)
  console.log(r.stdout); console.error(r.stderr)
  assert.equal(r.code, 0, `Cold default stage failed: ${args.join(' ')}`)
  return r
}
await buildSite(site, traced)
assert(!(await lstat(join(site, 'node_modules'))).isSymbolicLink())
for (const [path, marker] of [['first-post', 'First body marker alpha.'], ['second-post', 'Second body marker beta.']]) {
  assert((await readFile(join(site, 'dist/client', path, 'index.html'), 'utf8')).includes(marker))
}
const first = await readFile(join(site, 'dist/client/first-post/index.html'), 'utf8')
assert(first.includes('alt="Theme media context"'), 'Theme lost image alt')
assert.deepEqual(await readFile(join(site, 'dist/client/media/photo.png')), media)
assert((await readFile(join(site, 'dist/client/homes/personal/index.html'), 'utf8')).includes('plus.unsplash.com'), 'Historical failing demo was removed')
for (const name of ['source-manifest.json', 'migration-report.json', 'migration-report.md']) await assert.rejects(lstat(join(site, 'dist/client', name)), { code: 'ENOENT' })
await verifyKeystaticConsumer(site, 'astrowind')
await verifyLocalRuntime(site, 'node', '/first-post/')
for (const args of [['audit', '--omit=dev', '--json'], ['audit', '--json']]) {
  const audit = JSON.parse(execFileSync('npm', args, { cwd: site, encoding: 'utf8' }))
  assert.equal(audit.metadata.vulnerabilities.total, 0)
  console.log(JSON.stringify({ theme: 'astrowind', audit: args, vulnerabilities: audit.metadata.vulnerabilities }))
}
const lock = await readFile(join(site, 'package-lock.json'))
await buildSite(site, traced)
assert.deepEqual(await readFile(join(site, 'package-lock.json')), lock)
console.log(JSON.stringify({ defaultConsumer: 'PASS build/media/CMS/runtime/audits/rebuild', site, node: process.version, lockSha256: createHash('sha256').update(lock).digest('hex'), qualityPassed: false, release: 'NO-GO', findings: report.items.map(i => ({ id: i.id, status: i.status, findings: i.findings })) }))
