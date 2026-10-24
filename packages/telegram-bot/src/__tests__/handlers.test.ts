import { describe, it, expect, vi } from 'vitest'
import { InMemoryJobStore, runJob } from '@depress-org/job-core'
import { SessionStore } from '../session.js'
import { Handlers, themeKeyboardLabels, type BotPort } from '../handlers.js'
vi.mock('@depress-org/job-core', async original => ({ ...await original<typeof import('@depress-org/job-core')>(), runJob: vi.fn() }))
function setup() {
  const bot: BotPort = { makeUploadDir: vi.fn(async () => '.tmp/mock-owned'), downloadFile: vi.fn(async () => '.tmp/mock-owned/source.xml'), accepts: () => true, cleanup: vi.fn(async () => {}), sendMessage: vi.fn(async () => {}), sendThemeKeyboard: vi.fn(async () => {}) }
  const sessions = new SessionStore(); const store = new InMemoryJobStore(); const handlers = new Handlers({ bot, sessions, store, sessionTtlMs: 1000 })
  return { bot, sessions, store, handlers }
}
describe('handler state claims and failure recovery', () => {
  it('offers unique shared adapter themes including scaffold', () => { const ids = themeKeyboardLabels(); expect(ids).toContain('scaffold'); expect(new Set(ids).size).toBe(ids.length) })
  it('rejects unknown theme and invalid-stage skip', async () => {
    const { handlers, store, sessions, bot } = setup(); await handlers.skip('k', 42); expect(bot.sendThemeKeyboard).not.toHaveBeenCalled()
    const state = sessions.get('k'); state.stage = 'awaiting_theme'; await handlers.theme('k', 42, state.generation, 'not-a-theme'); expect(await store.list()).toEqual([])
  })
  it('cleans abandoned inputs on /start even when greeting fails', async () => {
    const { handlers, sessions, bot } = setup(); Object.assign(sessions.get('k'), { stage: 'awaiting_sql', uploadDir: '.tmp/mock-owned' }); vi.mocked(bot.sendMessage).mockRejectedValue(new Error('offline'))
    await handlers.start('k', 42); expect(bot.cleanup).toHaveBeenCalledWith('.tmp/mock-owned'); expect(sessions.get('k').stage).toBe('idle')
  })
  it('does not launch a job whose async creation completes after /start', async () => {
    const { handlers, store, sessions, bot } = setup(); const state = sessions.get('k'); Object.assign(state, { stage: 'awaiting_theme', uploadDir: '.tmp/mock-owned', wxrPath: '.tmp/mock-owned/source.xml' })
    let resolve!: (x: any) => void; vi.spyOn(store, 'create').mockImplementation(() => new Promise(r => { resolve = r }))
    vi.mocked(runJob).mockClear(); const pending = handlers.theme('k', 42, state.generation, 'scaffold'); await handlers.start('k', 42); resolve({ id: 'old' }); await pending
    expect(runJob).not.toHaveBeenCalled(); expect(bot.cleanup).toHaveBeenCalledWith('.tmp/mock-owned'); expect(sessions.get('k').stage).toBe('idle')
  })
  it('cleans inputs and restores idle if store creation rejects', async () => {
    const { handlers, store, sessions, bot } = setup(); const state = sessions.get('k'); Object.assign(state, { stage: 'awaiting_theme', uploadDir: '.tmp/mock-owned', wxrPath: 'x' }); vi.spyOn(store, 'create').mockRejectedValue(new Error('store down'))
    await handlers.theme('k', 42, state.generation, 'scaffold'); expect(sessions.get('k').stage).toBe('idle'); expect(bot.cleanup).toHaveBeenCalledWith('.tmp/mock-owned'); expect(bot.sendMessage).toHaveBeenCalledWith(42, 'Unable to queue migration. Send /start.')
  })
})
