import { copyFile, mkdir, readdir } from 'fs/promises'
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

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      await scanAndCopy(fullPath, baseDir, outputBase, urlMap, wpSiteUrl)
    } else if (entry.isFile() && isMediaFile(entry.name)) {
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/')
      const dest = join(outputBase, rel)

      await mkdir(join(dest, '..'), { recursive: true })
      await copyFile(fullPath, dest)

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