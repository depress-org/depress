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
    HostConfig:{ReadonlyRootfs:true,NetworkMode:'none',IpcMode:'private',CgroupnsMode:'private',Init:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],PidsLimit:64,Memory:2147483648,MemorySwap:2147483648,NanoCpus:1e9,ShmSize:16777216,Ulimits:[{Name:'cpu',Soft:120,Hard:120},{Name:'nofile',Soft:128,Hard:128},{Name:'fsize',Soft:167772160,Hard:167772160},{Name:'core',Soft:0,Hard:0}],LogConfig:{Type:'none'},RestartPolicy:{Name:'no'},Tmpfs:tmpfs}}
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
test('effective mount metadata permits only the declared bounded anonymous tmpfs, never a host source or extra mount',()=>{
  const runtime=new Runtime(image),c=config()
  c.Mounts=[{Type:'tmpfs',Source:'',Destination:'/work',RW:true},{Type:'tmpfs',Source:'',Destination:'/tmp',RW:true}]
  assert(runtime.verify(c,job))
  for(const mount of [{Type:'bind',Source:'/host',Destination:'/work',RW:true},{Type:'tmpfs',Source:'/host',Destination:'/work',RW:true},{Type:'tmpfs',Source:'',Destination:'/unbounded',RW:true},{Type:'volume',Source:'',Destination:'/work',RW:true}]){
    const changed=config();changed.Mounts=[mount];assert.throws(()=>runtime.verify(changed,job))
  }
  c.Mounts.push({...c.Mounts[0]});assert.throws(()=>runtime.verify(c,job))
})
test('created AppArmor policy is explicit and running/exited workloads require effective confinement',()=>{
  const runtime=new Runtime(image),c=config();c.AppArmorProfile='';c.State={Status:'created'}
  assert.throws(()=>runtime.verify(c,job))
  c.HostConfig.SecurityOpt.push('apparmor=docker-default');assert(runtime.verify(c,job))
  for(const status of ['running','exited']){c.State.Status=status;assert.throws(()=>runtime.verify(c,job))}
  c.AppArmorProfile='docker-default';assert(runtime.verify(c,job))
})
test('broker terminal transition occurs only AFTER confirmed exact-worker removal',async()=>{
  const events=[],artifact={kind:'preview-only',files:[{path:'index.html',data:'eA=='}]}
  const queue={claim:async()=>job,withJob:async(_id,fn)=>fn(async()=>job),current:async()=>job,finish:async(_j,a)=>events.push(a?'done':'failed'),retry:async()=>events.push('retry')}
  const runtime={create:async()=>id,call:async()=>({code:0,stderr:'',stdout:JSON.stringify({ok:true,artifact})}),inspect:async()=>config(),verify:()=>true,remove:async()=>events.push('removed')}
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
for(const reason of ['cancellation','deadline','lost-lock'])test(`late create cannot start after ${reason}`,async()=>{
 let allowed=true,started=0,removed=0
 const q={claim:async()=>job,current:async()=>job,
  withJob:async(_,fn)=>fn(async()=>{if(!allowed)throw new Error('Fenced start')}),
  finish:async()=>{},retry:async()=>{}}
 const r={create:async()=>{allowed=false;return id},call:async()=>{started++;return {code:1}},remove:async()=>removed++}
 await executeOne(q,r);assert.equal(started,0);assert.equal(removed,1)
})
test('loss only after initiating start removes the worker without accepting an artifact',async()=>{
 const events=[],artifact={kind:'preview-only',files:[{path:'index.html',data:'eA=='}]};let live=true
 const q={claim:async()=>job,current:async()=>job,
  withJob:async(_,fn)=>fn(async()=>{if(!live)throw new Error('Lost fence after start')}),
  finish:async(_,output)=>events.push(output?'done':'failed'),retry:async()=>events.push('retry')}
 const r={create:async()=>id,call:async()=>{events.push('start');live=false;return {code:0,stderr:'',stdout:JSON.stringify({ok:true,artifact})}},
  inspect:async()=>config(),verify:()=>true,remove:async()=>events.push('removed')}
 await executeOne(q,r);assert.deepEqual(events,['start','removed','failed'])
})
test('DB-only expiry still runs during runtime discovery outage without freeing uncertain workers',async()=>{
 const events=[],q={pendingReap:async()=>[],sweep:async()=>events.push('sweep'),finish:async()=>events.push('finish')}
 await assert.rejects(reap(q,{ownedContainers:async()=>{throw new Error('fake daemon unavailable')}}))
 assert.deepEqual(events,['sweep'])
})
test('separate reaper handles cancellation, orphan and outage; failure retains slot',async()=>{
  const events=[]
  const q={pendingReap:async()=>[job],current:async()=>job,withJob:async(_,fn)=>fn(),finish:async()=>events.push('finish'),sweep:async()=>events.push('sweep'),retry:async()=>events.push('retry')}
  const r={ownedContainers:async()=>[{job,container:{Created:new Date(Date.now()-WORKER_LIMITS.wallTimeMs-1).toISOString()}}],remove:async()=>events.push('remove')}
  await reap(q,r);assert.deepEqual(events,['remove','finish','sweep'])
  events.length=0;r.remove=async()=>{throw new Error('daemon uncertain')};await reap(q,r);assert.deepEqual(events,['retry','sweep'])
  events.length=0;q.pendingReap=async()=>{throw new Error('DB down')};r.remove=async()=>events.push('remove');await reap(q,r);assert.deepEqual(events,['remove'])
})
test('reaper removal is observable before its durable terminal transaction completes',async()=>{
 let removed=false,state='running',releaseFinish,observeRemoval
 const finishing=new Promise(resolve=>{releaseFinish=resolve}),removal=new Promise(resolve=>{observeRemoval=resolve})
 const q={pendingReap:async()=>[job],withJob:async(_,fn)=>fn(),finish:async()=>{await finishing;state='failed'},sweep:async()=>{}}
 const r={ownedContainers:async()=>[],remove:async()=>{removed=true;observeRemoval()}}
 const reaping=reap(q,r)
 await removal
 assert.equal(removed,true);assert.equal(state,'running','container absence alone cannot assert terminal state')
 releaseFinish();await reaping;assert.equal(state,'failed')
})
