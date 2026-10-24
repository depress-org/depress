import type { WPExport, SourceManifest } from '@depress-org/core'
import TurndownService from 'turndown'
import { stat } from 'node:fs/promises'
import { readRasterFile } from './media-file.js'
import { join } from 'node:path'
import { safeSegment, assertUniqueSegments, assertSafeTree, containedPath, safeWriteFile } from './input-boundary.js'
import { fetchMedia, MEDIA_LIMITS, rasterExtension } from './media-fetch.js'
import { transformPosts } from './transform.js'
import { attachmentEligible, createStaticPluginHost } from './static-plugins.js'
import { StaticPluginError, imageMarkdown, type LocalMedia } from './static-plugin-host.js'

/** Privacy identity and byte access must use the same validated path segments. */
function resolveMediaReference(raw: string, siteUrl: string) {
  if (/[\x00-\x20\\]/.test(raw)) throw new Error('Invalid media URL')
  // Validate the original path before WHATWG URL can remove dot segments.
  const rawPath = raw.replace(/^(?:https?:)?\/\/[^/?#]+/i, '').split(/[?#]/)[0]
  rawPath.split('/').filter(Boolean).forEach(safeSegment)
  const url = new URL(raw, siteUrl)
  const segments = url.pathname.split('/').filter(Boolean).map(safeSegment)
  const filename = segments.at(-1)
  if (!filename) throw new Error('Missing media filename')
  return { raw, url, segments, filename, identity: JSON.stringify([url.origin, ...segments]) }
}

/** All path-derived values are checked before the first conversion write/fetch. */
export function validateExportPaths(data: WPExport): void {
  for (const type of ['post', 'page']) assertUniqueSegments(data.posts.filter(p => p.type === type).map(p => p.slug))
  assertUniqueSegments(data.categories.map(c => c.slug))
  assertUniqueSegments(data.tags.map(t => t.slug))
  for (const post of data.posts) {
    safeSegment(post.slug)
    post.categories.forEach(safeSegment); post.tags.forEach(safeSegment)
  }
  for (const media of data.media) if (media.filename) safeSegment(media.filename)
}

/** Native converter replaces upstream's unbounded/path-decoding writer and Axios.
 * No WXR is ever passed to wordpress-export-to-markdown or a local HTTP server.
 */
export async function convertSafeExport(data: WPExport, output: string, wpDir?: string, manifest?: SourceManifest) {
  validateExportPaths(data)
  const host = manifest ? createStaticPluginHost(manifest, manifest.staticPlugins) : undefined
  if (host) await host.inspect()
  await assertSafeTree(output)
  if (wpDir) {
    if (!(await stat(wpDir)).isDirectory()) throw new Error('Missing local media directory')
    await assertSafeTree(wpDir)
  }
  const urls = new Set<string>()
  const collector = new TurndownService()
  collector.addRule('media', { filter: 'img', replacement: (_text, node) => {
    const src = (node as Element).getAttribute('src'); if (src) urls.add(src)
    return ''
  } })
  for (const post of data.posts.filter(p => p.status === 'publish')) {
    collector.turndown(post.content)
    if (post.featuredImageUrl) urls.add(post.featuredImageUrl)
  }
  // Gallery references may only copy contained local files. Never initiate a
  // network request solely because a shortcode names an attachment.
  if (host && wpDir && host.config.plugins.some(p => p.id === 'core.static-gallery')) {
    for (const source of manifest!.items.filter(i => i.status === 'publish' && ['post', 'page'].includes(i.type))) {
      for (const token of host.tokens(source).filter(t => t.tag === 'gallery' && !t.closing)) {
        const match = /^\s+ids\s*=\s*(?:"([\d,\s]+)"|'([\d,\s]+)'|([\d,]+))\s*$/.exec(token.rawAttributes)
        if (!match) continue
        for (const id of (match[1] ?? match[2] ?? match[3]).split(',').map(s => s.trim())) {
          const matches = data.media.filter(m => String(m.id) === id)
          if (matches.length !== 1 || !attachmentEligible(manifest!, matches[0].id)) continue
          // Missing/invalid gallery-only files are review findings, not a
          // partial gallery or fallback fetch. Native ordinary media still fails.
          try {
            const { url, segments, filename } = resolveMediaReference(matches[0].url, data.siteUrl)
            if (url.origin !== new URL(data.siteUrl).origin) continue
            imageMarkdown(matches[0].altText, `/media/${filename}`)
            const bytes = await readRasterFile(await containedPath(wpDir, segments.join('/')), MEDIA_LIMITS.maxBytes)
            rasterExtension(bytes)
            urls.add(matches[0].url)
          } catch { /* host will diagnose unresolved local media */ }
        }
      }
    }
  }
  // An explicit private/draft attachment is never promoted even through a
  // native img/featured reference alongside a gallery.
  const excludedIdentities = new Set<string>()
  if (manifest) for (const media of manifest.media) {
    if (attachmentEligible(manifest, media.id)) continue
    excludedIdentities.add(resolveMediaReference(media.url, data.siteUrl).identity)
  }
  // Validate first, then exclude exact read identities before collision checks
  // or any writes. An eligible public alias cannot promote private bytes.
  const plan = [...urls].map(raw => resolveMediaReference(raw, data.siteUrl))
    .filter(reference => !excludedIdentities.has(reference.identity))
  if (plan.length > MEDIA_LIMITS.maxFiles) throw new Error('Media file limit')
  const mapping = new Map<string, string>()
  // Fail closed: flattening collisions never silently rename or overwrite assets.
  assertUniqueSegments(plan.map(reference => reference.filename))
  const budget = { remaining: MEDIA_LIMITS.totalBytes as number }
  const deadline = Date.now() + MEDIA_LIMITS.migrationTimeoutMs
  for (const { raw, url, segments, filename } of plan) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw new Error('Migration media deadline')
    let bytes: Buffer
    if (wpDir) {
      // Local archive mode never falls back to network, even for missing images.
      if (url.origin !== new URL(data.siteUrl).origin) throw new Error('Off-site local media')
      const path = await containedPath(wpDir, segments.join('/'))
      bytes = await readRasterFile(path, Math.min(MEDIA_LIMITS.maxBytes, budget.remaining))
      budget.remaining -= bytes.length
    } else bytes = await fetchMedia(url.href, budget, undefined, Math.min(MEDIA_LIMITS.timeoutMs, remainingMs))
    const extension = rasterExtension(bytes)
    if (!filename.toLowerCase().endsWith(extension) && !(extension === '.jpg' && filename.toLowerCase().endsWith('.jpeg'))) throw new Error('Media type/extension mismatch')
    await safeWriteFile(output, join('public/media', filename), bytes)
    mapping.set(raw, `/media/${filename}`)
  }
  const attachmentAlts = new Map<string, string>()
  for (const { raw, url, filename } of plan) {
    const candidates = data.media.filter(media => {
      try { return new URL(media.url, data.siteUrl).pathname.split('/').at(-1) === filename } catch { return false }
    })
    // A basename shared by multiple attachments is never an identity proof.
    if (candidates.length === 1 && candidates[0].altText && new URL(candidates[0].url, data.siteUrl).href === url.href)
      attachmentAlts.set(raw, candidates[0].altText)
  }
  const posts = data.posts.map(p => ({ ...p, featuredImageUrl: p.featuredImageUrl ? mapping.get(p.featuredImageUrl) : undefined }))
  const localMedia: Record<string, LocalMedia[string]> = {}
  for (const media of data.media) {
    const publicUrl = mapping.get(media.url)
    if ((!manifest || attachmentEligible(manifest, media.id)) && publicUrl && data.media.filter(m => m.id === media.id).length === 1) localMedia[String(media.id)] = { publicUrl, alt: media.altText, copyStatus: 'copied' }
  }
  const sourceFor = (id: number) => manifest!.items.find(i => i.id === id)!
  const report = await transformPosts(posts, output, mapping, attachmentAlts, host ? {
    prepare: post => host.prepare(sourceFor(post.id)).content,
    transform: async (post, markdown) => {
      try { return (await host.transform(sourceFor(post.id), markdown, localMedia)).markdown }
      catch (error) { if (error instanceof StaticPluginError) manifest!.pluginFailure = error.code; throw error }
    },
  } : undefined)
  if (report.errors) throw new Error('Content conversion failed')
  return {
    postsTransformed: posts.filter(p => p.type === 'post' && p.status === 'publish').length,
    pagesTransformed: posts.filter(p => p.type === 'page' && p.status === 'publish').length,
    imagesCopied: mapping.size,
    imageFailed: [] as string[],
  }
}
