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
const deployment = { token: 'test', target: 'cloudflare-pages' as const }
let store: InMemoryJobStore
beforeEach(() => {
  store = new InMemoryJobStore()
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
      onProgress: (j) => seen.push(j.status),
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
      onProgress: (j) => seen.push(j.status),
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
  it('unknown job id rejects', async () => {
    await expect(runJob(store, 'missing')).rejects.toThrow('Job not found')
  })
})
