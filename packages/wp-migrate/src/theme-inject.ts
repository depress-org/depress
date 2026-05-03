import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, extname } from 'path'
import { spawn } from 'child_process'
import matter from 'gray-matter'
import type { ThemeAdapter, PatchConfigOpts } from './themes/types.js'

/** Download a GitHub theme repo tarball and extract into outputDir */
export async function downloadTheme(adapter: ThemeAdapter, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const url = `https://github.com/${adapter.repo}/archive/refs/heads/${adapter.branch}.tar.gz`
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'sh',
      ['-c', `curl -sL "${url}" | tar xz --strip-components=1 -C "${outputDir}"`],
      { stdio: 'inherit' },
    )
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Theme download exited ${code}`)),
    )
    child.on('error', reject)
  })
}

/** Delete all .md/.mdx sample files from the theme's content directories */
export async function clearSampleContent(
  outputDir: string,
  adapter: ThemeAdapter,
): Promise<void> {
  for (const dir of adapter.sampleContentDirs) {
    const fullDir = join(outputDir, dir)
    if (!existsSync(fullDir)) continue
    await clearMdFiles(fullDir)
  }
}

async function clearMdFiles(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await clearMdFiles(fullPath)
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
      await rm(fullPath, { force: true }).catch(() => {})
    }
  }
}

export interface InjectResult {
  postsInjected: number
  pagesInjected: number
  mediaFiles: number
}

/**
 * Read articles/pages from the intermediate content dir (our mdoc format)
 * and write them into the theme with the adapter's frontmatter mapping.
 */
export async function injectContent(
  contentTmpDir: string,
  outputDir: string,
  adapter: ThemeAdapter,
  siteAuthor: string,
): Promise<InjectResult> {
  const destContentDir = join(outputDir, adapter.contentDir)
  const destMediaDir = join(outputDir, adapter.mediaDir)

  await mkdir(destContentDir, { recursive: true })
  await mkdir(destMediaDir, { recursive: true })

  let postsInjected = 0

  // Inject blog posts from contentTmpDir/src/content/articles/
  const articlesDir = join(contentTmpDir, 'src', 'content', 'articles')
  if (existsSync(articlesDir)) {
    const slugDirs = await readdir(articlesDir, { withFileTypes: true })
    for (const entry of slugDirs) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue
      const mdocPath = join(articlesDir, entry.name, 'index.mdoc')
      if (!existsSync(mdocPath)) continue

      const raw = await readFile(mdocPath, 'utf-8')
      const { data, content } = matter(raw)

      const themeFm = adapter.mapFrontmatter(data as Parameters<ThemeAdapter['mapFrontmatter']>[0], siteAuthor)
      // Fix image paths: /media/foo.jpg → relative or keep as-is
      // Most themes serve from public/, so /media/ becomes /media/ which works
      const destFile = join(destContentDir, `${entry.name}.${adapter.fileExt}`)
      await writeFile(destFile, matter.stringify(content, themeFm), 'utf-8')
      postsInjected++
    }
  }

  // Inject pages (if theme supports)
  let pagesInjected = 0
  if (adapter.pagesDir) {
    const pagesDir = join(contentTmpDir, 'src', 'content', 'pages')
    const destPagesDir = join(outputDir, adapter.pagesDir)
    await mkdir(destPagesDir, { recursive: true })

    if (existsSync(pagesDir)) {
      const slugDirs = await readdir(pagesDir, { withFileTypes: true })
      for (const entry of slugDirs) {
        if (!entry.isDirectory()) continue
        const mdocPath = join(pagesDir, entry.name, 'index.mdoc')
        if (!existsSync(mdocPath)) continue

        const raw = await readFile(mdocPath, 'utf-8')
        const { data, content } = matter(raw)

        const themeFm = adapter.mapPageFrontmatter
          ? adapter.mapPageFrontmatter(data as Parameters<NonNullable<ThemeAdapter['mapPageFrontmatter']>>[0])
          : { title: (data as Record<string, unknown>).title ?? 'Page' }

        const destFile = join(destPagesDir, `${entry.name}.${adapter.fileExt}`)
        await writeFile(destFile, matter.stringify(content, themeFm), 'utf-8')
        pagesInjected++
      }
    }
  }

  // Copy media
  const sourceMedia = join(contentTmpDir, 'public', 'media')
  let mediaFiles = 0
  if (existsSync(sourceMedia)) {
    // For themes that use public/images/, copy there. For public/, copy to public/media/.
    // We keep /media/ as the subdir to keep image paths valid.
    const destMedia = adapter.mediaDir === 'public'
      ? join(outputDir, 'public', 'media')
      : join(outputDir, adapter.mediaDir)
    await mkdir(destMedia, { recursive: true })

    const files = await readdir(sourceMedia)
    for (const file of files) {
      await copyFile(join(sourceMedia, file), join(destMedia, file)).catch(() => {})
      mediaFiles++
    }
  }

  return { postsInjected, pagesInjected, mediaFiles }
}

// Re-export PatchConfigOpts for convenience
export type { PatchConfigOpts }
