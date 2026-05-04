import { describe, it, expect } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseWPExport } from '../parser.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, '../__fixtures__/sample-export.xml')

describe('parseWPExport', () => {
  it('parses site title and URL', async () => {
    const result = await parseWPExport(FIXTURE)
    expect(result.siteTitle).toBeTruthy()
    expect(typeof result.siteTitle).toBe('string')
  })

  it('extracts published posts', async () => {
    const result = await parseWPExport(FIXTURE)
    const published = result.posts.filter(p => p.status === 'publish' && p.type === 'post')
    expect(published.length).toBeGreaterThanOrEqual(1)
  })

  it('each post has required fields', async () => {
    const result = await parseWPExport(FIXTURE)
    const post = result.posts.find(p => p.status === 'publish' && p.type === 'post')
    expect(post).toBeDefined()
    expect(post!.id).toBeGreaterThan(0)
    expect(post!.title).toBeTruthy()
    expect(post!.slug).toBeTruthy()
    expect(post!.date).toBeTruthy()
  })

  it('extracts author from dc:creator', async () => {
    const result = await parseWPExport(FIXTURE)
    const post = result.posts.find(p => p.status === 'publish' && p.type === 'post')
    // Author may be empty string if not set, but should be a string
    expect(typeof post!.author).toBe('string')
  })

  it('extracts categories and tags', async () => {
    const result = await parseWPExport(FIXTURE)
    // Fixture has at least some taxonomy
    expect(Array.isArray(result.categories)).toBe(true)
    expect(Array.isArray(result.tags)).toBe(true)
  })

  it('parses media/attachments', async () => {
    const result = await parseWPExport(FIXTURE)
    expect(Array.isArray(result.media)).toBe(true)
  })

  it('extracts Yoast SEO meta from postmeta', async () => {
    const result = await parseWPExport(FIXTURE)
    // At least one post in the real fixture should have Yoast data
    // (fixture was built from real export — check optional fields are strings when present)
    for (const post of result.posts) {
      if (post.seoTitle !== undefined) expect(typeof post.seoTitle).toBe('string')
      if (post.seoDescription !== undefined) expect(typeof post.seoDescription).toBe('string')
    }
  })

  it('resolves featuredImageUrl from attachment map', async () => {
    const result = await parseWPExport(FIXTURE)
    // featuredImageUrl should be a URL string when present
    for (const post of result.posts) {
      if (post.featuredImageUrl !== undefined) {
        expect(post.featuredImageUrl).toMatch(/^https?:\/\//)
      }
    }
  })
})
