import { spawn } from 'node:child_process'
import { dirname, delimiter } from 'node:path'

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}
export interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
}
export interface SpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
  maxOutputBytes?: number
}
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => Promise<SpawnResult>

// Minimal allowlist, not a denylist: cloud/provider/npm/git credentials are never inherited.
export function safeEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    HOME: home,
    TMPDIR: home,
    CI: 'true',
    LANG: 'C.UTF-8',
    NODE_OPTIONS: '--max-old-space-size=512',
    npm_config_cache: `${home}/npm-cache`,
    npm_config_userconfig: `${home}/user.npmrc`,
    npm_config_globalconfig: `${home}/global.npmrc`,
    npm_config_fetch_timeout: '15000',
    npm_config_fetch_retries: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  }
}

let active = 0
const waiting: Array<() => void> = []
async function acquire(): Promise<void> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
}
function release() {
  const next = waiting.shift()
  if (next) next()
  else active--
}

/** Shell-free, bounded capture, bounded concurrency and whole process-group timeout. */
export const defaultSpawn: SpawnFn = async (cmd, args, opts) => {
  await acquire()
  try {
    return await new Promise<SpawnResult>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      let stdout = '',
        stderr = '',
        size = 0
      let failure: ServiceError | undefined
      function kill() {
        if (!child.pid) return
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch {
          /* already exited */
        }
      }
      const timer = setTimeout(
        () => {
          failure = new ServiceError(
            'PROCESS_TIMEOUT',
            'Child process timed out',
          )
          kill()
        },
        Math.min(opts.timeoutMs ?? 120_000, 300_000),
      )
      function collect(chunk: Buffer, stream: 'stdout' | 'stderr') {
        size += chunk.length
        if (size > Math.min(opts.maxOutputBytes ?? 1_048_576, 4_194_304)) {
          failure = new ServiceError(
            'PROCESS_OUTPUT_LIMIT',
            'Child process output limit exceeded',
          )
          kill()
          return
        }
        if (stream === 'stdout') stdout += String(chunk)
        else stderr += String(chunk)
      }
      child.stdout.on('data', (c) => collect(c, 'stdout'))
      child.stderr.on('data', (c) => collect(c, 'stderr'))
      child.on('error', () => {
        clearTimeout(timer)
        reject(
          new ServiceError('PROCESS_START', 'Could not start child process'),
        )
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        // Also reap background descendants after a parent exits.
        kill()
        if (failure) reject(failure)
        else resolve({ code, stdout, stderr })
      })
    })
  } finally {
    release()
  }
}

export async function checkedSpawn(
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  spawnFn = defaultSpawn,
) {
  const result = await spawnFn(cmd, args, opts)
  if (result.code !== 0)
    throw new ServiceError('PROCESS_FAILED', 'Child process failed')
  return result
}
