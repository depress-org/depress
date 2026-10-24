import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { rm, readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
const { runJobMock } = vi.hoisted(() => ({ runJobMock: vi.fn() }))
vi.mock('@depress-org/job-core', async (original) => ({
  ...(await original<any>()), runJob: runJobMock,
}))
import { InMemoryJobStore } from '@depress-org/job-core'
import { createApp, type AppOptions } from '../app.js'
const identities = [{ token: 'a'.repeat(32), ownerId: 'alice' }, { token: 'b'.repeat(32), ownerId: 'bob' }]
const auth = (owner = 0) => ({ Authorization: `Bearer ${identities[owner].token}` })
const wxr = '<rss><channel><wp:wxr_version>1.2</wp:wxr_version></channel></rss>'
let root: string, store: InMemoryJobStore
let serial = 0
function setup(options: AppOptions = {}) { return createApp({ identities, store, uploadRoot: root, ...options }) }
function form(extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('wxr', new File([wxr], 'anything.xml'))
  fd.set('theme', 'scaffold')
  for (const [key, value] of Object.entries(extra)) fd.set(key, value)
  return fd
}
function post(app: ReturnType<typeof createApp>, body = form(), owner = 0) {
  return app.request('/api/jobs', { method: 'POST', headers: auth(owner), body })
}
function multipart(parts: Array<[string, string, boolean?]>) {
  return parts.map(([name, value, file]) => `--test\r\nContent-Disposition: form-data; name="${name}"${file ? '; filename="test.xml"' : ''}\r\n${file ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n${value}\r\n`).join('') + '--test--\r\n'
}
function streamRequest(text: string, headers: Record<string, string> = {}, chunk = 13) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new Request('http://localhost/api/jobs', {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'multipart/form-data; boundary=test', ...headers },
    body: new ReadableStream({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return }
      controller.enqueue(bytes.subarray(offset, offset += Math.min(chunk, bytes.length - offset)))
    } }), duplex: 'half',
  } as RequestInit)
}
beforeEach(() => {
  root = resolve(`.tmp/admission-test-${process.pid}-${serial++}`)
  store = new InMemoryJobStore()
  runJobMock.mockReset().mockImplementation(async (scope, id) => scope.get(id))
})
afterEach(async () => {
  const jobs = [...await store.forOwner('alice').list(), ...await store.forOwner('bob').list()]
  await vi.waitFor(() => { for (const job of jobs) expect(existsSync(dirname(job.input.wxrPath))).toBe(false) })
  await rm(root, { recursive: true, force: true })
})
describe('fail-closed authentication before IO #23', () => {
  it.each([undefined, '', 'Bearer wrong', `Basic ${'a'.repeat(32)}`, `Bearer ${'z'.repeat(32)}`])('rejects %s without pulling body, files, store or work', async (authorization) => {
    const pull = vi.fn(), scope = vi.spyOn(store, 'forOwner')
    const headers: Record<string, string> = authorization ? { Authorization: authorization } : {}
    const request = new Request('http://localhost/api/jobs', { method: 'POST', headers,
      body: new ReadableStream({ pull }, { highWaterMark: 0 }), duplex: 'half' } as RequestInit)
    expect((await setup().request(request)).status).toBe(401)
    expect(pull).not.toHaveBeenCalled()
    expect(scope).not.toHaveBeenCalled()
    expect(existsSync(root)).toBe(false)
    expect(runJobMock).not.toHaveBeenCalled()
  })
  it('unconfigured auth returns 503 for every API endpoint, including themes', async () => {
    const app = setup({ identities: [] })
    for (const path of ['/api/themes', '/api/jobs', '/api/jobs/guessed'])
      expect((await app.request(path, { headers: auth() })).status).toBe(503)
    expect((await post(app)).status).toBe(503)
    expect(existsSync(root)).toBe(false)
  })
  it.each([[], [{ token: 'short', ownerId: 'alice' }], [{ token: 'a'.repeat(32), ownerId: '' }], [...identities, identities[0]]].map(config => [config] as const))('empty config fails closed; malformed config cannot start', (config) => {
    if (!config.length) expect(setup({ identities: config })).toBeDefined()
    else expect(() => setup({ identities: config })).toThrow('Invalid identities')
  })
  it('requires auth on read/list/themes and leaves static landing credential-free', async () => {
    const app = setup()
    for (const path of ['/api/themes', '/api/jobs', '/api/jobs/guessed'])
      expect((await app.request(path)).status).toBe(401)
    const res = await app.request('/api/themes', { headers: auth() })
    expect(res.status).toBe(200)
    expect((await res.json()).themes.map((t: any) => t.id)).toContain('scaffold')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await app.request('/')).status).toBe(200)
  })
})
describe('owner scoped admission and public reads #23', () => {
  it('stores server owner, passes scoped runner and filters get/list across tenants', async () => {
    const app = setup()
    const created = await post(app)
    expect(created.status).toBe(202)
    const { job } = await created.json()
    const stored = (await store.forOwner('alice').get(job.id))!
    expect(stored.ownerId).toBe('alice')
    expect(stored.input.mode).toBe('migrate-only')
    expect(runJobMock.mock.calls[0][0].ownerId).toBe('alice')
    expect(job.repoPath).toBeUndefined()
    expect(job.input).toBeUndefined()
    expect((await app.request(`/api/jobs/${job.id}`, { headers: auth() })).status).toBe(200)
    expect((await app.request(`/api/jobs/${job.id}`, { headers: auth(1) })).status).toBe(404)
    expect((await app.request('/api/jobs/missing', { headers: auth() })).status).toBe(404)
    expect((await (await app.request('/api/jobs', { headers: auth(1) })).json()).jobs).toEqual([])
    expect((await (await app.request('/api/jobs', { headers: auth() })).json()).jobs.map((j: any) => j.id)).toEqual([job.id])
    await vi.waitFor(() => expect(existsSync(dirname(stored.input.wxrPath))).toBe(false))
  })
  it('writes only server-selected private file names and removes uploads after runner', async () => {
    let finish!: () => void
    runJobMock.mockImplementation(() => new Promise<void>((r) => { finish = r }))
    const fd = form()
    fd.set('sql', new File(['-- MySQL dump'], '../../dump.sql'))
    const res = await post(setup(), fd)
    expect(res.status).toBe(202)
    const { job } = await res.json()
    const input = (await store.forOwner('alice').get(job.id))!.input
    expect(await readFile(input.sqlDumpPath!, 'utf8')).toBe('-- MySQL dump')
    expect(input.sqlDumpPath).toMatch(/\/dump.sql$/)
    finish()
    await vi.waitFor(() => expect(existsSync(dirname(input.wxrPath))).toBe(false))
  })
  it.each([
    { theme: 'unknown' }, { mode: 'invalid' }, { deployTarget: 'shell' },
    { projectName: '../escape' }, { projectName: '-flag' }, { projectName: 'X' },
    { projectName: 'x'.repeat(64) }, { projectName: '' }, { ownerId: 'bob' }, { token: 'fake' },
  ])('rejects invalid/unknown schema %j before creating files/jobs/work', async (extra) => {
    const res = await post(setup(), form(extra as Record<string, string>))
    expect(res.status).toBe(400)
    expect(await store.forOwner('alice').list()).toEqual([])
    expect(existsSync(root)).toBe(false)
    expect(runJobMock).not.toHaveBeenCalled()
  })
  it.each(['cloudflare-pages', 'netlify', 'vercel'])('validates allowlisted target %s as metadata only; deployment is disabled', async (deployTarget) => {
    expect((await post(setup(), form({ deployTarget, projectName: 'a'.repeat(63) }))).status).toBe(202)
    expect((await post(setup(), form({ deployTarget, projectName: 'site', mode: 'deploy' }), 1)).status).toBe(403)
  })
  it('rejects no/empty wxr and missing theme', async () => {
    for (const remove of ['wxr', 'theme']) {
      const fd = form(); fd.delete(remove)
      expect((await post(setup(), fd)).status).toBe(400)
    }
    const fd = form(); fd.set('wxr', new File([], 'empty.xml'))
    expect((await post(setup(), fd)).status).toBe(400)
    expect(existsSync(root)).toBe(false)
  })
})
describe('streamed multipart bounds #23', () => {
  const valid = () => multipart([['wxr', wxr, true], ['theme', 'scaffold']])
  it('accepts a fragmented upload without Content-Length', async () => {
    expect((await setup().request(streamRequest(valid(), {}, 1))).status).toBe(202)
  })
  it.each([{}, { 'Content-Length': '1' }])('caps actual request bytes regardless of missing/lying length %j', async (headers) => {
    const app = setup({ limits: { requestBytes: 250 } })
    expect((await app.request(streamRequest(multipart([['wxr', 'x'.repeat(500), true], ['theme', 'scaffold']]), headers as Record<string, string>))).status).toBe(413)
    expect(existsSync(root)).toBe(false)
  })
  it.each(['-1', 'x', '999999999999999999999999', '999999999'])('rejects invalid/oversized declared length %s', async (length) => {
    const res = await setup().request(streamRequest(valid(), { 'Content-Length': length }))
    expect([400, 413]).toContain(res.status)
    expect(existsSync(root)).toBe(false)
  })
  it('rejects smaller/larger lying length even inside byte quota', async () => {
    for (const n of ['1', '500'])
      expect((await setup().request(streamRequest(valid(), { 'Content-Length': n }))).status).toBe(400)
  })
  it('accepts all six allowlisted parts at the count boundary', async () => {
    const text = multipart([['wxr', wxr, true], ['sql', '-- MySQL dump', true], ['theme', 'scaffold'], ['mode', 'migrate-only'], ['deployTarget', 'vercel'], ['projectName', 'site']])
    expect((await setup().request(streamRequest(text))).status).toBe(202)
  })
  it('accepts exact request and file byte bounds', async () => {
    const text = valid()
    expect((await setup({ limits: { requestBytes: Buffer.byteLength(text), fileBytes: Buffer.byteLength(wxr) } }).request(streamRequest(text))).status).toBe(202)
  })
  it('rejects streamed file bytes before whole request aggregation', async () => {
    const res = await setup({ limits: { fileBytes: 6 } }).request(streamRequest(multipart([['wxr', '1234567', true], ['theme', 'scaffold']])))
    expect(res.status).toBe(413)
    expect(existsSync(root)).toBe(false)
  })
  it.each([
    [['wxr', 'x', true], ['wxr', 'x', true]],
    [['wxr', 'x', true], ['other', 'x', true]],
    [['theme', 'scaffold'], ['theme', 'scaffold']],
    [['wxr', 'not-a-file'], ['theme', 'scaffold']],
    [['theme', 'file', true]],
  ].map(parts => [parts] as const))('rejects duplicate/unknown/wrong-kind parts %j', async (parts) => {
    expect((await setup().request(streamRequest(multipart(parts as any)))).status).toBe(400)
    expect(existsSync(root)).toBe(false)
  })
  it('caps file/field/part counts and field bytes', async () => {
    const cases: Array<Array<[string, string, boolean?]>> = [
      [['theme', 'x'.repeat(129)]],
      [['theme', 'scaffold'], ['mode', 'migrate-only'], ['deployTarget', 'vercel'], ['projectName', 'site'], ['ownerId', 'bad']],
      [['theme', 'scaffold'], ['mode', 'migrate-only'], ['deployTarget', 'vercel'], ['projectName', 'site'], ['wxr', 'x', true], ['sql', 'x', true], ['media', 'x', true], ['extra', 'x']],
    ]
    for (const parts of cases) expect((await setup().request(streamRequest(multipart(parts)))).status).toBe(413)
    expect(existsSync(root)).toBe(false)
  })
  it('rejects malformed/truncated multipart and unsupported content types', async () => {
    expect((await setup().request(streamRequest('--test\r\nbroken'))).status).toBe(400)
    expect((await setup().request(streamRequest(valid(), { 'Content-Type': 'multipart/form-data' }))).status).toBe(415)
    expect((await setup().request(streamRequest(valid(), { 'Content-Type': 'text/plain' }))).status).toBe(415)
    expect((await setup().request(streamRequest(valid(), { 'Content-Type': 'multipart/form-data; boundary="' }))).status).toBe(400)
  })
  it('times out a stalled chunked body and releases admission without files/jobs/work', async () => {
    const cancel = vi.fn()
    const app = setup({ limits: { uploadMs: 20 } })
    const req = new Request('http://localhost/api/jobs', { method: 'POST', headers: { ...auth(), 'Content-Type': 'multipart/form-data; boundary=test' },
      body: new ReadableStream({ pull: () => new Promise(() => {}), cancel }), duplex: 'half' } as RequestInit)
    expect((await app.request(req)).status).toBe(408)
    expect(cancel).toHaveBeenCalledOnce()
    expect(existsSync(root)).toBe(false)
    expect(runJobMock).not.toHaveBeenCalled()
    expect((await post(app)).status).toBe(202)
  })
  it('aborted streams fail safely and release permits', async () => {
    const controller = new AbortController()
    const req = new Request('http://localhost/api/jobs', { method: 'POST', signal: controller.signal,
      headers: { ...auth(), 'Content-Type': 'multipart/form-data; boundary=test' },
      body: new ReadableStream({ pull: () => new Promise(() => {}) }), duplex: 'half' } as RequestInit)
    const app = setup()
    const response = app.request(req)
    controller.abort()
    expect((await response).status).toBe(400)
    expect((await post(app)).status).toBe(202)
  })
})
describe('bounded admission #23', () => {
  it('holds global and owner permits across work and deterministically rejects without reading body', async () => {
    let finish!: () => void
    runJobMock.mockImplementation(() => new Promise<void>((r) => { finish = r }))
    const app = setup({ limits: { active: 1 } })
    expect((await post(app)).status).toBe(202)
    for (const owner of [0, 1]) {
      const pull = vi.fn()
      const req = new Request('http://localhost/api/jobs', { method: 'POST', headers: auth(owner), body: new ReadableStream({ pull }, { highWaterMark: 0 }), duplex: 'half' } as RequestInit)
      expect((await app.request(req)).status).toBe(429)
      expect(pull).not.toHaveBeenCalled()
    }
    expect(runJobMock).toHaveBeenCalledOnce()
    finish()
    await vi.waitFor(async () => expect((await post(app, form(), 1)).status).toBe(202))
    finish()
  })
  it('rate rejection happens before IO even after invalid uploads release active slots', async () => {
    const app = setup({ limits: { requestsPerOwnerWindow: 1 } })
    expect((await post(app, form({ theme: 'invalid' }))).status).toBe(400)
    const rejected = await post(app)
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('60')
    expect(existsSync(root)).toBe(false)
    expect((await post(app, form(), 1)).status).toBe(202)
  })
  it('storage failure returns generic error, cleans allocated uploads and releases active slot', async () => {
    const alice = store.forOwner('alice')
    const broken = { ...alice, create: vi.fn().mockRejectedValueOnce(new Error('fake-private-path')).mockImplementation(alice.create) }
    vi.spyOn(store, 'forOwner').mockReturnValue(broken)
    const app = setup()
    const response = await post(app)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('fake-private-path')
    expect(await readdir(root)).toEqual([])
    expect(await alice.list()).toEqual([])
    expect(runJobMock).not.toHaveBeenCalled()
    expect((await post(app)).status).toBe(202)
  })
  it('runner rejection persists generic failure and releases slot/cleans uploads', async () => {
    runJobMock.mockRejectedValueOnce(new Error('fake-secret-do-not-return'))
    const app = setup()
    const res = await post(app)
    const { job } = await res.json()
    await vi.waitFor(async () => expect((await store.forOwner('alice').get(job.id))?.status).toBe('failed'))
    const fetched = await app.request(`/api/jobs/${job.id}`, { headers: auth() })
    expect(await fetched.text()).not.toContain('fake-secret')
    await vi.waitFor(async () => expect((await post(app)).status).toBe(202))
  })
})
