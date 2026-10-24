import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runMigrate } from '../commands/migrate.js'

// Intentionally synthetic local test fixture, not user/market evidence. No media/network.
export const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Fixture</title><link>https://fixture.invalid</link><wp:wxr_version>1.2</wp:wxr_version><item><title>Hello</title><link>https://fixture.invalid/hello/</link><pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate><dc:creator>fixture-author</dc:creator><content:encoded><![CDATA[<p>Local fixture body.</p>]]></content:encoded><wp:post_id>1</wp:post_id><wp:post_date>2024-01-01 12:00:00</wp:post_date><wp:post_name>hello</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type></item></channel></rss>`
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
  it('detects upstream converter errors even when the child exits zero', async () => {
    await writeFile(input, xml.replace(/<pubDate>.*?<\/pubDate>/, ''))
    await expect(
      runMigrate({ input, output: join(root, 'out'), theme: 'scaffold' }),
    ).rejects.toThrow()
  })
  it('runs actual wp2md and scaffold concurrently with isolated content/output', async () => {
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
