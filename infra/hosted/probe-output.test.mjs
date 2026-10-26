import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {defaultSpawn} from '../../packages/cli/dist/services/process.js'

test('real flood fixture reaches bounded pipe capture instead of starving the event loop',async()=>{
  await assert.rejects(defaultSpawn(process.execPath,[fileURLToPath(new URL('./integration/probe.mjs',import.meta.url))],{
    cwd:process.cwd(),env:{PATH:'/usr/bin:/bin',NODE_OPTIONS:'--max-old-space-size=64'},
    input:'{"op":"flood"}',timeoutMs:2000,maxOutputBytes:65536,
  }),error=>error.code==='PROCESS_OUTPUT_LIMIT')
})
