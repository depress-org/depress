import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeOne, reap } from './controller.mjs'
import { Runtime } from './runtime.mjs'
import { WORKER_LIMITS, WORKER_ENVIRONMENT, createWorkerArgs } from './worker-profile.mjs'
const job={id:'00000000-0000-4000-8000-000000000001',lease_id:'00000000-0000-4000-8000-000000000002',state:'running',deadline_ms:Date.now()+100000,input:Buffer.from('{}')}
const image='sha256:'+'a'.repeat(64), id='b'.repeat(64)
function config() {
  const args=createWorkerArgs({jobId:job.id,leaseId:job.lease_id,imageId:image},{Id:image,Config:{}})
  const tmpfs=Object.fromEntries(args.flatMap((v,i)=>v==='--tmpfs'?[args[i+1].split(':')]:[]))
  return {Id:id,Name:`/depress25-${job.id}-${job.lease_id}`,Image:image,AppArmorProfile:'docker-default',Mounts:[],
    Config:{User:'65532:65532',WorkingDir:'/work',Env:Object.entries(WORKER_ENVIRONMENT).map(([k,v])=>`${k}=${v}`),Labels:{'org.depress.boundary':'issue25','org.depress.job':job.id,'org.depress.lease':job.lease_id}},
    HostConfig:{ReadonlyRootfs:true,NetworkMode:'none',IpcMode:'private',CgroupnsMode:'private',Init:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],PidsLimit:64,Memory:2147483648,MemorySwap:2147483648,NanoCpus:1e9,ShmSize:16777216,Ulimits:[{Name:'cpu',Soft:120,Hard:120},{Name:'nofile',Soft:128,Hard:128},{Name:'fsize',Soft:134217728,Hard:134217728},{Name:'core',Soft:0,Hard:0}],LogConfig:{Type:'none'},RestartPolicy:{Name:'no'},Tmpfs:tmpfs}}
}
test('effective container policy fails closed on weakened runtime and foreign identity',()=>{
  const runtime=new Runtime(image);assert(runtime.verify(config(),job))
  for(const patch of [{NetworkMode:'host'},{ReadonlyRootfs:false},{PidsLimit:0},{Memory:0},{NanoCpus:0},{CapAdd:['SYS_ADMIN']},{SecurityOpt:['seccomp=unconfined']},{Binds:['/:/host']},{LogConfig:{Type:'json-file'}},{Devices:[{}]},{PortBindings:{'80/tcp':[{}]}},{Tmpfs:{}}]) {
    const c=config();Object.assign(c.HostConfig,patch);assert.throws(()=>runtime.verify(c,job),JSON.stringify(patch))
  }
  for(const mutate of [c=>c.Config.Env.push('FAKE_TOKEN=FAKE_25'),c=>c.Mounts.push({Source:'/host'}),c=>c.Image='sha256:'+'c'.repeat(64),c=>c.Config.Labels['org.depress.job']='foreign']) {const c=config();mutate(c);assert.throws(()=>runtime.verify(c,job))}
})
test('effective runtime requires exact shared memory and all soft/hard ulimits',()=>{
  const runtime=new Runtime(image)
  for (const ShmSize of [undefined,0,33554432]) {
    const c=config();c.HostConfig.ShmSize=ShmSize;assert.throws(()=>runtime.verify(c,job))
  }
  for (const Ulimits of [undefined,null,[],{},config().HostConfig.Ulimits.slice(1),[...config().HostConfig.Ulimits,{Name:'stack',Soft:-1,Hard:-1}]]) {
    const c=config();c.HostConfig.Ulimits=Ulimits;assert.throws(()=>runtime.verify(c,job))
  }
  for (const name of ['cpu','nofile','fsize','core']) {
    for (const field of ['Soft','Hard']) {
      for (const value of [undefined,-1,999999999]) {
        const c=config();c.HostConfig.Ulimits.find(u=>u.Name===name)[field]=value
        assert.throws(()=>runtime.verify(c,job),`${name}.${field}=${value}`)
      }
    }
    const c=config();c.HostConfig.Ulimits.find(u=>u.Name===name).Name='duplicate'
    assert.throws(()=>runtime.verify(c,job))
  }
  const c=config();c.HostConfig.Ulimits.reverse();assert(runtime.verify(c,job))
})
test('broker terminal transition occurs only AFTER confirmed exact-worker removal',async()=>{
  const events=[],artifact={kind:'preview-only',files:[{path:'index.html',data:'eA=='}]}
  const queue={claim:async()=>job,withJob:async(_id,fn)=>fn(),current:async()=>job,finish:async(_j,a)=>events.push(a?'done':'failed'),retry:async()=>events.push('retry')}
  const runtime={create:async()=>id,call:async()=>({code:0,stderr:'',stdout:JSON.stringify({ok:true,artifact})}),remove:async()=>events.push('removed')}
  assert.equal(await executeOne(queue,runtime),true);assert.deepEqual(events,['removed','done'])
  events.length=0;runtime.remove=async()=>{throw new Error('uncertain')};await executeOne(queue,runtime);assert.deepEqual(events,['retry'])
  events.length=0;runtime.remove=async()=>events.push('removed');runtime.call=async()=>({code:0,stderr:'FAKE_TOKEN_25 /private',stdout:'raw stdout'})
  await executeOne(queue,runtime);assert.deepEqual(events,['removed','failed'])
})
test('cancelled-before-create never starts; idle claim never calls runtime',async()=>{
  let created=0,finished=0
  const q={claim:async()=>job,withJob:async(_,fn)=>fn(),current:async()=>({...job,state:'stopping'}),finish:async()=>finished++}
  await executeOne(q,{create:async()=>created++,remove:async()=>true});assert.equal(created,0);assert.equal(finished,1)
  q.claim=async()=>undefined;assert.equal(await executeOne(q,{}),false)
})
test('separate reaper handles cancellation, orphan and outage; failure retains slot',async()=>{
  const events=[]
  const q={pendingReap:async()=>[job],current:async()=>job,withJob:async(_,fn)=>fn(),finish:async()=>events.push('finish'),sweep:async()=>events.push('sweep'),retry:async()=>events.push('retry')}
  const r={ownedContainers:async()=>[{job,container:{Created:new Date(Date.now()-WORKER_LIMITS.wallTimeMs-1).toISOString()}}],remove:async()=>events.push('remove')}
  await reap(q,r);assert.deepEqual(events,['remove','finish','sweep'])
  events.length=0;r.remove=async()=>{throw new Error('daemon uncertain')};await reap(q,r);assert.deepEqual(events,['retry','sweep'])
  events.length=0;q.pendingReap=async()=>{throw new Error('DB down')};r.remove=async()=>events.push('remove');await reap(q,r);assert.deepEqual(events,['remove'])
})
