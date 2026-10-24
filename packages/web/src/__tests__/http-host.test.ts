import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

describe('actual built HTTP transport #23 (loopback, fake credentials only)', () => {
  it('fails closed before IO and caps chunked/forged bodies and stalled uploads', () => {
    const appUrl = new URL('../../dist/app.js', import.meta.url).href
    const script = `
      import assert from 'node:assert/strict';
      import { request } from 'node:http';
      import { existsSync } from 'node:fs';
      import { resolve } from 'node:path';
      import { serve } from '@hono/node-server';
      import { createApp } from ${JSON.stringify(appUrl)};
      const root=resolve('.tmp/http23-'+process.pid);
      const app=createApp({identities:[{token:'a'.repeat(32),ownerId:'alice'}],uploadRoot:root,
        limits:{requestBytes:300,fileBytes:50,uploadMs:80}});
      const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
      await new Promise(r=>server.listening?r():server.once('listening',r));
      const port=server.address().port;
      const send=(headers,chunks,stall=false)=>new Promise((res,rej)=>{
        const req=request({hostname:'127.0.0.1',port,path:'/api/jobs',method:'POST',headers,agent:false},r=>{
          r.resume();r.on('end',()=>{req.destroy();res(r.statusCode)});
        });
        req.on('error',rej);
        req.setTimeout(2000,()=>req.destroy(Error('HTTP_PROBE_TIMEOUT')));
        for(const chunk of chunks)req.write(chunk);
        if(!stall)req.end();
      });
      const headers={authorization:'Bearer '+'a'.repeat(32),'content-type':'multipart/form-data; boundary=test'};
      try {
        assert.equal(await send({},['untrusted']),401);
        assert.equal(existsSync(root),false);
        assert.equal(await send(headers,['--test\\r\\n', 'x'.repeat(400)]),413);
        assert.equal(await send({...headers,'content-length':'999999'},[]),413);
        assert.equal(await send(headers,['--test\\r\\n'],true),408);
        assert.equal(existsSync(root),false);
        const read=await fetch('http://127.0.0.1:'+port+'/api/jobs',{headers:{authorization:headers.authorization}});
        assert.deepEqual(await read.json(),{jobs:[]});
        console.log('HTTP23_PASS unauthorized-no-IO chunked-limit forged-length upload-timeout empty-owner-store');
      } finally {server.closeAllConnections(); await new Promise(r=>server.close(r));}
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('HTTP23_PASS')
  }, 20_000)
})
