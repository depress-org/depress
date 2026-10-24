import { describe, it, expect, vi } from 'vitest'
import { runDeploy, validateDeployOptions } from '../services/deploy.js'
import { defaultSpawn } from '../services/process.js'

describe('PR-02 #16 Integration B regressions', () => {
  it.each([undefined, '', ' ', 'bad;name', '-option', 'x'.repeat(64)])(
    'requires explicit valid project name %s before build/child execution', async (projectName) => {
      const spawn = vi.fn()
      const onStage = vi.fn()
      const options = { token: 'synthetic-token', projectName, onStage }
      expect(() => validateDeployOptions(options)).toThrow(/project/i)
      await expect(runDeploy(options, spawn)).rejects.toMatchObject({code:'INVALID_PROJECT'})
      expect(spawn).not.toHaveBeenCalled()
      expect(onStage).not.toHaveBeenCalled()
    },
  )
  it('reaps inherited-stdio descendants on parent exit, not a false timeout', async () => {
    const script = `
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{stdio:'inherit'}).unref();
      console.log('PARENT_SUCCESS');
      console.error('PARENT_STDERR');
    `
    const start = Date.now()
    const result = await defaultSpawn(process.execPath, ['-e', script], {
      cwd: process.cwd(), env: {}, timeoutMs: 2000,
    })
    // A timer that merely reclassifies the false timeout is not exit cleanup.
    expect(Date.now() - start).toBeLessThan(1500)
    expect(result).toEqual({ code: 0, stdout: 'PARENT_SUCCESS\n', stderr: 'PARENT_STDERR\n' })
    // Both slots remain usable after successful cleanup and all failure modes.
    await Promise.all(Array.from({length:4}, async () => {
      await expect(defaultSpawn(process.execPath, ['-e', 'console.log("NEXT")'], {
        cwd:process.cwd(), env:{}, timeoutMs:1000,
      })).resolves.toMatchObject({code:0,stdout:'NEXT\n'})
    }))
  })
})
