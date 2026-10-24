import { createHash, timingSafeEqual } from 'node:crypto'

export interface Identity { token: string; ownerId: string }
export interface Limits {
  requestBytes: number
  fileBytes: number
  uploadMs: number
  active: number
  activePerOwner: number
  requestsPerWindow: number
  requestsPerOwnerWindow: number
  windowMs: number
}
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  requestBytes: 10 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  uploadMs: 30_000,
  active: 4,
  activePerOwner: 1,
  requestsPerWindow: 100,
  requestsPerOwnerWindow: 10,
  windowMs: 60_000,
})
export function resolveLimits(overrides: Partial<Limits> = {}): Readonly<Limits> {
  if (Object.keys(overrides).some((key) => !(key in DEFAULT_LIMITS))) throw new Error('Unknown limit')
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Limits must be positive finite integers')
  return Object.freeze(limits)
}
const hash = (token: string) => createHash('sha256').update(token).digest()
/** No default/demo credential, network auth, caller-supplied owner or fallback. */
export function authenticator(identities: readonly Identity[] = []) {
  if (!Array.isArray(identities) || identities.length > 1024) throw new Error('Invalid identities')
  const seen = new Set<string>()
  const entries = identities.map((entry) => {
    if (!entry || typeof entry.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(entry.token) ||
      typeof entry.ownerId !== 'string' || !entry.ownerId.trim() || entry.ownerId.length > 128 || seen.has(entry.token))
      throw new Error('Invalid identities')
    seen.add(entry.token)
    return { digest: hash(entry.token), ownerId: entry.ownerId }
  })
  return {
    configured: entries.length > 0,
    owner(authorization: string | undefined): string | undefined {
      if (!authorization || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization)) return undefined
      const digest = hash(authorization.slice(7))
      let ownerId: string | undefined
      for (const entry of entries) if (timingSafeEqual(entry.digest, digest)) ownerId = entry.ownerId
      return ownerId
    },
  }
}
/** Single-process admission only. Permit covers upload + entire runner; no pending queue. */
export class Admission {
  private active = 0
  private owners = new Map<string, { active: number; requests: number }>()
  private requests = 0
  private resetAt = 0
  constructor(private limits: Readonly<Limits>, private now: () => number = Date.now) {}
  acquire(ownerId: string): (() => void) | undefined {
    const now = this.now()
    if (now >= this.resetAt) {
      this.resetAt = now + this.limits.windowMs
      this.requests = 0
      for (const [id, owner] of this.owners) {
        owner.requests = 0
        if (!owner.active) this.owners.delete(id)
      }
    }
    const owner = this.owners.get(ownerId) ?? { active: 0, requests: 0 }
    if (this.active >= this.limits.active || owner.active >= this.limits.activePerOwner ||
      this.requests >= this.limits.requestsPerWindow || owner.requests >= this.limits.requestsPerOwnerWindow)
      return undefined
    this.owners.set(ownerId, owner)
    this.active++; owner.active++; this.requests++; owner.requests++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--; owner.active--
    }
  }
}
