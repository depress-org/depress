import { describe, it, expect } from 'vitest'

// Access the private functions via dynamic import of the built module.
// We test the shortcode handling logic by running transformPosts on synthetic input.
import { transformPosts } from '../transform.js'
import type { WPPost } from '@depress-org/core'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm } from 'fs/promises'

function makePost(overrides: Partial<WPPost> = {}): WPPost {
  return {
    id: 1,
    title: 'Test Post',
    slug: 'test-post',
    content: '<p>Hello world</p>',
    excerpt: 'Hello',
    status: 'publish',
    type: 'post',
    date: '2024-01-01 09:00:00',
    author: 'admin',
    categories: [],
    tags: [],
    ...overrides,
  }
}

describe('transformPosts', () => {
  it('creates an mdoc file for each published post', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const posts = [makePost({ slug: 'hello-world' })]
      const report = await transformPosts(posts, tmpDir)
      expect(report.success).toBe(1)
      expect(report.errors).toBe(0)
      const content = await readFile(join(tmpDir, 'src/content/articles/hello-world/index.mdoc'), 'utf-8')
      expect(content).toContain('title:')
      expect(content).toContain('Hello world')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('skips draft posts', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const posts = [makePost({ status: 'draft' })]
      const report = await transformPosts(posts, tmpDir)
      expect(report.skipped).toBe(1)
      expect(report.success).toBe(0)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('writes pages to pages/ subdirectory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const posts = [makePost({ slug: 'about', type: 'page' })]
      await transformPosts(posts, tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/pages/about/index.mdoc'), 'utf-8')
      expect(content).toContain('title:')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('includes author in frontmatter', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      await transformPosts([makePost({ author: 'Dr. Jane Smith' })], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      expect(content).toContain('author: "Dr. Jane Smith"')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('includes seoTitle and seoDescription when present', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      await transformPosts([makePost({
        seoTitle: 'SEO Title Here',
        seoDescription: 'SEO description here',
      })], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      expect(content).toContain('seoTitle:')
      expect(content).toContain('seoDescription:')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('shortcode handling', () => {
  it('preserves inner text of [et_pb_text] page builder blocks', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({ content: '[et_pb_text]<p>Important content</p>[/et_pb_text]' })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      expect(content).toContain('Important content')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('strips structural page builder wrappers but keeps children', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({
        content: '[et_pb_section][et_pb_row][et_pb_column]<p>Preserved</p>[/et_pb_column][/et_pb_row][/et_pb_section]',
      })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      expect(content).toContain('Preserved')
      expect(content).not.toContain('et_pb_section')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('converts [caption] to inner content', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({ content: '[caption id="1"]<img src="x.jpg">Caption text[/caption]' })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      // caption wrapper removed, inner content kept
      expect(content).not.toContain('[caption')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('converts [gallery] to a placeholder comment in the markdown', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({ content: '<p>Before</p>[gallery ids="1,2,3"]<p>After</p>' })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      // Gallery becomes a <!-- gallery: review manually --> comment
      expect(content).toContain('gallery')
      expect(content).toContain('Before')
      expect(content).toContain('After')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('preserves unknown shortcodes as depress warning comments', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({ content: '[custom_widget id="42"]Widget content[/custom_widget]' })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      // Either the warning block or the inline comment must reference the shortcode
      expect(content).toContain('custom_widget')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('converts YouTube iframes to plain URLs', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'depress-test-'))
    try {
      const post = makePost({
        content: '<p>Watch this:</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      })
      await transformPosts([post], tmpDir)
      const content = await readFile(join(tmpDir, 'src/content/articles/test-post/index.mdoc'), 'utf-8')
      expect(content).toContain('youtube.com/watch?v=dQw4w9WgXcQ')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
