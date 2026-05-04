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
  .option('-d, --wp-dir <path>', 'Path to WordPress public_html directory (for local image serving)')
  .option('--db <path>', 'WordPress MySQL dump (.sql) — enables Yoast SEO, ACF fields, author profiles')
  .option('-o, --output <path>', 'Output directory', './output')
  .option('--repo <owner/repo>', 'GitHub repo for Keystatic config (e.g. my-org/my-blog)')
  .option('-t, --theme <id>', 'Astro theme (default: astrowind | scaffold for Keystatic-only | rocket|brook|daisyui|mainline|small-biz)', 'astrowind')
  .action(async (options) => {
    const { runMigrate } = await import('./commands/migrate.js')
    await runMigrate(options)
  })

program
  .command('wp2md')
  .description('Migrate WordPress export to Markdown using wordpress-export-to-markdown')
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
  .description('Deploy site to Cloudflare Pages')
  .action(async () => {
    const { runDeploy } = await import('./commands/deploy.js')
    await runDeploy()
  })

program
  .command('check')
  .description('Run QA checks on migrated content')
  .option('-d, --dir <path>', 'Directory to check', '.')
  .action(async (options) => {
    const { runCheck } = await import('./commands/check.js')
    await runCheck(options)
  })

program.parse()
