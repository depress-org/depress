import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

describe('PR-02 #16 observer host survival on actual built library', () => {
  it('consumes asynchronous rejection after runJob resolves', () => {
    const pipeline = new URL('../../dist/pipeline.js', import.meta.url).href
    const types = new URL('../../dist/types.js', import.meta.url).href
    const script = `
      import { runJob } from ${JSON.stringify(pipeline)};
      import { InMemoryJobStore } from ${JSON.stringify(types)};
      const store = new InMemoryJobStore().forOwner('test-owner');
      const job = await store.create({wxrPath:'missing.xml',themeId:'invalid-theme'});
      const result = await runJob(store,job.id,{onProgress:async()=>{
        await new Promise(r=>setTimeout(r,10));
        throw Error('OBSERVER_REJECTED');
      }});
      console.log(result.status);
      setTimeout(()=>console.log('HOST_SURVIVED'),80);
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 5000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('failed')
    expect(result.stdout).toContain('HOST_SURVIVED')
    expect(result.stderr).not.toContain('OBSERVER_REJECTED')
  })
})
