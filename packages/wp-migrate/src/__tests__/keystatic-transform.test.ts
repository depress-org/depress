import { describe, it, expect } from 'vitest'
import { transformWp2mdOutput } from '../keystatic-transform.js'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Regression test for t_f247d67a: scaffold-theme migrate path never threaded
// WPPost.author into buildArticleFrontmatter, so `depress migrate --theme scaffold`
// produced articles with no `author:` frontmatter key even though parser.ts
// correctly extracts dc:creator into WPPost.author.

async function makeWp2mdFixture(root: string, slug: string) {
  const postDir = join(root, 'posts', slug)
  await mkdir(postDir, { recursive: true })
  await writeFile(
    join(postDir, 'index.md'),
    [
      '---',
      'title: "Test Post"',
      'date: "2024-01-01"',
      '---',
      '',
      'Hello world, this is the post body used to derive an excerpt.',
      '',
    ].join('\n'),
    'utf-8',
  )
}

describe('transformWp2mdOutput author threading', () => {
  it('writes author frontmatter when authorsBySlug is supplied', async () => {
    const wp2mdDir = await mkdtemp(join(tmpdir(), 'depress-wp2md-'))
    const outputDir = await mkdtemp(join(tmpdir(), 'depress-out-'))
    try {
      await makeWp2mdFixture(wp2mdDir, 'hello-world')

      await transformWp2mdOutput({
        wp2mdDir,
        outputDir,
        authorsBySlug: new Map([['hello-world', 'Jane Smith']]),
      })

      const content = await readFile(
        join(outputDir, 'src/content/articles/hello-world/index.mdoc'),
        'utf-8',
      )
      expect(content).toContain('author: Jane Smith')
    } finally {
      await rm(wp2mdDir, { recursive: true, force: true })
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('omits author frontmatter when no author is known for the slug', async () => {
    const wp2mdDir = await mkdtemp(join(tmpdir(), 'depress-wp2md-'))
    const outputDir = await mkdtemp(join(tmpdir(), 'depress-out-'))
    try {
      await makeWp2mdFixture(wp2mdDir, 'no-author-post')

      await transformWp2mdOutput({ wp2mdDir, outputDir })

      const content = await readFile(
        join(outputDir, 'src/content/articles/no-author-post/index.mdoc'),
        'utf-8',
      )
      expect(content).not.toContain('author:')
    } finally {
      await rm(wp2mdDir, { recursive: true, force: true })
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})
