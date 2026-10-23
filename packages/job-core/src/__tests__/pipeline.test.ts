import { describe, it, expect, vi, beforeEach } from 'vitest'

const runMigrateMock = vi.fn()
const runDeployMock = vi.fn()

vi.mock('@depress-org/depress/commands/migrate', () => ({
  runMigrate: (...args: unknown[]) => runMigrateMock(...args),
}))
vi.mock('@depress-org/depress/commands/deploy', () => ({
  runDeploy: (...args: unknown[]) => runDeployMock(...args),
}))

import { runJob, cleanupJob, isValidTheme } from '../pipeline.js'
import { InMemoryJobStore } from '../types.js'
import type { JobInput } from '../types.js'

describe('isValidTheme', () => {
  it('accepts the bundled default theme', () => {
    expect(isValidTheme('astrowind')).toBe(true)
  })
  it('accepts the scaffold escape hatch', () => {
    expect(isValidTheme('scaffold')).toBe(true)
  })
  it('rejects unknown theme ids', () => {
    expect(isValidTheme('not-a-real-theme')).toBe(false)
  })
})

describe('runJob', () => {
  beforeEach(() => {
    runMigrateMock.mockReset().mockResolvedValue(undefined)
    runDeployMock.mockReset().mockResolvedValue(undefined)
  })

  const input: JobInput = { wxrPath: '/tmp/export.xml', themeId: 'astrowind' }

  it('walks queued -> migrating -> building -> deploying -> done, calling migrate then deploy once each', async () => {
    const store = new InMemoryJobStore()
    const job = await store.create(input)
    expect(job.status).toBe('queued')

    const seen: string[] = []
    const result = await runJob(store, job.id, { onProgress: (j) => seen.push(j.status) })

    expect(result.status).toBe('done')
    expect(seen).toEqual(['migrating', 'building', 'deploying', 'done'])
    expect(runMigrateMock).toHaveBeenCalledTimes(1)
    expect(runDeployMock).toHaveBeenCalledTimes(1)
    expect(runMigrateMock.mock.calls[0][0]).toMatchObject({ input: input.wxrPath, theme: 'astrowind' })
    expect(runDeployMock.mock.calls[0][0]).toMatchObject({ target: 'cloudflare-pages' })
    expect(result.repoPath).toBeDefined()
    await cleanupJob(result)
  })

  it('passes through sqlDumpPath and mediaDir and a non-default deploy target', async () => {
    const store = new InMemoryJobStore()
    const job = await store.create({
      wxrPath: '/tmp/export.xml',
      sqlDumpPath: '/tmp/dump.sql',
      mediaDir: '/tmp/media',
      themeId: 'rocket',
      deployTarget: 'netlify',
      projectName: 'my-site',
    })

    await runJob(store, job.id)

    expect(runMigrateMock.mock.calls[0][0]).toMatchObject({
      db: '/tmp/dump.sql',
      wpDir: '/tmp/media',
      theme: 'rocket',
    })
    expect(runDeployMock.mock.calls[0][0]).toMatchObject({ target: 'netlify', projectName: 'my-site' })
  })

  it('marks the job failed and records the error when migration throws', async () => {
    runMigrateMock.mockRejectedValueOnce(new Error('boom: bad xml'))
    const store = new InMemoryJobStore()
    const job = await store.create(input)

    const seen: string[] = []
    const result = await runJob(store, job.id, { onProgress: (j) => seen.push(j.status) })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('boom: bad xml')
    expect(seen).toEqual(['migrating', 'failed'])
    expect(runDeployMock).not.toHaveBeenCalled()
  })

  it('marks the job failed when deploy throws, after migration already ran', async () => {
    runDeployMock.mockRejectedValueOnce(new Error('no token'))
    const store = new InMemoryJobStore()
    const job = await store.create(input)

    const result = await runJob(store, job.id)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('no token')
    expect(runMigrateMock).toHaveBeenCalledTimes(1)
  })

  it('throws synchronously for an unknown job id', async () => {
    const store = new InMemoryJobStore()
    await expect(runJob(store, 'does-not-exist')).rejects.toThrow('Job not found')
  })
})
