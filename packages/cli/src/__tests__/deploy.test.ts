import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  runDeploy,
  extractDeployedUrl,
  deployToCloudflarePages,
  type SpawnFn,
  type SpawnResult,
} from '../commands/deploy.js'

function mockSpawn(responses: SpawnResult[]): SpawnFn {
  let i = 0
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return r
  })
}

describe('extractDeployedUrl', () => {
  it('extracts a pages.dev URL from wrangler output', () => {
    const stdout = 'Deployed to https://my-site.pages.dev\nDone.'
    expect(extractDeployedUrl('cloudflare-pages', stdout)).toBe('https://my-site.pages.dev')
  })

  it('returns null when no URL is present', () => {
    expect(extractDeployedUrl('cloudflare-pages', 'no url here')).toBeNull()
  })

  it('extracts a netlify URL', () => {
    expect(extractDeployedUrl('netlify', 'Live: https://foo.netlify.app')).toBe('https://foo.netlify.app')
  })

  it('extracts a vercel URL', () => {
    expect(extractDeployedUrl('vercel', 'https://foo.vercel.app ready')).toBe('https://foo.vercel.app')
  })
})

describe('deployToCloudflarePages', () => {
  it('invokes wrangler pages deploy via npx with the token in env', async () => {
    const spawnFn = mockSpawn([{ code: 0, stdout: 'https://x.pages.dev', stderr: '' }])
    await deployToCloudflarePages('/tmp/site', { token: 'secret-token', projectName: 'my-site' }, spawnFn)
    expect(spawnFn).toHaveBeenCalledWith(
      'npx',
      ['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'my-site'],
      expect.objectContaining({ cwd: '/tmp/site', env: expect.objectContaining({ CLOUDFLARE_API_TOKEN: 'secret-token' }) }),
    )
  })
})

describe('runDeploy', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.NETLIFY_AUTH_TOKEN
    delete process.env.VERCEL_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    process.exitCode = 0
  })

  it('fails fast when no token is available', async () => {
    const spawnFn = mockSpawn([{ code: 0, stdout: '', stderr: '' }])
    await runDeploy({ dir: process.cwd(), target: 'cloudflare-pages' }, spawnFn)
    expect(process.exitCode).toBe(1)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('builds then deploys and reports the URL on success', async () => {
    const spawnFn = mockSpawn([
      { code: 0, stdout: 'build ok', stderr: '' },
      { code: 0, stdout: 'Deployed to https://my-site.pages.dev', stderr: '' },
    ])
    await runDeploy({ dir: process.cwd(), target: 'cloudflare-pages', token: 'tok' }, spawnFn)
    expect(process.exitCode).not.toBe(1)
    expect(spawnFn).toHaveBeenCalledTimes(2)
  })

  it('stops and fails when the build step fails', async () => {
    const spawnFn = mockSpawn([{ code: 1, stdout: '', stderr: 'build broke' }])
    await runDeploy({ dir: process.cwd(), target: 'cloudflare-pages', token: 'tok' }, spawnFn)
    expect(process.exitCode).toBe(1)
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('fails when the directory does not exist', async () => {
    const spawnFn = mockSpawn([{ code: 0, stdout: '', stderr: '' }])
    await runDeploy({ dir: '/no/such/dir/depress-test', target: 'cloudflare-pages', token: 'tok' }, spawnFn)
    expect(process.exitCode).toBe(1)
    expect(spawnFn).not.toHaveBeenCalled()
  })
})
