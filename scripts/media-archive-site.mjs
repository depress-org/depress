// PR-08 / #22: real BUILT web + grammy -> scoped runJob -> native migration.
// No live Telegram, origin server, credentials or deployment. Web artifact gets
// a fresh registry consumer install + unchanged-lock rebuild; bot uses root lock.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { buildSite, defaultSpawn } from '../packages/cli/dist/services/deploy.js'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import { createApp } from '../packages/web/dist/app.js'
import { createBot } from '../packages/telegram-bot/dist/bot.js'
import { SessionStore } from '../packages/telegram-bot/dist/session.js'
import { InMemoryJobStore } from '../packages/job-core/dist/index.js'
import { validateMigrationReport } from '../packages/wp-migrate/dist/index.js'
const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, '.tmp'), { recursive: true })
const work = await mkdtemp(join(root, '.tmp/media-e2e-'))
const fixture = async file => readFile(join(root, 'fixtures/media-archive', file))
const wxr = await fixture('export.xml'), sql = await fixture('database.sql'), zip = await fixture('uploads.zip'), photo = await fixture('photo.png')
const outputs = []
const originalFetch = globalThis.fetch
const originals = [http.request, http.get, https.request, https.get, net.connect, net.createConnection, net.Server.prototype.listen]
const noNetwork = () => { throw new Error('NETWORK_DISABLED: archive fixture must stay offline') }
http.request = http.get = https.request = https.get = net.connect = net.createConnection = net.Server.prototype.listen = noNetwork
syncBuiltinESMExports()
globalThis.fetch = noNetwork
const wait = async test => { for (let n = 0; n < 1000; n++) { const value = await test(); if (value) return value; await new Promise(r => setTimeout(r, 20)) } throw new Error('Timed out waiting for real adapter job') }
async function terminal(store, owner) {
  return wait(async () => { const [j] = await store.forOwner(owner).list(); return j && ['done', 'failed'].includes(j.status) ? j : undefined })
}
async function verifyAndBuild(job, label) {
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.deployUrl, undefined)
  const site = job.repoPath; outputs.push(site)
  const machine = JSON.parse(await readFile(join(site, 'migration-report.json'), 'utf8'))
  const human = await readFile(join(site, 'migration-report.md'), 'utf8')
  assert.equal(machine.schemaVersion, 1)
  assert.equal(machine.qualityPassed, true)
  assert(machine.media.some(i => i.id === 202 && i.status === 'migrated'))
  assert(human.includes('202'))
  assert.equal((await validateMigrationReport(site)).passed, true)
  const content = await readFile(join(site, 'src/content/articles/archive-post/index.mdoc'), 'utf8')
  for (const alt of ['Inline context one', 'Inline context two', 'Attachment fallback']) assert(content.includes(alt), `missing per-occurrence alt ${alt}`)
  assert(!content.includes('https://original-source.invalid/wp-content/uploads/'), 'original media URL survived')
  if (label === 'web') {
    // A real fresh generated consumer: registry install (not linked node_modules),
    // build, same-lock npm ci and rebuild of the archive-backed web artifact.
    const tracedSpawn = async (cmd, args, options) => {
      assert.equal(options.env.PR08_SYNTHETIC_SECRET, undefined)
      const result = await defaultSpawn(cmd, args, options)
      console.log(`PR-08 archive cold consumer: ${args.join(' ')}`)
      console.log(result.stdout); console.error(result.stderr)
      assert.equal(result.code, 0)
      return result
    }
    await buildSite(site, tracedSpawn)
    assert(!(await lstat(join(site, 'node_modules'))).isSymbolicLink())
    const lock = await readFile(join(site, 'package-lock.json'))
    await buildSite(site, tracedSpawn)
    assert.deepEqual(await readFile(join(site, 'package-lock.json')), lock)
    console.log(`PR-08 archive cold consumer unchanged-lock rebuild PASS ${createHash('sha256').update(lock).digest('hex')}`)
  } else {
    await symlink(join(root, 'node_modules'), join(site, 'node_modules'), 'dir')
    const home = join(work, label + '-home'); await mkdir(home)
    // Allowlist: do not inherit worker/provider/Telegram environment into Astro.
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: work, NODE_ENV: 'production', ASTRO_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }
    assert.equal(env.PR08_SYNTHETIC_SECRET, undefined)
    execFileSync(process.execPath, ['-e', "if(process.env.PR08_SYNTHETIC_SECRET)process.exit(1)"], { cwd: site, env })
    execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: site, env, stdio: 'inherit', timeout: 120_000 })
  }
  // Adapter/migration IO is disabled in this process. Child install/build is NOT
  // an OS network sandbox; registry access for fresh dependency installation is expected.
  const html = await readFile(join(site, 'dist/blog/archive-post/index.html'), 'utf8')
  assert(html.includes('Archive body marker.'))
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
  for (const alt of ['Inline context one', 'Inline context two', 'Attachment fallback']) assert(images.some(image => image.includes(`alt="${alt}"`) && image.includes('/media/photo.png')), `rendered occurrence lost ${alt}`)
  assert.deepEqual(await readFile(join(site, 'dist/media/photo.png')), photo)
  assert(!html.includes(process.env.PR08_SYNTHETIC_SECRET))
  for (const name of ['source-manifest.json', 'migration-report.json', 'migration-report.md']) {
    await assert.rejects(readFile(join(site, 'dist', name)))
    assert(!(await readFile(join(site, name), 'utf8')).includes(process.env.PR08_SYNTHETIC_SECRET))
  }
  console.log(`PR-08 ${label}: real owner-scoped migration, machine/human report, three rendered alt occurrences, exact built media bytes, private reports PASS`)
}
process.env.PR08_SYNTHETIC_SECRET = 'archive-env-must-not-leak'
try {
  const store = new InMemoryJobStore(), uploads = join(work, 'web')
  const app = createApp({ store, uploadRoot: uploads, identities: [{ ownerId: 'archive-web', token: 'a'.repeat(32) }] })
  const form = new FormData()
  form.set('wxr', new File([wxr], 'export.xml')); form.set('sql', new File([sql], 'database.sql')); form.set('media', new File([zip], 'uploads.zip')); form.set('theme', 'scaffold')
  const response = await app.request('/api/jobs', { method: 'POST', body: form, headers: { Authorization: `Bearer ${'a'.repeat(32)}` } })
  assert.equal(response.status, 202, await response.clone().text())
  const webJob = await terminal(store, 'archive-web')
  await wait(async () => (await readdir(uploads)).length === 0)
  await verifyAndBuild(webJob, 'web')
  // Explicit omission/skip must fail quality when source references are unavailable.
  const missingStore = new InMemoryJobStore(), missing = createApp({ store: missingStore, uploadRoot: join(work, 'missing'), identities: [{ ownerId: 'missing', token: 'b'.repeat(32) }] })
  const noMedia = new FormData(); noMedia.set('wxr', new File([wxr], 'export.xml')); noMedia.set('theme', 'scaffold')
  assert.equal((await missing.request('/api/jobs', { method: 'POST', body: noMedia, headers: { Authorization: `Bearer ${'b'.repeat(32)}` } })).status, 202)
  const missingJob = await terminal(missingStore, 'missing'); outputs.push(missingJob.outputDir)
  assert.equal(missingJob.status, 'failed')
  const missingReport = JSON.parse(await readFile(join(missingJob.outputDir, 'migration-report.json'), 'utf8'))
  assert.equal(missingReport.qualityPassed, false)
  assert(missingReport.media.find(i => i.id === 202).findings.some(f => f.code === 'missing-media'))
  assert.equal((await validateMigrationReport(missingJob.outputDir)).passed, false)
  console.log('PR-08 skipped archive: missing source media explicitly fails item/report/job; no unsupported success PASS')
  // ZIP admission allows PDF files, but native raster conversion does not.
  // Validate truthful failure at the real adapter/pipeline/report boundary.
  const unsupportedStore = new InMemoryJobStore(), unsupportedUploads = join(work, 'unsupported')
  const unsupportedApp = createApp({ store: unsupportedStore, uploadRoot: unsupportedUploads, identities: [{ ownerId: 'unsupported', token: 'c'.repeat(32) }] })
  const unsupportedForm = new FormData()
  unsupportedForm.set('wxr', new File([wxr.toString().replaceAll('photo.png', 'photo.pdf').replaceAll('image/png', 'application/pdf')], 'export.xml'))
  unsupportedForm.set('media', new File([await fixture('unsupported.zip')], 'uploads.zip'))
  unsupportedForm.set('theme', 'scaffold')
  assert.equal((await unsupportedApp.request('/api/jobs', { method: 'POST', body: unsupportedForm, headers: { Authorization: `Bearer ${'c'.repeat(32)}` } })).status, 202)
  const unsupportedJob = await terminal(unsupportedStore, 'unsupported'); outputs.push(unsupportedJob.outputDir)
  assert.equal(unsupportedJob.status, 'failed')
  await wait(async () => (await readdir(unsupportedUploads)).length === 0)
  const unsupportedReport = JSON.parse(await readFile(join(unsupportedJob.outputDir, 'migration-report.json'), 'utf8'))
  assert.equal(unsupportedReport.qualityPassed, false)
  const unsupportedItem = unsupportedReport.media.find(i => i.id === 202)
  assert.notEqual(unsupportedItem.status, 'migrated')
  assert(unsupportedItem.findings.length > 0)
  assert.equal((await validateMigrationReport(unsupportedJob.outputDir)).passed, false)
  assert((await readFile(join(unsupportedJob.outputDir, 'migration-report.md'), 'utf8')).includes('202'))
  console.log('PR-08 admitted ZIP with unsupported referenced PDF: item/report/job non-green, owned cleanup PASS')
  // Actual grammy adapter with offline transport, NOT a mocked runJob.
  const sessions = new SessionStore(), botStore = new InMemoryJobStore(), botUploads = join(work, 'bot')
  const bot = createBot('123456:synthetic-offline-token', { sessions, store: botStore, allowedUserIds: [42], workspaceRoot: botUploads })
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Fixture', username: 'fixture_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false }
  const messages = []; let body = wxr, serial = 0
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'getFile') return { ok: true, result: { file_id: 'fixture', file_path: 'documents/fixture.bin', file_size: body.length } }
    if (method === 'sendMessage') messages.push(payload)
    return { ok: true, result: method === 'answerCallbackQuery' ? true : { message_id: ++serial, date: 0, chat: { id: 42, type: 'private' }, text: '' } }
  })
  globalThis.fetch = async url => { assert.equal(String(url), 'https://api.telegram.org/file/bot123456:synthetic-offline-token/documents/fixture.bin'); return new Response(body) }
  async function document(name, bytes) {
    body = bytes; await bot.handleUpdate({ update_id: ++serial, message: { message_id: serial, date: 0, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'Fixture' }, document: { file_id: 'fixture', file_unique_id: 'fixture', file_name: name, file_size: bytes.length } } })
  }
  await document('export.xml', wxr); assert.equal(sessions.get('42:42').stage, 'awaiting_sql')
  await document('database.sql', sql); assert.equal(sessions.get('42:42').stage, 'awaiting_media')
  await document('uploads.zip', zip); assert.equal(sessions.get('42:42').stage, 'awaiting_theme')
  globalThis.fetch = noNetwork
  const data = messages.at(-1).reply_markup.inline_keyboard.flat().find(button => button.text === 'scaffold').callback_data
  await bot.handleUpdate({ update_id: ++serial, callback_query: { id: 'fixture', chat_instance: 'fixture', data, from: { id: 42, is_bot: false, first_name: 'Fixture' }, message: { message_id: serial, date: 0, chat: { id: 42, type: 'private' }, from: { id: 123456, is_bot: true, first_name: 'Fixture' } } } })
  const botJob = await terminal(botStore, 'telegram:42')
  await wait(async () => sessions.get('42:42').stage === 'idle' && (await readdir(botUploads)).length === 0)
  await verifyAndBuild(botJob, 'bot')
  assert(messages.some(m => m.text.includes('Not deployed; no live URL')))
  assert(!messages.some(m => m.text.includes('Live URL:')))
  assert.notEqual(webJob.ownerId, botJob.ownerId)
} finally {
  globalThis.fetch = originalFetch
  ;[http.request, http.get, https.request, https.get, net.connect, net.createConnection, net.Server.prototype.listen] = originals
  syncBuiltinESMExports()
  delete process.env.PR08_SYNTHETIC_SECRET
  await rm(work, { recursive: true, force: true })
  for (const output of outputs) if (output) await rm(output, { recursive: true, force: true })
}
