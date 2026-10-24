import { readFile, mkdir, mkdtemp, rm, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { checkedSpawn, safeEnvironment, ServiceError } from './process.js'
import { createRequire } from 'node:module'
import {
  parseWPExport,
  readWPDatabase,
  parseNavFromXml,
  convertSafeExport,
  validateExportPaths,
  safeSegment,
  assertUniqueSegments,
  assertSafeTree,
  safeWriteFile,
  scaffoldAstroProject,
  provisionTheme,
  clearSampleContent,
  injectContent,
  getThemeAdapter,
  listThemes,
  DEFAULT_THEME_ID,
} from '@depress-org/wp-migrate'
export interface MigrateOptions {
  input?: string
  wpDir?: string
  db?: string
  output: string
  repo?: string
  theme?: string
  /** CLI-only explicit overwrite permission; services reject non-empty output by default. */
  overwrite?: boolean
}
// ── Helper: resolve wp2md bin ─────────────────────────────────────────────────
export function resolveWp2mdBin(): string {
  return createRequire(import.meta.url).resolve(
    'wordpress-export-to-markdown/app.js',
  )
}
async function tempRoot() {
  const root = resolve('.tmp')
  await mkdir(root, { recursive: true })
  return root
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function migrateSite(options: MigrateOptions) {
  try {
    return await migrate(options)
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError(
      'MIGRATION_FAILED',
      'Migration failed: invalid input or conversion error',
    )
  }
}

async function migrate(options: MigrateOptions) {
  const outputDir = resolve(options.output)
  await assertSafeTree(outputDir)
  const inputFile = await resolveInput(options.input)
  if (!inputFile)
    throw new ServiceError('MISSING_INPUT', 'WordPress XML input is required')
  const wpDir = options.wpDir ? resolve(options.wpDir) : undefined
  if (
    existsSync(outputDir) &&
    (await readdir(outputDir)).length &&
    !options.overwrite
  )
    throw new ServiceError('OUTPUT_EXISTS', 'Output directory is not empty')
  const useScaffold = options.theme === 'scaffold'
  const themeId = useScaffold
    ? null
    : options.theme && options.theme !== 'default'
      ? options.theme
      : DEFAULT_THEME_ID
  const adapter = themeId ? getThemeAdapter(themeId) : null
  if (themeId && !adapter)
    throw new ServiceError('INVALID_THEME', 'Unknown theme')
  if (adapter && adapter.fileExt !== 'md') throw new ServiceError('UNSAFE_CONTENT_THEME', 'MDX-only themes are disabled for untrusted content')
  if (adapter && !adapter.bundled)
    throw new ServiceError(
      'REMOTE_THEME_DISABLED',
      'Remote themes require a bounded trusted downloader; choose scaffold or a bundled theme',
    )
  // Step 0 (optional): Load MySQL dump for richer metadata
  const dbPath = options.db ? resolve(options.db) : undefined
  let dbData: Awaited<ReturnType<typeof readWPDatabase>> | undefined
  if (dbPath) {
    if (!existsSync(dbPath)) {
      throw new ServiceError(
        'MIGRATION_FAILED',
        'Migration failed: invalid input or conversion error',
      )
    }
    try {
      const sql = await readFile(dbPath, 'utf-8')
      if (
        !/INSERT INTO \x60?[a-z0-9_]+(?:postmeta|users|options)\x60?[^;]+;/i.test(
          sql,
        )
      )
        throw new Error('Malformed or unsupported WordPress SQL dump')
      dbData = await readWPDatabase(dbPath)
      if (
        !dbData.postMeta.size &&
        !dbData.users.size &&
        !Object.keys(dbData.options).length
      )
        throw new Error('SQL dump contains no supported metadata rows')
    } catch (err) {
      throw new ServiceError(
        'MIGRATION_FAILED',
        'Migration failed: invalid input or conversion error',
      )
    }
  }
  let wpExport: Awaited<ReturnType<typeof parseWPExport>>
  let xmlContent: string
  try {
    xmlContent = await readFile(inputFile, 'utf-8')
    if (/<!DOCTYPE|<!ENTITY/i.test(xmlContent)) throw new Error('XML DTD/entities disabled')
    const { XMLValidator } = await import('fast-xml-parser')
    if (XMLValidator.validate(xmlContent) !== true)
      throw new Error('Malformed XML')
    wpExport = await parseWPExport(inputFile, dbData)
  } catch (err) {
    throw new ServiceError(
      'MIGRATION_FAILED',
      'Migration failed: invalid input or conversion error',
    )
  }
  validateExportPaths(wpExport)
  const allMenus = parseNavFromXml(
    xmlContent!,
    wpExport.posts,
    wpExport.categories,
    wpExport.siteUrl,
  )
  // Primary menu: prefer 'main', then 'primary', then first available
  const navItems =
    allMenus['main'] ?? allMenus['primary'] ?? Object.values(allMenus)[0] ?? []
  // Step 2: Bounded native conversion (no upstream subprocess)
  const tmpDir = await mkdtemp(join(await tempRoot(), 'depress-migrate-'))
  try {
    // Input validation runs before conversion; upstream wp2md is never invoked.
    const contentDest = adapter ? join(tmpDir, 'content') : outputDir
    const transformResult = await convertSafeExport(wpExport, contentDest, wpDir)
    // Step 3b: Generate redirect map
    const redirectMap: Record<string, string> = {}
    const netlifyRedirects: string[] = [
      '# Generated by depress — do not edit manually',
    ]
    for (const post of wpExport.posts) {
      if (post.status !== 'publish') continue
      const newPath =
        post.type === 'page' ? `/${post.slug}/` : `/blog/${post.slug}/`
      const date = new Date(post.date)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const oldPaths = [`/${y}/${m}/${post.slug}/`, `/?p=${post.id}`]
      for (const old of oldPaths) {
        if (old !== newPath) {
          redirectMap[old] = newPath
          netlifyRedirects.push(`${old}  ${newPath}  301`)
        }
      }
    }
    await mkdir(outputDir, { recursive: true })
    await safeWriteFile(outputDir, 'redirects.json', JSON.stringify(redirectMap, null, 2) + '\n')
    await safeWriteFile(outputDir, '_redirects', netlifyRedirects.join('\n') + '\n')
    if (adapter) {
      // ── Theme mode ──────────────────────────────────────────────────────────

      try {
        await mkdir(outputDir, { recursive: true })
        await provisionTheme(adapter, outputDir)
        await clearSampleContent(outputDir, adapter)
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true })
        throw new ServiceError(
          'MIGRATION_FAILED',
          'Migration failed: invalid input or conversion error',
        )
      }
      try {
        await injectContent(
          join(tmpDir, 'content'),
          outputDir,
          adapter,
          wpExport.siteTitle || '',
        )
        if (adapter.patchConfig) {
          await adapter.patchConfig(outputDir, {
            siteTitle: wpExport.siteTitle || 'My Blog',
            siteDescription: `${wpExport.siteTitle} — blog`,
            siteUrl: 'https://your-site.pages.dev',
            authorName: '',
            navItems,
            allMenus,
          })
        }
        // Keystatic "local" storage requires a git repo — init one if needed
        const gitDir = join(outputDir, '.git')
        if (!existsSync(gitDir)) {
          try {
            await checkedSpawn(
              'git',
              ['-c', 'core.hooksPath=/dev/null', 'init', '-q'],
              { cwd: outputDir, env: safeEnvironment(tmpDir) },
            )
          } catch {
            throw new ServiceError(
              'GIT_INIT_FAILED',
              'Could not initialize generated site repository',
            )
          }
        }
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true })
        throw new ServiceError(
          'MIGRATION_FAILED',
          'Migration failed: invalid input or conversion error',
        )
      }
    } else {
      try {
        await writeTaxonomy(wpExport.categories, wpExport.tags, outputDir)
      } catch {
        throw new ServiceError('TAXONOMY_FAILED', 'Could not write taxonomy')
      }
      try {
        await scaffoldAstroProject(
          {
            siteTitle: wpExport.siteTitle || 'My Blog',
            siteDescription: `${wpExport.siteTitle} — блог`,
            siteUrl: 'https://your-site.pages.dev',
            authorName: '',
            navItems,
            allMenus,
            hasCategories: wpExport.categories.length > 0,
            hasTags: wpExport.tags.length > 0,
          },
          outputDir,
        )
      } catch (err) {
        await rm(tmpDir, { recursive: true, force: true })
        throw new ServiceError(
          'MIGRATION_FAILED',
          'Migration failed: invalid input or conversion error',
        )
      }
    }
    return {
      outputDir,
      posts: transformResult.postsTransformed,
      pages: transformResult.pagesTransformed,
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function resolveInput(input?: string): Promise<string | null> {
  if (input) return resolve(input)
  for (const name of ['export.xml', 'wordpress.xml', 'wp-export.xml']) {
    try {
      const { access } = await import('fs/promises')
      await access(name)
      return resolve(name)
    } catch {
      /* not found */
    }
  }
  return null
}
export async function writeTaxonomy(
  categories: Array<{
    slug: string
    name: string
    description: string
  }>,
  tags: Array<{
    slug: string
    name: string
  }>,
  outputDir: string,
): Promise<void> {
  assertUniqueSegments(categories.map(c => c.slug))
  assertUniqueSegments(tags.map(t => t.slug))
  await assertSafeTree(outputDir)
  const catDir = join(outputDir, 'src', 'content', 'categories')
  await mkdir(catDir, { recursive: true })
  for (const cat of categories) {
    await safeWriteFile(outputDir,
      join('src/content/categories', `${safeSegment(cat.slug)}.yaml`),
      `name: ${JSON.stringify(cat.name)}\ndescription: ${JSON.stringify(cat.description ?? '')}\n`,
    )
  }
  const tagDir = join(outputDir, 'src', 'content', 'tags')
  await mkdir(tagDir, { recursive: true })
  for (const tag of tags) {
    await safeWriteFile(outputDir,
      join('src/content/tags', `${safeSegment(tag.slug)}.yaml`),
      `name: ${JSON.stringify(tag.name)}\n`,
    )
  }
}
