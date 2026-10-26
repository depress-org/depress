import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHostedHandler} from './http.mjs'
import {hash} from './protocol.mjs'
const token='FAKE_API_25_'+'a'.repeat(32),previewToken='FAKE_PREVIEW_25_'+'p'.repeat(32)
const id='00000000-0000-4000-8000-000000000025'
const artifact=Buffer.from(JSON.stringify({kind:'preview-only',files:[{path:'active.svg',data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.PWNED=true</script></svg>').toString('base64')}]})),digest=hash(artifact)
function fixture(){
 const events=[]
 const scope={reserve:async()=>{events.push('reserve');return 'reservation'},release:async()=>events.push('release'),submit:async input=>{events.push(input);return{id,status:'queued'}},list:async()=>[],get:async()=>undefined,cancel:async()=>false,artifact:async(_id,d)=>d===digest?artifact:undefined}
 const queue={forOwner:ownerId=>{assert.equal(ownerId,'server-owner');return scope}}
 const options={queue,identities:[{token,ownerId:'server-owner'}],previewIdentities:[{token:previewToken,ownerId:'server-owner'}],apiOrigin:'https://api.example.com',previewOrigin:'https://preview.example.net'}
 return{handler:createHostedHandler(options),events,options}
}
const api=(path,init={},auth=token)=>new Request('https://api.example.com'+path,{...init,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...init.headers}})
test('hosted API authenticates before admission; no query credentials or unknown origin',async()=>{
 const{handler,events,options}=fixture()
 assert.equal((await handler(api('/api/jobs',{},''))).status,401)
 assert.equal((await handler(new Request('https://foreign.example.org/api/jobs'))).status,421)
 assert.equal((await handler(api('/api/jobs?token=FAKE_SECRET'))).status,400)
 assert.equal(events.length,0)
 assert.equal((await createHostedHandler({...options,identities:[]})(api('/api/jobs'))).status,503)
 assert.throws(()=>createHostedHandler({...options,previewIdentities:[{token,ownerId:'server-owner'}]}))
})
test('real #23 multipart admission submits only fixed file bytes and releases failed reservation',async()=>{
 const{handler,events}=fixture(),form=new FormData();form.set('theme','scaffold');form.set('wxr',new Blob(['<rss/>']),'../../not-a-path.xml')
 const response=await handler(api('/api/jobs',{method:'POST',body:form}));assert.equal(response.status,202)
 assert.deepEqual(events,['reserve',{theme:'scaffold',wxr:Buffer.from('<rss/>').toString('base64'),sql:'',media:''}])
 const bad=fixture(),deploy=new FormData();deploy.set('theme','scaffold');deploy.set('wxr',new Blob(['<rss/>']),'input.xml');deploy.set('mode','deploy')
 assert.equal((await bad.handler(api('/api/jobs',{method:'POST',body:deploy}))).status,403);assert.deepEqual(bad.events,['reserve','release'])
 const huge=fixture();assert.equal((await huge.handler(api('/api/jobs',{method:'POST',body:'x',headers:{'content-type':'multipart/form-data; boundary=x','content-length':'99999999'}}))).status,413);assert.deepEqual(huge.events,['reserve','release'])
})
test('active SVG preview is authenticated, owner-bound and sandboxed by HTTP headers',async()=>{
 const{handler}=fixture(),url=`https://preview.example.net/preview/${id}/${digest}/active.svg`
 assert.equal((await handler(new Request(url))).status,401)
 const response=await handler(new Request(url,{headers:{authorization:'Basic '+Buffer.from('preview:'+previewToken).toString('base64')}}))
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml')
 for(const directive of ['sandbox;','default-src \'none\'','connect-src \'none\'','frame-ancestors \'none\''])assert(response.headers.get('content-security-policy').includes(directive))
 assert(!response.headers.get('content-security-policy').includes('allow-same-origin'));assert(!response.headers.has('set-cookie'));assert(!response.headers.has('access-control-allow-origin'))
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff')
 assert.equal((await handler(new Request(url,{headers:{authorization:'Bearer '+previewToken,'service-worker':'script'}}))).status,404)
 assert.equal((await handler(new Request(url.replace(digest,'0'.repeat(64)),{headers:{authorization:'Bearer '+previewToken}}))).status,404)
 assert.equal((await handler(new Request(url,{headers:{authorization:'Bearer '+token}}))).status,401)
})
