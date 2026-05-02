import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, extname, dirname } from 'path'
import matter from 'gray-matter'

export interface TransformOptions {
  /** Directory produced by wordpress-export-to-markdown (has posts/ and pages/ subdirs) */
  wp2mdDir: string
  /** Root output directory for the new Astro project */
  outputDir: string
}

export interface TransformResult {
  postsTransformed: number
  pagesTransformed: number
  imagesCopied: number
  imageFailed: string[]
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'])

// ── Frontmatter helpers ─────────────────────────────────────────────────────

function normaliseDate(d: unknown): string | undefined {
  if (!d) return undefined
  const s = String(d).trim()
  if (!s || s === 'false' || s === 'null') return undefined
  // date may be "2020-01-15" or a Date object serialised as ISO
  try {
    const dt = new Date(s)
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0]
  } catch {
    /* fall-through */
  }
  return s
}

function pickOne(arr: unknown): string | undefined {
  if (Array.isArray(arr) && arr.length > 0) return String(arr[0])
  if (arr && typeof arr === 'string') return arr
  return undefined
}

function toStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr.map((v) => String(v)).filter(Boolean)
}

function extractExcerpt(body: string, max = 220): string {
  const lines = body.split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#') || t.startsWith('!') || t.startsWith('---')) continue
    const clean = t
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim()
    if (clean.length > 20) return clean.slice(0, max)
  }
  return ''
}

function rewriteImagePaths(body: string): string {
  // Markdown image syntax:  ![alt](images/foo.jpg)
  let out = body.replace(/!\[([^\]]*)\]\(images\/([^)\s]+)\)/gi, '![$1](/media/$2)')
  // HTML img tags:  <img src="images/foo.jpg" …>
  out = out.replace(/(<img[^>]+src=")images\/([^"]+)(")/gi, '$1/media/$2$3')
  return out
}

function buildArticleFrontmatter(raw: Record<string, unknown>, body: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {}

  fm.title = raw.title ?? 'Untitled'

  const date = normaliseDate(raw.date)
  if (date) fm.publishedAt = date

  const category = pickOne(raw.categories)
  if (category) fm.category = category

  const tags = toStringArray(raw.tags)
  if (tags.length > 0) fm.tags = tags

  const cover = raw.coverImage ? String(raw.coverImage) : undefined
  if (cover) {
    // coverImage from wp2md is just the filename, e.g. "photo.jpg"
    fm.coverImage = cover.startsWith('/') ? cover : `/media/${cover}`
  }

  // excerpt: prefer existing, else extract from body
  const existingExcerpt = raw.excerpt ? String(raw.excerpt).trim() : ''
  fm.excerpt = existingExcerpt || extractExcerpt(body)

  if (raw.seoTitle) fm.seoTitle = String(raw.seoTitle)
  if (raw.seoDescription) fm.seoDescription = String(raw.seoDescription)

  return fm
}

function buildPageFrontmatter(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    title: raw.title ?? 'Untitled',
    ...(raw.seoDescription ? { seoDescription: String(raw.seoDescription) } : {}),
  }
}

// ── Image flattening ────────────────────────────────────────────────────────

