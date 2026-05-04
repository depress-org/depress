import type { WPExport, WPPost, WPCategory, WPTag } from '@depress-org/core'
import { XMLParser } from 'fast-xml-parser'
import { readFile } from 'fs/promises'

/**
 * Parse WordPress XML export file into structured data
 */
export async function parseWPExport(xmlPath: string): Promise<WPExport> {
  const xml = await readFile(xmlPath, 'utf-8')
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    textNodeName: '#text',
    isArray: (name) => ['item', 'category', 'tag', 'wp:postmeta'].includes(name),
  })

  const result = parser.parse(xml)
  const channel = result?.rss?.channel

  if (!channel) {
    throw new Error('Invalid WordPress export XML: missing channel element')
  }

  const siteTitle = channel.title ?? 'Untitled'
  const siteUrl = channel.link ?? ''
  const items: any[] = channel.item ?? []

  const posts: WPPost[] = []
  const categoriesMap = new Map<string, WPCategory>()
  const tagsMap = new Map<string, WPTag>()
  const media: any[] = []
  // Map attachment id → url for resolving featured images
  const attachmentUrlById = new Map<number, string>()

  // First pass: collect all attachments
  for (const item of items) {
    if (item['wp:post_type'] === 'attachment') {
      const id = Number(item['wp:post_id'])
      const url = item['wp:attachment_url'] ?? item.guid?.['#text'] ?? item.guid ?? ''
      if (id && url) attachmentUrlById.set(id, url)
    }
  }

  for (const item of items) {
    const postType = item['wp:post_type']

    if (postType === 'attachment') {
      const postmeta: any[] = Array.isArray(item['wp:postmeta']) ? item['wp:postmeta'] : []
      const altText =
        postmeta.find((m: any) => m['wp:meta_key'] === '_wp_attachment_image_alt')?.['wp:meta_value'] ??
        item.title ??
        ''
      media.push({
        id: Number(item['wp:post_id']),
        url: item['wp:attachment_url'] ?? item.guid?.['#text'] ?? item.guid ?? '',
        filename: item['wp:post_name'] ?? '',
        mimeType: '',
        altText: String(altText),
      })
      continue
    }

    if (postType !== 'post' && postType !== 'page') continue

    // Extract categories and tags from item
    const itemCategories: string[] = []
    const itemTags: string[] = []

    const cats = Array.isArray(item.category) ? item.category : item.category ? [item.category] : []
    for (const cat of cats) {
      const domain = cat._domain
      const rawSlug = cat._nicename
      const slug = decodeSlug(rawSlug)
      const name = cat['#text'] ?? slug

      if (domain === 'category') {
        itemCategories.push(slug)
        if (!categoriesMap.has(slug)) {
          categoriesMap.set(slug, { id: categoriesMap.size, name, slug, description: '' })
        }
      } else if (domain === 'post_tag') {
        itemTags.push(slug)
        if (!tagsMap.has(slug)) {
          tagsMap.set(slug, { id: tagsMap.size, name, slug })
        }
      }
    }

    // Extract postmeta: _thumbnail_id, Yoast SEO, ACF fields
    const postmeta: any[] = Array.isArray(item['wp:postmeta']) ? item['wp:postmeta'] : []
    let featuredImageId: string | undefined
    let seoTitle = ''
    let seoDescription = ''
    const customFields: Record<string, string> = {}

    for (const meta of postmeta) {
      const key = String(meta['wp:meta_key'] ?? '')
      const val = String(meta['wp:meta_value'] ?? '')
      if (key === '_thumbnail_id') {
        featuredImageId = val
      } else if (key === '_yoast_wpseo_title') {
        seoTitle = val
      } else if (key === '_yoast_wpseo_metadesc') {
        seoDescription = val
      } else if (key && !key.startsWith('_')) {
        // Public custom fields (ACF etc.)
        customFields[key] = val
      }
    }

    const featuredImageUrl = featuredImageId
      ? attachmentUrlById.get(Number(featuredImageId))
      : undefined

    posts.push({
      id: Number(item['wp:post_id']),
      title: item.title ?? 'Untitled',
      slug: decodeSlug(item['wp:post_name'] ?? String(item['wp:post_id'])),
      content: item['content:encoded'] ?? '',
      excerpt: item['excerpt:encoded'] ?? '',
      status: item['wp:status'] ?? 'draft',
      type: postType,
      date: item['wp:post_date'] ?? new Date().toISOString(),
      author: item['dc:creator'] ?? '',
      categories: itemCategories,
      tags: itemTags,
      featuredImageId,
      featuredImageUrl,
      seoTitle: seoTitle || undefined,
      seoDescription: seoDescription || undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    })
  }

  return {
    siteTitle,
    siteUrl,
    posts,
    categories: Array.from(categoriesMap.values()),
    tags: Array.from(tagsMap.values()),
    media,
  }
}

function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}
