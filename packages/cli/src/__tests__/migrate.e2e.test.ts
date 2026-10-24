import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir, mkdir } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import { runMigrate } from '../commands/migrate.js'

const fixture = fileURLToPath(new URL('../__fixtures__/offline-export.xml', import.meta.url))

describe('runMigrate offline WXR conversion (not a build or deployment)', () => {
  let outputDir: string
  afterEach(async () => { if (outputDir) await rm(dirname(outputDir), { recursive: true, force: true }) })
  it('preserves each published body, author, page and exact redirect mapping', async () => {
    const tempRoot = resolve('../../.tmp')
    await mkdir(tempRoot, { recursive: true })
    outputDir = join(await mkdtemp(join(tempRoot, 'fixture-unit-')), 'site')
    await runMigrate({ input: fixture, output: outputDir, theme: 'scaffold' })
    const articles = join(outputDir, 'src/content/articles')
    // Drafts may remain editable source, but never become public articles/routes.
    expect((await readdir(articles)).filter(s => s !== '_drafts').sort()).toEqual(['first-post', 'second-post'])
    for (const [slug, title, marker] of [
      ['first-post', 'First fixture post', 'First body marker alpha.'],
      ['second-post', 'Second fixture post', 'Second body marker beta.'],
    ]) {
      const { data, content } = matter(await readFile(join(articles, slug, 'index.mdoc'), 'utf8'))
      expect(data.title).toBe(title)
      expect(data.author).toBe('fixture-author') // exact WXR dc:creator, not a title fallback
      expect(content.trim().length).toBeGreaterThan(0)
      expect(content).toContain(marker)
    }
    const page = matter(await readFile(join(outputDir, 'src/content/pages/about/index.mdoc'), 'utf8'))
    expect(page.data.title).toBe('About fixture page')
    expect(page.content.trim()).toContain('Page body marker gamma.')
    const redirects = JSON.parse(await readFile(join(outputDir, 'redirects.json'), 'utf8'))
    expect(redirects).toEqual({
      '/2024/01/first-post/': '/blog/first-post/', '/?p=101': '/blog/first-post/',
      '/2024/01/second-post/': '/blog/second-post/', '/?p=102': '/blog/second-post/',
      '/2024/01/about/': '/about/', '/?p=103': '/about/',
    })
  })
})
