import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { scaffoldAstroProject } from '@depress-org/wp-migrate'

interface InitOptions {
  template: string
}

export async function runInit(_options: InitOptions) {
  console.log(chalk.cyan.bold('\n🔓 depress init') + chalk.gray(' — Create a new Astro + Keystatic blog\n'))

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'siteTitle',
      message: 'Site title:',
      default: 'My Blog',
      validate: (v: string) => v.trim().length > 0 || 'Title is required',
    },
    {
      type: 'input',
      name: 'siteDescription',
      message: 'Site description:',
      default: 'A personal blog',
    },
    {
      type: 'input',
      name: 'authorName',
      message: 'Author name:',
      default: '',
    },
    {
      type: 'input',
      name: 'outputDir',
      message: 'Output directory:',
      default: './my-blog',
      validate: (v: string) => v.trim().length > 0 || 'Directory is required',
    },
  ])

  const outputDir = resolve(answers.outputDir.trim())

  if (existsSync(outputDir)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Directory ${chalk.yellow(answers.outputDir)} already exists. Continue?`,
        default: false,
      },
    ])
    if (!overwrite) {
      console.log(chalk.gray('\nAborted.'))
      return
    }
  }

  const spinner = ora('Scaffolding Astro + Keystatic project…').start()

  try {
    await scaffoldAstroProject(
      {
        siteTitle: answers.siteTitle.trim(),
        siteDescription: answers.siteDescription.trim(),
        siteUrl: 'https://your-site.pages.dev',
        authorName: answers.authorName.trim(),
        navItems: [
          { label: 'Home', href: '/' },
          { label: 'Blog', href: '/blog' },
        ],
        hasCategories: false,
        hasTags: false,
      },
      outputDir,
    )
    spinner.succeed('Project scaffolded!')
  } catch (err) {
    spinner.fail(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  console.log(chalk.bold.green('\n✅ Done!\n'))
  console.log(`  Directory: ${chalk.cyan(answers.outputDir)}`)
  console.log()
  console.log(chalk.bold('Next steps:'))
  console.log(`  ${chalk.cyan(`cd ${answers.outputDir}`)}`)
  console.log(`  ${chalk.cyan('npm start')}`)
  console.log(`  → ${chalk.underline('http://localhost:4321')}`)
  console.log(`  → ${chalk.underline('http://localhost:4321/keystatic')}  ${chalk.gray('(CMS admin)')}`)
  console.log()
  console.log(chalk.gray('Tip: run ') + chalk.cyan('depress migrate --input your-export.xml') + chalk.gray(' to import WordPress content'))
}
