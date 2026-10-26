import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { POLICY, inputBytes, decode } from './protocol.mjs'
import { collectArtifact } from './collect-artifact.mjs'

// This file runs ONLY inside the reviewed disposable image, never in an API.
// Raw library output is discarded, not redacted after being persisted.
const reply = process.stdout.write.bind(process.stdout)
process.stdout.write = () => true
process.stderr.write = () => true
for (const method of ['log','warn','error','info','debug']) console[method] = () => {}
try {
  const chunks = []; let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > POLICY.bodyBytes) throw new Error('Input limit')
    chunks.push(chunk)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString()); inputBytes(input)
  await mkdir('/work/input', { mode:0o700 })
  await mkdir('/work/tmp', { mode:0o700 })
  await mkdir('/work/home', { mode:0o700 })
  const { InMemoryJobStore, runJob, ingestMediaArchive, validateSourceUpload } = await import('../../packages/job-core/dist/index.js')
  const { buildSite } = await import('../../packages/cli/dist/services/deploy.js')
  const { defaultSpawn } = await import('../../packages/cli/dist/services/process.js')
  const wxr = decode(input.wxr,POLICY.inputBytes), sql = decode(input.sql,POLICY.inputBytes)
  validateSourceUpload(wxr,'wxr'); if (sql.length) validateSourceUpload(sql,'sql')
  await writeFile('/work/input/export.xml', wxr,{mode:0o600,flag:'wx'})
  if (sql.length) await writeFile('/work/input/dump.sql',sql,{mode:0o600,flag:'wx'})
  const media = input.media ? await ingestMediaArchive(decode(input.media,POLICY.inputBytes),'/work/input') : undefined
  // Existing immutable server-derived owner capability. This process has exactly
  // one workload and no DB credentials/socket/network/other owner's input.
  const store = new InMemoryJobStore().forOwner('isolated-workload')
  const job = await store.create({wxrPath:'/work/input/export.xml',sqlDumpPath:sql.length?'/work/input/dump.sql':undefined,
    mediaDir:media?.mediaDir,themeId:input.theme,mode:'migrate-only'})
  const completed = await runJob(store,job.id)
  if (completed.status !== 'done' || !completed.outputDir) throw new Error('Migration failed')
  const generatedPackage = JSON.parse(await readFile(join(completed.outputDir,'package.json'),'utf8'))
  const trustedPackage = JSON.parse(await readFile('/opt/scaffold-package.json','utf8'))
  if (JSON.stringify(generatedPackage.dependencies) !== JSON.stringify(trustedPackage.dependencies) || JSON.stringify(generatedPackage.devDependencies) !== JSON.stringify(trustedPackage.devDependencies)) throw new Error('Uncached dependency graph')
  await writeFile(join(completed.outputDir,'package-lock.json'),await readFile('/opt/scaffold-lock.json'))
  await buildSite(completed.outputDir,(cmd,args,options) => defaultSpawn(cmd,args,{...options,
    env:{...options.env,npm_config_offline:'true',npm_config_cache:'/opt/cache',ASTRO_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false'}}))
  // Full output is Workers under CF14. Client files are preview-only, NEVER a
  // deployable static artifact. Do not strip server markers and claim static.
  const artifact = await collectArtifact(join(completed.outputDir,'dist/client'))
  reply(JSON.stringify({ok:true,artifact}))
} catch {
  reply('{"ok":false,"artifact":null}')
  process.exitCode = 1
}
