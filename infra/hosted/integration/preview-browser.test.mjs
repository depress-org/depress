import {test} from 'node:test'
import {writeFile} from 'node:fs/promises'
import {chromium} from 'playwright-core'
import {listenHosted} from '../server.mjs'
import {hash} from '../protocol.mjs'
import {svgFixture,svgPreviewProof} from './svg-preview.mjs'

test('real authenticated HTTP/browser confines SVG navigation without discarding SVG imagery or scoped HTML links',async t=>{
 const id='00000000-0000-4000-8000-000000000025',token='FAKE_SVG_PREVIEW_'+'p'.repeat(32),origin='http://preview.test:18726'
 const bytes=Buffer.from(JSON.stringify(svgFixture)),digest=hash(bytes),base=`${origin}/preview/${id}/${digest}`
 const server=listenHosted({queue:{forOwner:owner=>({artifact:async(j,d)=>owner==='owner-A'&&j===id&&d===digest?bytes:undefined})},identities:[],previewIdentities:[{token,ownerId:'owner-A'}],apiOrigin:'http://api.test:18726',previewOrigin:origin})
 await new Promise((yes,no)=>server.once('error',no).listen(18726,'127.0.0.1',yes))
 let browser;const receipt=[]
 try {
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP preview.test 127.0.0.1, MAP api.test 127.0.0.1']})
  for(const path of ['index.html','standalone.svg','xlink.svg','foreign.svg','static.svg','inline-foreign.html'])await t.test(path,async()=>{
   const context=await browser.newContext({httpCredentials:{username:'preview',password:token,origin}})
   try {
    const page=await context.newPage();page.setDefaultTimeout(5000)
    receipt.push(await svgPreviewProof(page,base,path))
    if(path==='index.html')await page.screenshot({path:'.tmp/preview25-svg.png'})
   } finally {await context.close()}
  })
  await writeFile('.tmp/preview25-svg-receipt.json',JSON.stringify(receipt,null,2))
  console.log(JSON.stringify({svgNavigationConfinement:receipt}))
 } finally {await browser?.close();await new Promise(r=>server.close(r))}
})
