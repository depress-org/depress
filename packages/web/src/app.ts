/** Local-only authenticated scaffold. Auth/admission are NOT a worker sandbox. */
import { Hono } from 'hono'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runJob, isValidTheme, listThemes, InMemoryJobStore, type Job, type JobInput } from '@depress-org/job-core'
import { Admission, authenticator, resolveLimits, type Identity, type Limits } from './security.js'
import { readUpload, UploadError } from './upload.js'

export interface AppOptions {
  identities?: readonly Identity[]
  limits?: Partial<Limits>
  store?: InMemoryJobStore
  /** Trusted operator path, never supplied by the request. */
  uploadRoot?: string
}
export function createApp(options: AppOptions = {}) {
  const auth = authenticator(options.identities)
  const limits = resolveLimits(options.limits)
  const admission = new Admission(limits)
  const repository = options.store ?? new InMemoryJobStore()
  const uploadRoot = resolve(options.uploadRoot ?? '.tmp/uploads')
  const app = new Hono<{ Variables: { ownerId: string } }>()
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!auth.configured) return c.json({ error: 'API authentication is not configured' }, 503)
    const ownerId = auth.owner(c.req.header('Authorization'))
    if (!ownerId) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'Unauthorized' }, 401)
    }
    c.set('ownerId', ownerId)
    await next()
  })
  app.get('/api/themes', (c) => c.json({ themes: [...listThemes(), {
    id: 'scaffold', name: 'Scaffold (Keystatic only)', description: 'Keystatic + custom Astro scaffold',
  }] }))
  app.get('/api/jobs/:id', async (c) => {
    const job = await repository.forOwner(c.get('ownerId')).get(c.req.param('id'))
    return job ? c.json({ job: toPublicJob(job) }) : c.json({ error: 'job not found' }, 404)
  })
  app.get('/api/jobs', async (c) => {
    const jobs = await repository.forOwner(c.get('ownerId')).list()
    return c.json({ jobs: jobs.map(toPublicJob) })
  })
  app.post('/api/jobs', async (c) => {
    const ownerId = c.get('ownerId')
    const release = admission.acquire(ownerId)
    if (!release) {
      c.header('Retry-After', String(Math.ceil(limits.windowMs / 1000)))
      return c.json({ error: 'Admission limit reached' }, 429)
    }
    let uploadDir: string | undefined
    let handedOff = false
    try {
      const { fields, files } = await readUpload(c.req.raw, limits)
      const wxr = files.get('wxr'), sql = files.get('sql')
      if (!wxr?.length) return c.json({ error: 'Nonempty wxr file is required' }, 400)
      if (!fields.theme || !isValidTheme(fields.theme)) return c.json({ error: 'Invalid theme' }, 400)
      if (fields.deployTarget !== undefined && !['cloudflare-pages', 'netlify', 'vercel'].includes(fields.deployTarget))
        return c.json({ error: 'Invalid deployment target' }, 400)
      if (fields.projectName !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(fields.projectName))
        return c.json({ error: 'Invalid project name' }, 400)
      if (fields.mode !== undefined && !['migrate-only', 'deploy'].includes(fields.mode))
        return c.json({ error: 'Invalid job mode' }, 400)
      // No HTTP credential/deployment opt-in until #25 provides a trusted worker boundary.
      if (fields.mode === 'deploy') return c.json({ error: 'HTTP deployment is disabled' }, 403)
      await mkdir(uploadRoot, { recursive: true, mode: 0o700 })
      uploadDir = await mkdtemp(join(uploadRoot, 'upload-'))
      const wxrPath = join(uploadDir, 'export.xml')
      await writeFile(wxrPath, wxr, { mode: 0o600, flag: 'wx' })
      const sqlDumpPath = sql ? join(uploadDir, 'dump.sql') : undefined
      if (sqlDumpPath) await writeFile(sqlDumpPath, sql!, { mode: 0o600, flag: 'wx' })
      const input: JobInput = {
        wxrPath, sqlDumpPath, themeId: fields.theme, mode: 'migrate-only',
        deployTarget: fields.deployTarget as JobInput['deployTarget'], projectName: fields.projectName,
      }
      const store = repository.forOwner(ownerId)
      const job = await store.create(input)
      // Permit lives until runner settles (no unbounded fire-and-forget work/queue).
      const directory = uploadDir
      void Promise.resolve().then(() => runJob(store, job.id)).catch(async () => {
        await store.update(job.id, { status: 'failed', error: 'PIPELINE_FAILED: Job failed' })
      }).finally(async () => {
        try { await rm(directory, { recursive: true, force: true }) } finally { release() }
      }).catch(() => { /* No raw filesystem/runner errors in HTTP/logs. #25 owns durable retry. */ })
      handedOff = true
      return c.json({ job: toPublicJob(job) }, 202)
    } catch (err) {
      if (err instanceof UploadError) return c.json({ error: err.message }, err.status)
      return c.json({ error: 'Job admission failed' }, 500)
    } finally {
      if (!handedOff) {
        try { if (uploadDir) await rm(uploadDir, { recursive: true, force: true }) }
        catch { /* #25 owns durable cleanup retries; never log raw paths/errors. */ }
        finally { release() }
      }
    }
  })
  app.get('/', (c) => c.html(INDEX_HTML))
  return app
}
function toPublicJob(job: Job) {
  return {
    id: job.id, status: job.status, theme: job.input.themeId,
    deployUrl: job.deployUrl, error: job.error ? 'Job failed' : undefined,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  }
}
const INDEX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>depress — local scaffold</title></head>
<body><h1>depress (local scaffold)</h1>
<p>The API requires an operator-configured bearer credential. No anonymous uploads or browser credential storage.
HTTP jobs are migrate-only. Public hosting remains NO-GO pending source containment, isolated workers and toolchain remediation.</p>
</body></html>`
