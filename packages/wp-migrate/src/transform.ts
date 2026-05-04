import type { WPPost, MigrationReport } from '@depress-org/core'
import TurndownService from 'turndown'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// Preserve iframe embeds rather than dropping them
turndown.addRule('iframe-video', {
  filter: 'iframe',
  replacement: (_content, node) => {
    const src = (node as Element).getAttribute('src') ?? ''
    if (!src) return ''
    if (src.includes('youtube.com') || src.includes('youtu.be')) {
      const id = src.match(/(?:embed\/|v=|youtu\.be\/)([A-Za-z0-9_-]+)/)?.[1]
      return id ? `\nhttps://www.youtube.com/watch?v=${id}\n` : `\n<!-- youtube: ${src} -->\n`
    }
    if (src.includes('vimeo.com')) {
      const id = src.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1]
      return id ? `\nhttps://vimeo.com/${id}\n` : `\n<!-- vimeo: ${src} -->\n`
    }
    return `\n<!-- iframe: ${src} -->\n`
  },
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

      const { content: cleaned, warnings } = handleShortcodes(post.content)
      const markdown = turndown.turndown(cleaned)
      const frontmatter = buildFrontmatter(post)
      const warnBlock = warnings.length > 0
        ? `\n<!-- depress-warnings: ${warnings.join(' | ')} -->\n`
        : ''
      const fileContent = `---\n${frontmatter}\n---\n${warnBlock}\n${markdown}`

      const dir = join(outputDir, 'src', 'content', post.type === 'page' ? 'pages' : 'articles', post.slug)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'index.mdoc'), fileContent, 'utf-8')

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

function handleShortcodes(html: string): { content: string; warnings: string[] } {
  if (!html) return { content: '', warnings: [] }
  const warnings: string[] = []

  let out = html

  // Known recoverable: caption → keep inner content
  out = out.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, '$1')

  // Gallery → placeholder comment
  out = out.replace(/\[gallery[^\]]*\]/gi, '<!-- gallery: review manually -->')

  // Embed → unwrap, keep the URL
  out = out.replace(/\[embed\]([\s\S]*?)\[\/embed\]/gi, '$1')

  // Page builder text blocks: extract inner HTML content
  out = out.replace(
    /\[(et_pb_text|vc_column_text|fusion_text|text_block)[^\]]*\]([\s\S]*?)\[\/\1\]/gi,
    '$2',
  )

  // Page builder structural wrappers: strip the tag, keep children
  out = out.replace(
    /\[(et_pb_[a-z_]+|vc_[a-z_]+|fusion_[a-z_]+|mk_[a-z_]+)[^\]]*\]([\s\S]*?)\[\/\1\]/gi,
    '$2',
  )
  out = out.replace(/\[(et_pb_[a-z_]+|vc_[a-z_]+|fusion_[a-z_]+|mk_[a-z_]+)[^\]]*\/?\]/gi, '')

  // Remaining unknown paired shortcodes: preserve inner content as comment
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\]([\s\S]*?)\[\/\1\]/gi, (_m, tag, inner) => {
    warnings.push(`shortcode:[${tag}]`)
    return `<!-- shortcode-start:[${tag}] -->\n${inner}\n<!-- shortcode-end:[${tag}] -->`
  })

  // Remaining unknown self-closing shortcodes
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\/?\]/gi, (_m, tag) => {
    warnings.push(`shortcode:[${tag}]`)
    return `<!-- shortcode:[${tag}] -->`
  })

  return { content: out, warnings }
}

function buildFrontmatter(post: WPPost): string {
  const fields: Record<string, unknown> = {
    title: post.title,
    publishedAt: post.date,
    slug: post.slug,
  }
  if (post.author) fields.author = post.author
  if (post.categories.length > 0) fields.category = post.categories[0]
  if (post.tags.length > 0) fields.tags = post.tags
  const rawExcerpt = (post.excerpt ?? '').replace(/<[^>]+>/g, '').trim()
  if (rawExcerpt) fields.excerpt = rawExcerpt
  if (post.seoTitle) fields.seoTitle = post.seoTitle
  if (post.seoDescription) fields.seoDescription = post.seoDescription
  if (post.featuredImageUrl) fields.featuredImageUrl = post.featuredImageUrl

  return Object.entries(fields)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`
      if (typeof value === 'string' && value.includes('\n')) return `${key}: |\n  ${value.split('\n').join('\n  ')}`
      if (typeof value === 'string') return `${key}: ${JSON.stringify(value)}`
      return `${key}: ${value}`
    })
    .join('\n')
}
