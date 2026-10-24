import type { WPPost, MigrationReport } from '@depress-org/core'
import TurndownService from 'turndown'
import { join } from 'path'
import { safeSegment, assertUniqueSegments, assertSafeTree, safeWriteFile } from './input-boundary.js'

/**
 * Transform WordPress posts to Markdoc files
 */
export async function transformPosts(
  posts: WPPost[],
  outputDir: string,
  mediaMapping = new Map<string, string>(),
  attachmentAlts = new Map<string, string>(),
): Promise<MigrationReport> {
  for (const type of ['post', 'page']) assertUniqueSegments(posts.filter(p => p.type === type).map(p => p.slug))
  await assertSafeTree(outputDir)
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  converter.remove(node => ['SCRIPT', 'STYLE', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'SVG', 'MATH'].includes(node.nodeName))
  converter.addRule('safe-links', { filter: 'a', replacement: (text, node) => {
    const href = (node as Element).getAttribute('href') ?? ''
    if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) || /[\s\x00-\x1f()<>\\]/.test(href)) return text
    return `[${text}](${href})`
  } })
  converter.addRule('safe-images', { filter: 'img', replacement: (_text, node) => {
    const src = (node as Element).getAttribute('src') ?? ''
    const dest = mediaMapping.get(src)
    const inline = (node as Element).getAttribute('alt') ?? ''
    const alt = inline.trim() ? inline : attachmentAlts.get(src) ?? ''
    // Keep ordinary source alt exact. Encode syntax-bearing delimiters rather
    // than creating nodes; unsupported lossy alts remain non-green in reports.
    const literal = alt.replace(/[\\`*_{}\[\]()!#<>\r\n]/g, char => `&#${char.charCodeAt(0)};`)
    return dest ? `![${literal}](${encodeURI(dest)})` : ''
  } })
  converter.addRule('iframe-video', { filter: 'iframe', replacement: (_text, node) => {
    const src = (node as Element).getAttribute('src') ?? ''
    const id = src.match(/^https:\/\/(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]+)/)?.[1]
    return id ? `\nhttps://www.youtube.com/watch?v=${id}\n` : ''
  } })
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
      // Recovered shortcode bodies are literal text, never a second Markdown input.
      const literalMarkers = shortcodeMarkers.map(marker => ({ ...marker, inner: marker.inner.replace(/[\\`*_{}\[\]()!#<>]/g, char => `&#${char.charCodeAt(0)};`) }))
      const markdown = applyShortcodeMarkers(converter.turndown(cleaned), literalMarkers).replace(/</g, '&lt;').replace(/\{/g, '&#123;')
      const frontmatter = buildFrontmatter(post, markdown)
      const warnBlock = warnings.length > 0
        ? `\n<!-- depress-warnings: ${warnings.join(' | ')} -->\n`
        : ''
      const fileContent = `---\n${frontmatter}\n---\n${warnBlock}\n${markdown}`

      const dir = join('src', 'content', post.type === 'page' ? 'pages' : 'articles', safeSegment(post.slug))
      await safeWriteFile(outputDir, join(dir, 'index.mdoc'), fileContent)

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

  // Shortcodes are text syntax, not image/link attribute syntax. Preserve tag
  // bytes through recovery; Turndown's parsed rules remain the safety boundary.
  const tags: string[] = []
  let prefix = 'DEPRESSHTMLTAG'
  while (html.includes(prefix)) prefix += 'X'
  let out = html.replace(/<!--[^]*?-->|<\/?[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g, tag => {
    const marker = `${prefix}${tags.length}M`
    tags.push(tag)
    return marker
  })

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

  const restore = (value: string) => value.replace(new RegExp(`${prefix}(\\d+)M`, 'g'), (marker, index) => tags[Number(index)] ?? marker)
  out = restore(out)
  for (const marker of shortcodeMarkers) marker.inner = restore(marker.inner)
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

function buildFrontmatter(post: WPPost, markdown: string): string {
  const fields: Record<string, unknown> = {
    title: post.title,
    publishedAt: post.date,
    slug: post.slug,
  }
  if (post.author) fields.author = post.author
  if (post.categories.length > 0) fields.category = post.categories[0]
  if (post.tags.length > 0) fields.tags = post.tags
  const rawExcerpt = (post.excerpt ?? '').replace(/<[^>]+>/g, '').trim()
  // Retain the existing generated-card excerpt when WXR has no explicit one.
  // This metadata never substitutes for visible body evidence in the report.
  const firstParagraph = markdown.split('\n').map(line => line.trim()).find(line => line && !/^(?:#|!|---|&lt;!--)/.test(line)) ?? ''
  fields.excerpt = rawExcerpt || firstParagraph.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1').slice(0, 220)
  if (post.seoTitle) fields.seoTitle = post.seoTitle
  if (post.seoDescription) fields.seoDescription = post.seoDescription
  if (post.featuredImageUrl && post.featuredImageUrl.startsWith('/media/')) fields.coverImage = post.featuredImageUrl

  return Object.entries(fields)
    .map(([key, value]) => {
      return `${key}: ${JSON.stringify(value)}`
    })
    .join('\n')
}
