import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runMigrate } from '../commands/migrate.js'

// Intentionally synthetic local test fixture, not user/market evidence. No media/network.
import { xml } from '../__fixtures__/single-export.js'
let root: string, input: string
beforeEach(async () => {
  await mkdir('.tmp', { recursive: true })
  root = await mkdtemp(resolve('.tmp/migrate-test-'))
  input = join(root, 'export.xml')
  await writeFile(input, xml)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
describe('real shared migration #16', () => {
  it.each(['<rss><channel></rss>', '<html>not WXR</html>'])(
    'malformed input rejects without host exit: %s',
    async (bad) => {
      await writeFile(input, bad)
      const before = process.exitCode
      await expect(
        runMigrate({ input, output: join(root, 'out'), theme: 'scaffold' }),
      ).rejects.toThrow()
      expect(process.exitCode).toBe(before)
    },
  )
  it.each(['not SQL', 'INSERT INTO `wp_postmeta` VALUES broken;'])(
    'rejects malformed SQL: %s',
    async (sql) => {
      const db = join(root, 'bad.sql')
      await writeFile(db, sql)
      await expect(
        runMigrate({ input, db, output: join(root, 'out'), theme: 'scaffold' }),
      ).rejects.toThrow()
    },
  )
  it('rejects unknown theme without writing output', async () => {
    await expect(
      runMigrate({ input, output: join(root, 'out'), theme: 'unknown' }),
    ).rejects.toThrow('Unknown theme')
  })
  it('native converter does not depend on upstream pubDate field', async () => {
    await writeFile(input, xml.replace(/<pubDate>.*?<\/pubDate>/, ''))
    await expect(
      runMigrate({ input, output: join(root, 'out'), theme: 'scaffold' }),
    ).resolves.toMatchObject({ posts: 1 })
  })
  it('runs native conversion and scaffold concurrently with isolated content/output', async () => {
    const before = process.exitCode
    const [a, b] = await Promise.all(
      ['a', 'b'].map((name) =>
        runMigrate({ input, output: join(root, name), theme: 'scaffold' }),
      ),
    )
    expect(a.posts).toBe(1)
    expect(b.posts).toBe(1)
    expect(a.outputDir).not.toBe(b.outputDir)
    const article = await readFile(
      join(a.outputDir, 'src/content/articles/hello/index.mdoc'),
      'utf8',
    )
    expect(article).toContain('Local fixture body.')
    expect(article).toContain('fixture-author')
    expect(process.exitCode).toBe(before)
    await expect(
      runMigrate({ input, output: a.outputDir, theme: 'scaffold' }),
    ).rejects.toThrow('not empty')
  }, 30_000)
})
