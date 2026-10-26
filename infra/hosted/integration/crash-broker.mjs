// Fake-only broker crash fixture; starts a real isolated wait workload then is killed.
import {connect,Queue} from '../queue.mjs'
import {Runtime} from '../runtime.mjs'
if(process.env.DEPRESS25_TEST_RUNTIME!=='ephemeral-fake-only')throw new Error('Fixture only')
const pool=await connect(process.env.DEPRESS25_TEST_DATABASE),q=new Queue(pool),r=new Runtime(process.env.DEPRESS25_PROBE_IMAGE)
const job=await q.claim()
await q.withJob(job.id,async()=>{
 const id=await r.create(job)
 r.call(['start','--attach','--interactive',id],{input:'{"op":"wait"}',timeoutMs:180000}).catch(()=>{})
 process.send({id,jobId:job.id,leaseId:job.lease_id})
})
setInterval(()=>{},1000)
