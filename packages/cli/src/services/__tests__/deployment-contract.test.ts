import { describe, expect, it, vi } from 'vitest'
import {
  createOfflinePagesAdapter, sealStaticArtifact, STATIC_KIND, DeploymentContractError,
  type Authority, type PagesTarget, type StaticFile, type VerifiedArtifact, type ProviderVersion,
  type PagesResponse, type PagesTransport, type Deadline,
} from '../deployment-contract.js'

const context: Authority = { ownerId: 'server-owner-a', jobId: 'server-job-a' }
const destination: PagesTarget = { provider: 'cloudflare-pages', accountId: 'a'.repeat(32), projectName: 'fixture-site' }
const deploymentId = '12345678-abcd-1234-abcd-123456789abc'
const otherId = '87654321-abcd-1234-abcd-123456789abc'
const url = 'https://abc123ef.fixture-site.pages.dev'
const canary = 'FAKE_DEPLOY_TOKEN_do_not_leak /private/job/export.xml'
const bytes = (value: string) => new TextEncoder().encode(value)
const files = (): StaticFile[] => [{ path: 'index.html', bytes: bytes('<html>offline fixture</html>') },
  { path: 'assets/main.js', bytes: bytes('/* static asset, not executed */') }]
const artifact = () => sealStaticArtifact(context, files())
const success = (patch: Record<string, unknown> = {}, status = 200): PagesResponse => ({ status,
  body: JSON.stringify({ success: true, errors: [], result: { id: deploymentId, url,
    project_name: destination.projectName, latest_stage: { name: 'deploy', status: 'success' }, ...patch } }) })
const failure = (status = 400): PagesResponse => ({ status,
  body: JSON.stringify({ success: false, errors: [{ code: 1000, message: canary }], result: null }) })
function fixture(options: { artifact?: VerifiedArtifact; version?: ProviderVersion; transport?: PagesTransport; deadline?: Deadline } = {}) {
  const sealed = options.artifact ?? artifact()
  const getArtifact = vi.fn(async () => sealed)
  const getVersion = vi.fn(async () => options.version)
  const transport = vi.fn(options.transport ?? (async () => success()))
  const adapter = createOfflinePagesAdapter({ authority: context, target: destination,
    registry: { getArtifact, getVersion }, transport, deadline: options.deadline })
  const request = { idempotencyKey: 'request-1', artifactSha256: sealed.sha256 }
  return { adapter, transport, request, getArtifact, getVersion, sealed }
}
const version = (patch: Partial<ProviderVersion> = {}): ProviderVersion => ({ ...context, jobId: 'older-job',
  verified: true, artifactKind: STATIC_KIND, artifactSha256: artifact().sha256, target: destination,
  providerDeploymentId: deploymentId, url, ...patch })

