import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkRedirects,
  checkAuthors,
  checkSeoMeta,
  checkMigrationReport,
  checkKeystaticContent,
} from '../commands/check.js'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'depress-check-'))
}

describe('checkRedirects', () => {
  it('fails when redirects.json is missing', async () => {
    const dir = await makeTempDir()
    try {
      const result = await checkRedirects(dir)
      expect(result.passed).toBe(false)
      expect(result.detail).toMatch(/not found/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails when redirects.json is empty', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'redirects.json'), '{}')
      const result = await checkRedirects(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes when redirects.json has entries covering published posts', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(
        join(dir, 'redirects.json'),
        JSON.stringify({ '/2020/01/hello/': '/blog/hello/', '/?p=1': '/blog/hello/' }),
      )
      const result = await checkRedirects(dir, 1)
      expect(result.passed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails when entry count is below published post count', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'redirects.json'), JSON.stringify({ '/a/': '/blog/a/' }))
      const result = await checkRedirects(dir, 3)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

async function writeArticle(dir: string, slug: string, frontmatter: Record<string, unknown>) {
  const postDir = join(dir, 'src', 'content', 'articles', slug)
  await mkdir(postDir, { recursive: true })
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')
  await writeFile(join(postDir, 'index.md'), `---\n${fm}\n---\nBody content.`)
}

describe('checkAuthors', () => {
  it('fails when no content entries exist', async () => {
    const dir = await makeTempDir()
    try {
      const result = await checkAuthors(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails when a post is missing author', async () => {
    const dir = await makeTempDir()
    try {
      await writeArticle(dir, 'post-1', { title: 'Post 1', author: 'Jane' })
      await writeArticle(dir, 'post-2', { title: 'Post 2', author: '' })
      const result = await checkAuthors(dir)
      expect(result.passed).toBe(false)
      expect(result.detail).toMatch(/post-2/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes when every post has an author', async () => {
    const dir = await makeTempDir()
    try {
      await writeArticle(dir, 'post-1', { title: 'Post 1', author: 'Jane' })
      const result = await checkAuthors(dir)
      expect(result.passed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('checkSeoMeta', () => {
  it('fails when a post has a blank seoDescription field present in frontmatter', async () => {
    const dir = await makeTempDir()
    try {
      await writeArticle(dir, 'post-1', { title: 'Post 1', author: 'Jane', seoDescription: '' })
      const result = await checkSeoMeta(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes when seoDescription is populated', async () => {
    const dir = await makeTempDir()
    try {
      await writeArticle(dir, 'post-1', { title: 'Post 1', author: 'Jane', seoDescription: 'A description' })
      const result = await checkSeoMeta(dir)
      expect(result.passed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('checkMigrationReport', () => {
  it('fails when migration-report.md is missing', async () => {
    const dir = await makeTempDir()
    try {
      const result = await checkMigrationReport(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails when the report records silent drops', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'migration-report.md'), '# Report\n\n3 silent drops detected.')
      const result = await checkMigrationReport(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes when the report shows 0 silent drops', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'migration-report.md'), '# Report\n\n0 silent drops.')
      const result = await checkMigrationReport(dir)
      expect(result.passed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('checkKeystaticContent', () => {
  it('fails when keystatic.config.ts is missing', async () => {
    const dir = await makeTempDir()
    try {
      const result = await checkKeystaticContent(dir)
      expect(result.passed).toBe(false)
      expect(result.detail).toMatch(/keystatic.config.ts/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails when content collection is empty', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'keystatic.config.ts'), 'export default {}')
      const result = await checkKeystaticContent(dir)
      expect(result.passed).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes with config + valid entries', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, 'keystatic.config.ts'), 'export default {}')
      await writeArticle(dir, 'post-1', { title: 'Post 1', author: 'Jane' })
      const result = await checkKeystaticContent(dir)
      expect(result.passed).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
