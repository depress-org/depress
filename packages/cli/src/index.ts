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
  .description('Migrate WordPress site to Astro + Keystatic')
  .option('-i, --input <path>', 'Path to WordPress XML export file')
  .option('-m, --media <path>', 'Path to WordPress media folder (wp-content/uploads)')
  .option('-o, --output <path>', 'Output directory', './output')
  .action(async (options) => {
    const { runMigrate } = await import('./commands/migrate.js')
    await runMigrate(options)
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
