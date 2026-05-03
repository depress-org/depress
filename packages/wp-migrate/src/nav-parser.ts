import { XMLParser } from 'fast-xml-parser'
import type { NavItem, WPPost, WPCategory } from '@depress-org/core'

interface RawNavItem {
  id: string
  title: string
  menuOrder: number
  parentId: string
  url: string
  type: string   // 'custom' | 'post_type' | 'taxonomy'
  object: string // 'page' | 'post' | 'category' | ...
  objectId: string
}

function getMeta(metas: any[], key: string): string {
  if (!Array.isArray(metas)) return ''
  for (const m of metas) {
    if (m['wp:meta_key'] === key) {
      return String(m['wp:meta_value'] ?? '')
    }
  }
  return ''
}

function decodeSlug(slug: string): string {
  try { return decodeURIComponent(slug) } catch { return slug }
}

interface RawNavItemWithMenu extends RawNavItem {
  menuSlug: string
}

/**
 * Parse WordPress nav menu items from WXR XML.
 * Returns a map from menu slug to its NavItem tree.
 * Falls back to { primary: fallbackNav } if the WXR data is too sparse.
 */
export function parseNavFromXml(
  xml: string,
  posts: WPPost[],
  categories: WPCategory[],
  siteUrl: string,
): Record<string, NavItem[]> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    textNodeName: '#text',
    isArray: (name) => ['item', 'wp:postmeta', 'category'].includes(name),
  })

  let channel: any
  try {
    const result = parser.parse(xml)
    channel = result?.rss?.channel
  } catch {
    return { primary: buildFallbackNav(posts, categories) }
  }

  if (!channel) return { primary: buildFallbackNav(posts, categories) }

  const items: any[] = Array.isArray(channel.item) ? channel.item : []

  // Build a lookup map of post_id → { slug, type, title }
  const idToEntry = new Map<string, { slug: string; type: string; title: string }>()
  for (const item of items) {
    const postType = item['wp:post_type']
    const postId = String(item['wp:post_id'] ?? '')
    const rawSlug = String(item['wp:post_name'] ?? '')
    const slug = decodeSlug(rawSlug)
    const title = String(item['title'] ?? '')
    if (postId && slug && (postType === 'page' || postType === 'post')) {
      idToEntry.set(postId, { slug, type: postType, title })
    }
  }

  // Also use parsed posts list as a fallback lookup (parser may decode slugs differently)
  for (const p of posts) {
    if (!idToEntry.has(String(p.id))) {
      idToEntry.set(String(p.id), { slug: p.slug, type: p.type, title: p.title })
    }
  }

  // Extract nav_menu_item entries, tagging each with its menu slug
  const rawNavItems: RawNavItemWithMenu[] = []
  for (const item of items) {
    if (item['wp:post_type'] !== 'nav_menu_item') continue

    const metas: any[] = Array.isArray(item['wp:postmeta'])
      ? item['wp:postmeta']
      : item['wp:postmeta']
      ? [item['wp:postmeta']]
      : []

    // Determine which menu this item belongs to via category tag
    const cats: any[] = Array.isArray(item['category']) ? item['category'] : item['category'] ? [item['category']] : []
    let menuSlug = 'primary'
    for (const cat of cats) {
      if (cat._domain === 'nav_menu') {
        menuSlug = cat._nicename || cat['#text'] || 'primary'
        break
      }
    }

    rawNavItems.push({
      id: String(item['wp:post_id'] ?? ''),
      title: String(item.title ?? '').trim(),
      menuOrder: Number(item['wp:menu_order'] ?? 0),
      parentId: getMeta(metas, '_menu_item_menu_item_parent'),
      url: getMeta(metas, '_menu_item_url'),
      type: getMeta(metas, '_menu_item_type'),
      object: getMeta(metas, '_menu_item_object'),
      objectId: getMeta(metas, '_menu_item_object_id'),
      menuSlug,
    })
  }

  if (rawNavItems.length === 0) {
    return { primary: buildFallbackNav(posts, categories) }
  }

  // Resolve href for each item
  const resolved: Array<NavItem & { id: string; parentId: string; order: number; menuSlug: string }> = []

  for (const raw of rawNavItems) {
    let href = ''
    let label = raw.title

    if (raw.type === 'custom' && raw.url) {
      // Custom URL — strip the live domain to make it relative
      try {
        const u = new URL(raw.url)
        href = u.pathname || '/'
      } catch {
        href = raw.url.startsWith('/') ? raw.url : `/${raw.url}`
      }
    } else if (raw.type === 'post_type' && raw.objectId) {
      const entry = idToEntry.get(raw.objectId)
      if (entry) {
        href = entry.type === 'post' ? `/blog/${entry.slug}` : `/${entry.slug}`
        // Use nav item title if set; fall back to the actual page title
        if (!label) label = entry.title || entry.slug
      }
    } else if (raw.type === 'taxonomy' && raw.object === 'category' && raw.objectId) {
      const cat = categories.find((c) => String(c.id) === raw.objectId)
      if (cat) {
        href = `/category/${cat.slug}`
        if (!label) label = cat.name
      }
    }

    if (!label && !href) continue // skip completely empty items

    // If the label looks like a URL slug (no spaces, all lowercase), look up better title
    const looksLikeSlug = label && !label.includes(' ') && /^[\p{Ll}\p{Lo}0-9-]+$/u.test(label)
    if (looksLikeSlug && raw.objectId) {
      const entry = idToEntry.get(raw.objectId)
      if (entry?.title && entry.title !== label) label = entry.title
    }

    resolved.push({
      id: raw.id,
      parentId: raw.parentId,
      order: raw.menuOrder,
      label: label || href,
      href: href || '/',
      menuSlug: raw.menuSlug,
    })
  }

  // Group by menu slug and build per-menu tree
  const menuSlugs = [...new Set(resolved.map((r) => r.menuSlug))]
  const allMenus: Record<string, NavItem[]> = {}

  for (const slug of menuSlugs) {
    const menuResolved = resolved.filter((r) => r.menuSlug === slug)

    const topLevel = menuResolved
      .filter((item) => item.parentId === '0' && item.href)
      .sort((a, b) => a.order - b.order)

    const navItems: NavItem[] = topLevel.map((parent) => {
      const children = menuResolved
        .filter((c) => c.parentId === parent.id && c.href)
        .sort((a, b) => a.order - b.order)
        .map(({ label, href }) => ({ label, href }))

      return children.length > 0
        ? { label: parent.label, href: parent.href, children }
        : { label: parent.label, href: parent.href }
    })

    const meaningful = navItems.filter((n) => n.href && n.label && n.label !== 'insight-logo')
    if (meaningful.length >= 2) {
      allMenus[slug] = meaningful
    }
  }

  if (Object.keys(allMenus).length === 0) {
    return { primary: buildFallbackNav(posts, categories) }
  }

  return allMenus
}

/**
 * Fallback nav when WXR nav_menu data is absent or too sparse.
 * Always includes Home + Blog; adds top-3 non-empty categories.
 */
function buildFallbackNav(posts: WPPost[], categories: WPCategory[]): NavItem[] {
  const nav: NavItem[] = [
    { label: 'Home', href: '/' },
    { label: 'Blog', href: '/blog' },
  ]

  // Add top categories that actually have posts
  const categorySlugSet = new Set(posts.filter((p) => p.status === 'publish').flatMap((p) => p.categories))
  const topCats = categories.filter((c) => categorySlugSet.has(c.slug)).slice(0, 3)
  for (const cat of topCats) {
    nav.push({ label: cat.name, href: `/category/${cat.slug}` })
  }

  return nav
}

