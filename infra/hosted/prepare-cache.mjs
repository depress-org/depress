import { runMigrate } from '../../packages/cli/dist/commands/migrate.js'
import { defaultSpawn, safeEnvironment } from '../../packages/cli/dist/services/process.js'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
const output = resolve('.tmp/trusted-cache-site')
await mkdir('.tmp',{recursive:true})
const migration = await runMigrate({input:resolve('infra/hosted/fixture.xml'),output,theme:'scaffold'})
if (!migration.qualityPassed) throw new Error('Trusted fixture migration failed')
const home = resolve('.tmp/cache-home'); await mkdir(home,{recursive:true})
const install = await defaultSpawn('/usr/local/bin/npm',['install','--ignore-scripts','--legacy-peer-deps'],{
  cwd:output,env:{...safeEnvironment(home),npm_config_cache:'/opt/cache',npm_config_fetch_timeout:'60000',npm_config_fetch_retries:'2'},timeoutMs:300000})
if (install.code !== 0) {
  // Fixed public fixture + credential-free preparation environment ONLY. This is
  // never a workload/public error surface; retain real diagnostics for CI repair.
  console.error(install.stderr.slice(-4096))
  throw new Error('Trusted cache preparation failed')
}
await writeFile('/opt/scaffold-package.json',await readFile(output+'/package.json'))
await writeFile('/opt/scaffold-lock.json',await readFile(output+'/package-lock.json'))
await rm(resolve('.tmp'),{recursive:true,force:true})
