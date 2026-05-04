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

      const { content: cleaned, warnings, shortcodeMarkers } = handleShortcodes(post.content)
      const markdown = applyShortcodeMarkers(turndown.turndown(cleaned), shortcodeMarkers)
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

interface HandleShortcodesResult {
  content: string
  warnings: string[]
  shortcodeMarkers: Array<{ marker: string; tag: string; inner: string }>
}

function handleShortcodes(html: string): HandleShortcodesResult {
  if (!html) return { content: '', warnings: [], shortcodeMarkers: [] }
  const warnings: string[] = []

  let out = html

  // Known recoverable: caption → keep inner content
  out = out.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, '$1')

  // Gallery → alphanumeric marker (replaced with HTML comment after Turndown runs)
  out = out.replace(/\[gallery[^\]]*\]/gi, 'DEPRESSGALLERY0')

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

  // Remaining unknown paired shortcodes: collect for post-Turndown replacement
  const shortcodeMarkers: Array<{ marker: string; tag: string; inner: string }> = []
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\]([\s\S]*?)\[\/\1\]/gi, (_m, tag, inner) => {
    warnings.push(`shortcode:[${tag}]`)
    const marker = `DEPRESSSHORTCODE${shortcodeMarkers.length}M`
    shortcodeMarkers.push({ marker, tag, inner: inner.trim() })
    return marker
  })

  // Remaining unknown self-closing shortcodes
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\/?\]/gi, (_m, tag) => {
    warnings.push(`shortcode:[${tag}]`)
    const marker = `DEPRESSSHORTCODE${shortcodeMarkers.length}M`
    shortcodeMarkers.push({ marker, tag, inner: '' })
    return marker
  })

  return { content: out, warnings, shortcodeMarkers }
}

function applyShortcodeMarkers(
  markdown: string,
  shortcodeMarkers: Array<{ marker: string; tag: string; inner: string }>,
): string {
  let out = markdown.replace(/DEPRESSGALLERY0/g, '<!-- gallery: review manually -->')
  for (const { marker, tag, inner } of shortcodeMarkers) {
    const replacement = inner
      ? `<!-- shortcode:[${tag}] -->\n\n${inner}\n\n<!-- /shortcode:[${tag}] -->`
      : `<!-- shortcode:[${tag}] -->`
    out = out.replaceAll(marker, replacement)
  }
  return out
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
