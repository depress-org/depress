import type { WPPost, MigrationReport } from '@depress/core'
import TurndownService from 'turndown'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

/**
 * Transform WordPress posts to Markdoc files
 */
export async function transformPosts(
  posts: WPPost[],
  outputDir: string,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    total: posts.length,
    success: 0,
    errors: 0,
    skipped: 0,
    errorDetails: [],
  }

  for (const post of posts) {
    try {
      if (post.status !== 'publish') {
        report.skipped++
        continue
      }

      const markdown = htmlToMarkdown(post.content)
      const frontmatter = buildFrontmatter(post)
      const content = `---\n${frontmatter}\n---\n\n${markdown}`

      const dir = join(outputDir, 'src', 'content', post.type === 'page' ? 'pages' : 'articles', post.slug)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'index.mdoc'), content, 'utf-8')

      report.success++
    } catch (error) {
      report.errors++
      report.errorDetails.push({
        slug: post.slug,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return report
}

function htmlToMarkdown(html: string): string {
  if (!html) return ''
  // Handle WordPress shortcodes
  const cleaned = html
    .replace(/\[caption[^\]]*\](.*?)\[\/caption\]/gs, '$1')
    .replace(/\[gallery[^\]]*\]/g, '<!-- gallery -->')
    .replace(/\[[^\]]+\]/g, '') // Remove remaining shortcodes
  return turndown.turndown(cleaned)
}

function buildFrontmatter(post: WPPost): string {
  const fields: Record<string, unknown> = {
    title: post.title,
    publishedAt: post.date,
    slug: post.slug,
  }
  if (post.categories.length > 0) fields.category = post.categories[0]
  if (post.tags.length > 0) fields.tags = post.tags
  if (post.excerpt) fields.excerpt = post.excerpt.replace(/<[^>]+>/g, '').trim()

  return Object.entries(fields)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`
      if (typeof value === 'string' && value.includes('\n')) return `${key}: |\n  ${value.split('\n').join('\n  ')}`
      if (typeof value === 'string') return `${key}: ${JSON.stringify(value)}`
      return `${key}: ${value}`
    })
    .join('\n')
}
