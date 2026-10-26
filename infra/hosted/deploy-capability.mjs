import { timingSafeEqual } from 'node:crypto'
import { hash, owner, exact } from './protocol.mjs'

/** Narrow authority seam only; no provider implementation, env lookup, process,
 * public mint endpoint, pricing or automatic deployment. #38 owns provider
 * idempotency/rollback protocol. Current preview-only artifacts ALWAYS fail.
 * Credentials stay in an operator-injected deploy-only closure, never a build.
 */
export function deploymentCapability(approval,{readArtifact,deployOnly,record},now=Date.now) {
  exact(approval,['ownerId','jobId','digest','target','expiresAt'])
  owner(approval.ownerId)
  if (!/^[a-f0-9]{64}$/.test(approval.digest) || !/^[a-f0-9-]{36}$/.test(approval.jobId) || !/^cloudflare-pages:[a-z0-9][a-z0-9-]{0,62}$/.test(approval.target) || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt > now()+60000 || approval.expiresAt <= now()) throw new Error('Invalid deployment approval')
  const bound=Object.freeze({...approval});let used=false
  return Object.freeze({ async deploy(identity,id,digest) {
    if (used || now() >= bound.expiresAt || identity !== bound.ownerId || id !== bound.jobId || digest !== bound.digest) throw new Error('Deployment denied')
    const artifact=await readArtifact(identity,id,digest)
    if (!artifact || artifact.kind !== 'verified-static' || !Buffer.isBuffer(artifact.bytes) || artifact.bytes.length > 1048576) throw new Error('Deployment denied')
    const snapshot=Buffer.from(artifact.bytes)
    if (!timingSafeEqual(Buffer.from(hash(snapshot)),Buffer.from(bound.digest))) throw new Error('Deployment denied')
    if (used || now() >= bound.expiresAt) throw new Error('Deployment denied')
    used=true // synchronous claim after validation; unknown outcomes belong to #38
    await record({event:'deploy-authorized',ownerId:identity,jobId:id,digest,target:bound.target})
    if (now() >= bound.expiresAt) throw new Error('Deployment denied')
    return deployOnly(Object.freeze({ownerId:identity,jobId:id,digest,target:bound.target}),snapshot)
  } })
}
