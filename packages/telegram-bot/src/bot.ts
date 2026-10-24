import { Bot, InlineKeyboard } from 'grammy'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { InMemoryJobStore, type JobStore } from '@depress-org/job-core'
import { SessionStore } from './session.js'
import { Handlers, themeKeyboardLabels, type BotPort } from './handlers.js'
import { deadline, Uploads } from './uploads.js'

export interface BotOptions {
  /** Empty/missing/invalid configuration denies all identities. No network registration. */
  allowedUserIds?: readonly number[]
  workspaceRoot?: string
  maxUploadBytes?: number
  ioTimeoutMs?: number
  sessionTtlMs?: number
  sessions?: SessionStore
  store?: JobStore
}
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}
// grammy's Node declaration uses the older abort-controller shim; native Node
// AbortSignal implements the same runtime cancellation protocol.
const telegramSignal = (signal: AbortSignal) => signal as unknown as NonNullable<Parameters<Bot['api']['getFile']>[1]>
export function createBot(token: string, options: BotOptions = {}) {
  const bot = new Bot(token)
  const ids = options.allowedUserIds ?? []
  const allowed = new Set(ids.every(id => Number.isSafeInteger(id) && id > 0) ? ids : [])
  const timeout = positive(options.ioTimeoutMs ?? 30_000, 'ioTimeoutMs')
  const uploads = new Uploads(options.workspaceRoot ?? resolve('.tmp/telegram-bot'), positive(options.maxUploadBytes ?? 20 * 1024 * 1024, 'maxUploadBytes'), timeout)
  const port: BotPort = {
    makeUploadDir: () => uploads.create(),
    cleanup: dir => uploads.cleanup(dir),
    accepts: (file, role) => uploads.accepts(file, role),
    downloadFile: (file, role, dir) => uploads.download(file, role, dir, async signal => {
      const tgFile = await bot.api.getFile(file.fileId, telegramSignal(signal))
      // Treat even provider path metadata as untrusted. It must stay on Telegram's fixed origin.
      if (!tgFile.file_path || !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(tgFile.file_path) || tgFile.file_path.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('INVALID_PROVIDER_PATH')
      if (tgFile.file_size !== undefined && tgFile.file_size > (options.maxUploadBytes ?? 20 * 1024 * 1024)) throw new Error('UPLOAD_TOO_LARGE')
      return `https://api.telegram.org/file/bot${token}/${tgFile.file_path}`
    }),
    async sendMessage(chatId, text) { await deadline(timeout, signal => bot.api.sendMessage(chatId, text, undefined, telegramSignal(signal))) },
    async sendThemeKeyboard(chatId, generation) {
      const keyboard = new InlineKeyboard()
      for (const id of themeKeyboardLabels()) keyboard.text(id, `theme:${generation}:${id}`).row()
      await deadline(timeout, signal => bot.api.sendMessage(chatId, 'Pick a theme:', { reply_markup: keyboard }, telegramSignal(signal)))
    },
  }
  const handlers = new Handlers({ bot: port, sessions: options.sessions ?? new SessionStore(), store: options.store ?? new InMemoryJobStore(), sessionTtlMs: positive(options.sessionTtlMs ?? 30 * 60_000, 'sessionTtlMs') })
  // This guard runs before commands, callbacks, getFile, downloads, sends and session allocation.
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot || ctx.chat?.type !== 'private' || ctx.chat.id !== ctx.from.id || !allowed.has(ctx.from.id)) return
    await next()
  })
  const key = (chat: number, user: number) => `${chat}:${user}`
  bot.command('start', ctx => handlers.start(key(ctx.chat.id, ctx.from!.id), ctx.chat.id))
  bot.command('skip', ctx => handlers.skip(key(ctx.chat.id, ctx.from!.id), ctx.chat.id))
  bot.on('message:document', ctx => handlers.document(key(ctx.chat.id, ctx.from!.id), ctx.chat.id, { fileId: ctx.message.document.file_id, fileName: ctx.message.document.file_name, size: ctx.message.document.file_size }))
  bot.callbackQuery(/^theme:([a-f0-9-]{36}):([\w-]+)$/, async ctx => {
    // Callback acknowledgement is best-effort, bounded, and cannot gate a valid action.
    try { await deadline(timeout, signal => ctx.answerCallbackQuery({}, telegramSignal(signal))) } catch { /* no raw provider errors */ }
    await handlers.theme(key(ctx.chat!.id, ctx.from.id), ctx.chat!.id, ctx.match[1], ctx.match[2])
  })
  bot.catch(() => { console.error('Bot update failed; raw provider details suppressed.') })
  return bot
}

// Importing this module never reads a bot token or starts a network client.
if (process.env.NODE_ENV !== 'test' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ids = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '').split(',')
  if (!ids.length || ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('TELEGRAM_ALLOWED_USER_IDS must contain allowed numeric sender IDs')
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for local/staging use')
  const bot = createBot(token, { allowedUserIds: ids.map(Number), workspaceRoot: process.env.TELEGRAM_WORKSPACE_ROOT })
  void bot.start().catch(() => { console.error('Bot startup failed; raw provider details suppressed.'); process.exitCode = 1 })
}
