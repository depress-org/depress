import chalk from 'chalk'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

export type DeployTarget = 'cloudflare-pages' | 'netlify' | 'vercel'

export interface DeployOptions {
  dir?: string
  target?: DeployTarget
  token?: string
  projectName?: string
}

export interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
}

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<SpawnResult>

/** Default implementation of SpawnFn — runs a real child process. Tests inject a mock instead. */
export function defaultSpawn(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<SpawnResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolvePromise({ code, stdout, stderr })
    })
  })
}

function resolveToken(target: DeployTarget, explicit?: string): string | undefined {
  if (explicit) return explicit
  switch (target) {
    case 'cloudflare-pages':
      return process.env.CLOUDFLARE_API_TOKEN
    case 'netlify':
      return process.env.NETLIFY_AUTH_TOKEN
    case 'vercel':
      return process.env.VERCEL_TOKEN
    default:
      return undefined
  }
}

function envVarNameFor(target: DeployTarget): string {
  switch (target) {
    case 'cloudflare-pages':
      return 'CLOUDFLARE_API_TOKEN'
    case 'netlify':
      return 'NETLIFY_AUTH_TOKEN'
    case 'vercel':
      return 'VERCEL_TOKEN'
  }
}

/** Extract the deployed URL from a target CLI's stdout. */
export function extractDeployedUrl(target: DeployTarget, stdout: string): string | null {
  const patterns: Record<DeployTarget, RegExp> = {
    'cloudflare-pages': /https:\/\/[a-z0-9.-]+\.pages\.dev\S*/i,
    netlify: /https:\/\/[a-z0-9.-]+\.netlify\.app\S*/i,
    vercel: /https:\/\/[a-z0-9.-]+\.vercel\.app\S*/i,
  }
  const match = stdout.match(patterns[target])
  return match ? match[0] : null
}

export async function buildSite(dir: string, spawnFn: SpawnFn = defaultSpawn): Promise<SpawnResult> {
  return spawnFn('npm', ['run', 'build'], { cwd: dir, env: process.env })
}

export async function deployToCloudflarePages(
  dir: string,
  opts: { token: string; projectName?: string },
  spawnFn: SpawnFn = defaultSpawn,
): Promise<SpawnResult> {
  const args = ['wrangler', 'pages', 'deploy', 'dist']
  if (opts.projectName) args.push('--project-name', opts.projectName)
  return spawnFn('npx', args, {
    cwd: dir,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: opts.token },
  })
}

export async function deployToNetlify(
  dir: string,
  opts: { token: string; projectName?: string },
  spawnFn: SpawnFn = defaultSpawn,
): Promise<SpawnResult> {
  const args = ['netlify-cli', 'deploy', '--prod', '--dir=dist']
  if (opts.projectName) args.push(`--site=${opts.projectName}`)
  return spawnFn('npx', args, {
    cwd: dir,
    env: { ...process.env, NETLIFY_AUTH_TOKEN: opts.token },
  })
}

export async function deployToVercel(
  dir: string,
  opts: { token: string; projectName?: string },
  spawnFn: SpawnFn = defaultSpawn,
): Promise<SpawnResult> {
  const args = ['vercel', 'deploy', '--prod', '--token', opts.token, '--yes']
  if (opts.projectName) args.push('--name', opts.projectName)
  return spawnFn('npx', args, { cwd: dir, env: process.env })
}

export async function runDeploy(options: DeployOptions = {}, spawnFn: SpawnFn = defaultSpawn): Promise<void> {
  const dir = resolve(options.dir ?? '.')
  const target: DeployTarget = options.target ?? 'cloudflare-pages'

  console.log(chalk.cyan(`🚀 Deploying ${dir} to ${target}\n`))

  if (!existsSync(dir)) {
    console.log(chalk.red(`❌ Directory not found: ${dir}`))
    process.exitCode = 1
    return
  }

  const token = resolveToken(target, options.token)
  if (!token) {
    console.log(
      chalk.red(
        `❌ No API token found. Pass --token or set ${envVarNameFor(target)} in your environment. ` +
          'Credentials are never read from or written to the repo.',
      ),
    )
    process.exitCode = 1
    return
  }

  console.log(chalk.gray('Building site (npm run build)…'))
  const buildResult = await buildSite(dir, spawnFn)
  if (buildResult.code !== 0) {
    console.log(chalk.red(`❌ Build failed (exit ${buildResult.code})`))
    if (buildResult.stderr) console.log(chalk.gray(buildResult.stderr.split('\n').slice(-10).join('\n')))
    process.exitCode = 1
    return
  }
  console.log(chalk.green('✅ Build succeeded'))

  console.log(chalk.gray(`Deploying via ${target}…`))
  let deployResult: SpawnResult
  switch (target) {
    case 'cloudflare-pages':
      deployResult = await deployToCloudflarePages(dir, { token, projectName: options.projectName }, spawnFn)
      break
    case 'netlify':
      deployResult = await deployToNetlify(dir, { token, projectName: options.projectName }, spawnFn)
      break
    case 'vercel':
      deployResult = await deployToVercel(dir, { token, projectName: options.projectName }, spawnFn)
      break
    default:
      console.log(chalk.red(`❌ Unknown target: ${target}`))
      process.exitCode = 1
      return
  }

  if (deployResult.code !== 0) {
    console.log(chalk.red(`❌ Deploy failed (exit ${deployResult.code})`))
    if (deployResult.stderr) console.log(chalk.gray(deployResult.stderr.split('\n').slice(-10).join('\n')))
    process.exitCode = 1
    return
  }

  const url = extractDeployedUrl(target, deployResult.stdout)
  console.log(chalk.bold.green('\n✅ Deploy complete!'))
  if (url) {
    console.log(`  URL: ${chalk.underline(url)}`)
  } else {
    console.log(chalk.yellow('  Deploy succeeded but the live URL could not be parsed from CLI output.'))
    console.log(chalk.gray(deployResult.stdout.split('\n').slice(-10).join('\n')))
  }
}
