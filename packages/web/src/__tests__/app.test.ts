import { describe, it, expect, vi, beforeEach } from 'vitest'

const runJobMock = vi.fn()

vi.mock('@depress-org/job-core', async () => {
  const actual = await vi.importActual<typeof import('@depress-org/job-core')>('@depress-org/job-core')
  return {
    ...actual,
    runJob: (...args: unknown[]) => runJobMock(...args),
  }
})

import { createApp, jobStore } from '../app.js'

function wxrFile(contents = '<rss><channel></channel></rss>') {
  return new File([contents], 'export.xml', { type: 'text/xml' })
}

describe('GET /api/themes', () => {
  it('lists themes including the scaffold fallback', async () => {
    const app = createApp()
    const res = await app.request('/api/themes')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.themes.map((t: { id: string }) => t.id)).toContain('astrowind')
    expect(body.themes.map((t: { id: string }) => t.id)).toContain('scaffold')
  })
})

describe('POST /api/jobs', () => {
  beforeEach(() => {
    runJobMock.mockReset().mockResolvedValue(undefined)
  })

  it('rejects a request with no wxr file', async () => {
    const app = createApp()
    const fd = new FormData()
    fd.set('theme', 'astrowind')
    const res = await app.request('/api/jobs', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid theme id', async () => {
    const app = createApp()
    const fd = new FormData()
    fd.set('wxr', wxrFile())
    fd.set('theme', 'not-a-theme')
    const res = await app.request('/api/jobs', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('creates a queued job and kicks off runJob for a valid upload', async () => {
    const app = createApp()
    const fd = new FormData()
    fd.set('wxr', wxrFile())
    fd.set('theme', 'astrowind')
    const res = await app.request('/api/jobs', { method: 'POST', body: fd })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.job.status).toBe('queued')
    expect(body.job.theme).toBe('astrowind')
    expect(runJobMock).toHaveBeenCalledTimes(1)

    const stored = await jobStore.get(body.job.id)
    expect(stored).toBeDefined()
    expect(stored?.input.wxrPath).toMatch(/export\.xml$/)
  })

  it('accepts an optional sql dump', async () => {
    const app = createApp()
    const fd = new FormData()
    fd.set('wxr', wxrFile())
    fd.set('sql', new File(['-- dump'], 'dump.sql'))
    fd.set('theme', 'scaffold')
    const res = await app.request('/api/jobs', { method: 'POST', body: fd })
    expect(res.status).toBe(202)
    const body = await res.json()
    const stored = await jobStore.get(body.job.id)
    expect(stored?.input.sqlDumpPath).toMatch(/dump\.sql$/)
  })
})

describe('GET /api/jobs/:id', () => {
  it('404s for an unknown job id', async () => {
    const app = createApp()
    const res = await app.request('/api/jobs/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('returns a job after creation', async () => {
    const app = createApp()
    const fd = new FormData()
    fd.set('wxr', wxrFile())
    fd.set('theme', 'astrowind')
    const createRes = await app.request('/api/jobs', { method: 'POST', body: fd })
    const { job } = await createRes.json()

    const res = await app.request(`/api/jobs/${job.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.job.id).toBe(job.id)
  })
})
