import { result } from './protocol.mjs'
import { WORKER_LIMITS } from './worker-profile.mjs'

export async function executeOne(queue, runtime) {
  const job = await queue.claim(); if (!job) return false
  let attached, output, containerId, launched = false
  try {
    await queue.withJob(job.id, async () => {
      const current = await queue.current(job.id,job.lease_id)
      if (!current || current.state !== 'running' || Number(current.deadline_ms) <= Date.now()) return
      const id = await runtime.create(job)
      containerId = id
      // Exact-ID start cannot resurrect a removed container; reaper shares this lock.
      attached = runtime.call(['start','--attach','--interactive',id], {
        input: current.input.toString(), timeoutMs: WORKER_LIMITS.wallTimeMs,
        maxOutputBytes: 2 * 1048576,
      })
      // Consume early rejection immediately; no unhandled raw controller errors.
      attached.catch(() => {})
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
 * containers; no new broker may create because its lease check requires the DB.
 */
export async function reap(queue, runtime) {
  let dbAvailable = true, pending = []
  try { pending = await queue.pendingReap() } catch { dbAvailable = false }
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
  if (dbAvailable) await queue.sweep()
}
