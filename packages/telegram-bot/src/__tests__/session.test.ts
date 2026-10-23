import { describe, it, expect } from 'vitest'
import { SessionStore } from '../session.js'

describe('SessionStore', () => {
  it('defaults an unknown chat to idle', () => {
    const sessions = new SessionStore()
    expect(sessions.get(1)).toEqual({ stage: 'idle' })
  })

  it('stores and retrieves per-chat state independently', () => {
    const sessions = new SessionStore()
    sessions.set(1, { stage: 'awaiting_sql', wxrPath: '/tmp/a.xml' })
    sessions.set(2, { stage: 'idle' })
    expect(sessions.get(1)).toEqual({ stage: 'awaiting_sql', wxrPath: '/tmp/a.xml' })
    expect(sessions.get(2)).toEqual({ stage: 'idle' })
  })

  it('reset returns a chat to idle', () => {
    const sessions = new SessionStore()
    sessions.set(5, { stage: 'running', jobId: 'job_x' })
    sessions.reset(5)
    expect(sessions.get(5)).toEqual({ stage: 'idle' })
  })
})
