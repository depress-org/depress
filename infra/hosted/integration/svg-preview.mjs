import assert from 'node:assert/strict'

// Fake hostile content, never migration output. All attempted destinations are
// intercepted by the browser before a socket opens, including failed controls.
export const svgDestination='http://127.0.0.1:19998/escaped?private=FAKE_PRIVATE_CONTENT_25'
const graphic=content=>`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="150" height="80" viewBox="0 0 150 80">${content}<script>window.PWNED=true</script></svg>`
const rect='<rect width="150" height="80" fill="#19a04b"/>'
export const svgFixture={kind:'preview-only',files:Object.entries({
 'index.html':`<!doctype html><h1>SVG navigation confinement</h1><a id="normal" href="/post">Local control</a><svg id="animated" xmlns="http://www.w3.org/2000/svg" width="150" height="80" viewBox="0 0 150 80"><a id="smil" href="#">${rect}<set attributeName="href" to="${svgDestination}" begin="0s"/></a></svg><img id="static" alt="Static SVG" src="/static.svg"><script>window.PWNED=true</script>`,
 'standalone.svg':graphic(`<a id="direct" href="${svgDestination}">${rect}</a>`),
 'xlink.svg':graphic(`<a xlink:href="#">${rect}<animate attributeName="xlink:href" values="${svgDestination}" dur="1s" repeatCount="indefinite"/></a>`),
 'foreign.svg':graphic(`${rect}<foreignObject width="150" height="80"><div xmlns="http://www.w3.org/1999/xhtml"><a href="${svgDestination}" style="display:block;width:150px;height:80px;background:#19a04b">Outbound</a></div></foreignObject>`),
 'inline-foreign.html':`<!doctype html>${graphic('<foreignObject width="150" height="80"><div xmlns="http://www.w3.org/1999/xhtml">First<br/>Second</div></foreignObject><foreignObject width="0" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><input disabled=""/><style>div { color: red; } /* & < */</style></div></foreignObject>')}<svg id="static" width="150" height="80" viewBox="0 0 150 80"><defs><linearGradient id="green" gradientUnits="userSpaceOnUse"><stop stop-color="#19a04b"/></linearGradient></defs><rect width="150" height="80" fill="url(#green)"/></svg><script>window.PWNED=true</script>`,
 'static.svg':graphic(rect),
 'post/index.html':'<h1>Local ordinary control</h1>',
}).map(([path,value])=>({path,data:Buffer.from(value).toString('base64')}))}

export async function svgPreviewProof(page,base,path='index.html') {
 const outbound=[],popups=[]
 const intercept=async route=>{
  outbound.push(route.request().url())
  await route.fulfill({status:200,contentType:'text/plain',body:'Intercepted fake outbound navigation'})
 }
 const popup=p=>popups.push(p.url())
 await page.context().route('http://127.0.0.1:19998/**',intercept)
 page.context().on('page',popup)
 try {
  const url=base+'/'+path,response=await page.goto(url)
  assert.equal(response.status(),200)
  assert(response.headers()['content-security-policy'].startsWith('sandbox;'))
  assert(!response.headers()['content-security-policy'].includes('allow-'))
  if(path==='index.html') {
   assert.equal(await page.evaluate(()=>window.PWNED),undefined)
   await page.locator('#normal').click();await page.waitForLoadState()
   assert.equal(page.url(),base+'/post')
   assert.equal(await page.locator('h1').textContent(),'Local ordinary control')
   await page.goto(url)
  }
  // Same visible rectangle and user activation as QA25-02, regardless of
  // whether the presentation is still vulnerable or now an inert image.
  const target=path==='index.html'?page.locator('#animated'):page.locator('svg, img').first()
  const box=await target.boundingBox();assert(box&&box.width>0&&box.height>0)
  await page.mouse.click(box.x+30,box.y+30)
  // Sample through multiple rendering turns, not merely the pre-click URL.
  await page.waitForTimeout(150)
  assert.equal(page.url(),url,'SVG click must stay within the authenticated artifact')
  assert.deepEqual(outbound,[])
  assert.deepEqual(popups,[])
  const image=path==='index.html'?page.locator('#animated'):page.locator('img').first()
  assert.equal(await image.evaluate(e=>e.tagName),'IMG')
  assert(await image.evaluate(e=>e.complete&&e.naturalWidth===150&&e.naturalHeight===80),'SVG remains a decoded visible image')
  assert.equal(await page.locator('svg,foreignObject,object,embed,iframe').count(),0,'no interactive SVG document in the live DOM')
  const scriptBlocked=await page.evaluate(()=>window.PWNED===undefined)
  assert(scriptBlocked,'fixture script must not execute in the preview window')
  let staticPixel
  if(path==='index.html'||path==='inline-foreign.html'||path==='static.svg') {
   const staticImage=path==='static.svg'?image:page.locator('#static')
   assert(await staticImage.evaluate(e=>e.complete&&e.naturalWidth===150&&e.naturalHeight===80))
   staticPixel=await staticImage.evaluate(e=>{
    const canvas=document.createElement('canvas');canvas.width=150;canvas.height=80
    const ctx=canvas.getContext('2d');ctx.drawImage(e,0,0)
    return [...ctx.getImageData(100,60,1,1).data]
   })
   assert.deepEqual(staticPixel,[25,160,75,255],'static SVG paints the expected opaque green pixel')
  }
  if(path==='inline-foreign.html') {
   const xml=await image.evaluate(e=>{
    const doc=new DOMParser().parseFromString(atob(e.src.split(',')[1]),'image/svg+xml')
    return {error:!!doc.querySelector('parsererror'),viewBox:doc.documentElement.getAttribute('viewBox'),foreign:doc.querySelector('foreignObject')?.namespaceURI,div:doc.querySelector('div')?.namespaceURI,br:doc.querySelector('br')?.namespaceURI,text:doc.querySelector('div')?.textContent}
   })
   assert.deepEqual(xml,{error:false,viewBox:'0 0 150 80',foreign:'http://www.w3.org/2000/svg',div:'http://www.w3.org/1999/xhtml',br:'http://www.w3.org/1999/xhtml',text:'FirstSecond'})
   const names=await page.locator('#static').evaluate(e=>{
    const doc=new DOMParser().parseFromString(atob(e.src.split(',')[1]),'image/svg+xml')
    return {viewBox:doc.documentElement.getAttribute('viewBox'),units:doc.querySelector('linearGradient')?.getAttribute('gradientUnits')}
   })
   assert.deepEqual(names,{viewBox:'0 0 150 80',units:'userSpaceOnUse'})
  }
  return {path,status:response.status(),url:page.url(),outbound,popups,imageDecoded:true,scopedLink:path==='index.html',scriptBlocked,...(staticPixel?{staticPixel}:{})}
 } finally {
  await page.context().unroute('http://127.0.0.1:19998/**',intercept)
  page.context().off('page',popup)
 }
}
