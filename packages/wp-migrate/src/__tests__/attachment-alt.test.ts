import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { transformWp2mdOutput } from '../keystatic-transform.js'
it('threads unique attachment alt fallback into actual stage2 destination without overwriting inline alt', async () => {
  await mkdir('.tmp',{recursive:true}); const root=await mkdtemp(resolve('.tmp/alt-'))
  try {
    const src=join(root,'in'); await mkdir(join(src,'posts/photo/images'),{recursive:true})
    await writeFile(join(src,'posts/photo/index.md'),'---\ntitle: Photo\n---\n![](images/photo.jpg)\n![Inline choice](images/photo.jpg)')
    await writeFile(join(src,'posts/photo/images/photo.jpg'),'fixture image bytes')
    const outputDir=join(root,'out')
    await transformWp2mdOutput({wp2mdDir:src,outputDir,attachmentMedia:[{id:8,url:'https://source.invalid/photo.jpg',filename:'photo.jpg',mimeType:'image/jpeg',altText:'Attachment alt'}]})
    const output=await readFile(join(outputDir,'src/content/articles/photo/index.mdoc'),'utf8')
    expect(output).toContain('![Attachment alt](/media/photo.jpg)')
    expect(output).toContain('![Inline choice](/media/photo.jpg)')
  } finally { await rm(root,{recursive:true,force:true}) }
})
