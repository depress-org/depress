import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,rm} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createServer} from 'node:net'
import {request as nodeRequest} from 'node:http'
import {fork,spawn} from 'node:child_process'
import {once} from 'node:events'
import {connect,Queue,migrate,QueueFull} from '../queue.mjs'
import {Runtime} from '../runtime.mjs'
import {executeOne,reap} from '../controller.mjs'
import {identifier,hash,POLICY} from '../protocol.mjs'
import {workerName,createWorkerArgs} from '../worker-profile.mjs'
import {listenHosted} from '../server.mjs'
import {chromium} from 'playwright-core'

// Hard guard: never run this against a local/shared daemon or a live database.
assert.equal(process.env.GITHUB_ACTIONS,'true')
assert.equal(process.env.DEPRESS25_TEST_RUNTIME,'ephemeral-fake-only')
assert.equal(process.env.DEPRESS25_TEST_DATABASE,'postgres://postgres:FAKE_TEST_ONLY_25@127.0.0.1:5432/postgres')
const pool=await connect(process.env.DEPRESS25_TEST_DATABASE),q=new Queue(pool)
const runtime=new Runtime(process.env.DEPRESS25_TEST_IMAGE),probe=new Runtime(process.env.DEPRESS25_PROBE_IMAGE)
const xml=await readFile(new URL('../fixture.xml',import.meta.url))
const input={theme:'scaffold',wxr:xml.toString('base64'),sql:'',media:''}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await pause(100)}assert.fail('Deadline exceeded')}
async function reset(){await pool.query('TRUNCATE private_jobs25,private_uploads25')}
const fakeEnv={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',GITHUB_ACTIONS:'true',DEPRESS25_TEST_RUNTIME:'ephemeral-fake-only',DEPRESS25_TEST_DATABASE:process.env.DEPRESS25_TEST_DATABASE,DEPRESS25_TEST_IMAGE:process.env.DEPRESS25_TEST_IMAGE,DEPRESS25_PROBE_IMAGE:process.env.DEPRESS25_PROBE_IMAGE,FAKE_BROKER_SECRET:'FAKE_TOKEN_SENTINEL_25'}
let observedFailure=false
async function runProbe(op,verify,timeout=15000){
 const job={id:identifier(),lease_id:identifier()};let id
 try{id=await probe.create(job)}catch(error){
  if(!observedFailure){
   observedFailure=true;const c=await probe.inspect(workerName(job.id,job.lease_id))
   // Only this freshly-created fake fixture's policy metadata, never a host
   // environment, input, stdout, secret, bind source or unrelated container.
   console.log(JSON.stringify({fixturePolicy:{error:error.message,user:c?.Config.User,envKeys:c?.Config.Env?.map(x=>x.split('=')[0]),mounts:c?.Mounts?.map(m=>({type:m.Type,destination:m.Destination})),apparmor:c?.AppArmorProfile,capDrop:c?.HostConfig.CapDrop,security:c?.HostConfig.SecurityOpt,pid:c?.HostConfig.PidMode,ipc:c?.HostConfig.IpcMode,cgroup:c?.HostConfig.CgroupnsMode,memory:c?.HostConfig.Memory,swap:c?.HostConfig.MemorySwap,cpu:c?.HostConfig.NanoCpus,pids:c?.HostConfig.PidsLimit,shm:c?.HostConfig.ShmSize,ulimits:c?.HostConfig.Ulimits}}))
  }
  throw error
 }
 try{const r=await probe.call(['start','--attach','--interactive',id],{input:JSON.stringify({op}),timeoutMs:timeout,maxOutputBytes:1048576});await verify(r,await probe.inspect(id))}
 finally{await probe.remove(job)}
}

test('real disposable OCI, durable fake DB and private HTTP/browser lifecycle',{timeout:1200000},async t=>{
 await migrate(pool)
 try{
 await t.test('actual namespaces/cgroups/credential-free filesystem and deny-default egress',async()=>{
  await runProbe('boundary',(r)=>{
   assert.equal(r.code,0,r.stderr);const p=JSON.parse(r.stdout)
   for(const key of ['nonroot','capless','seccomp','nonewprivs','readonly','noSocket','network','noCredentials','cgroupReadonly','privatePid','apparmor'])assert.equal(p[key],true,key)
   assert.equal(p.memory,'2147483648');assert.equal(p.swap,'0');assert.equal(p.pids,'64');assert.equal(p.cpu,'100000 100000')
   assert.equal(p.work,1073741824);assert.equal(p.tmp,16777216)
  })
 })
 await t.test('actual process/FD/aggregate disk limits reject excess while ordinary files work',async()=>{
  for(const op of ['pids','fds','disk'])await runProbe(op,r=>{assert.equal(r.code,0,r.stderr);assert.equal(JSON.parse(r.stdout).rejected,true,op)},30000)
  await runProbe('file',r=>assert(r.code!==0||JSON.parse(r.stdout).rejected),30000)
 })
 await t.test('real negative control: weakening a copied network profile exposes only the fake loopback fixture',async()=>{
  const listener=createServer(socket=>socket.end());await new Promise(r=>listener.listen(18726,'127.0.0.1',r))
  try{
   await runProbe('network-fixture',r=>assert.equal(JSON.parse(r.stdout).denied,true))
   const job={id:identifier(),lease_id:identifier()},args=createWorkerArgs({jobId:job.id,leaseId:job.lease_id,imageId:probe.imageId},await probe.image())
   args[args.indexOf('--network')+1]='host'
   const id=await probe.checked(args)
   try{
    const c=await probe.inspect(id);assert.throws(()=>probe.verify(c,job))
    const result=await probe.call(['start','--attach','--interactive',id],{input:'{"op":"network-fixture"}'})
    assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).denied,false,'weakened actual network must be detected')
   }finally{await probe.remove(job)}
  }finally{await new Promise(r=>listener.close(r))}
 })
 await t.test('hostile ancestor swaps stay in disposable namespace; unrelated fake host marker unchanged',async()=>{
  const marker=resolve('.tmp/fake-host-marker25'),job={id:identifier(),lease_id:identifier()};await writeFile(marker,'FAKE_HOST_MARKER_25',{flag:'wx'})
  try{
   const id=await probe.create(job),r=await probe.call(['start','--attach','--interactive',id],{input:JSON.stringify({op:'ancestor',marker})})
   assert.equal(r.code,0);assert.deepEqual(JSON.parse(r.stdout),{denied:true,hostDenied:true})
   await probe.remove(job);assert.equal(await readFile(marker,'utf8'),'FAKE_HOST_MARKER_25')
  }finally{await probe.remove(job);await rm(marker)}
 })
 await t.test('actual cgroup OOM and bounded attached raw-log flood; no persisted log driver',async()=>{
  await runProbe('memory',(r,c)=>{assert.notEqual(r.code,0);assert.equal(c.State.OOMKilled,true)},30000)
  const job={id:identifier(),lease_id:identifier()},id=await probe.create(job)
  try{await assert.rejects(probe.call(['start','--attach','--interactive',id],{input:'{"op":"flood"}',timeoutMs:10000,maxOutputBytes:65536}),asyncError=>{
   return asyncError.code==='PROCESS_OUTPUT_LIMIT'
  });const c=await probe.inspect(id);assert.equal(c.HostConfig.LogConfig.Type,'none')}
  catch(error){const c=await probe.inspect(id);console.log(JSON.stringify({fakeFlood:{state:c.State.Status,oom:c.State.OOMKilled,exit:c.State.ExitCode}}));throw error}
  finally{await probe.remove(job)}
 })
 await t.test('actual per-process CPU hard limit stops a busy workload, not just an argv claim',async()=>{
  const began=Date.now();await runProbe('cpu',(r)=>{assert.notEqual(r.code,0);assert(Date.now()-began<175000)},175000)
 })
 await t.test('transactional concurrent owner/global queue bounds; immutable owner and stale fencing',async()=>{
  await reset()
  const owner=q.forOwner('server-derived-owner-A'),foreign=q.forOwner('server-derived-owner-B')
  const same=await Promise.allSettled(Array.from({length:20},()=>owner.submit(input)))
  assert.equal(same.filter(x=>x.status==='fulfilled').length,4)
  assert(same.filter(x=>x.status==='rejected').every(x=>x.reason instanceof QueueFull))
  const first=(await owner.list())[0];assert.equal(await foreign.get(first.id),undefined);assert.equal(await foreign.cancel(first.id),false)
  await assert.rejects(pool.query("UPDATE private_jobs25 SET owner_id='foreign' WHERE id=$1",[first.id]),/immutable identity/)
  const other=await Promise.allSettled(Array.from({length:40},(_,i)=>q.forOwner('server-'+i).submit(input)))
  assert.equal(other.filter(x=>x.status==='fulfilled').length,28)
  const claims=await Promise.all([q.claim(),q.claim(),q.claim()]);assert.equal(claims.filter(Boolean).length,1)
  const claimed=claims.find(Boolean)
  assert.equal(await q.finish({...claimed,lease_id:identifier()}),false)
  assert.equal((await q.current(claimed.id,claimed.lease_id)).state,'running')
  await q.finish(claimed)
  assert.equal((await q.current(claimed.id,claimed.lease_id)).input,null)
  await reset()
  const reservations=await Promise.allSettled(Array.from({length:10},(_,i)=>q.forOwner('upload-'+i).reserve()))
  assert.equal(reservations.filter(x=>x.status==='fulfilled').length,4)
  await pool.query('UPDATE private_uploads25 SET expires_ms=0');await q.sweep()
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM private_uploads25')).rows[0].n,0)
 })
 await t.test('bounded bytes, queued abandon cleanup and durable fake-DB restart',async()=>{
  await reset()
  const many={...input,sql:Buffer.alloc(700000,65).toString('base64')}
  const submitted=await Promise.allSettled(Array.from({length:32},(_,i)=>q.forOwner('bytes-'+i).submit(many)))
  assert(submitted.some(x=>x.status==='fulfilled'),'large valid inputs must have positive controls')
  assert(submitted.some(x=>x.status==='rejected'))
  const budget=(await pool.query('SELECT sum(octet_length(input))::bigint AS n FROM private_jobs25')).rows[0]
  assert(Number(budget.n)<=POLICY.totalBytes)
  await reset();const job=await q.forOwner('restart-owner').submit(input)
  await probe.checked(['restart','postgres25'],{timeoutMs:30000})
  await until(async()=>{try{return (await q.forOwner('restart-owner').get(job.id))?.status==='queued'}catch{return false}},30000)
  assert.equal((await pool.query('SELECT input FROM private_jobs25 WHERE id=$1',[job.id])).rows[0].input.toString(),JSON.stringify(input))
  await pool.query('UPDATE private_jobs25 SET expires_ms=0');await q.sweep()
  const row=(await pool.query('SELECT * FROM private_jobs25 WHERE id=$1',[job.id])).rows[0];assert.equal(row.state,'failed');assert.equal(row.input,null)
  await pool.query('UPDATE private_jobs25 SET expires_ms=0');await q.sweep();assert.equal(await q.forOwner('restart-owner').get(job.id),undefined)
 })
 await t.test('real broker crash, independent reaper cancellation, fenced retry and unrelated-runtime preservation',async()=>{
  await reset();await q.forOwner('crash-owner').submit(input)
  const unrelated=await probe.checked(['create','--name','depress25-unrelated',probe.imageId])
  const broker=fork(new URL('./crash-broker.mjs',import.meta.url),[],{env:fakeEnv,stdio:['ignore','pipe','pipe','ipc']})
  let reaper
  try{
   const [message]=await Promise.race([once(broker,'message'),pause(10000).then(()=>{throw new Error('Crash broker did not create worker')})])
   await until(async()=>!!(await probe.inspect(message.id))?.State.Running)
   broker.kill('SIGKILL');await once(broker,'exit')
   assert((await probe.inspect(message.id)).State.Running)
   // Exact lease cancelled, retry failure leaves capacity reserved.
   await q.forOwner('crash-owner').cancel(message.jobId)
   const remove=probe.remove.bind(probe);probe.remove=async()=>{throw new Error('fake uncertain daemon reply')}
   await reap(q,probe);assert.equal((await q.current(message.jobId,message.leaseId)).state,'stopping')
   assert.equal(await q.claim(),undefined);assert.equal((await q.current(message.jobId,message.leaseId)).cleanup_attempts,1)
   probe.remove=remove
   reaper=spawn(process.execPath,['infra/hosted/control.mjs','reaper'],{env:{...fakeEnv,DEPRESS25_TEST_IMAGE:probe.imageId},stdio:'ignore'})
   await until(async()=>!(await probe.inspect(message.id)),15000)
   await until(async()=>(await q.current(message.jobId,message.leaseId)).state==='failed')
   assert.equal((await q.current(message.jobId,message.leaseId)).input,null)
   assert(await probe.inspect(unrelated),'unrelated container must survive')
  }finally{broker.kill('SIGKILL');reaper?.kill('SIGTERM');await probe.checked(['rm','--force',unrelated])}
 })
 await t.test('independent reaper kills on DB outage, then reconciles durable fenced state after restart',async()=>{
  await reset();await q.forOwner('outage-owner').submit(input);const job=await q.claim(),id=await probe.create(job)
  const attached=probe.call(['start','--attach','--interactive',id],{input:'{"op":"wait"}',timeoutMs:30000});attached.catch(()=>{})
  await until(async()=>(await probe.inspect(id))?.State.Running)
  await probe.checked(['stop','postgres25'],{timeoutMs:30000})
  try{await reap(q,probe);assert.equal(await probe.inspect(id),undefined)}finally{await probe.checked(['start','postgres25']);await attached.catch(()=>{})}
  await until(async()=>{try{await pool.query('SELECT 1');return true}catch{return false}},30000)
  await pool.query('UPDATE private_jobs25 SET deadline_ms=0 WHERE id=$1',[job.id]);await reap(q,probe)
  assert.equal((await q.current(job.id,job.lease_id)).state,'failed')
 })
 await t.test('real hard wall deadline is enforced by reaper when broker is gone',async()=>{
  await reset();await q.forOwner('wall-owner').submit(input);const job=await q.claim(),id=await probe.create(job),began=Date.now()
  const attached=probe.call(['start','--attach','--interactive',id],{input:'{"op":"wait"}',timeoutMs:200000});attached.catch(()=>{})
  const reaper=spawn(process.execPath,['infra/hosted/control.mjs','reaper'],{env:{...fakeEnv,DEPRESS25_TEST_IMAGE:probe.imageId},stdio:'ignore'})
  try{await until(async()=>!(await probe.inspect(id)),190000);assert(Date.now()-began>=175000);assert(Date.now()-began<190000);await attached.catch(()=>{});assert.equal((await q.current(job.id,job.lease_id)).state,'failed')}
  finally{reaper.kill('SIGTERM');await probe.remove(job)}
 })
 await t.test('actual owner-scoped HTTP -> durable queue -> runJob and offline build -> private expiring preview',async()=>{
  await reset()
  const tokenA='FAKE_API_OWNER_A_'+'a'.repeat(32),tokenB='FAKE_API_OWNER_B_'+'b'.repeat(32),previewA='FAKE_PREVIEW_A_'+'c'.repeat(32),previewB='FAKE_PREVIEW_B_'+'d'.repeat(32)
  const server=listenHosted({queue:q,identities:[{token:tokenA,ownerId:'owner-A'},{token:tokenB,ownerId:'owner-B'}],previewIdentities:[{token:previewA,ownerId:'owner-A'},{token:previewB,ownerId:'owner-B'}],apiOrigin:'http://api.test:18725',previewOrigin:'http://preview.test:18725'})
  await new Promise(r=>server.listen(18725,'127.0.0.1',r))
  const request=async(path,token,init={},preview=false)=>{
   const host=preview?'preview.test:18725':'api.test:18725'
   const outgoing=new Request(`http://${host}${path}`,{...init,headers:{...(token?{authorization:'Bearer '+token}:{}),...init.headers}})
   const body=outgoing.body?Buffer.from(await outgoing.arrayBuffer()):undefined
   return new Promise((yes,no)=>{
    const req=nodeRequest({hostname:'127.0.0.1',port:18725,path,method:outgoing.method,headers:{...Object.fromEntries(outgoing.headers),host}},res=>{
     const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>yes(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));res.on('error',no)
    });req.on('error',no);req.end(body)
   })
  }
  try{
   assert.equal((await request('/api/jobs')).status,401)
   const form=new FormData();form.set('theme','scaffold');form.set('wxr',new Blob([xml]),'private-source.xml')
   const sql=await readFile(new URL('../../../fixtures/media-archive/database.sql',import.meta.url))
   const media=await readFile(new URL('../../../fixtures/media-archive/uploads.zip',import.meta.url))
   form.set('sql',new Blob([Buffer.concat([sql,Buffer.from('\n-- FAKE_PRIVATE_SQL_25\n')])]),'private-dump.sql')
   form.set('media',new Blob([media]),'private-upload.zip')
   const response=await request('/api/jobs',tokenA,{method:'POST',body:form});assert.equal(response.status,202,await response.clone().text())
   const {job}=await response.json();assert.equal((await request('/api/jobs/'+job.id,tokenB)).status,404)
   assert.equal((await request('/api/jobs/'+job.id,tokenB,{method:'DELETE'})).status,404)
   assert.equal(await executeOne(q,runtime),true)
   const done=await q.forOwner('owner-A').get(job.id)
   if(done.status!=='done'){
    const diagnostic=new Runtime(process.env.DEPRESS25_DIAGNOSTIC_IMAGE),identity={id:identifier(),lease_id:identifier()}
    try{
     const id=await diagnostic.create(identity),r=await diagnostic.call(['start','--attach','--interactive',id],{input:JSON.stringify({...input,sql:Buffer.concat([sql,Buffer.from('\n-- FAKE_PRIVATE_SQL_25\n')]).toString('base64'),media:media.toString('base64')}),timeoutMs:180000})
     console.log(JSON.stringify({fakeWorkloadDiagnosis:JSON.parse(r.stdout)}))
    }finally{await diagnostic.remove(identity)}
   }
   assert.equal(done.status,'done',JSON.stringify(done))
   const rows=(await pool.query('SELECT * FROM private_jobs25 WHERE id=$1',[job.id])).rows[0]
   assert.equal(rows.input,null);assert.equal(await runtime.inspect(workerName(job.id,rows.lease_id)),undefined)
   const artifact=JSON.parse(await q.forOwner('owner-A').artifact(job.id,done.artifact.digest))
   assert(artifact.files.some(f=>Buffer.from(f.data,'base64').toString().includes('Private worker fixture marker.')))
   const publicText=JSON.stringify(done)+artifact.files.map(f=>Buffer.from(f.data,'base64').toString()).join('\n')
   for(const forbidden of ['FAKE_TOKEN_SENTINEL_25','FAKE_PRIVATE_SQL_25','/work/input','raw stdout','dump.sql','private-source.xml'])assert(!publicText.includes(forbidden),forbidden)
   const file=artifact.files.find(f=>f.path.endsWith('.html'));assert(file)
   const path=`/preview/${job.id}/${done.artifact.digest}/${file.path}`
   assert.equal((await request(path,undefined,{},true)).status,401)
   assert.equal((await request(path,previewB,{},true)).status,404)
   const preview=await request(path,previewA,{},true);assert.equal(preview.status,200);assert(preview.headers.get('content-security-policy').includes('sandbox;'));assert.equal(preview.headers.get('access-control-allow-origin'),null)
   assert.equal((await request(path,previewA,{headers:{'service-worker':'script'}},true)).status,404)
   // Explicit hostile active-content artifact fixture; not fabricated pipeline output.
   const active={kind:'preview-only',files:[{path:'active.html',data:Buffer.from('<!doctype html><h1>Isolated private preview</h1><script>window.PWNED=true;fetch("http://api.test:18725/api/jobs")</script><form action="http://api.test:18725/api/jobs"><button>Blocked form</button></form>').toString('base64')}]}
   const bytes=Buffer.from(JSON.stringify(active)),digest=hash(bytes)
   await pool.query('UPDATE private_jobs25 SET artifact=$2,artifact_digest=$3 WHERE id=$1',[job.id,bytes,digest])
   const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP preview.test 127.0.0.1, MAP api.test 127.0.0.1']})
   try{
    const context=await browser.newContext({httpCredentials:{username:'preview',password:previewA,origin:'http://preview.test:18725'}}),page=await context.newPage(),requests=[]
    page.on('request',r=>requests.push(r.url()))
    await page.goto(`http://preview.test:18725/preview/${job.id}/${digest}/active.html`)
    assert.equal(await page.locator('h1').textContent(),'Isolated private preview')
    assert.equal(await page.evaluate(()=>window.PWNED),undefined)
    assert.equal(await page.evaluate(()=>{try{localStorage.setItem('leak','x');return false}catch{return true}}),true)
    assert.equal(await page.evaluate(()=>{try{document.cookie='leak=x';return false}catch{return true}}),true)
    assert(!requests.some(u=>u.includes('api.test')))
    await page.screenshot({path:'.tmp/preview25.png',fullPage:true});await context.close()
   }finally{await browser.close()}
   await pool.query('UPDATE private_jobs25 SET artifact_expires_ms=0 WHERE id=$1',[job.id]);await q.sweep()
   assert.equal(await q.forOwner('owner-A').artifact(job.id,digest),undefined)
   assert.equal((await request(`/preview/${job.id}/${digest}/active.html`,previewA,{},true)).status,404)
   await pool.query('UPDATE private_jobs25 SET expires_ms=0 WHERE id=$1',[job.id]);await q.sweep();assert.equal(await q.forOwner('owner-A').get(job.id),undefined)
  }finally{await new Promise(r=>server.close(r))}
 })
 }finally{
  for(const r of [runtime,probe])for(const {job} of await r.ownedContainers().catch(()=>[]))await r.remove(job).catch(()=>{})
  await pool.end()
 }
})
