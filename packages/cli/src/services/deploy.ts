import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, cp } from 'node:fs/promises'
import { resolve, join, dirname, delimiter, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import {
  defaultSpawn,
  safeEnvironment,
  ServiceError,
  type SpawnFn,
  type SpawnResult,
} from './process.js'
export { defaultSpawn, ServiceError } from './process.js'
export type { SpawnFn, SpawnResult } from './process.js'

// Resolve the operator-installed npm once, before any generated build can run.
const npmCommand = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((p) => isAbsolute(p))
  .map((p) => join(p, process.platform === 'win32' ? 'npm.cmd' : 'npm'))
  .find((p) => existsSync(p))
const trustedNpm = npmCommand ? realpathSync(npmCommand) : undefined

export type DeployTarget = 'cloudflare-pages' | 'netlify' | 'vercel'
export interface DeployOptions {
  dir?: string
  target?: DeployTarget
  token?: string
  projectName?: string
  onStage?: (stage: 'building' | 'deploying') => void | Promise<void>
}
export interface DeployResult {
  deployUrl: string
  target: DeployTarget
}
export interface DeployConfig {
  target: DeployTarget
  token: string
  projectName?: string
}

/** Validate BEFORE migration/install/build. No ambient credential lookup in library code. */
export function validateDeployOptions(options: DeployOptions): DeployConfig {
  const target = options.target ?? 'cloudflare-pages'
  if (!['cloudflare-pages', 'netlify', 'vercel'].includes(target))
    throw new ServiceError('INVALID_TARGET', 'Unknown deployment target')
  // Other providers previously used npx in an untrusted cwd and leaked credentials.
  // Fail closed until a trusted, pinned static-artifact adapter is implemented.
  if (target !== 'cloudflare-pages')
    throw new ServiceError(
      'UNSUPPORTED_TARGET',
      'Deployment target requires a trusted static-artifact adapter',
    )
  if (
    options.projectName &&
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.projectName)
  )
    throw new ServiceError('INVALID_PROJECT', 'Invalid project name')
  if (!options.token?.trim())
    throw new ServiceError('MISSING_TOKEN', 'Deployment API token is required')
  return { target, token: options.token, projectName: options.projectName }
}

export function extractDeployedUrl(
  target: DeployTarget,
  stdout: string,
): string | null {
  const suffix = {
    'cloudflare-pages': '.pages.dev',
    netlify: '.netlify.app',
    vercel: '.vercel.app',
  }[target]
  if (!suffix) return null
  for (const text of stdout.match(/https:\/\/[^\s<>"'\x1b]+/g) ?? []) {
    try {
      const url = new URL(text)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.hostname.endsWith(suffix) &&
        /^[a-z0-9.-]+$/.test(url.hostname)
      )
        return url.href.replace(/\/$/, '')
    } catch {
      /* not a URL */
    }
  }
  return null
}

async function workspace(prefix: string) {
  const root = resolve('.tmp')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, prefix))
}

/** Creates/retains a lock then installs exactly it; install lifecycle scripts are disabled. */
export async function buildSite(
  dir: string,
  spawnFn: SpawnFn = defaultSpawn,
): Promise<SpawnResult> {
  const home = await workspace('build-home-')
  try {
    const env = safeEnvironment(home)
    if (npmCommand) env.PATH += delimiter + dirname(npmCommand)
    if (!trustedNpm)
      throw new ServiceError(
        'MISSING_NPM',
        'Operator-installed npm is required',
      )
    if (!existsSync(join(dir, 'package-lock.json'))) {
      const lock = await spawnFn(
        trustedNpm,
        [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--legacy-peer-deps',
        ],
        { cwd: dir, env, timeoutMs: 300_000 },
      )
      if (lock.code !== 0)
        throw new ServiceError(
          'INSTALL_FAILED',
          'Dependency lock generation failed',
        )
    }
    const install = await spawnFn(
      trustedNpm,
      ['ci', '--ignore-scripts', '--legacy-peer-deps'],
      { cwd: dir, env, timeoutMs: 300_000 },
    )
    if (install.code !== 0)
      throw new ServiceError('INSTALL_FAILED', 'Dependency installation failed')
    const build = await spawnFn(trustedNpm, ['run', 'build'], {
      cwd: dir,
      env,
      timeoutMs: 300_000,
    })
    if (build.code !== 0)
      throw new ServiceError('BUILD_FAILED', 'Site build failed')
    return build
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

export async function deployToCloudflarePages(
  dir: string,
  opts: { token: string; projectName?: string },
  spawnFn: SpawnFn = defaultSpawn,
): Promise<SpawnResult> {
  validateDeployOptions({ ...opts, target: 'cloudflare-pages' })
  const scratch = await workspace('deploy-artifacts-')
  try {
    // Copy only static artifacts, not package.json, node_modules, .env or provider config.
    // Dereferencing is forbidden: reject symlinks before allowing the credential process.
    const { readdir, lstat } = await import('node:fs/promises')
    async function assertStatic(path: string): Promise<void> {
      const stat = await lstat(path)
      if (stat.isSymbolicLink())
        throw new ServiceError(
          'INVALID_ARTIFACT',
          'Symlinks are not deployable',
        )
      if (stat.isDirectory())
        for (const name of await readdir(path))
          await assertStatic(join(path, name))
      else if (!stat.isFile())
        throw new ServiceError(
          'INVALID_ARTIFACT',
          'Non-file deployment artifact',
        )
    }
    const dist = join(dir, 'dist')
    await assertStatic(dist)
    await cp(dist, join(scratch, 'dist'), {
      recursive: true,
      dereference: false,
    })
    const require = createRequire(import.meta.url)
    const bin = join(
      dirname(require.resolve('wrangler/package.json')),
      'bin/wrangler.js',
    )
    const args = [bin, 'pages', 'deploy', 'dist']
    if (opts.projectName) args.push('--project-name', opts.projectName)
    return await spawnFn(process.execPath, args, {
      cwd: scratch,
      env: {
        ...safeEnvironment(scratch),
        CLOUDFLARE_API_TOKEN: opts.token,
        WRANGLER_SEND_METRICS: 'false',
      },
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function runDeploy(
  options: DeployOptions = {},
  spawnFn: SpawnFn = defaultSpawn,
): Promise<DeployResult> {
  const config = validateDeployOptions(options)
  const dir = resolve(options.dir ?? '.')
  if (!existsSync(dir))
    throw new ServiceError(
      'MISSING_DIRECTORY',
      'Deployment directory not found',
    )
  await options.onStage?.('building')
  await buildSite(dir, spawnFn)
  await options.onStage?.('deploying')
  let result: SpawnResult
  try {
    result = await deployToCloudflarePages(dir, config, spawnFn)
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError('DEPLOY_FAILED', 'Deployment adapter failed')
  }
  if (result.code !== 0)
    throw new ServiceError('DEPLOY_FAILED', 'Deployment failed')
  const deployUrl = extractDeployedUrl(config.target, result.stdout)
  if (!deployUrl)
    throw new ServiceError(
      'MISSING_DEPLOY_URL',
      'Deployment did not return a valid URL',
    )
  return { deployUrl, target: config.target }
}
