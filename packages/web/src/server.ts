/**
 * Entry point for local/staging runs. `npm run dev` (tsx watch) or `npm start` (built dist).
 */
import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`depress web (staging) listening on http://localhost:${info.port}`)
})
