import { mkdir, readdir } from 'fs/promises'
import { assertSafeTree, safeSegment, safeWriteFile, assertUniqueSegments } from './input-boundary.js'
import { rasterExtension, MEDIA_LIMITS } from './media-fetch.js'
import { readRasterFile } from './media-file.js'
import { join, relative, extname } from 'path'

const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg',
  '.mp4', '.webm', '.ogv', '.mp3', '.ogg', '.wav',
  '.pdf', '.zip',
])

export async function migrateMedia(
  mediaSourceDir: string,
  outputDir: string,
  wpSiteUrl?: string,
): Promise<Map<string, string>> {
  await assertSafeTree(mediaSourceDir)
  await assertSafeTree(outputDir)
  const urlMap = new Map<string, string>()
  const publicMediaDir = join(outputDir, 'public', 'media')

  await mkdir(publicMediaDir, { recursive: true })
  await scanAndCopy(mediaSourceDir, mediaSourceDir, publicMediaDir, urlMap, wpSiteUrl)

  return urlMap
}

async function scanAndCopy(
  dir: string,
  baseDir: string,
  outputBase: string,
  urlMap: Map<string, string>,
  wpSiteUrl?: string,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  assertUniqueSegments(entries.map(e => e.name))

  for (const entry of entries) {
    const fullPath = join(dir, safeSegment(entry.name))

    if (entry.isDirectory()) {
      await scanAndCopy(fullPath, baseDir, outputBase, urlMap, wpSiteUrl)
    } else if (entry.isFile() && isMediaFile(entry.name)) {
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/')
      const dest = join(outputBase, rel)

      await mkdir(join(dest, '..'), { recursive: true })
      const bytes = await readRasterFile(fullPath, MEDIA_LIMITS.maxBytes)
      if (bytes.length > MEDIA_LIMITS.maxBytes) throw new Error('Media byte limit')
      rasterExtension(bytes)
      await safeWriteFile(outputBase, rel, bytes)

      const newPath = `/media/${rel}`

      urlMap.set(rel, newPath)

      if (wpSiteUrl) {
        const base = wpSiteUrl.replace(/\/$/, '')
        urlMap.set(`${base}/wp-content/uploads/${rel}`, newPath)
      }
    }
  }
}

function isMediaFile(filename: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(filename).toLowerCase())
}