import type { WPMedia } from '@depress/core'
import { copyFile, mkdir } from 'fs/promises'
import { join, basename } from 'path'

/**
 * Migrate WordPress media files to public/media/
 */
export async function migrateMedia(
  mediaSourceDir: string,
  outputDir: string,
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>()

  // TODO: Implement full media migration
  // 1. Scan wp-content/uploads/ recursively
  // 2. Copy files preserving year/month structure
  // 3. Build URL mapping: old WP URL -> new /media/ path
  // 4. Return map for use in content transformation

  console.log('Media migration: coming soon 🚧')
  return urlMap
}
