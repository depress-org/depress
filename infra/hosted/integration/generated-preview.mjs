import assert from 'node:assert/strict'

// Enrich the real scaffold input with an ordinary archive-backed image. This is
// fed through actual migrate/runJob+offline build, never patched into artifacts.
export function previewXml(xml) {
  return xml.toString().replace('<p>Private worker fixture marker.</p>',
    '<p>Private worker fixture marker.</p><p><img src="https://example.invalid/wp-content/uploads/2026/10/photo.png" alt="Private fixture photo" /></p>')
    .replace('</channel>', '<item><title>Photo</title><wp:post_id>202</wp:post_id><wp:post_name>photo</wp:post_name><wp:status>inherit</wp:status><wp:post_type>attachment</wp:post_type><wp:post_parent>1</wp:post_parent><wp:post_mime_type>image/png</wp:post_mime_type><wp:attachment_url>https://example.invalid/wp-content/uploads/2026/10/photo.png</wp:attachment_url></item></channel>')
}

export async function generatedPreviewProof(page,base) {
  const requests=[],errors=[]
  page.on('request',request=>requests.push(request.url()))
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
  const home=await page.goto(base+'/index.html')
  assert.equal(home.status(),200)
  assert(await page.locator('style').count()>0,'actual collected scaffold CSS must be embedded')
  await page.locator(`a[href="${new URL(base).pathname}/blog/first-post"]`).first().click()
  await page.waitForLoadState()
  assert.equal(page.url(),base+'/blog/first-post')
  assert.equal(await page.locator('h1').textContent(),'First post')
  assert((await page.locator('main').innerText()).includes('Private worker fixture marker.'))
  const style=await page.locator('h1').evaluate(element=>({size:parseFloat(getComputedStyle(element).fontSize),weight:getComputedStyle(element).fontWeight}))
  assert(style.size>=36,'real generated heading styling, not default UA CSS: '+JSON.stringify(style))
  assert.equal(style.weight,'700')
  const image=page.locator('img[alt="Private fixture photo"]')
  assert((await image.getAttribute('src')).startsWith('data:image/png;base64,'))
  assert(await image.evaluate(element=>element.complete&&element.naturalWidth>0),'actual archive image must decode')
  assert(!errors.some(error=>/Refused to (?:load|apply)|violates.*style-src/i.test(error)),errors.join('\n'))
  assert(requests.every(url=>url.startsWith(base+'/') || url.startsWith('data:')),JSON.stringify(requests))
  assert.equal((await page.goto(base+'/blog/first-post/')).status(),200)
  return {home:home.status(),post:page.url(),style,imageDecoded:true,requests,errors}
}
