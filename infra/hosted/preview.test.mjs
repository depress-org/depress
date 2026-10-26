import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHostedHandler} from './http.mjs'
import {hash,POLICY} from './protocol.mjs'

const id='00000000-0000-4000-8000-000000000025', token='FAKE_PREVIEW_'+'p'.repeat(32), foreign='FAKE_FOREIGN_'+'f'.repeat(32)
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
function fixture(extra={}) {
 const files={'index.html':'<!doctype html><link rel="stylesheet" href="/css/main.css"><a href="/blog/post#title">Post</a><img src="/media/pixel.png">','blog/post/index.html':'<h1 id="title">Post content</h1><a href="../../">Home</a>','css/main.css':'@import "nested/extra.css"; h1 {color: rgb(25, 50, 75);background-image:url(../media/pixel.png)}','css/nested/extra.css':'@font-face {font-family:fixture;src:url(../../font.woff2)}','font.woff2':Buffer.from('fake-font'),'media/pixel.png':Buffer.from(png,'base64'),...extra}
 const bytes=Buffer.from(JSON.stringify({kind:'preview-only',files:Object.entries(files).map(([path,data])=>({path,data:Buffer.from(data).toString('base64')}))})),digest=hash(bytes),base=`/preview/${id}/${digest}`
 let expired=false
 const queue={forOwner:owner=>({artifact:async(j,d)=>!expired&&owner==='owner-A'&&j===id&&d===digest?bytes:undefined})}
 const handler=createHostedHandler({queue,identities:[],previewIdentities:[{token,ownerId:'owner-A'},{token:foreign,ownerId:'owner-B'}],apiOrigin:'https://api.example.com',previewOrigin:'https://preview.example.net'})
 const request=(path,auth=token,headers={})=>handler(new Request('https://preview.example.net'+path,{headers:{...(auth?{authorization:'Bearer '+auth}:{}),...headers}}))
 return {base,request,expire:()=>{expired=true}}
}
test('static preview scopes post links and inlines admitted CSS, nested imports, local images and fonts without relaxing CSP',async()=>{
 const {base,request}=fixture(),response=await request(base+'/index.html'),html=await response.text()
 assert.equal(response.status,200)
 assert(html.includes(`href="${base}/blog/post#title"`),html)
 assert(html.includes('<style>'));assert(html.includes('rgb(25, 50, 75)'))
 assert(html.includes('data:image/png;base64,'));assert(html.includes('data:font/woff2;base64,'))
 assert(!html.includes('@import'));assert(!html.includes('rel="stylesheet"'))
 assert(response.headers.get('content-security-policy').includes("style-src 'unsafe-inline'; img-src data:; font-src data:"))
 assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin')
 assert.equal(response.headers.get('access-control-allow-origin'),null)
})
test('scoped root, extensionless and trailing slash routes resolve only admitted directory index files',async()=>{
 const {base,request}=fixture()
 for(const path of ['','/','/blog/post','/blog/post/','/blog/post/index.html']) {
  const response=await request(base+path);assert.equal(response.status,200,path)
 }
 const html=await (await request(base+'/blog/post/')).text();assert(html.includes(`href="${base}/"`))
 assert.equal((await request(base+'/missing')).status,404)
})
test('all static resource and directory routes retain authentication, owner, digest, expiry and service-worker denial',async()=>{
 const paths=['/','/blog/post','/css/main.css','/media/pixel.png','/font.woff2']
 for(const path of paths){
  // Each owner remains within the unchanged ten-request admission window.
  const {base,request,expire}=fixture()
  assert.equal((await request(base+path)).status,200,path)
  assert.equal((await request(base+path,'')).status,401)
  assert.equal((await request(base+path,foreign)).status,404)
  assert.equal((await request(base.replace(/\/[a-f0-9]{64}$/,'/'+'0'.repeat(64))+path)).status,404)
  assert.equal((await request(base+path,token,{'service-worker':'script'})).status,404)
  expire();assert.equal((await request(base+path)).status,404)
 }
})
test('external/base/refresh/ping/target navigation is inert; encoded and escaping paths never become artifact capabilities',async()=>{
 const {base,request}=fixture({'index.html':'<base href="https://outside.invalid/"><meta http-equiv="refresh" content="0;url=https://outside.invalid"><a href="https://outside.invalid/private" target="_blank" ping="https://outside.invalid/ping">Outside</a><a href="/preview/foreign/digest/post">Cross</a><a href="%2fsecret">Encoded</a><a href="../../escape">Escape</a><img src="//outside.invalid/pixel"><script>window.PWNED=true</script><form action="https://outside.invalid"></form>'})
 const response=await request(base+'/'),html=await response.text()
 assert.equal(response.status,200)
 assert(!html.includes('outside.invalid'));assert(!html.includes('<base'));assert(!html.includes('http-equiv="refresh"'));assert(!html.includes('target='));assert(!html.includes('ping='))
 assert(!html.includes('href="%2f'));assert(!html.includes('href="../../'))
 assert(!response.headers.get('content-security-policy').includes('allow-'))
})
test('CSS embedding escapes raw-text closing tags and preserves inline styles without HTML breakout',async()=>{
 const {base,request}=fixture({'css/main.css':'h1::after {content:"</style><script>window.PWNED=true</script>"}', 'index.html':'<link rel="stylesheet" href="css/main.css"><h1 style="background:url(media/pixel.png)">Safe</h1>'})
 const response=await request(base+'/'),html=await response.text()
 assert.equal(response.status,200);assert(!html.includes('</style><script>'));assert(html.includes('data:image/png;base64,'))
})
test('cyclic imports and transformed expansion over the unchanged byte ceiling fail closed with redacted errors',async()=>{
 for(const extra of [{'css/main.css':'@import "main.css";'}, {'index.html':'<img src="/media/big.png">'.repeat(100),'media/big.png':Buffer.alloc(POLICY.artifactBytes/8,65)}]){
  const {base,request}=fixture(extra),response=await request(base+'/')
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'Request failed'})
 }
})
