import type { WPExport, WPPost, WPCategory, WPTag } from '@depress-org/core'
import { XMLParser } from 'fast-xml-parser'
import { readFile } from 'fs/promises'
import type { WPDBData } from './db-reader.js'

/**
 * Parse WordPress XML export file into structured data.
 * Pass `dbData` (from readWPDatabase) to augment with Yoast SEO,
 * featured images, and ACF custom fields from the SQL dump.
 */
export async function parseWPExport(xmlPath: string, dbData?: WPDBData): Promise<WPExport> {
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

  let siteTitle = channel.title ?? 'Untitled'
  let siteUrl = channel.link ?? ''
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

    let featuredImageUrl = featuredImageId
      ? attachmentUrlById.get(Number(featuredImageId))
      : undefined
    // Resolve relative attachment URLs against the site URL
    if (featuredImageUrl && featuredImageUrl.startsWith('/') && siteUrl) {
      try {
        const base = new URL(siteUrl)
        featuredImageUrl = `${base.origin}${featuredImageUrl}`
      } catch { /* leave as-is if siteUrl is malformed */ }
    }

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

  // Augment posts with DB data (Yoast SEO, ACF, featured image) when available
  if (dbData) {
    for (const post of posts) {
      const meta = dbData.postMeta.get(post.id)
      if (!meta) continue

      // Yoast SEO — DB takes priority over WXR (covers pages and custom post types too)
      if (!post.seoTitle && meta['_yoast_wpseo_title']) post.seoTitle = meta['_yoast_wpseo_title']
      if (!post.seoDescription && meta['_yoast_wpseo_metadesc']) post.seoDescription = meta['_yoast_wpseo_metadesc']

      // Featured image from DB (resolves when WXR attachment was missing)
      if (!post.featuredImageId && meta['_thumbnail_id']) {
        post.featuredImageId = meta['_thumbnail_id']
        const url = attachmentUrlById.get(Number(meta['_thumbnail_id']))
        if (url) {
          post.featuredImageUrl = url.startsWith('/') && siteUrl
            ? (() => { try { return new URL(siteUrl).origin + url } catch { return url } })()
            : url
        }
      }

      // ACF and public custom fields from DB (richer than WXR)
      const dbCustom: Record<string, string> = {}
      for (const [key, val] of Object.entries(meta)) {
        if (!key.startsWith('_') && val) dbCustom[key] = val
      }
      if (Object.keys(dbCustom).length > 0) {
        post.customFields = { ...dbCustom, ...(post.customFields ?? {}) }
      }
    }

    // Use DB blogname/description as site metadata fallback
    if (!siteTitle && dbData.options.blogname) siteTitle = dbData.options.blogname
    if (!siteUrl && dbData.options.siteurl) siteUrl = dbData.options.siteurl
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