async function collectAndCopyImages(
  sourceDir: string,
  mediaDir: string,
  existing: Map<string, string>,
): Promise<{ copied: number; failed: string[] }> {
  const failed: string[] = []
  let copied = 0

  if (!existsSync(sourceDir)) return { copied, failed }

  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = extname(entry.name).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue

    const src = join(sourceDir, entry.name)
    const targetName = uniqueFilename(entry.name, src, existing)
    existing.set(entry.name, targetName)

    try {
      await copyFile(src, join(mediaDir, targetName))
      copied++
    } catch (err) {
      failed.push(`${src}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { copied, failed }
}

function uniqueFilename(name: string, srcPath: string, existing: Map<string, string>): string {
  if (!existing.has(name)) return name
  // Already registered with this exact source path → same file, reuse
  const ext = extname(name)
  const base = basename(name, ext)
  let i = 2
  while (existing.has(`${base}-${i}${ext}`)) i++
  return `${base}-${i}${ext}`
}

// ── Transform a single .md file ─────────────────────────────────────────────

async function transformMarkdownFile(
  srcPath: string,
  destPath: string,
  fmBuilder: (raw: Record<string, unknown>, body: string) => Record<string, unknown>,
): Promise<void> {
  const raw = await readFile(srcPath, 'utf-8')
  const { data, content } = matter(raw)

  const updatedFm = fmBuilder(data, content)
  const updatedBody = rewriteImagePaths(content)

  // Stringify back with gray-matter
  const output = matter.stringify(updatedBody, updatedFm)

  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, output, 'utf-8')
}

// ── Walk a type directory (posts/ or pages/) ────────────────────────────────

async function walkTypeDir(
  typeDir: string,          // e.g. .tmp/wp2md/posts
  contentDir: string,       // e.g. output/src/content/articles
  mediaDir: string,         // e.g. output/public/media
  fmBuilder: (raw: Record<string, unknown>, body: string) => Record<string, unknown>,
  imageRegistry: Map<string, string>,
  isDraft = false,
): Promise<{ transformed: number; imagesCopied: number; imageFailed: string[] }> {
  let transformed = 0
  let imagesCopied = 0
  const imageFailed: string[] = []

  if (!existsSync(typeDir)) return { transformed, imagesCopied, imageFailed }

  const slugDirs = await readdir(typeDir, { withFileTypes: true })

  for (const entry of slugDirs) {
    if (!entry.isDirectory()) continue

    const slug = entry.name
    const srcSlugDir = join(typeDir, slug)

    // Find the .md file (usually index.md or slug.md)
    const files = await readdir(srcSlugDir, { withFileTypes: true })
    const mdFile = files.find((f) => f.isFile() && f.name.endsWith('.md'))
    if (!mdFile) continue

    const srcMd = join(srcSlugDir, mdFile.name)
    const destMd = join(contentDir, slug, 'index.mdoc')

    await transformMarkdownFile(srcMd, destMd, fmBuilder)
    transformed++

    // Copy images from posts/slug/images/ → public/media/
    const imagesDir = join(srcSlugDir, 'images')
    const { copied, failed } = await collectAndCopyImages(imagesDir, mediaDir, imageRegistry)
    imagesCopied += copied
    imageFailed.push(...failed)
  }

  return { transformed, imagesCopied, imageFailed }
}

// ── Main transform entry point ───────────────────────────────────────────────

export async function transformWp2mdOutput(options: TransformOptions): Promise<TransformResult> {
  const { wp2mdDir, outputDir } = options

  const articlesDir = join(outputDir, 'src', 'content', 'articles')
  const pagesDir = join(outputDir, 'src', 'content', 'pages')
  const mediaDir = join(outputDir, 'public', 'media')

  await mkdir(articlesDir, { recursive: true })
  await mkdir(pagesDir, { recursive: true })
  await mkdir(mediaDir, { recursive: true })

  // Shared image registry to detect filename collisions across all posts+pages
  const imageRegistry = new Map<string, string>()

  // Transform posts → articles
  const postsResult = await walkTypeDir(
    join(wp2mdDir, 'posts'),
    articlesDir,
    mediaDir,
    buildArticleFrontmatter,
    imageRegistry,
  )

  // Transform draft posts
  const draftsResult = await walkTypeDir(
    join(wp2mdDir, 'posts', '_drafts'),
    join(articlesDir, '_drafts'),
    mediaDir,
    buildArticleFrontmatter,
    imageRegistry,
    true,
  )

  // Transform pages
  const pagesResult = await walkTypeDir(
    join(wp2mdDir, 'pages'),
    pagesDir,
    mediaDir,
    buildPageFrontmatter,
    imageRegistry,
  )

  return {
    postsTransformed: postsResult.transformed + draftsResult.transformed,
    pagesTransformed: pagesResult.transformed,
    imagesCopied: postsResult.imagesCopied + draftsResult.imagesCopied + pagesResult.imagesCopied,
    imageFailed: [...postsResult.imageFailed, ...draftsResult.imageFailed, ...pagesResult.imageFailed],
  }
}

