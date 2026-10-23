/**
 * Entry point: wires a real grammy Bot into the handlers in handlers.ts.
 * STAGING/LOCAL ONLY. Token comes from env var only — never commit it,
 * never register a public bot here. See packages/telegram-bot/README.md.
 */
import { Bot, InlineKeyboard, type Context } from 'grammy'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { InMemoryJobStore } from '@depress-org/job-core'
import { SessionStore } from './session.js'
import {
  handleStart,
  handleDocument,
  handleSkipSql,
  handleThemeChoice,
  themeKeyboardLabels,
  type BotPort,
  type Deps,
  type IncomingFile,
} from './handlers.js'

export const jobStore = new InMemoryJobStore()
export const sessions = new SessionStore()

export function createBot(token: string) {
  const bot = new Bot(token)

  const port: BotPort = {
    async makeUploadDir() {
      return mkdtemp(join(tmpdir(), 'depress-bot-upload-'))
    },
    async downloadFile(file: IncomingFile, destDir: string) {
      const tgFile = await bot.api.getFile(file.fileId)
      const url = `https://api.telegram.org/file/bot${token}/${tgFile.file_path}`
      const res = await fetch(url)
      const buf = Buffer.from(await res.arrayBuffer())
      const destPath = join(destDir, file.fileName ?? 'upload.bin')
      await writeFile(destPath, buf)
      return destPath
    },
    async sendMessage(chatId: number, text: string) {
      await bot.api.sendMessage(chatId, text)
    },
    async sendThemeKeyboard(chatId: number) {
      const keyboard = new InlineKeyboard()
      for (const id of themeKeyboardLabels()) {
        keyboard.text(id, `theme:${id}`).row()
      }
      await bot.api.sendMessage(chatId, 'Pick a theme:', { reply_markup: keyboard })
    },
  }

  const deps: Deps = { bot: port, store: jobStore, sessions }

  bot.command('start', (ctx: Context) => handleStart(deps, ctx.chat!.id))
  bot.command('skip', (ctx: Context) => handleSkipSql(deps, ctx.chat!.id))

  bot.on('message:document', (ctx: Context) => {
    const doc = ctx.message!.document!
    return handleDocument(deps, ctx.chat!.id, { fileId: doc.file_id, fileName: doc.file_name })
  })

  bot.callbackQuery(/^theme:(.+)$/, async (ctx: Context) => {
    const themeId = (ctx.match as RegExpMatchArray)[1]
    await ctx.answerCallbackQuery()
    await handleThemeChoice(deps, ctx.chat!.id, themeId)
  })

  return bot
}

/* istanbul ignore next -- exercised manually in staging, not under test */
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN env var is required (staging/local only, never commit a token).')
    process.exit(1)
  }
  const bot = createBot(token)
  bot.start()
  console.log('depress telegram-bot (staging) started via long polling.')
}
