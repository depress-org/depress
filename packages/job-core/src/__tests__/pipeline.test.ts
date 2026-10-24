import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { migrate, deploy } = vi.hoisted(() => ({
  migrate: vi.fn(),
  deploy: vi.fn(),
}))
vi.mock('@depress-org/depress/commands/migrate', () => ({
  runMigrate: migrate,
}))
vi.mock('@depress-org/depress/commands/deploy', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  runDeploy: deploy,
}))
import { runJob, cleanupJob, isValidTheme } from '../pipeline.js'
import { InMemoryJobStore } from '../types.js'
const input = { wxrPath: 'fixture.xml', themeId: 'scaffold' }
const deployment = { token: 'test', target: 'cloudflare-pages' as const, projectName: 'site' }
let store: ReturnType<InMemoryJobStore['forOwner']>
beforeEach(() => {
  store = new InMemoryJobStore().forOwner('test-owner')
  migrate.mockReset().mockResolvedValue({})
  deploy.mockReset().mockImplementation(async (options) => {
    await options.onStage?.('building')
    await options.onStage?.('deploying')
    return { deployUrl: 'https://site.pages.dev', target: 'cloudflare-pages' }
  })
})
afterEach(async () => {
  for (const job of await store.list()) await cleanupJob(job)
})
describe('shared job lifecycle #16', () => {
  it('defaults to migrate-only, does not deploy or imply build/deploy success', async () => {
    const job = await store.create(input)
    const seen: string[] = []
    const result = await runJob(store, job.id, {
      onProgress: (j) => { seen.push(j.status) },
    })
    expect(result.status).toBe('done')
    expect(result.deployUrl).toBeUndefined()
    expect(seen).toEqual(['migrating', 'done'])
    expect(deploy).not.toHaveBeenCalled()
  })
  it('explicit deployment returns URL with truthful stage transitions', async () => {
    const job = await store.create({ ...input, mode: 'deploy' })
    const seen: string[] = []
    const result = await runJob(store, job.id, {
      deployment,
      onProgress: (j) => { seen.push(j.status) },
    })
    expect(result.deployUrl).toBe('https://site.pages.dev')
    expect(seen).toEqual(['migrating', 'building', 'deploying', 'done'])
  })
  it.each([undefined, { token: '', target: 'cloudflare-pages' as const }])(
    'fails before migration if deploy is disabled or missing token',
    async (config) => {
      const job = await store.create({ ...input, mode: 'deploy' })
      const result = await runJob(store, job.id, { deployment: config })
      expect(result.status).toBe('failed')
      expect(migrate).not.toHaveBeenCalled()
      expect(deploy).not.toHaveBeenCalled()
    },
  )
  it('invalid mode fails before migration', async () => {
    const job = await store.create({ ...input, mode: 'invalid' as any })
    const result = await runJob(store, job.id)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('INVALID_MODE')
    expect(migrate).not.toHaveBeenCalled()
  })
  it('request target cannot override trusted server deployment configuration', async () => {
    const job = await store.create({ ...input, mode: 'deploy', deployTarget: 'vercel' })
    const result = await runJob(store, job.id, { deployment })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('INVALID_TARGET')
    expect(migrate).not.toHaveBeenCalled()
    expect(deploy).not.toHaveBeenCalled()
  })
  it('unknown theme fails before migration', async () => {
    const job = await store.create({ ...input, themeId: 'not-a-theme' })
    expect((await runJob(store, job.id)).status).toBe('failed')
    expect(migrate).not.toHaveBeenCalled()
    expect(isValidTheme('scaffold')).toBe(true)
  })
  it('failed stays failed when run again; provider secrets are not persisted', async () => {
    deploy.mockRejectedValueOnce(new Error('raw provider failure secret-token'))
    const job = await store.create({ ...input, mode: 'deploy' })
    const first = await runJob(store, job.id, { deployment })
    expect(first.status).toBe('failed')
    expect(first.error).not.toContain('secret-token')
    expect(await runJob(store, job.id, { deployment })).toEqual(first)
    expect(migrate).toHaveBeenCalledTimes(1)
  })
  it('duplicate runners cannot overwrite one another', async () => {
    const job = await store.create(input)
    const [a, b] = await Promise.all([
      runJob(store, job.id),
      runJob(store, job.id),
    ])
    expect(a).toEqual(b)
    expect(migrate).toHaveBeenCalledTimes(1)
  })
  it('concurrent jobs have separate output and failure states', async () => {
    migrate.mockImplementation(async (options) => {
      if (options.input === 'bad.xml') throw new Error('bad XML')
    })
    const a = await store.create(input)
    const b = await store.create({ ...input, wxrPath: 'bad.xml' })
    const [ra, rb] = await Promise.all([
      runJob(store, a.id),
      runJob(store, b.id),
    ])
    expect(ra.status).toBe('done')
    expect(rb.status).toBe('failed')
    expect(ra.outputDir).not.toBe(rb.outputDir)
  })
  it('observer errors do not corrupt success', async () => {
    const job = await store.create(input)
    expect(
      (
        await runJob(store, job.id, {
          onProgress: () => {
            throw new Error('UI disconnected')
          },
        })
      ).status,
    ).toBe('done')
  })
  it('a resolving deploy without a result is not success', async () => {
    deploy.mockResolvedValue(undefined)
    const job = await store.create({ ...input, mode: 'deploy' })
    expect((await runJob(store, job.id, { deployment })).status).toBe('failed')
  })
  it.each([undefined, '', ' ', 'bad;name', '-option', 'x'.repeat(64)])(
    'rejects missing/invalid trusted project name %s before allocating output',
    async (projectName) => {
      const job = await store.create({ ...input, mode: 'deploy', projectName: 'untrusted-fallback' })
      const result = await runJob(store, job.id, { deployment: { ...deployment, projectName } })
      expect(result.status).toBe('failed')
      expect(result.error).toContain('INVALID_PROJECT')
      expect(result.outputDir).toBeUndefined()
      expect(migrate).not.toHaveBeenCalled()
      expect(deploy).not.toHaveBeenCalled()
    },
  )
  it.each(['scaffold', 'invalid-theme'])('observer mutation cannot rewrite %s result/store/input', async (themeId) => {
    const original = { ...input, themeId }
    const job = await store.create(original)
    const result = await runJob(store, job.id, {
      onProgress: (snapshot) => {
        // Deliberately bypass readonly types: JS callers must be isolated too.
        const mutable = snapshot as any
        mutable.status = 'done'
        mutable.deployUrl = 'https://fake.pages.dev'
        mutable.input.themeId = 'observer-theme'
        mutable.input.wxrPath = 'observer.xml'
      },
    })
    expect(result.status).toBe(themeId === 'scaffold' ? 'done' : 'failed')
    expect(result.deployUrl).toBeUndefined()
    expect(result.input).toEqual({ ...input, themeId })
    expect(await store.get(job.id)).toEqual(result)
    expect(original).toEqual({ ...input, themeId })
    if (themeId === 'scaffold') expect(migrate.mock.calls[0][0].input).toBe(input.wxrPath)
  })
  it('a pending async observer does not block pipeline completion', async () => {
    const job = await store.create({ ...input, themeId: 'invalid-theme' })
    const result = await runJob(store, job.id, {
      onProgress: () => new Promise<void>(() => {}),
    })
    expect(result.status).toBe('failed')
  }, 1000)
  it('foreign owner capability cannot run another owner job', async () => {
    const root = new InMemoryJobStore()
    const job = await root.forOwner('alice').create(input)
    await expect(runJob(root.forOwner('bob'), job.id)).rejects.toThrow('Job not found')
    expect(migrate).not.toHaveBeenCalled()
    expect(deploy).not.toHaveBeenCalled()
    expect((await root.forOwner('alice').get(job.id))?.status).toBe('queued')
  })
  it('report quality failure prevents done and deployment', async () => {
    migrate.mockResolvedValue({ qualityPassed: false })
    const job = await store.create({ ...input, mode: 'deploy' })
    const result = await runJob(store, job.id, { deployment })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('MIGRATION_QUALITY_FAILED')
    expect(deploy).not.toHaveBeenCalled()
  })
  it('unknown job id rejects', async () => {
    await expect(runJob(store, 'missing')).rejects.toThrow('Job not found')
  })
})
