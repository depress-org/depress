import { describe, it, expect } from 'vitest'
import { SessionStore } from '../session.js'

describe('actor scoped generations', () => {
  it('isolates chat:sender identities', () => {
    const s = new SessionStore(); s.get('42:42').stage = 'running'
    expect(s.get('43:43').stage).toBe('idle')
  })
  it('reset invalidates old state and keyboard generation', () => {
    const s = new SessionStore(); const old = s.get('42:42'); const next = s.reset('42:42')
    expect(s.current('42:42', old)).toBe(false); expect(next.generation).not.toBe(old.generation)
  })
})
