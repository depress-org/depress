import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inputBytes, artifactBytes, result, decode, hash, publicJob, POLICY } from './protocol.mjs'
import { deploymentCapability } from './deploy-capability.mjs'
import { origins } from './http.mjs'

const input={theme:'scaffold',wxr:Buffer.from('<rss/>').toString('base64'),sql:'',media:''}
const artifact={kind:'preview-only',files:[{path:'index.html',data:Buffer.from('<h1>Fixture</h1>').toString('base64')}]}
test('strict uploads and canonical bytes reject source paths, owner spoofing, arrays and expansion',()=>{
  assert.equal(inputBytes(input),6)
  assert.equal(decode(Buffer.alloc(POLICY.inputBytes,65).toString('base64'),POLICY.inputBytes).length,POLICY.inputBytes)
  for (const bad of [{...input,ownerId:'foreign'},{...input,theme:'remote'},{...input,wxr:''},{...input,sql:'Zg='},{...input,sql:'Zh=='},{...input,media:'x'.repeat(POLICY.bodyBytes)},[],null]) assert.throws(()=>inputBytes(bad))
  assert.throws(()=>decode(Buffer.alloc(2).toString('base64'),1))
})
test('hostile worker result is bounded opaque data, not an authority or host pathname',()=>{
  assert.equal(artifactBytes(artifact),16)
  assert.deepEqual(JSON.parse(result(JSON.stringify({ok:true,artifact}))),artifact)
  for(const path of ['../victim','/etc/passwd','.env','a//b.html','a/../b.html','sources/site.html','reports/migration-report.json','a\\b.html','a%2fb.html','public/server/index.html','index.map']) assert.throws(()=>artifactBytes({...artifact,files:[{path,data:''}]}),path)
  assert.throws(()=>artifactBytes({...artifact,files:[artifact.files[0],{...artifact.files[0],path:'INDEX.html'}]}))
  assert.throws(()=>artifactBytes({...artifact,files:new Array(1)}))
  assert.throws(()=>artifactBytes({...artifact,kind:'verified-static'}))
  assert.throws(()=>result('raw FAKE_TOKEN_25 /private/path stdout'))
  assert.throws(()=>result(JSON.stringify({ok:false,artifact:null})))
  assert.throws(()=>result('x'.repeat(2*POLICY.artifactBytes+1)))
})
test('minimal public record excludes owner/input/logs/paths/raw errors',()=>{
  const view=publicJob({id:'id',state:'failed',created_ms:'1',expires_ms:'2',owner_id:'owner',input:'/private/FAKE_TOKEN_25',error:'stdout FAKE_TOKEN_25'})
  assert.deepEqual(view,{id:'id',status:'failed',createdAt:1,expiresAt:2,error:'Job failed',artifact:undefined})
  assert(!JSON.stringify(view).includes('FAKE_TOKEN_25'))
})
test('preview requires separate site and separate configured authority',()=>{
  assert.deepEqual(origins('https://api.example.com','https://preview.example.net'),{api:'https://api.example.com',preview:'https://preview.example.net'})
  for(const p of ['https://preview.example.com','https://preview.example.com.','https://api.example.com','https://a:b@example.net','file:///preview','https://preview.example.net/path','http://preview.example.net']) assert.throws(()=>origins('https://api.example.com',p))
})
test('deployment authority is immutable owner/job/digest/target/expiry bound; only fake closure has fake credentials',async()=>{
  const bytes=Buffer.from('verified fake static artifact'),digest=hash(bytes),jobId='00000000-0000-4000-8000-000000000025'
  const approval={ownerId:'server-owner',jobId,digest,target:'cloudflare-pages:fake-project',expiresAt:1500}
  const audit=[],sent=[];let kind='preview-only'
  const cap=deploymentCapability(approval,{readArtifact:async()=>({kind,bytes}),record:async e=>audit.push(e),deployOnly:async(a,b)=>{sent.push([a,b.toString()]);return 'fake-receipt'}},()=>1000)
  approval.ownerId='mutated'
  await assert.rejects(cap.deploy('foreign',jobId,digest))
  await assert.rejects(cap.deploy('server-owner',jobId,'a'.repeat(64)))
  await assert.rejects(cap.deploy('server-owner',jobId,digest))
  kind='verified-static'
  assert.equal(await cap.deploy('server-owner',jobId,digest),'fake-receipt')
  await assert.rejects(cap.deploy('server-owner',jobId,digest))
  assert.equal(audit.length,1);assert.equal(sent.length,1)
  assert(!JSON.stringify(audit).includes('FAKE_PROVIDER_SECRET'))
  assert.throws(()=>deploymentCapability({...approval,expiresAt:1000000},{},()=>1000))
  const corrupt=deploymentCapability({...approval,ownerId:'server-owner'},{readArtifact:async()=>({kind,bytes:Buffer.from('changed')}),record:async()=>{},deployOnly:async()=>assert.fail()},()=>1000)
  await assert.rejects(corrupt.deploy('server-owner',jobId,digest))
})
test('concurrent deployment reads can claim a capability only once',async()=>{
  const bytes=Buffer.from('verified fake static artifact'),digest=hash(bytes),jobId='00000000-0000-4000-8000-000000000025'
  const approval={ownerId:'server-owner',jobId,digest,target:'cloudflare-pages:fake-project',expiresAt:1500}
  const readers=[];let audited=0,deployed=0,releaseAudit
  const auditGate=new Promise(resolve=>{releaseAudit=resolve})
  const cap=deploymentCapability(approval,{
    readArtifact:()=>new Promise(resolve=>readers.push(resolve)),
    record:async()=>{audited++;await auditGate},
    deployOnly:async()=>{deployed++;return 'fake-receipt'},
  },()=>1000)
  const pending=Promise.allSettled([cap.deploy('server-owner',jobId,digest),cap.deploy('server-owner',jobId,digest)])
  assert.equal(readers.length,2)
  for(const resolve of readers) resolve({kind:'verified-static',bytes})
  await Promise.resolve()
  assert.equal(audited,1)
  releaseAudit()
  const outcomes=await pending
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(outcomes.filter(r=>r.status==='rejected').length,1)
  assert.equal(deployed,1)
})
for(const phase of ['read','audit']) test(`deployment expiry during ${phase} prevents provider invocation`,async()=>{
  const bytes=Buffer.from('verified fake static artifact'),digest=hash(bytes),jobId='00000000-0000-4000-8000-000000000025'
  const approval={ownerId:'server-owner',jobId,digest,target:'cloudflare-pages:fake-project',expiresAt:1500}
  let clock=1000,audited=0,deployed=0,release
  const gate=new Promise(resolve=>{release=resolve})
  const cap=deploymentCapability(approval,{
    readArtifact:async()=>{if(phase==='read') await gate;return {kind:'verified-static',bytes}},
    record:async()=>{audited++;if(phase==='audit') await gate},
    deployOnly:async()=>{deployed++},
  },()=>clock)
  const pending=cap.deploy('server-owner',jobId,digest)
  await Promise.resolve()
  assert.equal(audited,phase==='read'?0:1)
  clock=1500;release()
  await assert.rejects(pending,/Deployment denied/)
  await assert.rejects(cap.deploy('server-owner',jobId,digest),/Deployment denied/)
  assert.equal(audited,phase==='read'?0:1);assert.equal(deployed,0)
})
