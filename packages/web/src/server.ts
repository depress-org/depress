/** Local-only entry point. No public bind or deployment capability. */
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import type { Identity } from './security.js'

let identities: Identity[] = []
try {
  const configured = process.env.DEPRESS_API_IDENTITIES_JSON
  if (configured) identities = JSON.parse(configured)
} catch { throw new Error('Invalid API authentication configuration') }
const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
const app = createApp({ identities })
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`depress web (local-only) listening on http://127.0.0.1:${info.port}`)
})
if (server instanceof (await import('node:http')).Server) {
  server.requestTimeout = 35_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 64
}
