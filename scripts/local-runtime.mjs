import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { safeEnvironment } from '../packages/cli/dist/services/process.js'

/** Loopback-only, credential-free built artifact smoke. No provider deployment. */
export async function verifyLocalRuntime(site, kind, route = '/blog/first-post/') {
  const reservation = createServer()
  await new Promise((yes, no) => reservation.once('error', no).listen(0, '127.0.0.1', yes))
  const port = reservation.address().port
  await new Promise(yes => reservation.close(yes))
  const args = kind === 'workers'
    ? [join(site, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--config', 'dist/server/wrangler.json']
    : ['dist/server/entry.mjs']
  const child = spawn(process.execPath, args, { cwd: site, detached: true, env: { ...safeEnvironment(join(site, '.tmp/runtime-home')), HOST: '127.0.0.1', PORT: String(port), WRANGLER_SEND_METRICS: 'false', ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = '', error
  child.on('error', e => { error = e })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', d => { log = (log + d.toString()).slice(-32768) })
  try {
    const base = `http://127.0.0.1:${port}`
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (error || child.exitCode !== null) throw new Error(`Local runtime exited: ${error ?? child.exitCode}\n${log}`)
      try { ready = (await fetch(base + route, { signal: AbortSignal.timeout(500) })).ok } catch {}
      if (ready) break
      await new Promise(r => setTimeout(r, 200))
    }
    assert(ready, `Local runtime not ready\n${log}`)
    const html = await (await fetch(base + route)).text()
    assert(html.includes('First body marker alpha.'), `${kind} lost static post`)
    const cms = await fetch(base + '/keystatic')
    assert.equal(cms.status, 200, `${kind} Keystatic route failed\n${log}`)
    assert((await cms.text()).toLowerCase().includes('keystatic'), `${kind} CMS UI not served`)
    console.log(JSON.stringify({ runtime: 'PASS', kind, route, cms: cms.status }))
  } finally {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    await new Promise(r => setTimeout(r, 100))
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
  }
}
