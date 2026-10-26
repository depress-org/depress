import { connect, Queue, migrate } from './queue.mjs'
import { Runtime } from './runtime.mjs'
import { executeOne, reap } from './controller.mjs'

// Explicit disposable-runner guard: this CLI is NOT a production service install.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.DEPRESS25_TEST_RUNTIME !== 'ephemeral-fake-only') throw new Error('Disposable test authorization required')
const pool = await connect(process.env.DEPRESS25_TEST_DATABASE)
const queue = new Queue(pool), role=process.argv[2]
try {
  if (role === 'migrate') await migrate(pool)
  else {
    const runtime = new Runtime(process.env.DEPRESS25_TEST_IMAGE)
    if (!['broker','reaper'].includes(role)) throw new Error('Invalid controller role')
    let stop = false
    process.on('SIGTERM',() => {stop=true});process.on('SIGINT',() => {stop=true})
    while (!stop) {
      try { if (role === 'broker') await executeOne(queue,runtime); else await reap(queue,runtime) }
      catch { /* Fixed public audit event only, never raw runtime/DB errors. */ }
      await new Promise(r => setTimeout(r,250))
    }
  }
} finally { await pool.end() }
