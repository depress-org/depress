import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryJobStore } from '@depress-org/job-core'
import { SessionStore } from '../session.js'
import {
  handleStart,
  handleDocument,
  handleSkipSql,
  handleThemeChoice,
  reportProgress,
  type Deps,
  type BotPort,
} from '../handlers.js'

// Mock job-core's runJob so tests never touch real migration/deploy/network code.
vi.mock('@depress-org/job-core', async () => {
  const actual = await vi.importActual<typeof import('@depress-org/job-core')>('@depress-org/job-core')
  return {
    ...actual,
    runJob: vi.fn(async (store: any, jobId: string, opts: any) => {
      const job = await store.update(jobId, { status: 'done', deployUrl: 'https://example.pages.dev' })
      opts?.onProgress?.(job)
      return job
    }),
    isValidTheme: (id: string) => id === 'scaffold' || id === 'hugo-theme',
    listThemes: () => [{ id: 'hugo-theme', name: 'Hugo Theme', description: 'test theme' }],
  }
})

function makeFakeBot(): BotPort {
  return {
    downloadFile: vi.fn(async (_file, destDir) => `${destDir}/downloaded.xml`),
    sendMessage: vi.fn(async () => {}),
    sendThemeKeyboard: vi.fn(async () => {}),
    makeUploadDir: vi.fn(async () => '/tmp/fake-upload-dir'),
  }
}

describe('telegram-bot handlers', () => {
  let bot: BotPort
  let store: InMemoryJobStore
  let sessions: SessionStore
  let deps: Deps
  const chatId = 42

  beforeEach(() => {
    bot = makeFakeBot()
    store = new InMemoryJobStore()
    sessions = new SessionStore()
    deps = { bot, store, sessions }
  })

  it('/start resets session and greets the user', async () => {
    sessions.set(chatId, { stage: 'running', jobId: 'stale' })
    await handleStart(deps, chatId)
    expect(sessions.get(chatId)).toEqual({ stage: 'idle' })
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('WordPress export'))
  })

  it('accepts a WXR document and asks for SQL dump next', async () => {
    await handleDocument(deps, chatId, { fileId: 'f1', fileName: 'export.xml' })
    expect(bot.downloadFile).toHaveBeenCalled()
    expect(sessions.get(chatId)).toMatchObject({ stage: 'awaiting_sql' })
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('/skip'))
  })

  it('rejects a document with a non-xml extension while idle', async () => {
    await handleDocument(deps, chatId, { fileId: 'f1', fileName: 'export.zip' })
    expect(bot.downloadFile).not.toHaveBeenCalled()
    expect(sessions.get(chatId)).toEqual({ stage: 'idle' })
  })

  it('accepting a SQL dump after WXR moves to theme selection', async () => {
    sessions.set(chatId, { stage: 'awaiting_sql', wxrPath: '/tmp/export.xml' })
    await handleDocument(deps, chatId, { fileId: 'f2', fileName: 'dump.sql' })
    expect(sessions.get(chatId)).toMatchObject({ stage: 'awaiting_theme', wxrPath: '/tmp/export.xml' })
    expect(bot.sendThemeKeyboard).toHaveBeenCalledWith(chatId)
  })

  it('/skip moves straight to theme selection without a sql dump', async () => {
    sessions.set(chatId, { stage: 'awaiting_sql', wxrPath: '/tmp/export.xml' })
    await handleSkipSql(deps, chatId)
    expect(sessions.get(chatId)).toEqual({ stage: 'awaiting_theme', wxrPath: '/tmp/export.xml' })
    expect(bot.sendThemeKeyboard).toHaveBeenCalledWith(chatId)
  })

  it('/skip with nothing pending tells the user to /start', async () => {
    await handleSkipSql(deps, chatId)
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('/start'))
  })

  it('choosing a valid theme queues a job and reports progress to done', async () => {
    sessions.set(chatId, { stage: 'awaiting_theme', wxrPath: '/tmp/export.xml' })
    await handleThemeChoice(deps, chatId, 'hugo-theme')

    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Queued'))
    await Promise.resolve()
    await Promise.resolve()
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('https://example.pages.dev'))
    expect(sessions.get(chatId)).toEqual({ stage: 'idle' })
  })

  it('choosing an invalid theme does not create a job', async () => {
    sessions.set(chatId, { stage: 'awaiting_theme', wxrPath: '/tmp/export.xml' })
    await handleThemeChoice(deps, chatId, 'nonexistent-theme')
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Unknown theme'))
    expect(await store.list()).toHaveLength(0)
  })

  it('theme choice without a pending migration is rejected', async () => {
    await handleThemeChoice(deps, chatId, 'hugo-theme')
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('/start'))
  })

  it('reportProgress formats a failed job and resets the session', async () => {
    sessions.set(chatId, { stage: 'running', jobId: 'job_1' })
    await reportProgress(deps, chatId, {
      id: 'job_1',
      status: 'failed',
      error: 'boom',
      input: { wxrPath: '/tmp/x.xml', themeId: 'scaffold' },
      createdAt: 0,
      updatedAt: 0,
    })
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('boom'))
    expect(sessions.get(chatId)).toEqual({ stage: 'idle' })
  })

  it('reportProgress formats an in-progress status without resetting the session', async () => {
    sessions.set(chatId, { stage: 'running', jobId: 'job_2' })
    await reportProgress(deps, chatId, {
      id: 'job_2',
      status: 'migrating',
      input: { wxrPath: '/tmp/x.xml', themeId: 'scaffold' },
      createdAt: 0,
      updatedAt: 0,
    })
    expect(bot.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('migrating'))
    expect(sessions.get(chatId)).toEqual({ stage: 'running', jobId: 'job_2' })
  })
})
