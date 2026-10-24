import { it, expect, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { deployToCloudflarePages } from '../services/deploy.js'

it('rejects Workers/Node server artifacts before the credential-bearing Pages child (#26)', async () => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(resolve('.tmp/worker26-'))
  try {
    await mkdir(join(root, 'dist/server'), { recursive: true })
    await mkdir(join(root, 'dist/client'), { recursive: true })
    await writeFile(join(root, 'dist/server/index.js'), 'server sentinel')
    await writeFile(join(root, 'dist/client/index.html'), '<h1>static sentinel</h1>')
    const spawn = vi.fn(async () => ({ code: 0, stdout: 'https://fixture.pages.dev', stderr: '' }))
    await expect(deployToCloudflarePages(root, { projectName: 'fixture', token: 'synthetic-token' }, spawn)).rejects.toMatchObject({ code: 'UNSUPPORTED_ARTIFACT' })
    expect(spawn).not.toHaveBeenCalled()
  } finally { await rm(root, { recursive: true, force: true }) }
})
