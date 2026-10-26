import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {Queue} from './queue.mjs'
const job={id:'00000000-0000-4000-8000-000000000001',lease_id:'00000000-0000-4000-8000-000000000002'}
for(const condition of ['allowed','cancelled','expired','foreign-lease','lost-session'])test(`lock-session start fence: ${condition}`,async()=>{
 const client=new EventEmitter(),queries=[];let released
 client.query=async(sql,args)=>{
  queries.push(sql)
  if(sql.startsWith('SELECT *'))return {rows:condition==='foreign-lease'?[]:[{...job,state:condition==='cancelled'?'stopping':'running',deadline_ms:condition==='expired'?0:Date.now()+10000}]}
  return {rows:[]}
 }
 client.release=destroy=>{released=destroy}
 const queue=new Queue({connect:async()=>client,query:async()=>assert.fail('Fence must not use another session')})
 await queue.withJob(job.id,async authorize=>{
  if(condition==='lost-session')client.emit('error',new Error('FAKE_SESSION_LOSS'))
  if(condition==='allowed')assert.equal((await authorize(job)).state,'running')
  else await assert.rejects(authorize(job),/Lost runtime fence/)
 })
 assert(queries.some(q=>q.includes('pg_advisory_lock(')))
 assert.equal(released,condition==='lost-session')
 assert.equal(client.listenerCount('error'),0)
})
