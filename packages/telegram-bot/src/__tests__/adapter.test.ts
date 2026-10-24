import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, readdir, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createBot } from '../bot.js'
import { SessionStore } from '../session.js'
import { uploadIO } from '../uploads.js'
import { InMemoryJobStore, runJob } from '@depress-org/job-core'

vi.mock('@depress-org/job-core', async (original) => ({
  ...await original<typeof import('@depress-org/job-core')>(), runJob: vi.fn(),
}))
const wxr = '<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><wp:wxr_version>1.2</wp:wxr_version></channel></rss>'
const deferred = <T,>() => { let resolve!: (x: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
let root: string
let id = 0
let bot: ReturnType<typeof createBot>
let sessions: SessionStore
let store: InMemoryJobStore
let calls: { method: string; payload: any }[]
let apiFailure = ''
let apiGate: ReturnType<typeof deferred<any>> | undefined
const fetchMock = vi.fn()
function setup(options: any = {}) {
  sessions = new SessionStore()
  store = new InMemoryJobStore()
  bot = createBot('123456:synthetic-test-token', { allowedUserIds: [42], workspaceRoot: root, sessions, store, ...options })
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'offline_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false }
  calls = []
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload })
    if (apiFailure === method) throw new Error('sensitive upstream detail')
    if (method === 'getFile' && apiGate) return apiGate.promise
    return { ok: true, result: method === 'getFile' ? { file_id: 'file', file_path: 'documents/file.xml', file_size: wxr.length } : method === 'answerCallbackQuery' ? true : { message_id: id, date: 0, chat: { id: 42, type: 'private' }, text: '' } } as any
  })
}
async function update(kind: string, value = '', user = 42, type = 'private') {
  const common = { message_id: ++id, date: 0, chat: { id: type === 'private' ? user : -1, type }, from: { id: user, is_bot: false, first_name: 'test' } }
  const message = kind === 'doc' ? { ...common, document: { file_id: 'file', file_unique_id: 'uniq', file_name: value, file_size: wxr.length } } : { ...common, text: `/${kind}`, entities: [{ type: 'bot_command', offset: 0, length: kind.length + 1 }] }
  const u = kind === 'callback' ? { callback_query: { id: String(id), from: common.from, chat_instance: 'test', data: value, message: { ...common, from: { id: 123456, is_bot: true, first_name: 'Test' } } } } : { message }
  await bot.handleUpdate({ update_id: id, ...u } as any)
}
const text = () => calls.filter(c => c.method === 'sendMessage').map(c => c.payload.text).join('\n')
const callback = () => calls.filter(c => c.method === 'sendMessage').at(-1)!.payload.reply_markup.inline_keyboard[0][0].callback_data as string
const tick = () => new Promise(r => setTimeout(r, 10))
async function ready() { await update('doc', 'export.xml'); await update('skip'); return callback() }
beforeEach(async () => {
  await mkdir(resolve('.tmp'), { recursive: true }); root = await mkdtemp(resolve('.tmp/bot-test-'))
  apiFailure = ''; apiGate = undefined
  fetchMock.mockReset().mockImplementation(async () => new Response(wxr))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(runJob).mockReset().mockImplementation(async (s, jobId) => s.update(jobId, { status: 'done', repoPath: '.tmp/local-artifact' }))
  setup()
})
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) })

