import { readFile } from 'node:fs/promises'
import { POLICY, identifier, owner, inputBytes, hash, publicJob, artifactBytes } from './protocol.mjs'
import { WORKER_LIMITS } from './worker-profile.mjs'

export async function connect(connectionString) {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 })
  pool.on('error', () => {}) // Idle connection outage is reconciled, never a raw log or process crash.
  return pool
}
export async function migrate(pool) { await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')) }
export class QueueFull extends Error { constructor() { super('Admission limit reached') } }

export class Queue {
  constructor(pool) { this.pool = pool }
  async transaction(fn) {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SET LOCAL lock_timeout = '5s'")
      // ALL quota-changing paths use the same database-wide lock, including expiry.
      await c.query('SELECT pg_advisory_xact_lock(250025)')
      const value = await fn(c); await c.query('COMMIT'); return value
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
  }
  async withJob(id, fn) {
    const c = await this.pool.connect()
    let lost = false
    const onError = () => { lost = true }
    c.on('error',onError)
    try {
      // Serialize runtime create/start vs exact-lease removal across controllers.
      await c.query("SET lock_timeout = '5s'")
      await c.query('SELECT pg_advisory_lock(hashtext($1),25)', [id])
      // Revalidate on the lock session itself, never on a fresh connection after
      // lock loss. Cancellation and deadline can change during a slow create.
      return await fn(async job => {
        if (lost || job.id !== id) throw new Error('Lost runtime fence')
        const {rows:[r]} = await c.query('SELECT * FROM private_jobs25 WHERE id=$1 AND lease_id=$2',[id,job.lease_id])
        if (lost || !r || r.state !== 'running' || Number(r.deadline_ms) <= Date.now()) throw new Error('Lost runtime fence')
        return r
      })
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtext($1),25)', [id]).catch(() => {})
      c.removeListener('error',onError)
      c.release(lost)
    }
  }
  forOwner(identity) {
    const ownerId = owner(identity), root = this
    return Object.freeze({ ownerId,
      async reserve() {
        return root.transaction(async c => {
          await c.query('DELETE FROM private_uploads25 WHERE expires_ms<=$1',[Date.now()])
          const {rows:[n]} = await c.query('SELECT count(*)::int AS n FROM private_uploads25')
          const {rows:[own]} = await c.query('SELECT count(*)::int AS n FROM private_uploads25 WHERE owner_id=$1',[ownerId])
          if (n.n >= 4 || own.n >= 1) throw new QueueFull()
          const id=identifier(); await c.query('INSERT INTO private_uploads25 VALUES($1,$2,$3)',[id,ownerId,Date.now()+POLICY.requestMs]); return id
        })
      },
      async release(id) { await root.pool.query('DELETE FROM private_uploads25 WHERE id=$1 AND owner_id=$2',[id,ownerId]) },
      async submit(input, reservation) {
        const size = inputBytes(input), bytes = Buffer.from(JSON.stringify(input))
        return root.transaction(async c => {
          if (reservation) {
            const {rowCount} = await c.query('DELETE FROM private_uploads25 WHERE id=$1 AND owner_id=$2 AND expires_ms>$3',[reservation,ownerId,Date.now()])
            if (rowCount !== 1) throw new QueueFull()
          }
          const { rows: [r] } = await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE owner_id=$1)::int AS own,
            coalesce(sum(coalesce(octet_length(input),0) + coalesce(octet_length(artifact),0)),0)::bigint AS bytes FROM private_jobs25`, [ownerId])
          // Rows include terminal metadata; clients cannot churn past the retention budget.
          if (r.n >= POLICY.rows || r.own >= POLICY.ownerRows || Number(r.bytes) + bytes.length > POLICY.totalBytes) throw new QueueFull()
          const now = Date.now(), id = identifier()
          const { rows: [job] } = await c.query(`INSERT INTO private_jobs25(id,owner_id,state,created_ms,expires_ms,input,input_bytes)
            VALUES($1,$2,'queued',$3,$4,$5,$6) RETURNING *`, [id, ownerId, now, now + POLICY.queuedMs, bytes, size])
          return publicJob(job)
        })
      },
      async get(id) { const { rows: [r] } = await root.pool.query('SELECT * FROM private_jobs25 WHERE owner_id=$1 AND id::text=$2 AND expires_ms>$3', [ownerId, id, Date.now()]); return r && publicJob(r) },
      async list() { const { rows } = await root.pool.query('SELECT * FROM private_jobs25 WHERE owner_id=$1 AND expires_ms>$2 ORDER BY created_ms DESC LIMIT 32', [ownerId,Date.now()]); return rows.map(publicJob) },
      async cancel(id) {
        return root.transaction(async c => {
          const { rows: [r] } = await c.query('SELECT * FROM private_jobs25 WHERE owner_id=$1 AND id::text=$2 FOR UPDATE', [ownerId,id])
          if (!r) return false
          if (r.state === 'queued') await c.query("UPDATE private_jobs25 SET state='failed',input=NULL,input_bytes=0,expires_ms=$2 WHERE id=$1", [r.id, Date.now() + POLICY.metadataMs])
          else if (r.state === 'running') await c.query("UPDATE private_jobs25 SET state='stopping' WHERE id=$1", [r.id])
          return true
        })
      },
      async artifact(id, digest) {
        const { rows: [r] } = await root.pool.query(`SELECT artifact FROM private_jobs25 WHERE owner_id=$1 AND id::text=$2 AND artifact_digest=$3 AND state='done' AND artifact_expires_ms>$4`, [ownerId,id,digest,Date.now()])
        return r?.artifact && Buffer.from(r.artifact)
      },
    })
  }
  async claim() {
    return this.transaction(async c => {
      const { rows: [count] } = await c.query("SELECT count(*)::int AS n FROM private_jobs25 WHERE state IN ('running','stopping')")
      if (count.n >= POLICY.running) return undefined
      const { rows: [row] } = await c.query("SELECT * FROM private_jobs25 WHERE state='queued' AND expires_ms>$1 ORDER BY created_ms,id LIMIT 1 FOR UPDATE", [Date.now()])
      if (!row) return undefined
      const lease = identifier(), deadline = Date.now() + WORKER_LIMITS.wallTimeMs
      const { rows: [job] } = await c.query("UPDATE private_jobs25 SET state='running',lease_id=$2,deadline_ms=$3 WHERE id=$1 RETURNING *", [row.id,lease,deadline])
      return job
    })
  }
  async current(id, lease) {
    const { rows: [r] } = await this.pool.query('SELECT * FROM private_jobs25 WHERE id=$1 AND lease_id=$2', [id,lease]); return r
  }
  async finish(job, artifact) {
    if (artifact) artifactBytes(JSON.parse(artifact))
    return this.transaction(async c => {
      const now = Date.now(), { rows: [r] } = await c.query('SELECT * FROM private_jobs25 WHERE id=$1 AND lease_id=$2 FOR UPDATE', [job.id,job.lease_id])
      if (!r || !['running','stopping'].includes(r.state)) return false
      const { rows: [budget] } = await c.query('SELECT coalesce(sum(coalesce(octet_length(input),0)+coalesce(octet_length(artifact),0)),0)::bigint AS bytes FROM private_jobs25')
      const success = r.state === 'running' && Number(r.deadline_ms) > now && artifact && Number(budget.bytes) + artifact.length <= POLICY.totalBytes
      await c.query(`UPDATE private_jobs25 SET state=$3,input=NULL,input_bytes=0,artifact=$4,artifact_digest=$5,
        artifact_expires_ms=$6,expires_ms=$7 WHERE id=$1 AND lease_id=$2`,
        [job.id,job.lease_id,success ? 'done' : 'failed',success ? artifact : null,success ? hash(artifact) : null,success ? now + POLICY.artifactMs : null,now + POLICY.metadataMs])
      return true
    })
  }
  async pendingReap() {
    const { rows } = await this.pool.query("SELECT * FROM private_jobs25 WHERE state='stopping' OR (state='running' AND deadline_ms<=$1)", [Date.now()]); return rows
  }
  async retry(job) { await this.pool.query('UPDATE private_jobs25 SET cleanup_attempts=least(cleanup_attempts+1,2147483647) WHERE id=$1 AND lease_id=$2', [job.id,job.lease_id]) }
  async sweep() {
    return this.transaction(async c => {
      const now = Date.now()
      await c.query('DELETE FROM private_uploads25 WHERE expires_ms<=$1',[now])
      await c.query("UPDATE private_jobs25 SET state='failed',input=NULL,input_bytes=0,expires_ms=$2 WHERE state='queued' AND expires_ms<=$1", [now,now + POLICY.metadataMs])
      await c.query('UPDATE private_jobs25 SET artifact=NULL,artifact_digest=NULL WHERE artifact_expires_ms<=$1', [now])
      // Only terminal rows; never release an unconfirmed live workload's slot.
      await c.query("DELETE FROM private_jobs25 WHERE state IN ('done','failed') AND expires_ms<=$1", [now])
    })
  }
}
