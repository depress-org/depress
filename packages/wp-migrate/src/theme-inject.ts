import { readdir, readFile, mkdir, rm, cp } from 'fs/promises'
const writeFile = async (path: string, data: string, _encoding: string) => safeWriteFile(dirname(path), path.split('/').at(-1)!, data)
const copyFile = async (src: string, dest: string) => safeWriteFile(dirname(dest), dest.split('/').at(-1)!, await readFile(src))
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { assertSafeTree, safeSegment, assertUniqueSegments, safeWriteFile } from './input-boundary.js'
import matter from 'gray-matter'
import type { ThemeAdapter, PatchConfigOpts } from './themes/types.js'

// Resolve the bundled-themes/ directory relative to THIS file at runtime.
// dist/theme-inject.js → ../../bundled-themes/
const _thisFile = fileURLToPath(import.meta.url)
const _bundledRoot = join(dirname(_thisFile), '..', 'bundled-themes')

/**
 * Provision a theme into outputDir.
 * If `adapter.bundled` is true the theme files are copied from the
 * bundled-themes/<id>/ directory already stored in this package — no
 * network access required, version is frozen.
 * Otherwise the theme tarball is downloaded from GitHub.
 */
export async function provisionTheme(adapter: ThemeAdapter, outputDir: string): Promise<void> {
  if (adapter.fileExt !== 'md') throw new Error('MDX-only themes are disabled for untrusted content')
  await assertSafeTree(outputDir)
  if (adapter.bundled) {
    await copyBundledTheme(adapter, outputDir)
  } else {
    await downloadTheme(adapter, outputDir)
  }
}

/** Copy a bundled theme from bundled-themes/<id>/ into outputDir */
async function copyBundledTheme(adapter: ThemeAdapter, outputDir: string): Promise<void> {
  const src = join(_bundledRoot, adapter.id)
  if (!existsSync(src)) {
    throw new Error(
      `Bundled theme "${adapter.id}" not found at ${src}. ` +
        `Run: npm run fetch-themes  (or re-clone the repo)`,
    )
  }
  await mkdir(outputDir, { recursive: true })
  await assertSafeTree(src)
  // Node 16.7+ recursive copy
  await cp(src, outputDir, { recursive: true })
}

/** Download a GitHub theme repo tarball and extract into outputDir */
export async function downloadTheme(adapter: ThemeAdapter, outputDir: string): Promise<void> {
  throw new Error('Remote theme downloads require a bounded trusted downloader; use a bundled theme')
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
  // Uploaded content is data, never executable MDX. Do not silently rename it
  // into a compiler input with ESM, JSX or expression evaluation semantics.
  // MDX-only adapters must opt into plain Markdown support before migration.
  if (adapter.fileExt !== 'md') {
    throw new Error(`Theme "${adapter.id}" requires executable MDX; untrusted content migration requires a plain Markdown (.md) adapter`)
  }

  await assertSafeTree(contentTmpDir)
  await assertSafeTree(outputDir)
  const destContentDir = join(outputDir, adapter.contentDir)
  const destMediaDir = join(outputDir, adapter.mediaDir)

  await mkdir(destContentDir, { recursive: true })
  await mkdir(destMediaDir, { recursive: true })

  let postsInjected = 0

  // Inject blog posts from contentTmpDir/src/content/articles/
  const articlesDir = join(contentTmpDir, 'src', 'content', 'articles')
  if (existsSync(articlesDir)) {
    const slugDirs = await readdir(articlesDir, { withFileTypes: true })
    assertUniqueSegments(slugDirs.map(e => e.name))
    for (const entry of slugDirs) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue
      const mdocPath = join(articlesDir, entry.name, 'index.mdoc')
      if (!existsSync(mdocPath)) continue

      const raw = await readFile(mdocPath, 'utf-8')
      const { data, content } = parseIntermediateContent(raw)

      const themeFm = adapter.mapFrontmatter(data as Parameters<ThemeAdapter['mapFrontmatter']>[0], siteAuthor)
      let destFile: string
      if (adapter.useDirectoryEntries) {
        await mkdir(join(destContentDir, entry.name), { recursive: true })
        destFile = join(destContentDir, entry.name, `index.${adapter.fileExt}`)
      } else {
        destFile = join(destContentDir, `${entry.name}.${adapter.fileExt}`)
      }
      await writeFile(destFile, matter.stringify(content.replace(/</g, '&lt;'), themeFm), 'utf-8')
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
      assertUniqueSegments(slugDirs.map(e => e.name))
      for (const entry of slugDirs) {
        if (!entry.isDirectory()) continue
        const mdocPath = join(pagesDir, entry.name, 'index.mdoc')
        if (!existsSync(mdocPath)) continue

        const raw = await readFile(mdocPath, 'utf-8')
        const { data, content } = parseIntermediateContent(raw)

        const themeFm = adapter.mapPageFrontmatter
          ? adapter.mapPageFrontmatter(data as Parameters<NonNullable<ThemeAdapter['mapPageFrontmatter']>>[0])
          : { title: (data as Record<string, unknown>).title ?? 'Page' }

        const destFile = join(destPagesDir, `${entry.name}.${adapter.fileExt}`)
        await writeFile(destFile, matter.stringify(content.replace(/</g, '&lt;'), themeFm), 'utf-8')
        pagesInjected++
      }
    }
  }

  // Copy media to the theme's designated directory
  const sourceMedia = join(contentTmpDir, 'public', 'media')
  let mediaFiles = 0
  if (existsSync(sourceMedia)) {
    const destMedia = adapter.mediaDir === 'public'
      ? join(outputDir, 'public', 'media')
      : join(outputDir, adapter.mediaDir)
    await mkdir(destMedia, { recursive: true })

    // Also ensure /media/ paths in post body markdown resolve — content written by
    // keystatic-transform always uses /media/filename, so we copy to public/media/
    // as an alias even when the theme uses a different primary media directory.
    const publicMediaAlias = join(outputDir, 'public', 'media')
    if (destMedia !== publicMediaAlias) {
      await mkdir(publicMediaAlias, { recursive: true })
    }

    const files = await readdir(sourceMedia)
    assertUniqueSegments(files)
    for (const file of files) {
      safeSegment(file)
      await copyFile(join(sourceMedia, file), join(destMedia, file))
      if (destMedia !== publicMediaAlias) {
        await copyFile(join(sourceMedia, file), join(publicMediaAlias, file))
      }
      mediaFiles++
    }
  }

  return { postsInjected, pagesInjected, mediaFiles }
}

/** Only YAML frontmatter is accepted; gray-matter also has executable JS engines. */
function parseIntermediateContent(raw: string): ReturnType<typeof matter> {
  if (!/^---(?:ya?ml)?[ \t]*\r?\n/.test(raw)) {
    throw new Error('Intermediate content requires YAML frontmatter')
  }
  return matter(raw)
}

// Re-export PatchConfigOpts for convenience
export type { PatchConfigOpts }
