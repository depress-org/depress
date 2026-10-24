import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createApp } from '../app.js'
import { InMemoryJobStore, runJob } from '@depress-org/job-core'
vi.mock('@depress-org/job-core', async original => ({ ...await original<typeof import('@depress-org/job-core')>(), runJob: vi.fn() }))
const fixture = (file: string) => readFile(resolve('../../fixtures/media-archive', file))
const roots: string[] = []
afterEach(async () => { vi.resetAllMocks(); for (const r of roots) await rm(r, { recursive: true, force: true }) })
async function setup() {
  await mkdir(resolve('.tmp'), { recursive: true }); const root = await mkdtemp(resolve('.tmp/web-media-')); roots.push(root)
  const store = new InMemoryJobStore()
  const app = createApp({ uploadRoot: root, store, identities: [{ ownerId: 'alice', token: 'a'.repeat(32) }] })
  const form = new FormData(); form.set('wxr', new File([await fixture('export.xml')], 'export.xml')); form.set('theme', 'scaffold')
  const post = () => app.request('/api/jobs', { method: 'POST', body: form, headers: { Authorization: `Bearer ${'a'.repeat(32)}` } })
  return { root, store, app, form, post }
}
it('web passes shared validated media root and SQL to the exact owner runner, then cleans', async () => {
  const { root, form, post } = await setup()
  form.set('media', new File([await fixture('uploads.zip')], '../../evil.zip'))
  form.set('sql', new File([await fixture('database.sql')], 'dump.sql'))
  let input: any
  vi.mocked(runJob).mockImplementation(async (scope, id) => {
    input = (await scope.get(id))!.input
    expect(scope.ownerId).toBe('alice')
    expect(await readFile(join(input.mediaDir!, 'wp-content/uploads/2026/10/photo.png'))).toEqual(await fixture('photo.png'))
    return scope.update(id, { status: 'done' })
  })
  expect((await post()).status).toBe(202)
  await vi.waitFor(() => expect(input?.mediaDir).toBeTruthy())
  await vi.waitFor(async () => expect(await readdir(root)).toEqual([]))
})
it.each(['truncated', 'wrong-role', 'empty'])('web rejects %s media with no queued job and cleans', async kind => {
  const { root, form, post, store } = await setup()
  const bytes = kind === 'truncated' ? (await fixture('uploads.zip')).subarray(0, 60) : kind === 'empty' ? Buffer.alloc(0) : await fixture('database.sql')
  form.set('media', new File([bytes], 'uploads.zip'))
  expect((await post()).status).toBe(400)
  expect(await store.forOwner('alice').list()).toEqual([])
  expect(runJob).not.toHaveBeenCalled()
  expect(await readdir(root)).toEqual([])
})
it.each(['wxr', 'sql'])('web never treats a ZIP as %s', async field => {
  const { form, post, store } = await setup()
  form.set(field, new File([await fixture('uploads.zip')], field + '.xml'))
  expect((await post()).status).toBe(400)
  expect(await store.forOwner('alice').list()).toEqual([])
})
it('web optional media skip is omission, not an empty success', async () => {
  const { form, post } = await setup()
  vi.mocked(runJob).mockImplementation(async (scope, id) => { expect((await scope.get(id))!.input.mediaDir).toBeUndefined(); return scope.update(id, { status: 'done' }) })
  expect(form.has('media')).toBe(false); expect((await post()).status).toBe(202)
})
