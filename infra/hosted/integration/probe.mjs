// Adversarial fixture image ONLY. Never accepted as a request-selected command.
import { readFileSync, writeFileSync, existsSync, statfsSync, openSync, closeSync, symlinkSync, renameSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
const chunks=[];for await(const c of process.stdin)chunks.push(c)
const {op,marker}=JSON.parse(Buffer.concat(chunks))
if(op==='boundary'){
  const status=readFileSync('/proc/self/status','utf8')
  const denied=path=>{try{writeFileSync(path,'fake');return false}catch{return true}}
  const network=await new Promise(r=>{const s=connect({host:'1.1.1.1',port:443});s.setTimeout(500);s.on('connect',()=>{s.destroy();r(false)});s.on('error',()=>r(true));s.on('timeout',()=>{s.destroy();r(true)})})
  const env=Object.keys(process.env)
  const output={nonroot:process.getuid()===65532,capless:/CapEff:\s+0+\n/.test(status),seccomp:/Seccomp:\s+2/.test(status),nonewprivs:/NoNewPrivs:\s+1/.test(status),
    readonly:denied('/opt/depress/hostile-write')&&denied('/etc/hostile-write'),noSocket:!existsSync('/var/run/docker.sock'),network,
    noCredentials:!env.some(k=>/TOKEN|SECRET|PASSWORD|DATABASE|AUTH|COOKIE|SSH|AWS|GITHUB/i.test(k)),
    memory:readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),swap:readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),
    pids:readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),
    cgroupReadonly:denied('/sys/fs/cgroup/pids.max'),work:Number(statfsSync('/work').blocks*statfsSync('/work').bsize),tmp:Number(statfsSync('/tmp').blocks*statfsSync('/tmp').bsize),
    privatePid:readFileSync('/proc/1/comm','utf8').trim().includes('docker-init')}
  process.stdout.write(JSON.stringify(output))
}else if(op==='network-fixture'){
  const denied=await new Promise(r=>{const s=connect({host:'127.0.0.1',port:18726});s.setTimeout(500);s.on('connect',()=>{s.destroy();r(false)});s.on('error',()=>r(true));s.on('timeout',()=>{s.destroy();r(true)})})
  process.stdout.write(JSON.stringify({denied}))
}else if(op==='ancestor'){
  // Explicit fake host marker only. No host home/secret discovery.
  let denied=true
  for(let i=0;i<50;i++){
    symlinkSync('/etc','/work/link');renameSync('/work/link','/work/current')
    try{writeFileSync('/work/current/ancestor-swap','fake');denied=false}catch{}
    unlinkSync('/work/current')
  }
  let hostDenied=false;try{writeFileSync(marker,'hostile')}catch{hostDenied=true}
  process.stdout.write(JSON.stringify({denied,hostDenied}))
}else if(op==='file'){
  const fd=openSync('/work/large-file','wx');let rejected=false
  try{for(let i=0;i<17;i++)writeFileSync(fd,Buffer.alloc(8*1024*1024))}catch(e){rejected=e.code==='EFBIG'}finally{closeSync(fd)}
  process.stdout.write(JSON.stringify({rejected}))
}else if(op==='pids'){
  const children=[];let rejected=false
  for(let i=0;i<100;i++){
    const c=spawn('/usr/local/bin/node',['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
    const ok=await new Promise(r=>{c.once('spawn',()=>r(true));c.once('error',()=>r(false))})
    if(!ok){rejected=true;break}children.push(c)
  }
  children.forEach(c=>c.kill('SIGKILL'));process.stdout.write(JSON.stringify({rejected,count:children.length}))
}else if(op==='disk'){
  let rejected=false
  try{const block=Buffer.alloc(8*1024*1024);for(let i=0;i<140;i++){const file=openSync('/work/f'+i,'wx');try{writeFileSync(file,block)}finally{closeSync(file)}}}catch(e){rejected=e.code==='ENOSPC'}
  process.stdout.write(JSON.stringify({rejected}))
}else if(op==='fds'){
  const fds=[];let rejected=false
  try{for(let i=0;i<200;i++)fds.push(openSync('/dev/null','r'))}catch(e){rejected=e.code==='EMFILE'}
  fds.forEach(closeSync);process.stdout.write(JSON.stringify({rejected}))
}else if(op==='memory'){
  const chunks=[];while(true)chunks.push(Buffer.alloc(32*1024*1024,1))
}else if(op==='flood'){
  while(true)process.stdout.write('FAKE_TOKEN_SENTINEL_25 /private/source raw stdout\n'.repeat(4096))
}else if(op==='cpu'){
  while(true){}
}else if(op==='wait'){
  setInterval(()=>{},1000)
}else throw new Error('Invalid probe')
