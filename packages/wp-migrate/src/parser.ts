import type { WPExport, WPPost, WPCategory, WPTag } from '@depress/core'
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
    isArray: (name) => ['item', 'category', 'tag'].includes(name),
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

  for (const item of items) {
    const postType = item['wp:post_type']

    if (postType === 'attachment') {
      media.push({
        id: item['wp:post_id'],
        url: item['wp:attachment_url'] ?? item.guid,
        filename: item['wp:post_name'],
        mimeType: '',
        altText: item.title ?? '',
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

    posts.push({
      id: item['wp:post_id'],
      title: item.title ?? 'Untitled',
      slug: decodeSlug(item['wp:post_name'] ?? String(item['wp:post_id'])),
      content: item['content:encoded'] ?? '',
      excerpt: item['excerpt:encoded'] ?? '',
      status: item['wp:status'] ?? 'draft',
      type: postType,
      date: item['wp:post_date'] ?? new Date().toISOString(),
      categories: itemCategories,
      tags: itemTags,
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
