import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { resolveInput, writeTaxonomy, resolveWp2mdBin } from '../commands/migrate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('resolveInput', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop()!
      await fn()
    }
  })

  it('returns the resolved path when input is given explicitly', async () => {
    const result = await resolveInput('some/export.xml')
    expect(result).toBe(join(process.cwd(), 'some/export.xml'))
  })

  it('finds export.xml in the current directory when no input is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'depress-resolve-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, 'export.xml'), '<rss></rss>', 'utf-8')

    const cwd = process.cwd()
    process.chdir(dir)
    try {
      const result = await resolveInput(undefined)
      expect(result).toBe(join(dir, 'export.xml'))
    } finally {
      process.chdir(cwd)
    }
  })

  it('returns null when nothing is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'depress-resolve-empty-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      const result = await resolveInput(undefined)
      expect(result).toBeNull()
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('writeTaxonomy', () => {
  it('writes one yaml file per category and tag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'depress-taxonomy-'))
    try {
      await writeTaxonomy(
        [{ slug: 'news', name: 'News', description: 'Latest news' }],
        [{ slug: 'jung', name: 'Jung' }],
        dir,
      )
      const cat = await readFile(join(dir, 'src', 'content', 'categories', 'news.yaml'), 'utf-8')
      expect(cat).toContain('name: "News"')
      expect(cat).toContain('description: "Latest news"')

      const tag = await readFile(join(dir, 'src', 'content', 'tags', 'jung.yaml'), 'utf-8')
      expect(tag).toContain('name: "Jung"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles empty categories and tags without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'depress-taxonomy-empty-'))
    try {
      await expect(writeTaxonomy([], [], dir)).resolves.toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveWp2mdBin (via migrate.ts)', () => {
  it('resolves without throwing in the monorepo dev environment', () => {
    expect(() => resolveWp2mdBin()).not.toThrow()
  })
})
