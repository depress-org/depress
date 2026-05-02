import { rm, readdir } from 'fs/promises'
import { join } from 'path'
import chalk from 'chalk'

type RollbackScope = 'all' | 'articles' | 'pages' | 'media'

/**
 * Rollback migrated content
 */
export async function rollback(outputDir: string, scope: RollbackScope = 'all') {
  console.log(chalk.yellow(`\n⏪ Rolling back: ${scope}\n`))

  const targets: string[] = []

  if (scope === 'all' || scope === 'articles') {
    targets.push(join(outputDir, 'src', 'content', 'articles'))
  }
  if (scope === 'all' || scope === 'pages') {
    targets.push(join(outputDir, 'src', 'content', 'pages'))
  }
  if (scope === 'all' || scope === 'media') {
    targets.push(join(outputDir, 'public', 'media'))
  }
  if (scope === 'all') {
    targets.push(join(outputDir, 'src', 'content', 'categories'))
    targets.push(join(outputDir, 'src', 'content', 'tags'))
  }

  for (const target of targets) {
    try {
      await rm(target, { recursive: true, force: true })
      console.log(chalk.green(`  ✓ Removed: ${target}`))
    } catch {
      console.log(chalk.gray(`  - Skipped (not found): ${target}`))
    }
  }

  console.log(chalk.green('\n✅ Rollback complete. Fix the issue and run migrate again.'))
}
