import chalk from 'chalk'
import ora from 'ora'
import { parseWPExport, transformPosts, generateKeystaticConfig, migrateMedia } from '@depress/wp-migrate'
import { writeFile, mkdir, access } from 'fs/promises'
import { join, resolve } from 'path'

interface MigrateOptions {
  input?: string
  media?: string
  output: string
}

export async function runMigrate(options: MigrateOptions) {
  console.log(chalk.cyan('WordPress → Astro + Keystatic migration\n'))

  const outputDir = resolve(options.output)

  const inputFile = await resolveInput(options.input)
  if (!inputFile) {
    console.error(chalk.red('No WordPress export file found.'))
    console.error(chalk.gray('Provide one with: depress migrate --input export.xml'))
    process.exit(1)
  }

  // Phase 1: Parse WP export
  const parseSpinner = ora('Parsing WordPress export...').start()
  let wpExport
  try {
    wpExport = await parseWPExport(inputFile)
    parseSpinner.succeed(
      `Parsed "${wpExport.siteTitle}": ` +
        `${wpExport.posts.length} posts, ` +
        `${wpExport.categories.length} categories, ` +
        `${wpExport.tags.length} tags`,
    )
  } catch (err) {
    parseSpinner.fail(`Parse failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  // Phase 2: Transform posts to Markdoc
  const transformSpinner = ora('Converting posts to Markdoc...').start()
  let report
  try {
    report = await transformPosts(wpExport.posts, outputDir)
    transformSpinner.succeed(
      `Converted: ${chalk.green(String(report.success))} published, ` +
        `${chalk.gray(String(report.skipped))} drafts skipped` +
        (report.errors > 0 ? `, ${chalk.red(String(report.errors))} errors` : ''),
    )
  } catch (err) {
    transformSpinner.fail(`Transform failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  // Phase 3: Migrate media files
  let urlMap = new Map<string, string>()
  if (options.media) {
    const mediaSpinner = ora('Migrating media files...').start()
    try {
      urlMap = await migrateMedia(resolve(options.media), outputDir, wpExport.siteUrl)
      mediaSpinner.succeed(`Media: ${urlMap.size} files migrated`)
    } catch (err) {
      mediaSpinner.warn(`Media skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Phase 4: Generate keystatic.config.ts
  const configSpinner = ora('Generating Keystatic config...').start()
  try {
    const repo = (await inferGitRepo()) ?? 'your-org/your-repo'
    const configCode = generateKeystaticConfig(wpExport, repo)
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'keystatic.config.ts'), configCode, 'utf-8')
    configSpinner.succeed('Generated keystatic.config.ts')
  } catch (err) {
    configSpinner.fail(`Config generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Phase 5: Write taxonomy YAML entries
  if (wpExport.categories.length > 0 || wpExport.tags.length > 0) {
    const taxSpinner = ora('Writing taxonomy entries...').start()
    try {
      await writeTaxonomy(wpExport.categories, wpExport.tags, outputDir)
      taxSpinner.succeed(
        `Taxonomies: ${wpExport.categories.length} categories, ${wpExport.tags.length} tags`,
      )
    } catch (err) {
      taxSpinner.warn(`Taxonomy write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Summary
  console.log(chalk.bold.green('\nMigration complete!\n'))
  console.log(`  Articles migrated : ${chalk.bold(String(report.success))}`)
  if (report.skipped > 0) console.log(`  Drafts skipped    : ${chalk.gray(String(report.skipped))}`)
  if (urlMap.size > 0) console.log(`  Media files       : ${chalk.bold(String(urlMap.size))}`)
  if (report.errors > 0) {
    console.log(`  Errors            : ${chalk.red(String(report.errors))}`)
    for (const { slug, error } of report.errorDetails.slice(0, 5)) {
      console.log(`    ${chalk.red('-')} ${slug}: ${error}`)
    }
  }
  console.log(`\n  Output: ${chalk.cyan(outputDir)}`)
  console.log(chalk.gray('\nNext steps:'))
  console.log(`  cd ${options.output} && npm install && npm run dev`)
}

async function resolveInput(input?: string): Promise<string | null> {
  if (input) return resolve(input)
  for (const name of ['export.xml', 'wordpress.xml', 'wp-export.xml']) {
    try {
      await access(name)
      return resolve(name)
    } catch {
      // not found, try next
    }
  }
  return null
}

async function inferGitRepo(): Promise<string | null> {
  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const exec = promisify(execFile)
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'])
    const match = stdout.trim().match(/github\.com[:/]([^/\s]+\/[^/\s.]+)/)
    return match ? match[1].replace(/\.git$/, '') : null
  } catch {
    return null
  }
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
