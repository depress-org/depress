import { describe, it, expect, vi } from 'vitest'
import {
  runDeploy,
  defaultSpawn,
  extractDeployedUrl,
} from '../commands/deploy.js'
import { runMigrate } from '../commands/migrate.js'

describe('PR-02 #16 host isolation regressions', () => {
  it('missing credentials rejects without mutating host exitCode', async () => {
    const original = process.exitCode
    const spawn = vi.fn()
    await expect(
      runDeploy(
        { dir: process.cwd(), token: '', target: 'cloudflare-pages' },
        spawn,
      ),
    ).rejects.toThrow(/token/i)
    expect(process.exitCode).toBe(original)
    expect(spawn).not.toHaveBeenCalled()
  })
  it('rejects shell/option project names before launching anything', async () => {
    const spawn = vi.fn()
    await expect(
      runDeploy(
        { dir: process.cwd(), token: 'test', projectName: 'x; touch injected' },
        spawn,
      ),
    ).rejects.toThrow(/project/i)
    expect(spawn).not.toHaveBeenCalled()
  })
  it('executes argument vectors literally', async () => {
    const arg = 'x; printf SHELL_EXECUTED'
    const result = await defaultSpawn(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', arg],
      { cwd: process.cwd(), env: {} },
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(arg)
  })
  it('does not accept a lookalike deployment hostname', () => {
    expect(
      extractDeployedUrl(
        'cloudflare-pages',
        'https://x.pages.dev.attacker.example',
      ),
    ).toBeNull()
  })
  it('missing input is a library rejection, not a prompt or process exit', async () => {
    await expect(
      runMigrate({ input: 'nonexistent-export.xml', output: '.tmp/invalid' }),
    ).rejects.toThrow()
  })
})
