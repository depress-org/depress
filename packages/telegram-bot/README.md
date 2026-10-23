# @depress-org/telegram-bot

Telegram front-end for the depress migrate -> deploy pipeline. Same
`@depress-org/job-core` orchestration as `packages/web` (upload -> migrate ->
build -> deploy) — this package never re-implements that logic, it just
talks to the user in chat.

STAGING/LOCAL ONLY. No billing/payment wiring (blocked on biz-analyst's
review of the billing recommendation, t_d850a35e). Do not register a public
bot from this package until Bullwinkle approves going live.

## Flow

1. `/start` — greet, reset any in-progress session for this chat.
2. Send a WXR export file (`.xml`/`.wxr`). The bot downloads it.
3. Send an optional SQL dump, or `/skip`.
4. Pick a theme from the inline keyboard (same registry as the CLI/web via
   `@depress-org/job-core`'s `listThemes`/`isValidTheme`).
5. The bot queues a job via `job-core`'s `runJob` and reports progress as chat
   messages (queued -> migrating -> building -> deploying -> done/failed).
   On success it replies with the live URL and the generated repo path.

## Running locally

```sh
export TELEGRAM_BOT_TOKEN=... # never commit this; get a token from @BotFather for a PRIVATE test bot
npm run dev --workspace=@depress-org/telegram-bot
```

The token is read from the environment only. Nothing in this package writes
it to disk or a config file.

## Testing

```sh
npm run test --workspace=@depress-org/telegram-bot
```

Tests mock `@depress-org/job-core`'s `runJob`/`isValidTheme`/`listThemes` and
a fake `BotPort` — no real Telegram API calls are made, no network access,
no real migration/deploy work.

## Architecture note

`src/handlers.ts` holds all command/message logic behind a small `BotPort`
interface (download a file, send a message, send the theme keyboard). This
keeps the business logic unit-testable without grammy's real `Bot`/`Context`
types. `src/bot.ts` adapts a real grammy `Bot` to that port and is the only
file that touches the Telegram Bot API or `TELEGRAM_BOT_TOKEN`.
