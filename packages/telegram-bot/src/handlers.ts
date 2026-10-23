/**
 * Command/message handling logic for the depress Telegram bot.
 *
 * Kept decoupled from grammy's Bot/Context types where practical so it's
 * easy to unit test: handlers take a small `BotPort` interface (download a
 * file, send a message/keyboard, run a job) instead of the real grammy API.
 * src/bot.ts adapts a real grammy Bot to this port.
 */
import { listThemes, isValidTheme, runJob, type Job, type JobStore, type JobInput } from '@depress-org/job-core'
import { SessionStore } from './session.js'

export interface IncomingFile {
  /** Telegram file_id, used to resolve a download URL. */
  fileId: string
  /** Suggested file name (e.g. from document.file_name). */
  fileName?: string
}

/** Minimal surface the handlers need from the chat platform; grammy's Bot satisfies a superset of this. */
export interface BotPort {
  downloadFile(file: IncomingFile, destDir: string): Promise<string>
  sendMessage(chatId: number, text: string): Promise<void>
  sendThemeKeyboard(chatId: number): Promise<void>
  makeUploadDir(): Promise<string>
}

export interface Deps {
  bot: BotPort
  store: JobStore
  sessions: SessionStore
}

function isWxrFile(fileName: string | undefined): boolean {
  if (!fileName) return true // accept unnamed uploads; content isn't sniffed at this stage
  return /\.(xml|wxr)$/i.test(fileName)
}

export async function handleStart(deps: Deps, chatId: number): Promise<void> {
  deps.sessions.reset(chatId)
  await deps.bot.sendMessage(
    chatId,
    'Welcome to depress \uD83D\uDC4B\nSend me a WordPress export (WXR) file to begin migrating your site.',
  )
}

export async function handleDocument(deps: Deps, chatId: number, file: IncomingFile): Promise<void> {
  const state = deps.sessions.get(chatId)

  if (state.stage === 'idle') {
    if (!isWxrFile(file.fileName)) {
      await deps.bot.sendMessage(chatId, 'That doesn\u2019t look like a WXR export (.xml). Please send your WordPress export file.')
      return
    }
    const uploadDir = await deps.bot.makeUploadDir()
    const wxrPath = await deps.bot.downloadFile(file, uploadDir)
    deps.sessions.set(chatId, { stage: 'awaiting_sql', wxrPath })
    await deps.bot.sendMessage(chatId, 'Got your WXR export. Send a SQL dump now, or /skip to continue without one.')
    return
  }

  if (state.stage === 'awaiting_sql') {
    const uploadDir = await deps.bot.makeUploadDir()
    const sqlDumpPath = await deps.bot.downloadFile(file, uploadDir)
    deps.sessions.set(chatId, { stage: 'awaiting_theme', wxrPath: state.wxrPath, sqlDumpPath })
    await deps.bot.sendThemeKeyboard(chatId)
    return
  }

  await deps.bot.sendMessage(chatId, 'I\u2019m not expecting a file right now. Send /start to begin a new migration.')
}

export async function handleSkipSql(deps: Deps, chatId: number): Promise<void> {
  const state = deps.sessions.get(chatId)
  if (state.stage !== 'awaiting_sql') {
    await deps.bot.sendMessage(chatId, 'Nothing to skip right now. Send /start to begin.')
    return
  }
  deps.sessions.set(chatId, { stage: 'awaiting_theme', wxrPath: state.wxrPath })
  await deps.bot.sendThemeKeyboard(chatId)
}

export async function handleThemeChoice(deps: Deps, chatId: number, themeId: string): Promise<void> {
  const state = deps.sessions.get(chatId)
  if (state.stage !== 'awaiting_theme') {
    await deps.bot.sendMessage(chatId, 'No migration is waiting for a theme. Send /start to begin.')
    return
  }
  if (!isValidTheme(themeId)) {
    await deps.bot.sendMessage(chatId, `Unknown theme: ${themeId}`)
    return
  }

  const input: JobInput = { wxrPath: state.wxrPath, sqlDumpPath: state.sqlDumpPath, themeId }
  const job = await deps.store.create(input)
  deps.sessions.set(chatId, { stage: 'running', jobId: job.id })

  await deps.bot.sendMessage(chatId, `Queued \uD83D\uDFE1 job ${job.id} (theme: ${themeId}). I\u2019ll keep you posted.`)

  // Fire-and-forget, same pattern as packages/web: progress comes through onProgress.
  void runJob(deps.store, job.id, { onProgress: (j: Job) => void reportProgress(deps, chatId, j) }).catch(() => {
    /* runJob already records failures on the job itself; reportProgress sees the final state */
  })
}

const STATUS_EMOJI: Record<Job['status'], string> = {
  queued: '\uD83D\uDFE1',
  migrating: '\u2699\uFE0F',
  building: '\uD83D\uDD28',
  deploying: '\uD83D\uDE80',
  done: '\u2705',
  failed: '\u274C',
}

export async function reportProgress(deps: Deps, chatId: number, job: Job): Promise<void> {
  const emoji = STATUS_EMOJI[job.status]
  if (job.status === 'done') {
    const lines = [`${emoji} Done!`]
    if (job.deployUrl) lines.push(`Live URL: ${job.deployUrl}`)
    if (job.repoPath) lines.push(`Repo: ${job.repoPath}`)
    await deps.bot.sendMessage(chatId, lines.join('\n'))
    deps.sessions.reset(chatId)
    return
  }
  if (job.status === 'failed') {
    await deps.bot.sendMessage(chatId, `${emoji} Migration failed: ${job.error ?? 'unknown error'}`)
    deps.sessions.reset(chatId)
    return
  }
  await deps.bot.sendMessage(chatId, `${emoji} ${job.status}\u2026`)
}

export function themeKeyboardLabels(): string[] {
  const themes = listThemes()
  return [...themes.map((t: { id: string }) => t.id), 'scaffold']
}
