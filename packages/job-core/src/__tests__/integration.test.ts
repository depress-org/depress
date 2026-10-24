import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runJob, cleanupJob } from '../pipeline.js'
import { InMemoryJobStore } from '../types.js'
const store = new InMemoryJobStore()
const roots: string[] = []
afterEach(async () => {
  for (const job of await store.list()) await cleanupJob(job)
  for (const root of roots) await rm(root, { recursive: true, force: true })
})
describe('real shared host isolation (no deploy/network)', () => {
  it('valid conversion succeeds alongside malformed XML/SQL jobs; host remains usable', async () => {
    await mkdir('.tmp', { recursive: true })
    const root = await mkdtemp(resolve('.tmp/job-integration-'))
    roots.push(root)
    const fixture = fileURLToPath(
      new URL('../../../../tests/fixtures/service-export.xml', import.meta.url),
    )
    const badXml = join(root, 'bad.xml'),
      badSql = join(root, 'bad.sql')
    await writeFile(badXml, '<rss><channel></rss>')
    await writeFile(badSql, 'this is not SQL')
    const jobs = await Promise.all([
      store.create({ wxrPath: fixture, themeId: 'scaffold' }),
      store.create({ wxrPath: badXml, themeId: 'scaffold' }),
      store.create({
        wxrPath: fixture,
        sqlDumpPath: badSql,
        themeId: 'scaffold',
      }),
    ])
    const before = process.exitCode
    const result = await Promise.all(jobs.map((job) => runJob(store, job.id)))
    expect(result.map((j) => j.status)).toEqual(['done', 'failed', 'failed'])
    expect(result.every((j) => !j.deployUrl)).toBe(true)
    expect(
      await readFile(
        join(result[0].outputDir!, 'src/content/articles/hello/index.mdoc'),
        'utf8',
      ),
    ).toContain('Local fixture body.')
    expect(process.exitCode).toBe(before)
    expect((await runJob(store, jobs[1].id)).status).toBe('failed')
  }, 30_000)
})
