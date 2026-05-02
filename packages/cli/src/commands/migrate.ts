import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import {
  parseWPExport,
  parseNavFromXml,
  transformWp2mdOutput,
  scaffoldAstroProject,
} from '@depress-org/wp-migrate'


export interface MigrateOptions {
  input?: string
  wpDir?: string
  output: string
  repo?: string
}

// ── Helper: resolve wp2md bin ─────────────────────────────────────────────────

function resolveWp2mdBin(): string {
  const candidates = [
    fileURLToPath(new URL('../../../../../node_modules/wordpress-export-to-markdown/app.js', import.meta.url)),
    fileURLToPath(new URL('../../../../node_modules/wordpress-export-to-markdown/app.js', import.meta.url)),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('wordpress-export-to-markdown not found. Run: npm install')
}

// ── Helper: run wp2md stage 1 ─────────────────────────────────────────────────

async function runWp2mdStage1(opts: {
  inputXml: string
  wpDir?: string
  outputDir: string
}): Promise<void> {
  const { inputXml, wpDir, outputDir } = opts

  let effectiveInput = inputXml
  let serverStop: (() => void) | undefined
  let tmpXmlPath: string | undefined

  if (wpDir && existsSync(wpDir)) {
    const { createServer } = await import('http')
    const { createReadStream } = await import('fs')
    const { extname: ext } = await import('path')

    const MIME_MAP: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp',
    }

    const server = createServer((req, res) => {
      let rawPath = (req.url ?? '/').split('?')[0]
      try { rawPath = decodeURIComponent(rawPath) } catch { /* keep */ }
      const safePath = join(wpDir, rawPath.replace(/\.\./g, ''))
      const filePath = resolve(safePath)
      if (!filePath.startsWith(resolve(wpDir))) { res.writeHead(403); res.end(); return }
      if (!existsSync(filePath)) { res.writeHead(404); res.end(); return }
      const ct = MIME_MAP[ext(filePath).toLowerCase()] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': ct })
      createReadStream(filePath).pipe(res)
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
    serverStop = () => server.close()

    const rawXml = await readFile(inputXml, 'utf-8')
    const siteUrlMatch = rawXml.match(/<link>(https?:\/\/[^<]+)<\/link>/)
    const siteUrl = siteUrlMatch ? siteUrlMatch[1].trim() : 'https://example.com'

    let patched = rawXml
    try {
      const u = new URL(siteUrl)
      for (const variant of [u.origin, u.origin.replace(/^https:\/\//, 'http://'), u.origin.replace(/^http:\/\//, 'https://')]) {
        patched = patched.split(variant).join(localBase)
      }
    } catch { /* ignore */ }
    patched = patched.split('http://127.0.0.1/wp/').join(`${localBase}/`)
    patched = patched.split('https://127.0.0.1/wp/').join(`${localBase}/`)
    patched = patched.replace(/(<wp:attachment_url><!\[CDATA\[)(\/wp-content\/)/g, `$1${localBase}$2`)
    patched = patched.replace(/<link>(\/[^<]*)<\/link>/g, `<link>${localBase}$1</link>`)

    const tmpXmlDir = await mkdtemp(join(tmpdir(), 'depress-xml-'))
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
      const siteUrlMatch = xmlContent.match(/<channel>[\s\S]*?<link>(https?:\/\/[^<]+)<\/link>/)
      const siteOrigin = siteUrlMatch ? (() => { try { return new URL(siteUrlMatch[1].trim()).origin } catch { return '' } })() : ''
      if (siteOrigin) {
        const patched = xmlContent.replace(/<link>(\/[^<]*)<\/link>/g, `<link>${siteOrigin}$1</link>`)
        if (patched !== xmlContent) {
          if (!tmpXmlPath) {
            const tmpXmlDir = await mkdtemp(join(tmpdir(), 'depress-xml-'))
            tmpXmlPath = join(tmpXmlDir, 'patched.xml')
          }
          await writeFile(tmpXmlPath, patched, 'utf-8')
          effectiveInput = tmpXmlPath
        }
      }
    }
  }

  const binPath = resolveWp2mdBin()
  await new Promise<void>((res, rej) => {
    const child = spawn(process.execPath, [
      binPath, '--wizard=false',
      `--input=${effectiveInput}`,
      `--output=${outputDir}`,
      '--save-images=all', '--post-folders=true', '--prefix-date=false',
      '--date-folders=none', '--strict-ssl=false', '--request-delay=100', '--write-delay=10',
    ], { stdio: 'inherit' })
    child.on('close', (code) => code === 0 ? res() : rej(new Error(`wp2md exited ${code}`)))
    child.on('error', rej)
  })

  if (serverStop) serverStop()
  if (tmpXmlPath) {
    const tmpXmlDir = tmpXmlPath.replace(/\/patched\.xml$/, '')
    await rm(tmpXmlDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runMigrate(options: MigrateOptions) {
  console.log(chalk.cyan.bold('\n🔓 depress migrate') + chalk.gray(' — WordPress → Astro + Keystatic\n'))

  const outputDir = resolve(options.output)
  const inputFile = await resolveInput(options.input)

  if (!inputFile) {
    console.log(chalk.yellow('No WordPress export XML found in current directory.'))
    console.log(chalk.gray('  (looked for export.xml, wordpress.xml, wp-export.xml)\n'))
    const { xmlPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'xmlPath',
        message: 'Path to WordPress export .xml file:',
        validate: (v: string) => {
          const p = resolve(v.trim())
          return existsSync(p) || `File not found: ${p}`
        },
      },
    ])
    const resolved = resolve(xmlPath.trim())
    if (!existsSync(resolved)) {
      console.error(chalk.red(`File not found: ${resolved}`))
      process.exit(1)
    }
    // Re-run with the provided path (simplest approach: mutate and continue)
    options.input = resolved
    return runMigrate(options)
  }

  const wpDir = options.wpDir ? resolve(options.wpDir) : undefined

  // Confirm before overwriting an existing output directory
  if (existsSync(outputDir)) {
    const entries = await readdir(outputDir).catch(() => [])
    if (entries.length > 0) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `Output directory ${chalk.cyan(outputDir)} already exists. Overwrite? (your changes will be lost)`,
        default: false,
      }])
      if (!overwrite) {
        console.log(chalk.yellow('Migration cancelled.'))
        process.exit(0)
      }
    }
  }

  // Step 1: Parse WXR for site metadata + navigation
  const parseSpinner = ora('Reading WordPress export…').start()
  let wpExport: Awaited<ReturnType<typeof parseWPExport>>
  let xmlContent: string
  try {
    xmlContent = await readFile(inputFile, 'utf-8')
    wpExport = await parseWPExport(inputFile)
    const postCount = wpExport.posts.filter((p) => p.status === 'publish' && p.type === 'post').length
    const pageCount = wpExport.posts.filter((p) => p.type === 'page').length
    parseSpinner.succeed(
      `Parsed "${chalk.bold(wpExport.siteTitle)}": ` +
      `${postCount} posts, ${pageCount} pages, ${wpExport.categories.length} categories`
    )
  } catch (err) {
    parseSpinner.fail(`Parse failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const navItems = parseNavFromXml(xmlContent!, wpExport.posts, wpExport.categories, wpExport.siteUrl)
  console.log(chalk.gray(`  Navigation: ${navItems.map((n: { label: string }) => n.label).join(' · ')}`))

  // Step 2: Run wp2md stage 1
  const tmpDir = await mkdtemp(join(tmpdir(), 'depress-migrate-'))
  const wp2mdOut = join(tmpDir, 'wp2md')
  const stage1Spinner = ora('Converting WordPress content to Markdown (stage 1)…').start()
  try {
    await runWp2mdStage1({ inputXml: inputFile, wpDir, outputDir: wp2mdOut })
    stage1Spinner.succeed('Stage 1 complete')
  } catch (err) {
    stage1Spinner.fail(`Stage 1 failed: ${err instanceof Error ? err.message : String(err)}`)
    await rm(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  // Step 3: Transform to Keystatic structure
  const transformSpinner = ora('Transforming to Astro/Keystatic structure (stage 2)…').start()
  let transformResult: Awaited<ReturnType<typeof transformWp2mdOutput>>
  try {
    await mkdir(outputDir, { recursive: true })
    const categoryNames = new Map(wpExport.categories.map((c) => [c.slug, c.name]))
    transformResult = await transformWp2mdOutput({ wp2mdDir: wp2mdOut, outputDir, categoryNames })
    transformSpinner.succeed(
      `Transformed: ${chalk.green(String(transformResult.postsTransformed))} articles, ` +
      `${chalk.green(String(transformResult.pagesTransformed))} pages, ` +
      `${chalk.green(String(transformResult.imagesCopied))} images → /media`
    )
  } catch (err) {
    transformSpinner.fail(`Transform failed: ${err instanceof Error ? err.message : String(err)}`)
    await rm(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  // Step 4: Write taxonomy files
  const taxSpinner = ora('Writing taxonomy entries…').start()
  try {
    await writeTaxonomy(wpExport.categories, wpExport.tags, outputDir)
    taxSpinner.succeed(`Taxonomies: ${wpExport.categories.length} categories, ${wpExport.tags.length} tags`)
  } catch (err) {
    taxSpinner.warn(`Taxonomy write failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Step 5: Scaffold Astro project files
  const scaffoldSpinner = ora('Scaffolding Astro project…').start()
  try {
    await scaffoldAstroProject(
      {
        siteTitle: wpExport.siteTitle || 'My Blog',
        siteDescription: `${wpExport.siteTitle} — блог`,
        siteUrl: 'https://your-site.pages.dev',
        authorName: '',
        navItems,
        hasCategories: wpExport.categories.length > 0,
        hasTags: wpExport.tags.length > 0,
      },
      outputDir,
    )
    scaffoldSpinner.succeed('Astro project scaffolded')
  } catch (err) {
    scaffoldSpinner.fail(`Scaffold failed: ${err instanceof Error ? err.message : String(err)}`)
    await rm(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  await rm(tmpDir, { recursive: true, force: true })

  console.log(chalk.bold.green('\n✅ Migration complete!\n'))
  console.log(`  Output   : ${chalk.cyan(outputDir)}`)
  console.log(`  Articles : ${chalk.bold(String(transformResult.postsTransformed))}`)
  console.log(`  Pages    : ${chalk.bold(String(transformResult.pagesTransformed))}`)
  console.log(`  Media    : ${chalk.bold(String(transformResult.imagesCopied))} files`)

  if (transformResult.imageFailed.length > 0) {
    console.log(chalk.yellow(`\n⚠️  ${transformResult.imageFailed.length} image(s) could not be copied:`))
    for (const msg of transformResult.imageFailed) {
      console.log(chalk.gray(`    • ${msg}`))
    }
  }
  console.log()
  console.log(chalk.bold('Next steps:'))
  console.log(`  ${chalk.cyan(`cd ${options.output}`)}`)
  console.log(`  ${chalk.cyan('npm start')}`)
  console.log(`  → ${chalk.underline('http://localhost:4321')}`)
  console.log(`  → ${chalk.underline('http://localhost:4321/keystatic')}  (CMS admin)`)
}

async function resolveInput(input?: string): Promise<string | null> {
  if (input) return resolve(input)
  for (const name of ['export.xml', 'wordpress.xml', 'wp-export.xml']) {
    try {
      const { access } = await import('fs/promises')
      await access(name)
      return resolve(name)
    } catch { /* not found */ }
  }
  return null
}

async function writeTaxonomy(
  categories: Array<{ slug: string; name: string; description: string }>,
  tags: Array<{ slug: string; name: string }>,
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
    await writeFile(join(tagDir, `${tag.slug}.yaml`), `name: ${JSON.stringify(tag.name)}\n`, 'utf-8')
  }
}
