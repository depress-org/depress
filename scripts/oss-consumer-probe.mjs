// Copied INTO the clean consumer by oss-consumer.mjs. Only public installed APIs.
import assert from 'node:assert/strict'
import { readFile, readdir, lstat, realpath } from 'node:fs/promises'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { syncBuiltinESMExports, createRequire } from 'node:module'

assert.equal(process.env.NODE_PATH, undefined, 'Global NODE_PATH must not supply consumer dependencies')
if (process.argv.includes('--assert-clean')) {
  const require = createRequire(import.meta.url)
  assert.throws(() => require.resolve('vitest'), { code: 'MODULE_NOT_FOUND' }, 'Root-only vitest leaked into the clean consumer')
  console.log(`PASS: preinstall vitest cannot resolve from ${dirname(fileURLToPath(import.meta.url))}`)
  process.exit(0)
}
const consumer = await realpath(dirname(fileURLToPath(import.meta.url)))
function contained(parent, target) {
  const path = relative(parent, target)
  assert(path && path !== '..' && !path.startsWith('../') && !isAbsolute(path), `Installed resolution escaped ${parent}: ${target}`)
}
for (const [name, specifier] of [
  ['@depress-org/core', '@depress-org/core'],
  ['@depress-org/wp-migrate', '@depress-org/wp-migrate'],
  ['@depress-org/depress', '@depress-org/depress'],
  ['@depress-org/depress', '@depress-org/depress/commands/migrate'],
]) {
  const expected = join(consumer, 'node_modules', name)
  assert.equal(await realpath(expected), expected, `Installed package must not link outside consumer: ${name}`)
  const resolved = await realpath(fileURLToPath(import.meta.resolve(specifier)))
  contained(expected, resolved)
  console.log(`Installed resolution: ${specifier} -> ${resolved}`)
}
contained(join(consumer, 'node_modules/@depress-org/depress'), await realpath(join(consumer, 'node_modules/.bin/depress')))
if (process.argv.includes('--assert-installed')) process.exit(0)
const { runMigrate } = await import('@depress-org/depress/commands/migrate')
const { validateMigrationReport, provisionTheme, getThemeAdapter } = await import('@depress-org/wp-migrate')

// Migration is offline; child npm install/build stages run in the parent script.
const deny = () => { throw new Error('Migration network disabled in consumer probe') }
http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny
syncBuiltinESMExports()
globalThis.fetch = deny

await assert.rejects(runMigrate({ input: 'bad.xml', output: 'bad-site', theme: 'scaffold' }))
await assert.rejects(lstat('bad-site'), { code: 'ENOENT' })
await assert.rejects(runMigrate({ input: 'offline.xml', output: 'rocket-site', theme: 'rocket' }), /MDX-only/)
await assert.rejects(lstat('rocket-site'), { code: 'ENOENT' })
// Both the engine and CLI/library fail closed, even though Rocket is initialized in source.
await assert.rejects(provisionTheme(getThemeAdapter('rocket'), 'rocket-engine-site'), /MDX-only/)
await assert.rejects(runMigrate({ input: 'offline.xml', output: 'remote-site', theme: 'brook' }), /Remote themes|MDX-only/)
await assert.rejects(lstat('remote-site'), { code: 'ENOENT' })

const mediaOptions = { input: 'media.xml', db: 'database.sql', wpDir: 'wordpress' }
await runMigrate({ ...mediaOptions, output: 'library-media', theme: 'scaffold' })
await runMigrate({ input: 'offline.xml', output: 'library-default' })
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result.sort()
}
async function parity(left, right, contentDir) {
  const paths = (await files(join(left, contentDir))).map(p => p.slice(left.length + 1))
  assert(paths.length > 0)
  assert.deepEqual(paths, (await files(join(right, contentDir))).map(p => p.slice(right.length + 1)))
  for (const path of [...paths, 'redirects.json', 'keystatic.config.ts']) {
    assert.deepEqual(await readFile(join(left, path)), await readFile(join(right, path)), `Installed CLI/library mismatch: ${path}`)
  }
}
await parity('library-media', 'cli-media', 'src/content')
await parity('library-default', 'default-site', 'src/data/post')
assert.equal((await validateMigrationReport('library-media')).passed, true)
const mediaReport = JSON.parse(await readFile('library-media/migration-report.json', 'utf8'))
assert.equal(mediaReport.qualityPassed, true)
assert(mediaReport.media.some(item => item.id === 202 && item.status === 'migrated'))
assert.deepEqual(await readFile('library-media/public/media/photo.png'), await readFile('photo.png'))
const content = await readFile('library-media/src/content/articles/archive-post/index.mdoc', 'utf8')
for (const alt of ['Inline context one', 'Inline context two', 'Attachment fallback']) assert(content.includes(alt))
assert(!content.includes('https://original-source.invalid/wp-content/uploads/'))
// Default feature/report completeness is a separate #26 boundary, never rewritten to green.
for (const site of ['default-site', 'library-default']) {
  const report = JSON.parse(await readFile(join(site, 'migration-report.json'), 'utf8'))
  console.log(JSON.stringify({ site, qualityPassed: report.qualityPassed, validation: await validateMigrationReport(site) }))
}
console.log('PASS: installed API malformed-then-valid isolation, default/scaffold CLI parity, media bytes/alts and MDX/remote fail-closed controls')
