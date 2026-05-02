import inquirer from 'inquirer'
import chalk from 'chalk'
import ora from 'ora'

interface InitOptions {
  template: string
}

export async function runInit(options: InitOptions) {
  console.log(chalk.cyan('🚀 Creating a new Astro + Keystatic site\n'))

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: 'my-blog',
    },
    {
      type: 'list',
      name: 'template',
      message: 'Choose a template:',
      choices: [
        { name: '📝 Blog (recommended)', value: 'blog' },
        { name: '🗂️  Portfolio', value: 'portfolio' },
        { name: '⚡ Minimal', value: 'minimal' },
      ],
      default: options.template,
    },
    {
      type: 'input',
      name: 'githubRepo',
      message: 'GitHub repository (org/repo):',
      validate: (input: string) => input.includes('/') || 'Format: org/repo',
    },
  ])

  const spinner = ora('Scaffolding project...').start()

  // TODO: Implement scaffolding
  await new Promise((resolve) => setTimeout(resolve, 1000))

  spinner.succeed(chalk.green(`Project "${answers.projectName}" created!`))
  console.log(`\nNext steps:`)
  console.log(`  cd ${answers.projectName}`)
  console.log(`  npm install`)
  console.log(`  npm run dev`)
}
