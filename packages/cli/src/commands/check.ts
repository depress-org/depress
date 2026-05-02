import chalk from 'chalk'

interface CheckOptions {
  dir: string
}

export async function runCheck(options: CheckOptions) {
  console.log(chalk.cyan(`🔍 Running QA checks in ${options.dir}\n`))
  console.log(chalk.yellow('QA check command coming soon! 🚧'))
}
