#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'

const program = new Command()

console.log(chalk.bold.green('\n🔓 depress') + chalk.gray(' — De-press yourself.\n'))

program
  .name('depress')
  .description('WordPress to Astro + Keystatic migration tool. Free your blog.')
  .version('0.1.0')

program
  .command('init')
  .description('Create a new Astro + Keystatic site from scratch')
  .option('-t, --template <template>', 'Template to use (blog, portfolio, minimal)', 'blog')
  .action(async (options) => {
    const { runInit } = await import('./commands/init.js')
    await runInit(options)
  })

program
  .command('migrate')
  .description('Migrate WordPress site to Astro + Keystatic (full pipeline)')
  .option('-i, --input <path>', 'Path to WordPress XML export file')
  .option('-d, --wp-dir <path>', 'Path to WordPress public_html directory (contained local raster copies; no network fallback)')
  .option('--db <path>', 'WordPress MySQL dump (.sql) — enables Yoast SEO, ACF fields, author profiles')
  .option('-o, --output <path>', 'Output directory', './output')
  .option('--static-plugins <path>', 'Path to strict static-plugin v1 JSON config (reviewed in-tree IDs only)')
  .option('--repo <owner/repo>', 'GitHub repo for Keystatic config (e.g. my-org/my-blog)')
  .option('-t, --theme <id>', 'Safe themes: astrowind (default) | scaffold; MDX-only/remote themes disabled', 'astrowind')
  .action(async (options) => {
    const { runMigrate } = await import('./commands/migrate.js')
    const { existsSync } = await import('node:fs')
    const { readdir } = await import('node:fs/promises')
    const { default: inquirer } = await import('inquirer')
    if (!options.input) {
      const answer = await inquirer.prompt([{ type: 'input', name: 'input', message: 'WordPress XML export path:' }])
      options.input = answer.input
    }
    if (existsSync(options.output) && (await readdir(options.output)).length) {
      const { overwrite } = await inquirer.prompt([{ type: 'confirm', name: 'overwrite', message: 'Output is not empty. Overwrite?', default: false }])
      if (!overwrite) return
      options.overwrite = true
    }
    if (options.staticPlugins) {
      const { readFile, stat } = await import('node:fs/promises')
      try {
        if ((await stat(options.staticPlugins)).size > 1_048_576) throw new Error('PLUGIN_CONFIG_INVALID')
        options.staticPlugins = JSON.parse(await readFile(options.staticPlugins, 'utf8'))
      } catch { options.staticPlugins = null } // canonical service report, no raw file/error disclosure
    }
    const result = await runMigrate(options)
    if (!result.qualityPassed) { console.error('Migration needs review; see migration-report.json and migration-report.md'); process.exitCode = 1; return }
    console.log(`Migration complete: ${result.outputDir}`)
  })

program
  .command('wp2md')
  .description('Disabled raw converter; use migrate for bounded conversion (#24)')
  .requiredOption('-i, --input <path>', 'Path to WordPress XML export file')
  .option('-d, --wp-dir <path>', 'Path to WordPress public_html directory (enables local media serving)')
  .option('-o, --output <path>', 'Output directory', './output')
  .option('--save-images <mode>', 'Which images to save: all | attached | scraped | none', 'all')
  .option('--post-folders <bool>', 'Put each post in its own folder', (v) => v !== 'false', true)
  .option('--prefix-date <bool>', 'Add date prefix to post folder/file names', (v) => v !== 'false', false)
  .option('--date-folders <mode>', 'Organise posts into date folders: none | year | year-month', 'none')
  .option('--strict-ssl <bool>', 'Use strict SSL when downloading images', (v) => v !== 'false', true)
  .option('--request-delay <ms>', 'Delay in ms between image download requests', (v) => parseInt(v, 10), 500)
  .action(async (options) => {
    const { runWp2md } = await import('./commands/wp2md.js')
    await runWp2md(options)
  })

program
  .command('deploy')
  .description('Deploy site to Cloudflare Pages (or Netlify/Vercel)')
  .option('-d, --dir <path>', 'Directory to build & deploy', '.')
  .option(
    '-t, --target <target>',
    'Deploy target: cloudflare-pages | netlify | vercel',
    'cloudflare-pages',
  )
  .option('--token <token>', 'API token for the deploy target (overrides env var)')
  .option('--project-name <name>', 'Project/site name for the deploy target')
  .action(async (options) => {
    const { runDeploy } = await import('./commands/deploy.js')
    const keys: Record<string, string> = { 'cloudflare-pages': 'CLOUDFLARE_API_TOKEN', netlify: 'NETLIFY_AUTH_TOKEN', vercel: 'VERCEL_TOKEN' }
    const envKey = keys[options.target]
    const result = await runDeploy({ ...options, token: options.token ?? (envKey ? process.env[envKey] : undefined) })
    console.log(`Deployment complete: ${result.deployUrl}`)
  })

program
  .command('check')
  .description('Run QA checks on migrated content')
  .option('-d, --dir <path>', 'Directory to check', '.')
  .action(async (options) => {
    const { runCheck } = await import('./commands/check.js')
    await runCheck(options)
  })

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed')
  process.exitCode = 1
})
