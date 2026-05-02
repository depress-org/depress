import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import sitemap from '@astrojs/sitemap'
import markdoc from '@astrojs/markdoc'
import keystatic from '@keystatic/astro'

export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  site: 'https://your-site.pages.dev',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    sitemap(),
    markdoc(),
    keystatic(),
  ],
})