describe('real grammy adapter, offline API transport', () => {
  it('fails closed without access config; rejects groups and other senders before any IO', async () => {
    setup({ allowedUserIds: [] }); await update('doc', 'x.xml'); expect(calls).toEqual([])
    setup(); await update('doc', 'x.xml', 43); await update('doc', 'x.xml', 42, 'group'); await update('callback', 'theme:scaffold', 43)
    expect(calls).toEqual([]); expect(fetchMock).not.toHaveBeenCalled(); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('acquires no owner capability for unauthenticated, mismatched or non-private actors', async () => {
    const forOwner = vi.fn(() => { throw new Error('must not acquire') })
    setup({ store: { forOwner }, allowedUserIds: [42, 43] })
    await update('start', '', 44); await update('doc', 'x.xml', 42, 'group')
    await update('callback', `theme:${crypto.randomUUID()}:scaffold`, 44)
    await bot.handleUpdate({ update_id: ++id, message: { message_id: id, date: 0, chat: { id: 43, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'test' }, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } } as any)
    expect(forOwner).not.toHaveBeenCalled(); expect(calls).toEqual([]); expect(fetchMock).not.toHaveBeenCalled()
  })
  it('scopes the default root repository without an injected store or anonymous fallback', async () => {
    setup({ store: undefined })
    await update('callback', await ready())
    await expect.poll(() => readdir(root)).toEqual([])
    const [scope, jobId] = vi.mocked(runJob).mock.calls[0]
    expect(scope.ownerId).toBe('telegram:42')
    expect((await scope.get(jobId))!.ownerId).toBe('telegram:42')
    expect((await scope.get(jobId))!.status).toBe('done')
  })
  it('keeps two allowed users isolated through concurrent asynchronous job execution', async () => {
    setup({ allowedUserIds: [42, 43] })
    const forOwner = vi.spyOn(store, 'forOwner')
    const gates = new Map<string, ReturnType<typeof deferred<void>>>()
    const capabilities = new Map<string, import('@depress-org/job-core').JobStore>()
    vi.mocked(runJob).mockImplementation(async (scope, jobId) => {
      capabilities.set(scope.ownerId, scope)
      const gate = deferred<void>(); gates.set(scope.ownerId, gate)
      await gate.promise
      return scope.update(jobId, { status: 'done' })
    })
    const a = await ready()
    await update('doc', 'b.xml', 43); await update('skip', '', 43); const b = callback()
    await update('callback', a, 43) // A's keyboard is not B's session generation.
    expect(runJob).not.toHaveBeenCalled()
    await update('callback', a); await update('callback', b, 43); await tick()
    expect(runJob).toHaveBeenCalledTimes(2)
    expect(forOwner.mock.calls.map(([owner]) => owner)).toEqual(['telegram:43', 'telegram:42', 'telegram:43'])
    const ownerA = store.forOwner('telegram:42'), ownerB = store.forOwner('telegram:43')
    expect(capabilities.get('telegram:42')).toBe(ownerA); expect(capabilities.get('telegram:43')).toBe(ownerB)
    const [jobA] = await ownerA.list(), [jobB] = await ownerB.list()
    expect(jobA.ownerId).toBe('telegram:42'); expect(jobB.ownerId).toBe('telegram:43')
    expect(jobA.id).not.toBe(jobB.id)
    expect(await ownerA.get(jobB.id)).toBeUndefined(); expect(await ownerB.get(jobA.id)).toBeUndefined()
    await expect(ownerA.update(jobB.id, { status: 'failed' })).rejects.toThrow('Job not found')
    await expect(ownerB.update(jobA.id, { status: 'failed' })).rejects.toThrow('Job not found')
    await expect(ownerA.update(jobA.id, { ownerId: 'telegram:43' } as any)).rejects.toThrow('Immutable')
    ;(jobA as any).ownerId = 'forged' // Returned snapshots cannot mutate stored ownership.
    expect((await ownerA.get(jobA.id))!.ownerId).toBe('telegram:42')
    await update('start'); await update('doc', 'replacement.xml')
    gates.get('telegram:43')!.resolve(); await tick(); gates.get('telegram:42')!.resolve(); await tick(); await tick()
    expect((await ownerA.get(jobA.id))!.status).toBe('done'); expect((await ownerB.get(jobB.id))!.status).toBe('done')
    expect((await ownerA.list()).map(job => job.id)).toEqual([jobA.id]); expect((await ownerB.list()).map(job => job.id)).toEqual([jobB.id])
    expect(sessions.get('42:42').stage).toBe('awaiting_sql'); expect(sessions.get('43:43').stage).toBe('idle')
    expect(await readdir(root)).toHaveLength(1)
    await update('start'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it.each(['../../escape.xml', '/absolute.xml', '..\\windows.xml', 'odd 🦌.XML'])('generates contained role filename for %s', async name => {
    await update('doc', name)
    const dirs = await readdir(root); expect(dirs).toHaveLength(1)
    const files = await readdir(join(root, dirs[0])); expect(files).toEqual(['source.xml'])
    expect(await readFile(join(root, dirs[0], files[0]), 'utf8')).toBe(wxr)
  })
  it('rejects unnamed and wrong-role/media files before downloading', async () => {
    await update('doc', ''); await update('doc', 'media.zip'); expect(fetchMock).not.toHaveBeenCalled()
    await update('doc', 'x.xml'); fetchMock.mockClear(); await update('doc', 'media.zip'); await update('doc', 'x.xml')
    expect(fetchMock).not.toHaveBeenCalled(); expect(text()).toContain('SQL'); expect(text()).toContain('not supported')
  })
  it.each(['getFile', 'fetch', 'http', 'content', 'oversize'])('recovers and cleans uploads after %s failure', async failure => {
    if (failure === 'getFile') apiFailure = 'getFile'
    if (failure === 'fetch') fetchMock.mockRejectedValue(new Error('token must not appear'))
    if (failure === 'http') fetchMock.mockResolvedValue(new Response('error', { status: 403 }))
    if (failure === 'content') fetchMock.mockResolvedValue(new Response('not WXR'))
    if (failure === 'oversize') setup({ maxUploadBytes: 8 })
    await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([]); expect(text()).not.toContain('sensitive'); expect(text()).not.toContain('token must')
    apiFailure = ''; fetchMock.mockImplementation(async () => new Response(wxr)); setup(); await update('doc', 'x.xml'); expect(text()).toContain('/skip')
  })
  it('bounds streamed bytes even without content-length', async () => {
    setup({ maxUploadBytes: 200 }); fetchMock.mockResolvedValue(new Response('x'.repeat(201)))
    await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('times out a hung getFile or fetch and cleans the owned directory', async () => {
    setup({ ioTimeoutMs: 10 }); apiGate = deferred(); await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([])
    apiGate = undefined; fetchMock.mockImplementation(() => new Promise(() => {})); await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('rejects SQL content with XML or binary data and permits a real SQL dump', async () => {
    await update('doc', 'x.xml'); fetchMock.mockResolvedValue(new Response(wxr)); await update('doc', 'dump.sql')
    expect(text()).toContain('Upload failed'); expect(await readdir(root)).toHaveLength(1)
    fetchMock.mockResolvedValue(new Response('-- MySQL dump\nCREATE TABLE wp_posts (id int);')); await update('doc', 'dump.sql')
    expect(text()).toContain('Pick a theme')
  })
  it('does not accept old keyboard callbacks in a newer session', async () => {
    const old = await ready(); await update('start'); const current = await ready(); expect(current).not.toBe(old)
    await update('callback', old); expect(runJob).not.toHaveBeenCalled(); await update('callback', current); await tick(); expect(runJob).toHaveBeenCalledTimes(1)
  })
  it('claims document and job stages synchronously to prevent duplicate launches', async () => {
    apiGate = deferred(); const first = update('doc', 'x.xml'); await tick(); await update('doc', 'x.xml')
    expect(calls.filter(c => c.method === 'getFile')).toHaveLength(1)
    apiGate.resolve({ ok: true, result: { file_path: 'documents/file.xml' } }); await first; apiGate = undefined
    await update('skip'); const cb = callback(); await Promise.all([update('callback', cb), update('callback', cb)]); await tick()
    expect(runJob).toHaveBeenCalledTimes(1)
  })
  it('does not let a late download clobber /start and cleans its stale directory', async () => {
    apiGate = deferred(); const uploading = update('doc', 'x.xml'); await tick(); await update('start')
    apiGate.resolve({ ok: true, result: { file_path: 'documents/file.xml' } }); await uploading
    await expect.poll(() => readdir(root)).toEqual([]); apiGate = undefined; await update('doc', 'x.xml'); expect(text()).toContain('/skip')
  })
  it('cleans terminal uploads despite rejected sends and leaves a newer /start intact', async () => {
    const jobGate = deferred<any>(); let progress: any; let job: any
    vi.mocked(runJob).mockImplementation(async (s, jobId, opts) => { job = await s.get(jobId); progress = opts!.onProgress; return jobGate.promise })
    const cb = await ready(); await update('callback', cb); await tick(); await update('start'); await update('doc', 'new.xml')
    apiFailure = 'sendMessage'; await progress({ ...job, status: 'migrating' }); jobGate.resolve({ ...job, status: 'failed', error: 'private raw path' }); await tick(); await tick()
    expect(await readdir(root)).toHaveLength(1); apiFailure = ''; await update('skip'); expect(text()).toContain('Pick a theme')
  })
  it.each(['resolved-failed', 'rejected', 'done'])('always cleans after %s with rejected queued/progress/terminal delivery', async terminal => {
    const cb = await ready(); apiFailure = 'sendMessage'
    vi.mocked(runJob).mockImplementation(async (s, jobId, opts) => { const job = (await s.get(jobId))!; await opts!.onProgress!({ ...job, status: 'migrating' }); if (terminal === 'rejected') throw new Error('raw secret'); return { ...job, status: terminal === 'done' ? 'done' : 'failed' } })
    await update('callback', cb); await tick(); await tick(); await expect.poll(() => readdir(root)).toEqual([])
    apiFailure = ''; await update('doc', 'new.xml'); expect(text()).toContain('/skip')
  })
  it('reports migrate-only artifacts truthfully, without invented live/repository URLs', async () => {
    const cb = await ready(); await update('callback', cb); await tick(); expect(text()).toContain('Local artifact:'); expect(text()).not.toContain('Live URL:'); expect(text()).not.toContain('Repo:'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('reports only a returned live URL', async () => {
    vi.mocked(runJob).mockImplementation(async (s, jobId) => ({ ...(await s.get(jobId))!, status: 'done', deployUrl: 'https://fixture.invalid', repoPath: '.tmp/local' }))
    await update('callback', await ready()); await tick(); expect(text()).toContain('Live URL: https://fixture.invalid'); expect(text()).toContain('Local artifact:')
  })
  it.each(['mkdir', 'mkdtemp', 'writeFile'] as const)('recovers from mocked file IO %s rejection', async method => {
    vi.spyOn(uploadIO, method).mockRejectedValueOnce(new Error('private filesystem error'))
    await update('doc', 'x.xml'); expect(text()).toContain('Upload failed'); expect(text()).not.toContain('private filesystem'); await expect.poll(() => readdir(root)).toEqual([])
    await update('doc', 'x.xml'); expect(text()).toContain('/skip')
  })
  it('accepts a valid callback even if its acknowledgement rejects', async () => {
    const cb = await ready(); apiFailure = 'answerCallbackQuery'; await update('callback', cb); expect(runJob).toHaveBeenCalledTimes(1); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('cleans the prior upload when /start abandons a theme keyboard', async () => {
    await ready(); await update('start'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it.each(['<rss><channel>', '<rss><channel/></rss>', '<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>', '\u0000binary'])('rejects malformed, non-WXR, declaration or binary XML', async body => {
    fetchMock.mockResolvedValue(new Response(body)); await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([]); expect(text()).toContain('Upload failed')
  })
  it('rejects an excessive content-length before consuming the body', async () => {
    fetchMock.mockResolvedValue(new Response(wxr, { headers: { 'content-length': '999999999' } })); await update('doc', 'x.xml'); await expect.poll(() => readdir(root)).toEqual([])
  })
  it('does not expire inputs while an actual job promise is still active', async () => {
    setup({ sessionTtlMs: 30 }); const gate = deferred<any>(); let job: any
    vi.mocked(runJob).mockImplementation(async (s, jobId) => { job = await s.get(jobId); return gate.promise })
    await update('callback', await ready()); await new Promise(r => setTimeout(r, 60)); expect(await readdir(root)).toHaveLength(1)
    gate.resolve({ ...job, status: 'failed' }); await tick(); await expect.poll(() => readdir(root)).toEqual([])
  })
  it.each(['terminal', 'expiry'])('retries a transient cleanup failure on %s', async when => {
    if (when === 'expiry') setup({ sessionTtlMs: 15 })
    const cb = await ready(); const removal = vi.spyOn(uploadIO, 'rm').mockRejectedValueOnce(new Error('transient disk error'))
    if (when === 'terminal') await update('callback', cb)
    await new Promise(r => setTimeout(r, 60)); await expect.poll(() => readdir(root)).toEqual([]); expect(removal.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('expires abandoned uploads without deleting active job inputs', async () => {
    setup({ sessionTtlMs: 15 }); await update('doc', 'x.xml'); await new Promise(r => setTimeout(r, 50)); await expect.poll(() => readdir(root)).toEqual([])
  })
})
