# Telegram adapter — PR-07 / #21

Local/staging only. No bot is registered or exposed by this package. No billing,
public deployment, cloud credentials or Telegram API calls were exercised by tests.

## Supported flow

1. A configured allowed sender opens a private chat and sends `/start`.
2. Upload a named `.xml`/`.wxr` WordPress export (valid UTF-8 XML with a WXR
   version, no DTD/entity declarations).
3. Upload an optional named `.sql` text dump, or `/skip`.
4. Select a theme from the current session's inline keyboard.
5. The adapter calls the existing shared `runJob` in explicit `migrate-only` mode.
   It reports local artifact paths as server filesystem paths, NOT hosted GitHub
   links. No live URL is invented. A returned `deployUrl` can be displayed, but
   this adapter does not enable deployments.

Media archives are explicitly unsupported until shared feature #22. ZIP/tar/media
cannot be silently accepted as SQL. SQL admission checks text/recognizable dump
statements, not the full SQL grammar, and does not execute SQL itself. WXR admission
is not a claim of full WordPress compatibility or converter sandboxing (#24/#25).

## Configuration (trusted operator only)

`createBot(token, options)` creates an unstarted grammy Bot. Import has no token
read/network side effects. Options:

- `allowedUserIds`: positive safe numeric sender IDs. Missing/empty/invalid denies
  everyone. Only private chats whose chat ID matches sender ID are admitted;
  groups, channel/anonymous messages and bots are rejected before session/file/API IO.
- `workspaceRoot`: trusted dedicated upload root; default `.tmp/telegram-bot`
  relative to startup working directory. This is not upload/request-controlled.
- `maxUploadBytes`: 20 MiB default, enforced at metadata, Content-Length and streamed
  byte count. Content is buffered only within that cap.
- `ioTimeoutMs`: 30 seconds default for the entire metadata+download/body operation,
  and separately for each send/ack. Native abort plus a deadline also bounds clients
  that ignore cancellation. Downloads require HTTP success and reject redirects.
- `sessionTtlMs`: 30 minutes default for abandoned SQL/theme-waiting uploads.
- `store`/`sessions`: optional isolated local dependencies for tests/embedding.

For manually approved local execution, the executable requires
`TELEGRAM_ALLOWED_USER_IDS` (comma-separated positive IDs) and
`TELEGRAM_BOT_TOKEN`; optional `TELEGRAM_WORKSPACE_ROOT` overrides the upload root.
Supply these via an approved secret mechanism; never commit or log a real token.
Then `npm start -w packages/telegram-bot` uses long polling. This document is not
permission to register/start a bot or deploy a service.

## Lifecycle and containment

All uploads use server-generated `source.xml` / `database.sql` filenames in a
random mode-0700 owned directory; supplied names are extension hints only. Writes
use exclusive creation and mode 0600. Cleanup accepts only directories recorded
by this adapter instance. Each identity gets a random generation: keyboards carry
it, and every delayed state mutation checks the same current state plus active job
ID. Upload/job stage claims happen before their first await to reject duplicates.

`/start` invalidates the old generation, not the running pipeline. Old downloads/jobs
finish against their own inputs, cannot reset newer sessions, then remove only their
owned uploads. Abandoned uploads expire; terminal notification failures never gate
cleanup. Deletion retries three times (Node filesystem transient retries also apply);
permanent failure emits a fixed operator diagnostic, without paths/provider details.
Operators must resolve persistent filesystem errors. There is no durable recovery
across process crashes/restarts yet; #25 owns hosted retention/isolation.

Progress notifications are ordered best-effort bounded operations, not delivery
acknowledgments from the core. The awaited typed `runJob` result is terminal truth;
rejected getFile/fetch/send/store/job promises are handled without exposing raw
provider errors. Core output artifacts remain under shared pipeline ownership;
this adapter removes its input directories, not retained output sites.

## Executable verification

`npm test -w packages/telegram-bot` runs the actual grammy middleware/command/document/
callback adapter against synthetic updates and an intercepted API transformer.
Fetch is mocked, file IO failure cases are mocked, and contained real workspace
files independently verify filename containment and cleanup. No tests read a real
token or contact Telegram/cloud providers. `npm run test:coverage -w
packages/telegram-bot` is required by the root runner, with gates 85/70/85/85 for
statements/branches/functions/lines. Existing other-workspace gates are unchanged.

See `docs/PR-07-bot-safety.md` for issue/review mapping and verification evidence.
