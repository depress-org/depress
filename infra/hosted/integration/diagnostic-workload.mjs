// TEST IMAGE ONLY: fixed enums/booleans from a fake-only workload. Never export
// source bytes, paths, child stdout/stderr, error messages, environment or tokens.
import {readFile} from 'node:fs/promises'
let source=await readFile(new URL('../workload.mjs',import.meta.url),'utf8')
function replace(before,after){
  if(source.split(before).length!==2)throw new Error('Diagnostic fixture source mismatch')
  source=source.replace(before,after)
}
replace("const reply = process.stdout.write.bind(process.stdout)",`const reply = process.stdout.write.bind(process.stdout)
let phase='input', child
async function diagnoseSpawn(fn,cmd,args,options){
 const r=await fn(cmd,args,options)
 if(r.code!==0){
  child={operation:args[0]==='ci'?'install':'build',exit:r.code,indicators:Object.fromEntries(['ENOSPC','EACCES','EROFS','EMFILE','EAGAIN','ENOTCACHED','ENOMEM','EFBIG','offline','esbuild','sharp','heap','permission','workerd','wrangler'].map(k=>[k,(r.stderr+'\\n'+r.stdout).includes(k)]))}
 }
 return r
}`)
for(const [before,phase] of [
 ["  const media =",'archive'],["  const completed =",'migration'],
 ["  const generatedPackage =",'dependency-match'],["  await buildSite(",'build'],
 ["  const artifact =",'collect'],
])replace(before,`  phase='${phase}'\n${before}`)
replace('defaultSpawn(cmd,args,{...options,','diagnoseSpawn(defaultSpawn,cmd,args,{...options,')
replace('  reply(JSON.stringify({ok:true,artifact}))',"  reply(JSON.stringify({phase:'complete'}))")
replace('} catch {','} catch(error) {')
replace("  reply('{\"ok\":false,\"artifact\":null}')",`  reply(JSON.stringify({phase,child,code:['INSTALL_FAILED','BUILD_FAILED','PROCESS_TIMEOUT','PROCESS_OUTPUT_LIMIT'].includes(error.code)?error.code:'OTHER'}))`)
source=source.replace(/from '(\.\.?\/[^']+)'/g,(_,path)=>`from '${new URL(path,new URL('../workload.mjs',import.meta.url))}'`)
source=source.replace(/import\('(\.\.?\/[^']+)'\)/g,(_,path)=>`import('${new URL(path,new URL('../workload.mjs',import.meta.url))}')`)
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
