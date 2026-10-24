import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { migrateSite } from '../services/migrate.js'

const fixture = fileURLToPath(new URL('../__fixtures__/offline-export.xml', import.meta.url))
let root: string
const originalCwd = process.cwd()
beforeEach(async () => {
  const scratch = resolve(originalCwd, '../../.tmp')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'security24-scratch-'))
})
afterEach(async () => {
  process.chdir(originalCwd)
  await rm(root, { recursive: true, force: true })
})

// Call the actual shared service, not a filesystem mock. A final empty listing
// alone misses create/delete mutations hidden by migration's finally cleanup.
describe.each(['scaffold', 'astrowind'])('#24 %s scratch containment', theme => {
  it.each(['symlink', 'case-alias', 'case-symlink', 'case-ancestor', 'nfc-ancestor'])('rejects %s before any scratch/output mutation', async kind => {
    const work = join(root, 'work')
    const outside = join(root, 'outside')
    await mkdir(work)
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'unchanged')
    let cwd = work
    if (kind === 'symlink') await symlink(outside, join(work, '.tmp'))
    if (kind === 'case-alias') await mkdir(join(work, '.TMP'))
    if (kind === 'case-symlink') await symlink(outside, join(work, '.TMP'))
    if (kind === 'case-ancestor') {
      cwd = join(root, 'workspace')
      await mkdir(cwd)
      await mkdir(join(root, 'Workspace'))
    }
    if (kind === 'nfc-ancestor') {
      cwd = join(root, 'cafe\u0301')
      await mkdir(cwd)
      await mkdir(join(root, 'caf\u00e9'))
    }
    const outsideEvents: string[] = []
    const cwdEvents: string[] = []
    const outsideWatcher = watch(outside, (event, name) => outsideEvents.push(`${event}:${name}`))
    const cwdWatcher = watch(cwd, (event, name) => cwdEvents.push(`${event}:${name}`))
    try {
      process.chdir(cwd)
      // Keep output independent of cwd, so output validation cannot mask the
      // scratch preflight defect in case/NFC ancestor scenarios.
      await expect(migrateSite({ input: fixture, output: join(root, 'output'), theme })).rejects.toMatchObject({ code: 'MIGRATION_FAILED' })
      await setTimeout(30) // let real fs.watch create/delete events drain
      expect(outsideEvents).toEqual([])
      expect(cwdEvents).toEqual([])
      expect(await readdir(outside)).toEqual(['keep'])
      expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('unchanged')
      expect(await readdir(root)).not.toContain('output')
    } finally {
      outsideWatcher.close()
      cwdWatcher.close()
      process.chdir(originalCwd)
    }
  })

  it.each([false, true])('migrates with a safe scratch root (pre-existing=%s) and cleans intermediates', async existing => {
    const cwd = join(root, 'work')
    await mkdir(cwd)
    if (existing) await mkdir(join(cwd, '.tmp'))
    process.chdir(cwd)
    const output = join(root, 'output')
    const result = await migrateSite({ input: fixture, output, theme })
    expect(result).toMatchObject({ outputDir: output, posts: 2, pages: 1 })
    expect(await readdir(join(cwd, '.tmp'))).toEqual([])
    const article = theme === 'scaffold'
      ? 'src/content/articles/first-post/index.mdoc'
      : 'src/data/post/first-post/index.md'
    expect(await readFile(join(output, article), 'utf8')).toContain('First body marker alpha.')
  }, 30_000) // real bundled-template copy/config/git work, including coverage instrumentation
})

it('the real filesystem watcher observes scratch create/delete events', async () => {
  const events: string[] = []
  const watcher = watch(root, (event, name) => events.push(`${event}:${name}`))
  try {
    const scratch = await mkdtemp(join(root, 'watch-control-'))
    await rm(scratch, { recursive: true })
    await setTimeout(30)
    expect(events.some(event => event.includes('watch-control-'))).toBe(true)
  } finally { watcher.close() }
})
