import { describe, it, expect } from 'vitest'
import { Admission, authenticator, DEFAULT_LIMITS, resolveLimits } from '../security.js'

describe('admission state machine #23', () => {
  it('keeps per-owner and global concurrency independent; releases are idempotent', () => {
    const gate = new Admission(resolveLimits({ active: 2 }), () => 1)
    const alice = gate.acquire('alice')!
    expect(gate.acquire('alice')).toBeUndefined()
    const bob = gate.acquire('bob')!
    expect(gate.acquire('charlie')).toBeUndefined()
    alice(); alice()
    expect(gate.acquire('bob')).toBeUndefined()
    expect(gate.acquire('charlie')).toBeTypeOf('function')
    bob()
  })
  it('global rate spans owners; reset never drops active permits', () => {
    let now = 1
    const gate = new Admission(resolveLimits({ requestsPerWindow: 2 }), () => now)
    gate.acquire('alice')!()
    const bob = gate.acquire('bob')!
    expect(gate.acquire('charlie')).toBeUndefined()
    now += DEFAULT_LIMITS.windowMs
    expect(gate.acquire('bob')).toBeUndefined()
    expect(gate.acquire('alice')).toBeTypeOf('function')
    bob()
    expect(gate.acquire('bob')).toBeTypeOf('function')
  })
  it('owner rate spans credential rotations mapping to the same owner', () => {
    let now = 0
    const gate = new Admission(resolveLimits({ requestsPerOwnerWindow: 1 }), () => now)
    gate.acquire('alice')!()
    expect(gate.acquire('alice')).toBeUndefined()
    expect(gate.acquire('bob')).toBeTypeOf('function')
    now = DEFAULT_LIMITS.windowMs
    expect(gate.acquire('alice')).toBeTypeOf('function')
  })
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects non-finite/invalid limit %s', (active) => {
    expect(() => resolveLimits({ active })).toThrow('Limits must')
  })
  it('rejects unknown config and invalid auth config types', () => {
    expect(() => resolveLimits({ typo: 5 } as any)).toThrow('Unknown limit')
    expect(() => authenticator({} as any)).toThrow('Invalid identities')
    expect(() => authenticator(new Array(1025).fill({}))).toThrow('Invalid identities')
    expect(authenticator().owner('Bearer fake')).toBeUndefined()
  })
  it('maps duplicate-owner credentials to one stable owner and snapshots config', () => {
    const identities = [{ token: 'a'.repeat(32), ownerId: 'alice' }, { token: 'b'.repeat(32), ownerId: 'alice' }]
    const auth = authenticator(identities)
    identities[0].ownerId = 'bob'
    expect(auth.owner(`Bearer ${'a'.repeat(32)}`)).toBe('alice')
    expect(auth.owner(`Bearer ${'b'.repeat(32)}`)).toBe('alice')
    expect(auth.owner(`Bearer ${'c'.repeat(32)}`)).toBeUndefined()
  })
})
