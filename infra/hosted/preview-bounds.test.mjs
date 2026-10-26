import {spawnSync} from 'node:child_process'
import {test} from 'node:test'
import assert from 'node:assert/strict'

test('hostile unmatched-close HTML is bounded before the DOM parser builds an excessive stack',()=>{
 const code=`import {previewFile} from './infra/hosted/preview.mjs';
 const data=Buffer.from('<i>'.repeat(60000)+'</x>'.repeat(60000)).toString('base64');
 try {previewFile({kind:'preview-only',files:[{path:'index.html',data}]},'index.html','/preview/fake/fake');process.exit(2)}
 catch(error){if(error.message!=='Preview depth limit')throw error;console.log('bounded-before-DOM')}`
 const result=spawnSync(process.execPath,['--max-old-space-size=256','--input-type=module','-e',code],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:2000})
 assert.equal(result.error,undefined,'parser must reject before the 2-second isolated probe deadline')
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'bounded-before-DOM')
})

test('hostile CSS rule count is bounded before allocating an excessive CSS AST',()=>{
 const code=`import {previewFile} from './infra/hosted/preview.mjs';
 const data=Buffer.from('<style>'+'a{}'.repeat(349500)+'</style>').toString('base64');
 try {previewFile({kind:'preview-only',files:[{path:'index.html',data}]},'index.html','/preview/fake/fake');process.exit(2)}
 catch(error){if(error.message!=='Preview work limit')throw error;console.log('bounded-before-CSS-AST')}`
 const result=spawnSync(process.execPath,['--max-old-space-size=256','--input-type=module','-e',code],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:2000})
 assert.equal(result.error,undefined,'CSS must reject before the 2-second isolated probe deadline')
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'bounded-before-CSS-AST')
})
