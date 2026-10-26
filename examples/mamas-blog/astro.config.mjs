import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@tailwindcss/vite'
import sitemap from '@astrojs/sitemap'
import markdoc from '@astrojs/markdoc'
import keystatic from '@keystatic/astro'

export default defineConfig({
  output: 'static',
  adapter: cloudflare({ prerenderEnvironment: 'node' }),
  site: "https://example.invalid",
  integrations: [
    react(),
    sitemap(),
    markdoc(),
    keystatic(),
  ],
  vite: { plugins: [tailwind()] },
})
