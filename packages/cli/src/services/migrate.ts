import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { checkedSpawn, safeEnvironment, ServiceError } from './process.js'
import { createRequire } from 'node:module'
import {
  parseWPExport,
  readWPDatabase,
  parseNavFromXml,
  transformWp2mdOutput,
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
function resolveWp2mdBin(): string {
  return createRequire(import.meta.url).resolve(
    'wordpress-export-to-markdown/app.js',
  )
}
// ── Helper: run wp2md stage 1 ─────────────────────────────────────────────────
async function runWp2mdStage1(opts: {
  inputXml: string
  wpDir?: string
  outputDir: string
}): Promise<void> {
  const { inputXml, wpDir, outputDir } = opts
  await mkdir(outputDir, { recursive: true })
  let effectiveInput = inputXml
  let serverStop: (() => void) | undefined
  let tmpXmlPath: string | undefined
  try {
    if (wpDir && existsSync(wpDir)) {
      const { createServer } = await import('http')
      const { createReadStream } = await import('fs')
      const { extname: ext } = await import('path')
      const MIME_MAP: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      }
      const server = createServer((req, res) => {
        let rawPath = (req.url ?? '/').split('?')[0]
        try {
          rawPath = decodeURIComponent(rawPath)
        } catch {
          /* keep */
        }
        const filePath = resolve(wpDir, '.' + rawPath)
        if (!filePath.startsWith(resolve(wpDir) + '/')) {
          res.writeHead(403)
          res.end()
          return
        }
        if (!existsSync(filePath)) {
          res.writeHead(404)
          res.end()
          return
        }
        const ct =
          MIME_MAP[ext(filePath).toLowerCase()] ?? 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': ct })
        const stream = createReadStream(filePath)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
      })
      const port = await new Promise<number>((res, rej) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          if (addr && typeof addr !== 'string') res(addr.port)
          else rej(new Error('Could not bind server'))
        })
        server.on('error', rej)
      })
      const localBase = `http://127.0.0.1:${port}`
      serverStop = () => {
        server.closeAllConnections()
        server.close()
      }
      const rawXml = await readFile(inputXml, 'utf-8')
      const siteUrlMatch = rawXml.match(/<link>(https?:\/\/[^<]+)<\/link>/)
      const siteUrl = siteUrlMatch
        ? siteUrlMatch[1].trim()
        : 'https://example.com'
      let patched = rawXml
      try {
        const u = new URL(siteUrl)
        for (const variant of [
          u.origin,
          u.origin.replace(/^https:\/\//, 'http://'),
          u.origin.replace(/^http:\/\//, 'https://'),
        ]) {
          patched = patched.split(variant).join(localBase)
        }
      } catch {
        /* ignore */
      }
      patched = patched.split('http://127.0.0.1/wp/').join(`${localBase}/`)
      patched = patched.split('https://127.0.0.1/wp/').join(`${localBase}/`)
      patched = patched.replace(
        /(<wp:attachment_url><!\[CDATA\[)(\/wp-content\/)/g,
        `$1${localBase}$2`,
      )
      patched = patched.replace(
        /<link>(\/[^<]*)<\/link>/g,
        `<link>${localBase}$1</link>`,
      )
      const tmpXmlDir = await mkdtemp(join(await tempRoot(), 'depress-xml-'))
      tmpXmlPath = join(tmpXmlDir, 'patched.xml')
      await writeFile(tmpXmlPath, patched, 'utf-8')
      effectiveInput = tmpXmlPath
    }
    // Always patch relative <link> elements so wp2md can resolve scraped image URLs,
    // even when no local media server is running. Read from either the already-patched
    // tmpXmlPath (wpDir flow) or the original inputXml.
    {
      const xmlToCheck = tmpXmlPath ?? inputXml
      const xmlContent = await readFile(xmlToCheck, 'utf-8')
      if (xmlContent.includes('<link>/')) {
        const siteUrlMatch = xmlContent.match(
          /<channel>[\s\S]*?<link>(https?:\/\/[^<]+)<\/link>/,
        )
        const siteOrigin = siteUrlMatch
          ? (() => {
              try {
                return new URL(siteUrlMatch[1].trim()).origin
              } catch {
                return ''
              }
            })()
          : ''
        if (siteOrigin) {
          const patched = xmlContent.replace(
            /<link>(\/[^<]*)<\/link>/g,
            `<link>${siteOrigin}$1</link>`,
          )
          if (patched !== xmlContent) {
            if (!tmpXmlPath) {
              const tmpXmlDir = await mkdtemp(
                join(await tempRoot(), 'depress-xml-'),
              )
              tmpXmlPath = join(tmpXmlDir, 'patched.xml')
            }
            await writeFile(tmpXmlPath, patched, 'utf-8')
            effectiveInput = tmpXmlPath
          }
        }
      }
    }
    const binPath = resolveWp2mdBin()
    const conversion = await checkedSpawn(
      process.execPath,
      [
        binPath,
        '--wizard=false',
        '--input=' + effectiveInput,
        '--output=' + outputDir,
        '--save-images=all',
        '--post-folders=true',
        '--prefix-date=false',
        '--date-folders=none',
        '--strict-ssl=true',
        '--request-delay=100',
        '--write-delay=10',
      ],
      { cwd: outputDir, env: safeEnvironment(resolve(outputDir, '..')) },
    )
    // Upstream app.js catches exceptions without setting a nonzero exit status.
    if (
      !conversion.stdout.includes('All done!') ||
      conversion.stdout.includes('execution halted early')
    )
      throw new ServiceError(
        'CONVERSION_FAILED',
        'WordPress conversion did not complete',
      )
  } finally {
    if (serverStop) serverStop()
    if (tmpXmlPath) {
      const tmpXmlDir = tmpXmlPath.replace(/\/patched\.xml$/, '')
      await rm(tmpXmlDir, { recursive: true, force: true }).catch(() => {})
    }
  }
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
  const allMenus = parseNavFromXml(
    xmlContent!,
    wpExport.posts,
    wpExport.categories,
    wpExport.siteUrl,
  )
  // Primary menu: prefer 'main', then 'primary', then first available
  const navItems =
    allMenus['main'] ?? allMenus['primary'] ?? Object.values(allMenus)[0] ?? []
  // Step 2: Run wp2md stage 1
  const tmpDir = await mkdtemp(join(await tempRoot(), 'depress-migrate-'))
  const wp2mdOut = join(tmpDir, 'wp2md')
  try {
    try {
      await runWp2mdStage1({ inputXml: inputFile, wpDir, outputDir: wp2mdOut })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true })
      throw new ServiceError(
        'MIGRATION_FAILED',
        'Migration failed: invalid input or conversion error',
      )
    }
    let transformResult: Awaited<ReturnType<typeof transformWp2mdOutput>>
    // For theme mode, write to tmpDir so scaffold/theme files stay separate
    const contentDest = adapter ? join(tmpDir, 'content') : outputDir
    try {
      await mkdir(contentDest, { recursive: true })
      const categoryNames = new Map(
        wpExport.categories.map((c) => [c.slug, c.name]),
      )
      const authorsBySlug = new Map(
        wpExport.posts
          .filter((p: { author?: string }) => p.author && p.author.trim())
          .map(
            (p: { slug: string; author: string }) =>
              [p.slug, p.author] as const,
          ),
      )
      transformResult = await transformWp2mdOutput({
        wp2mdDir: wp2mdOut,
        outputDir: contentDest,
        categoryNames,
        authorsBySlug,
      })
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true })
      throw new ServiceError(
        'MIGRATION_FAILED',
        'Migration failed: invalid input or conversion error',
      )
    }
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
    await writeFile(
      join(outputDir, 'redirects.json'),
      JSON.stringify(redirectMap, null, 2) + '\n',
      'utf-8',
    )
    await writeFile(
      join(outputDir, '_redirects'),
      netlifyRedirects.join('\n') + '\n',
      'utf-8',
    )
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

async function resolveInput(input?: string): Promise<string | null> {
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
async function writeTaxonomy(
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
  const catDir = join(outputDir, 'src', 'content', 'categories')
  await mkdir(catDir, { recursive: true })
  for (const cat of categories) {
    await writeFile(
      join(catDir, `${cat.slug}.yaml`),
      `name: ${JSON.stringify(cat.name)}\ndescription: ${JSON.stringify(cat.description ?? '')}\n`,
      'utf-8',
    )
  }
  const tagDir = join(outputDir, 'src', 'content', 'tags')
  await mkdir(tagDir, { recursive: true })
  for (const tag of tags) {
    await writeFile(
      join(tagDir, `${tag.slug}.yaml`),
      `name: ${JSON.stringify(tag.name)}\n`,
      'utf-8',
    )
  }
}