describe('immutable static artifact contract', () => {
  it('addresses bytes and canonical sorted paths, detaches source bytes', () => {
    const source = files()
    const sealed = sealStaticArtifact(context, source)
    expect(sealed.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(sealStaticArtifact(context, [...source].reverse()).sha256).toBe(sealed.sha256)
    source[0].bytes[0] ^= 1
    expect(sealed.files.find(f => f.path === 'index.html')!.bytes[0]).toBe(60)
    expect(sealStaticArtifact(context, source).sha256).not.toBe(sealed.sha256)
    expect(Object.isFrozen(sealed)).toBe(true)
    expect(Object.isFrozen(sealed.files)).toBe(true)
  })
  it.each(['server/entry.mjs', 'client/index.html', '_worker.js', '_worker.js/index.js', '_routes.json',
    '.wrangler/deploy/config.json', 'functions/hello.js', '.env', 'a/.env', 'package.json', 'package-lock.json',
    'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'node_modules/a.js', 'deployment.v1.json',
    'migration-report.json', 'source.ts', '../secret.txt', 'assets/../a.js', '/index.html', 'a//b.js',
    'a\\b.js', 'https://bad/a.js', 'a/%2e%2e/a.js', 'café.html', 'a\u0000.js'])('rejects unsupported static path %s', path => {
    expect(() => sealStaticArtifact(context, [...files(), { path, bytes: bytes('x') }]))
      .toThrowError(new DeploymentContractError('ARTIFACT_REJECTED'))
  })
  it('rejects no root index, empty entries, duplicate paths/case and nonbytes', () => {
    for (const input of [[], [files()[1]], [...files(), files()[0]],
      [...files(), { path: 'INDEX.html', bytes: bytes('x') }],
      [{ path: 'index.html', bytes: 'not bytes' }]]) {
      expect(() => sealStaticArtifact(context, input as StaticFile[])).toThrow('ARTIFACT_REJECTED')
    }
  })
  it('bounds count and per-file/total byte size', () => {
    expect(() => sealStaticArtifact(context, Array(10_001).fill(files()[0]))).toThrow('ARTIFACT_REJECTED')
    expect(() => sealStaticArtifact(context, [{ path: 'index.html', bytes: new Uint8Array(25 * 1024 * 1024 + 1) }])).toThrow('ARTIFACT_REJECTED')
    expect(() => sealStaticArtifact(context, [files()[0], ...[1, 2, 3].map(n => ({ path: `${n}.js`, bytes: new Uint8Array(23 * 1024 * 1024) }))])).toThrow('ARTIFACT_REJECTED')
  })
  it('rejects sparse arrays instead of hashing holes as null manifest entries', () => {
    const sparse = [files()[0]]
    sparse.length = 2
    expect(() => sealStaticArtifact(context, sparse)).toThrow('ARTIFACT_REJECTED')
  })
})

describe('owner/artifact/credential seam', () => {
  it('writes only frozen deployment.v1 allowlisted fields and never receives credentials', async () => {
    const { adapter, request, transport } = fixture()
    const result = await adapter.deploy({ ...request, ownerId: 'attacker', jobId: 'attacker', target: 'workers', token: canary } as typeof request)
    expect(result).toMatchObject({ schema: 'deployment.v1', ...context, artifact: { kind: STATIC_KIND, sha256: request.artifactSha256 },
      target: destination, status: 'succeeded', operation: 'deploy', providerDeploymentId: deploymentId, url })
    expect(result.id).toMatch(/^[a-f0-9]{64}$/)
    const [command, signal] = transport.mock.calls[0]
    expect(command.authority).toEqual(context)
    expect(command.kind).toBe('deploy')
    expect(command.files).toHaveLength(2)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify([result, command])).not.toContain(canary)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.artifact)).toBe(true)
    expect(Object.isFrozen(result.target)).toBe(true)
    expect(() => { (result as { ownerId: string }).ownerId = 'other' }).toThrow()
    expect(adapter.get(request.idempotencyKey)).toBe(result)
  })
  it.each([
    { ownerId: 'other' }, { jobId: 'other' }, { kind: 'cloudflare-workers.v1' },
    { sha256: 'b'.repeat(64) }, { files: [...files(), { path: 'server/entry.mjs', bytes: bytes('x') }] },
  ])('rejects foreign/unverified metadata %j before transport', async patch => {
    const valid = artifact()
    const f = fixture({ artifact: { ...valid, ...patch } as VerifiedArtifact })
    await expect(f.adapter.deploy({ ...f.request, artifactSha256: valid.sha256 })).rejects.toThrow('ARTIFACT_REJECTED')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('rejects changed bytes under same digest and absent/throwing registry', async () => {
    const f = fixture()
    f.sealed.files[0].bytes[0] ^= 1
    await expect(f.adapter.deploy(f.request)).rejects.toThrow('ARTIFACT_REJECTED')
    f.getArtifact.mockRejectedValueOnce(new Error(canary))
    await expect(f.adapter.deploy(f.request)).rejects.toThrow('ARTIFACT_REJECTED')
    f.getArtifact.mockResolvedValueOnce(undefined as unknown as VerifiedArtifact)
    await expect(f.adapter.deploy(f.request)).rejects.toThrow('ARTIFACT_REJECTED')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('captures authority/target/request before async work and detaches transport bytes', async () => {
    const auth = { ...context }, tgt = { ...destination }
    const art = artifact()
    let resolve!: (value: VerifiedArtifact) => void
    const transport = vi.fn(async () => success())
    const adapter = createOfflinePagesAdapter({ authority: auth, target: tgt,
      registry: { getArtifact: () => new Promise(r => { resolve = r }), getVersion: async () => undefined }, transport })
    auth.ownerId = 'changed'; tgt.projectName = 'changed'
    const request = { idempotencyKey: 'capture', artifactSha256: art.sha256 }
    const result = adapter.deploy(request)
    request.idempotencyKey = 'other'; request.artifactSha256 = 'f'.repeat(64)
    resolve(art)
    expect(await result).toMatchObject({ ...context, target: destination, idempotencyKey: 'capture', artifact: { sha256: art.sha256 } })
    expect(transport.mock.calls[0][0].files![0].bytes).not.toBe(art.files[0].bytes)
  })
  it.each(['', '../unsafe', 'a'.repeat(129)])('rejects invalid idempotency key %s', async key => {
    const f = fixture()
    await expect(f.adapter.deploy({ ...f.request, idempotencyKey: key })).rejects.toThrow('INVALID_REQUEST')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('rejects malformed SHA and invalid server authority/target/timeout', async () => {
    const f = fixture()
    await expect(f.adapter.deploy({ ...f.request, artifactSha256: 'SHA256:' + f.request.artifactSha256 })).rejects.toThrow('INVALID_REQUEST')
    const base = { authority: context, target: destination, registry: { getArtifact: f.getArtifact, getVersion: f.getVersion }, transport: f.transport }
    for (const patch of [{ authority: { ...context, ownerId: '' } }, { target: { ...destination, provider: 'workers' } },
      { target: { ...destination, projectName: '../bad' } }, { target: { ...destination, accountId: 'bad' } }, { timeoutMs: 0 }, { timeoutMs: 60_001 }]) {
      expect(() => createOfflinePagesAdapter({ ...base, ...patch } as typeof base)).toThrow('INVALID_REQUEST')
    }
    expect(f.transport).not.toHaveBeenCalled()
  })
})

describe('strict provider response parsing (all fixtures, no provider calls)', () => {
  it.each([200, 201])('accepts completed successful envelope HTTP %s', async status => {
    const f = fixture({ transport: async () => success({}, status) })
    expect((await f.adapter.deploy(f.request)).status).toBe('succeeded')
  })
  it.each(['http://abc123ef.fixture-site.pages.dev', 'https://evil.pages.dev', 'https://fixture-site.pages.dev',
    'https://abc.other.pages.dev', 'https://abc123ef.fixture-site.pages.dev.evil.test',
    'https://abc123ef.fixture-site.pages.dev/path', 'https://abc123ef.fixture-site.pages.dev/?token=fake',
    'https://abc123ef.fixture-site.pages.dev/#fragment', 'https://user:pass@abc123ef.fixture-site.pages.dev',
    'https://abc123ef.fixture-site.pages.dev:443', 'https://main.fixture-site.pages.dev',
    'https://a.b.fixture-site.pages.dev', 'not a url'])('rejects unsafe/nonimmutable URL %s', async invalid => {
    const f = fixture({ transport: async () => success({ url: invalid }) })
    const result = await f.adapter.deploy(f.request)
    expect(result.status).toBe('unknown')
    expect(result.url).toBeUndefined()
    expect(result.error?.code).toBe('PROVIDER_UNCERTAIN')
  })
  it.each([
    { id: 'not-id' }, { project_name: 'foreign' }, { latest_stage: { name: 'deploy', status: 'active' } },
    { latest_stage: { name: 'build', status: 'success' } }, { latest_stage: null },
  ])('requires completed deployment id/project/stage %j', async patch => {
    const f = fixture({ transport: async () => success(patch) })
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
  })
  it.each(['not JSON ' + canary, '[]', 'null', '{}', '{"success":"true","errors":[],"result":{}}',
    '{"success":true,"errors":[{}],"result":{}}', '{"success":false,"errors":[],"result":null}',
    '{"success":false,"errors":[{"code":"1000","message":"fake"}],"result":null}',
    'x'.repeat(65_537)])('redacts malformed/oversized response case %#', async body => {
    const f = fixture({ transport: async () => ({ status: 200, body }) })
    const result = await f.adapter.deploy(f.request)
    expect(result.status).toBe('unknown')
    expect(JSON.stringify(result)).not.toContain(canary)
  })
  it('redacts definitive provider rejection and does not retry it', async () => {
    const f = fixture({ transport: async () => failure() })
    const result = await f.adapter.deploy(f.request)
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'PROVIDER_REJECTED' } })
    expect(await f.adapter.deploy(f.request)).toBe(result)
    expect(f.transport).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain(canary)
  })
  it.each([202, 204, 302, 400, 500])('rejects contradictory successful JSON HTTP %s', async status => {
    const f = fixture({ transport: async () => success({}, status) })
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
  })
  it('strips extra provider properties instead of persisting arbitrary data', async () => {
    const f = fixture({ transport: async () => success({ secret: canary, files: [canary] }) })
    expect(JSON.stringify(await f.adapter.deploy(f.request))).not.toContain(canary)
  })
})

describe('duplicate/retry/timeout semantics', () => {
  it('coalesces concurrent duplicates and returns terminal receipt without new side effects', async () => {
    let finish!: (value: PagesResponse) => void
    const f = fixture({ transport: () => new Promise(resolve => { finish = resolve }) })
    const first = f.adapter.deploy(f.request), duplicate = f.adapter.deploy(f.request)
    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1))
    expect(f.adapter.get(f.request.idempotencyKey)?.status).toBe('pending')
    finish(success())
    const receipt = await first
    expect(await duplicate).toBe(receipt)
    expect(await f.adapter.deploy(f.request)).toBe(receipt)
    expect(f.transport).toHaveBeenCalledTimes(1)
    await expect(f.adapter.deploy({ ...f.request, artifactSha256: 'f'.repeat(64) })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await expect(f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it.each([408, 409, 429, 500, 503])('reconciles uncertain HTTP %s without resubmitting deploy', async status => {
    const f = fixture()
    f.transport.mockResolvedValueOnce(failure(status)).mockResolvedValueOnce(success())
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
    expect((await f.adapter.deploy(f.request)).status).toBe('succeeded')
    expect(f.transport.mock.calls.map(([command]) => command.kind)).toEqual(['deploy', 'lookup'])
    expect(f.transport.mock.calls[1][0].files).toBeUndefined()
    expect(f.transport.mock.calls[0][0].operationId).toBe(f.transport.mock.calls[1][0].operationId)
  })
  it('lookup absence/404 never implies safe resubmission; exceptions are redacted', async () => {
    const f = fixture({ transport: async () => { throw new Error(canary) } })
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
    f.transport.mockResolvedValue(failure(404))
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
    expect((await f.adapter.deploy(f.request)).status).toBe('unknown')
    expect(f.transport.mock.calls.map(([c]) => c.kind)).toEqual(['deploy', 'lookup', 'lookup'])
    expect(JSON.stringify(f.adapter.get(f.request.idempotencyKey))).not.toContain(canary)
  })
  it('deterministically times out, aborts, cancels timer and ignores late success/rejection', async () => {
    let expire!: () => void
    let late!: (value: PagesResponse) => void
    const cancel = vi.fn()
    const f = fixture({ deadline: { schedule: callback => { expire = callback; return cancel } },
      transport: () => new Promise(resolve => { late = resolve }) })
    const pending = f.adapter.deploy(f.request)
    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1))
    expire()
    const timedOut = await pending
    expect(timedOut).toMatchObject({ status: 'unknown', error: { code: 'TIMEOUT' } })
    expect(f.transport.mock.calls[0][1].aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    late(success())
    await Promise.resolve()
    expect(f.adapter.get(f.request.idempotencyKey)).toBe(timedOut)
    f.transport.mockResolvedValueOnce(success())
    expect((await f.adapter.deploy(f.request)).status).toBe('succeeded')
    expect(f.transport.mock.calls[1][0].kind).toBe('lookup')
  })
  it('handles late transport rejection after deadline without unhandled rejection', async () => {
    let expire!: () => void, lateReject!: (reason: Error) => void
    const f = fixture({ deadline: { schedule: callback => { expire = callback; return () => {} } },
      transport: () => new Promise((_resolve, reject) => { lateReject = reject }) })
    const pending = f.adapter.deploy(f.request)
    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(1))
    expire(); expect((await pending).status).toBe('unknown')
    lateReject(new Error(canary)); await Promise.resolve(); await Promise.resolve()
    expect(f.adapter.get(f.request.idempotencyKey)?.error?.code).toBe('TIMEOUT')
  })
  it('keeps owner/job scope distinct for same key/digest', async () => {
    const f = fixture()
    const receipt = await f.adapter.deploy(f.request)
    const otherContext = { ...context, ownerId: 'owner-b' }
    const other = sealStaticArtifact(otherContext, files())
    const transport = vi.fn(async () => success())
    const adapter = createOfflinePagesAdapter({ authority: otherContext, target: destination,
      registry: { getArtifact: async () => other, getVersion: async () => undefined }, transport })
    const next = await adapter.deploy(f.request)
    expect(next.id).not.toBe(receipt.id)
    expect(next.ownerId).toBe('owner-b')
    expect(transport).toHaveBeenCalledTimes(1)
  })
})

describe('provider rollback selects existing verified immutable version', () => {
  it('rolls back across prior same-owner job with no local files/build/delete', async () => {
    const f = fixture({ version: version() })
    const result = await f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })
    expect(result).toMatchObject({ ...context, operation: 'rollback', status: 'succeeded', previousDeploymentId: deploymentId,
      providerDeploymentId: deploymentId, url })
    expect(f.getArtifact).not.toHaveBeenCalled()
    expect(f.getVersion).toHaveBeenCalledWith(deploymentId)
    const command = f.transport.mock.calls[0][0]
    expect(command.kind).toBe('rollback')
    expect(command.files).toBeUndefined()
    expect(Object.keys(command)).not.toContain('path')
  })
  it.each([
    { ownerId: 'foreign-owner' }, { verified: false }, { artifactKind: 'cloudflare-workers.v1' }, { artifactSha256: 'b'.repeat(64) },
    { providerDeploymentId: otherId }, { target: { ...destination, projectName: 'foreign-site' } },
    { target: { ...destination, accountId: 'b'.repeat(32) } }, { url: 'https://attacker.test' },
  ])('rejects foreign/unverified/digest-mismatched old version %j', async patch => {
    const f = fixture({ version: version(patch as Partial<ProviderVersion>) })
    await expect(f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })).rejects.toThrow('ROLLBACK_REJECTED')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('rejects absent version, unsafe ID and registry exception before transport', async () => {
    const f = fixture()
    await expect(f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })).rejects.toThrow('ROLLBACK_REJECTED')
    await expect(f.adapter.rollback({ ...f.request, previousDeploymentId: '../rm-output' })).rejects.toThrow('INVALID_REQUEST')
    f.getVersion.mockRejectedValueOnce(new Error(canary))
    await expect(f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })).rejects.toThrow('ROLLBACK_REJECTED')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it.each([{ id: otherId }, { url: 'https://deadbeef.fixture-site.pages.dev' }])('does not accept different rollback receipt %j', async patch => {
    const f = fixture({ version: version(), transport: async () => success(patch) })
    expect((await f.adapter.rollback({ ...f.request, previousDeploymentId: deploymentId })).status).toBe('unknown')
  })
  it('reconciles uncertain rollback by same operation ID without second rollback', async () => {
    const f = fixture({ version: version() })
    f.transport.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(success())
    const request = { ...f.request, previousDeploymentId: deploymentId }
    expect((await f.adapter.rollback(request)).status).toBe('unknown')
    expect((await f.adapter.rollback(request)).status).toBe('succeeded')
    expect(f.transport.mock.calls.map(([c]) => c.kind)).toEqual(['rollback', 'lookup'])
  })
})
