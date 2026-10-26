import { describe, it, expect } from 'vitest'
import { defaultSpawn } from '../services/process.js'

describe('#25 additive bounded process stdin', () => {
  it('transfers literal bytes without argv/shell or fake credential inheritance', async () => {
    const input='literal $HOME; touch /never; FAKE_INPUT_25'
    const result=await defaultSpawn(process.execPath,['-e',"let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(s))"],{cwd:process.cwd(),env:{},input})
    expect(result).toEqual({code:0,stdout:input,stderr:''})
  })
  it('rejects oversized input before starting, including multi-byte text',async () => {
    await expect(defaultSpawn('/never',[],{cwd:'.',env:{},input:'é'.repeat(2097153)})).rejects.toMatchObject({code:'PROCESS_INPUT_LIMIT'})
  })
  it('consumes early child stdin close without unhandled EPIPE',async () => {
    const result=await defaultSpawn(process.execPath,['-e','process.exit(0)'],{cwd:process.cwd(),env:{},input:'x'.repeat(1048576)})
    expect(result.code).toBe(0)
  })
})
