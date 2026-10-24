import { listThemes, isValidTheme, runJob, type JobStore } from '@depress-org/job-core'
import { SessionStore, type ChatState } from './session.js'
import { type IncomingFile, type FileRole } from './uploads.js'

export interface BotPort {
  downloadFile(file: IncomingFile, role: FileRole, dir: string): Promise<string>
  makeUploadDir(): Promise<string>
  cleanup(dir?: string): Promise<void>
  accepts(file: IncomingFile, role: FileRole): boolean
  sendMessage(chatId: number, text: string): Promise<void>
  sendThemeKeyboard(chatId: number, generation: string): Promise<void>
}
export interface Deps { bot: BotPort; store: JobStore; sessions: SessionStore; sessionTtlMs: number }

/** All actions are actor-scoped and every continuation checks the same state identity. */
export class Handlers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(private deps: Deps) {}
  private current(key: string, state: ChatState) { return this.deps.sessions.current(key, state) }
  private async safe(task: () => Promise<unknown>) { try { await task() } catch { /* Delivery/cleanup failure is never an unhandled background rejection. */ } }
  private clear(key: string) { clearTimeout(this.timers.get(key)); this.timers.delete(key) }
  private expire(key: string, state: ChatState) {
    this.clear(key)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      if (!this.current(key, state) || !['awaiting_sql', 'awaiting_theme'].includes(state.stage)) return
      this.deps.sessions.reset(key)
      void this.safe(() => this.deps.bot.cleanup(state.uploadDir))
    }, this.deps.sessionTtlMs)
    timer.unref(); this.timers.set(key, timer)
  }
  async start(key: string, chatId: number) {
    const old = this.deps.sessions.get(key)
    this.deps.sessions.reset(key); this.clear(key)
    // In-flight uploads and jobs own their cleanup until they settle.
    if (['idle', 'awaiting_sql', 'awaiting_theme'].includes(old.stage)) await this.safe(() => this.deps.bot.cleanup(old.uploadDir))
    await this.safe(() => this.deps.bot.sendMessage(chatId, 'Welcome! Send a WordPress export (.xml/.wxr). Local migration only; media archives are not supported yet.'))
  }
  async document(key: string, chatId: number, file: IncomingFile) {
    const { bot, sessions } = this.deps
    const state = sessions.get(key)
    if (!['idle', 'awaiting_sql'].includes(state.stage)) return
    const role = state.stage === 'idle' ? 'wxr' : 'sql'
    if (!bot.accepts(file, role)) {
      await this.safe(() => bot.sendMessage(chatId, role === 'wxr' ? 'Send a named WXR .xml/.wxr within the upload size limit. Media archives are not supported.' : 'Expected a named SQL .sql dump within the upload size limit, or /skip. Media archives are not supported.'))
      return
    }
    const previous = state.stage
    state.stage = 'uploading'; this.clear(key) // claim before first await
    let dir = state.uploadDir
    try {
      dir ??= await bot.makeUploadDir()
      if (!this.current(key, state)) { await this.safe(() => bot.cleanup(dir)); return }
      state.uploadDir = dir
      const path = await bot.downloadFile(file, role, dir)
      if (!this.current(key, state)) { await this.safe(() => bot.cleanup(dir)); return }
      if (role === 'wxr') { state.wxrPath = path; state.stage = 'awaiting_sql' }
      else { state.sqlDumpPath = path; state.stage = 'awaiting_theme' }
      this.expire(key, state)
      if (role === 'wxr') await this.safe(() => bot.sendMessage(chatId, 'Got your WXR export. Send a SQL dump or /skip. Media archives are not supported yet.'))
      else await this.safe(() => bot.sendThemeKeyboard(chatId, state.generation))
    } catch {
      if (!this.current(key, state)) { await this.safe(() => bot.cleanup(dir)); return }
      if (previous === 'idle') { sessions.reset(key); await this.safe(() => bot.cleanup(dir)) }
      else { state.stage = 'awaiting_sql'; this.expire(key, state) }
      await this.safe(() => bot.sendMessage(chatId, 'Upload failed validation or download. Retry a valid file, or /start.'))
    }
  }
  async skip(key: string, chatId: number) {
    const state = this.deps.sessions.get(key)
    if (state.stage !== 'awaiting_sql') return
    state.stage = 'awaiting_theme'; this.expire(key, state)
    await this.safe(() => this.deps.bot.sendThemeKeyboard(chatId, state.generation))
  }
  async theme(key: string, chatId: number, generation: string, themeId: string) {
    const { bot, sessions, store } = this.deps
    const state = sessions.get(key)
    if (state.stage !== 'awaiting_theme' || generation !== state.generation || !isValidTheme(themeId)) return
    state.stage = 'starting'; this.clear(key) // suppress concurrent callbacks before async create
    try {
      const job = await store.create({ wxrPath: state.wxrPath!, sqlDumpPath: state.sqlDumpPath, themeId, mode: 'migrate-only' })
      if (!this.current(key, state)) { await this.safe(() => bot.cleanup(state.uploadDir)); return }
      state.stage = 'running'; state.jobId = job.id
      // Own the promise, including terminal notification and cleanup. Observer callbacks
      // are best-effort only; the typed runJob return is the terminal authority.
      void this.execute(key, chatId, state, job.id).catch(() => {})
    } catch {
      const replacement = this.current(key, state) ? sessions.reset(key) : undefined
      await this.safe(() => bot.cleanup(state.uploadDir))
      if (replacement && this.current(key, replacement)) await this.safe(() => bot.sendMessage(chatId, 'Unable to queue migration. Send /start.'))
    }
  }
  private async execute(key: string, chatId: number, state: ChatState, jobId: string) {
    const { bot, sessions, store } = this.deps
    const active = () => this.current(key, state) && state.jobId === jobId && state.stage === 'running'
    // Ordered, bounded delivery; each queued operation rechecks identity at send time.
    let delivery = Promise.resolve()
    const enqueue = (text: string) => { delivery = delivery.then(async () => { if (active()) await this.safe(() => bot.sendMessage(chatId, text)) }); return delivery }
    try {
      void enqueue(`Queued job ${jobId}. Local migration only.`)
      const result = await runJob(store, jobId, { onProgress: (job) => {
        if (job.id !== jobId || ['done', 'failed', 'queued'].includes(job.status) || !active()) return
        return enqueue(`${job.status}…`)
      } })
      if (result.status === 'done') {
        const lines = ['Done! Migration completed.']
        if (result.deployUrl) lines.push(`Live URL: ${result.deployUrl}`)
        else lines.push('Not deployed; no live URL was created.')
        if (result.repoPath) lines.push(`Local artifact: ${result.repoPath} (server filesystem, not a hosted repository link)`)
        await enqueue(lines.join('\n'))
      } else await enqueue('Migration failed. Send /start to retry.')
    } catch { await enqueue('Migration failed. Send /start to retry.') }
    finally {
      // Cleanup is independent of network success, and stale jobs never reset new sessions.
      await this.safe(() => bot.cleanup(state.uploadDir))
      if (active()) sessions.reset(key)
    }
  }
}
export function themeKeyboardLabels(): string[] { return [...new Set([...listThemes().map(t => t.id), 'scaffold'])] }
