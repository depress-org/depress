import { result } from './protocol.mjs'
import { WORKER_LIMITS } from './worker-profile.mjs'

export async function executeOne(queue, runtime) {
  const job = await queue.claim(); if (!job) return false
  let attached, output, containerId, launched = false
  try {
    await queue.withJob(job.id, async authorize => {
      const current = await queue.current(job.id,job.lease_id)
      if (!current || current.state !== 'running' || Number(current.deadline_ms) <= Date.now()) return
      const id = await runtime.create(job)
      containerId = id
      await authorize(job)
      // Exact-ID start cannot resurrect a removed container; reaper shares this lock.
      attached = runtime.call(['start','--attach','--interactive',id], {
        input: current.input.toString(), timeoutMs: WORKER_LIMITS.wallTimeMs,
        maxOutputBytes: 2 * 1048576,
      })
      // Consume early rejection immediately; no unhandled raw controller errors.
      attached.catch(() => {})
      await authorize(job)
      launched = true
    })
    if (launched) {
      const r = await attached
      // Docker resolves effective AppArmor at start, not create. Reverify the
      // exact runtime after execution before accepting any artifact bytes.
      runtime.verify(await runtime.inspect(containerId),job)
      if (r.code === 0 && !r.stderr) output = result(r.stdout)
    }
  } catch { /* Public status is typed; raw stdout/errors never enter the DB. */ }
  try {
    await queue.withJob(job.id, async () => {
      await runtime.remove(job)
      await queue.finish(job, output)
    })
  } catch { await queue.retry(job).catch(() => {}) } // keep capacity reserved until reaper confirms removal
  return true
}

/** Separate process/failure domain from broker. Also kills on DB outage, using
 * Docker Created + fixed hard lifetime (not workload-supplied labels/time).
 * Serialize creates/removals in DB. With DB unavailable: remove expired/all owned
 * containers. Slow creates revalidate on the original lock session before and
 * after start; a simultaneous partition/start is reconciled by repeated reaping,
 * not by a claim of atomicity between PostgreSQL and the runtime daemon.
 */
export async function reap(queue, runtime) {
  let dbAvailable = true, pending = []
  try { pending = await queue.pendingReap() } catch { dbAvailable = false }
  try {
  const discovered = await runtime.ownedContainers()
  const candidates = new Map(pending.map(j => [j.id + j.lease_id,j]))
  for (const { job, container } of discovered) {
    let current
    if (dbAvailable) {
      try { current = await queue.current(job.id,job.lease_id) } catch { dbAvailable = false }
    }
    if (!dbAvailable || !current || !['running','stopping'].includes(current.state) ||
        current.state === 'stopping' || Number(current.deadline_ms) <= Date.now() ||
        Date.now() - Date.parse(container.Created) >= WORKER_LIMITS.wallTimeMs) candidates.set(job.id+job.lease_id,current ?? job)
  }
  for (const job of candidates.values()) {
    try {
      const cleanup = async () => { await runtime.remove(job); if (dbAvailable) await queue.finish(job) }
      if (dbAvailable) await queue.withJob(job.id,cleanup)
      else await cleanup()
    } catch { await queue.retry(job).catch(() => {}) }
  }
  } finally {
    // Queued/terminal DB expiry does not depend on daemon availability; sweep
    // never releases running/stopping capacity without confirmed removal.
    if (dbAvailable) await queue.sweep()
  }
}
