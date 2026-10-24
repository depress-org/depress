import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { runMigrate } from '../packages/cli/dist/commands/migrate.js'
import { buildSite, defaultSpawn } from '../packages/cli/dist/services/deploy.js'

// Real registry install in a fresh consumer directory. Not a linked fixture,
// not a deploy adapter, and not a claim of an OS security sandbox.
const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, '.tmp'), { recursive: true })
const site = join(await mkdtemp(join(root, '.tmp/cold-consumer-')), 'site')
console.log(JSON.stringify({ node: process.version, site }))
const migration = await runMigrate({
  input: join(root, 'packages/cli/src/__fixtures__/offline-export.xml'),
  output: site,
  theme: 'scaffold',
})
// Converter retains one editable draft in source; public route checks below exclude it.
assert.equal(migration.posts, 3)
assert.equal(migration.pages, 1)
const tracedSpawn = async (cmd, args, opts) => {
  console.log(`Stage: ${args.join(' ')}`)
  const result = await defaultSpawn(cmd, args, opts)
  console.log(result.stdout)
  console.error(result.stderr)
  assert.equal(result.code, 0, `Stage failed: ${args.join(' ')}`)
  return result
}
await buildSite(site, tracedSpawn)
assert(!(await lstat(join(site, 'node_modules'))).isSymbolicLink())
for (const [route, title, marker] of [
  ['blog/first-post', 'First fixture post', 'First body marker alpha.'],
  ['blog/second-post', 'Second fixture post', 'Second body marker beta.'],
  ['about', 'About fixture page', 'Page body marker gamma.'],
]) {
  const html = await readFile(join(site, 'dist', route, 'index.html'), 'utf8')
  assert(html.includes(title), `${route}: missing title`)
  assert(html.includes(marker), `${route}: missing body`)
}
await assert.rejects(lstat(join(site, 'dist/blog/secret-draft/index.html')), { code: 'ENOENT' })
assert(!(await readFile(join(site, 'dist/blog/index.html'), 'utf8')).includes('Secret fixture draft'))
const lockPath = join(site, 'package-lock.json')
const lock = await readFile(lockPath)
// Reuse the real generated lock: ci reinstalls dependencies; do not resolve ranges twice.
await buildSite(site, tracedSpawn)
assert.deepEqual(await readFile(lockPath), lock, 'Rebuild modified generated lock')
console.log(JSON.stringify({ result: 'PASS', site, lockSha256: createHash('sha256').update(lock).digest('hex'), migration }))
