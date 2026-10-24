import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {
  runDeploy,
  extractDeployedUrl,
  buildSite,
  validateDeployOptions,
} from '../commands/deploy.js'
import { defaultSpawn, safeEnvironment } from '../services/process.js'

let dir: string
beforeEach(async () => {
  await mkdir('.tmp', { recursive: true })
  dir = await mkdtemp(resolve('.tmp/deploy-test-'))
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), 'static fixture')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
const ok = { code: 0, stdout: '', stderr: '' }
function mockSpawn(failAt = -1, noUrl = false) {
  let n = 0
  return vi.fn(async () => {
    n++
    if (n === failAt)
      return {
        code: 1,
        stdout: 'secret-provider-output',
        stderr: 'secret-token',
      }
    return {
      ...ok,
      stdout: n === 4 && !noUrl ? 'Deployed to https://site.pages.dev' : '',
    }
  })
}
describe('typed deploy service', () => {
  it.each([
    'https://x.pages.dev.attacker.test',
    'https://x.pages.dev@attacker.test',
    'https://x.pages.dev:1234',
  ])('rejects invalid URL %s', (url) => {
    expect(extractDeployedUrl('cloudflare-pages', url)).toBeNull()
  })
  it.each(['netlify', 'vercel', 'bad'])(
    'fails closed on unsupported/untrusted target %s',
    (target) => {
      expect(() =>
        validateDeployOptions({ target: target as any, token: 'test' }),
      ).toThrow()
    },
  )
  it('returns URL only after lock/install/build/deploy, without leaking credentials', async () => {
    const spawn = mockSpawn()
    const before = process.exitCode
    await expect(
      runDeploy({ dir, token: 'secret-token', projectName: 'site' }, spawn),
    ).resolves.toEqual({
      target: 'cloudflare-pages',
      deployUrl: 'https://site.pages.dev',
    })
    expect(process.exitCode).toBe(before)
    expect(spawn.mock.calls).toHaveLength(4)
    const calls = (spawn as any).mock.calls
    expect(calls[0][1]).toContain('--package-lock-only')
    expect(calls[1][1]).toEqual([
      'ci',
      '--ignore-scripts',
      '--legacy-peer-deps',
    ])
    expect(calls[2][1]).toEqual(['run', 'build'])
    // Real cold Keystatic build exhausts 512 MiB; build-only policy stays bounded.
    expect(calls[2][2].env.NODE_OPTIONS).toBe('--max-old-space-size=1024')
    expect(calls[0][2].env.NODE_OPTIONS).toBe('--max-old-space-size=512')
    for (const call of calls.slice(0, 3)) {
      expect(call[2].env).not.toHaveProperty('CLOUDFLARE_API_TOKEN')
      expect(JSON.stringify(call)).not.toContain('secret-token')
    }
    expect(calls[3][0]).toBe(process.execPath)
    expect(calls[3][1].join(' ')).not.toContain('secret-token')
    expect(calls[3][2].cwd).not.toBe(dir)
    expect(calls[3][2].env.CLOUDFLARE_API_TOKEN).toBe('secret-token')
  })
  it.each([1, 2, 3, 4])(
    'rejects failure at stage %s without raw output or host exit changes',
    async (stage) => {
      const before = process.exitCode
      const spawn = mockSpawn(stage)
      await expect(
        runDeploy({ dir, token: 'secret-token' }, spawn),
      ).rejects.toThrow(/failed/i)
      expect(process.exitCode).toBe(before)
      expect(spawn).toHaveBeenCalledTimes(stage)
    },
  )
  it('rejects zero-exit deploy without URL', async () => {
    await expect(
      runDeploy({ dir, token: 'secret-token' }, mockSpawn(-1, true)),
    ).rejects.toThrow(/valid URL/)
  })
  it('uses an existing lock without resolving dependencies again', async () => {
    await writeFile(join(dir, 'package-lock.json'), '{}')
    const spawn = vi.fn(async () => ok)
    await buildSite(dir, spawn)
    expect(spawn).toHaveBeenCalledTimes(2)
  })
  it('allowlist excludes ambient secret/config injection', () => {
    const env = safeEnvironment(dir)
    expect(Object.keys(env)).not.toContain('CLOUDFLARE_API_TOKEN')
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=512')
    expect(env.npm_config_userconfig).toBe(`${dir}/user.npmrc`)
  })
})
describe('bounded subprocesses', () => {
  it('times out a real child', async () => {
    await expect(
      defaultSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        cwd: dir,
        env: {},
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/timed out/)
  })
  it('kills over-producing children', async () => {
    await expect(
      defaultSpawn(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(10000))'],
        { cwd: dir, env: {}, maxOutputBytes: 100 },
      ),
    ).rejects.toThrow(/output limit/)
  })
  it('limits concurrent real children to two', async () => {
    const script =
      'const a=Date.now();setTimeout(()=>console.log(JSON.stringify([a,Date.now()])),150)'
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        defaultSpawn(process.execPath, ['-e', script], { cwd: dir, env: {} }),
      ),
    )
    const events = results
      .flatMap((r) => {
        const [a, b] = JSON.parse(r.stdout)
        return [
          [a, 1],
          [b, -1],
        ]
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let active = 0,
      peak = 0
    for (const [, change] of events) {
      active += change
      peak = Math.max(peak, active)
    }
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBe(2)
  })
  it('does not print argv or environment when executable is missing', async () => {
    await expect(
      defaultSpawn('/no/such/secret-token', ['secret-token'], {
        cwd: dir,
        env: {},
      }),
    ).rejects.toThrow('Could not start child process')
  })
})
