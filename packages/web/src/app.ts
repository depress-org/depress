/**
 * depress web — scaffold API.
 *
 * STAGING/LOCAL ONLY. No billing, no production credentials. Upload -> pick
 * theme -> migrate -> deploy, reusing @depress-org/job-core for all pipeline
 * logic (never reimplements migration/deploy here).
 */
import { Hono } from 'hono'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  runJob,
  isValidTheme,
  listThemes,
  InMemoryJobStore,
  type Job,
  type JobInput,
} from '@depress-org/job-core'

export const jobStore = new InMemoryJobStore()

export function createApp() {
  const app = new Hono()

  app.get('/api/themes', (c) => {
    const themes = listThemes()
    return c.json({ themes: [...themes, { id: 'scaffold', name: 'Scaffold (Keystatic only)', description: 'No external theme — Keystatic + custom Astro scaffold' }] })
  })

  app.get('/api/jobs/:id', async (c) => {
    const job = await jobStore.get(c.req.param('id'))
    if (!job) return c.json({ error: 'job not found' }, 404)
    return c.json({ job: toPublicJob(job) })
  })

  app.get('/api/jobs', async (c) => {
    const jobs = await jobStore.list()
    return c.json({ jobs: jobs.map(toPublicJob) })
  })

  // multipart/form-data: wxr (required file), sql (optional file), theme (required string),
  // deployTarget (optional string), projectName (optional string)
  app.post('/api/jobs', async (c) => {
    const body = await c.req.parseBody()
    const wxrFile = body['wxr']
    const themeId = body['theme']
    const sqlFile = body['sql']
    const deployTarget = body['deployTarget']
    const projectName = body['projectName']

    if (!(wxrFile instanceof File)) {
      return c.json({ error: 'wxr file is required (WordPress export XML)' }, 400)
    }
    if (typeof themeId !== 'string' || !isValidTheme(themeId)) {
      return c.json({ error: `invalid theme: ${String(themeId)}. See GET /api/themes for valid ids.` }, 400)
    }

    const uploadDir = await mkdtemp(join(tmpdir(), 'depress-upload-'))
    const wxrPath = join(uploadDir, 'export.xml')
    await writeFile(wxrPath, Buffer.from(await wxrFile.arrayBuffer()))

    let sqlDumpPath: string | undefined
    if (sqlFile instanceof File) {
      sqlDumpPath = join(uploadDir, 'dump.sql')
      await writeFile(sqlDumpPath, Buffer.from(await sqlFile.arrayBuffer()))
    }

    const input: JobInput = {
      wxrPath,
      sqlDumpPath,
      themeId,
      deployTarget: typeof deployTarget === 'string' ? (deployTarget as JobInput['deployTarget']) : undefined,
      projectName: typeof projectName === 'string' ? projectName : undefined,
    }

    const job = await jobStore.create(input)

    // Fire-and-forget: progress is polled via GET /api/jobs/:id.
    // A scaffold-level choice — the architecture doc's Postgres job queue
    // would make this durable across restarts; tracked as a follow-up.
    void runJob(jobStore, job.id).catch(() => {
      /* runJob already records failures on the job itself */
    })

    return c.json({ job: toPublicJob(job) }, 202)
  })

  app.get('/', (c) => c.html(INDEX_HTML))

  return app
}

function toPublicJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    theme: job.input.themeId,
    deployUrl: job.deployUrl,
    repoPath: job.repoPath,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

const INDEX_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>depress — migrate &amp; deploy (staging)</title></head>
<body>
  <h1>depress web (scaffold, staging only)</h1>
  <p>Upload a WordPress export (WXR), pick a theme, and watch the migration + deploy job run.</p>
  <form id="f">
    <label>WXR export (required): <input type="file" name="wxr" required></label><br>
    <label>SQL dump (optional): <input type="file" name="sql"></label><br>
    <label>Theme: <select name="theme" id="theme"></select></label><br>
    <button type="submit">Start migration</button>
  </form>
  <pre id="status"></pre>
  <script type="module">
    const themeSelect = document.getElementById('theme')
    const status = document.getElementById('status')
    const res = await fetch('/api/themes')
    const { themes } = await res.json()
    themeSelect.innerHTML = themes.map(t => \`<option value="\${t.id}">\${t.name}</option>\`).join('')

    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const r = await fetch('/api/jobs', { method: 'POST', body: fd })
      const { job } = await r.json()
      status.textContent = 'job ' + job.id + ': ' + job.status
      const poll = setInterval(async () => {
        const jr = await fetch('/api/jobs/' + job.id)
        const { job: j } = await jr.json()
        status.textContent = 'job ' + j.id + ': ' + j.status + (j.deployUrl ? ('\\nURL: ' + j.deployUrl) : '') + (j.error ? ('\\nerror: ' + j.error) : '')
        if (j.status === 'done' || j.status === 'failed') clearInterval(poll)
      }, 1500)
    })
  </script>
</body>
</html>`
