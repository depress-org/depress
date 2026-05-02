import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import markdoc from '@astrojs/markdoc'
import keystatic from '@keystatic/astro'

/**
 * Vite plugin to fix circular chunk dependency between `astro` and `@astrojs` packages
 * when using the Cloudflare adapter with Astro 4.
 * The adapter's manualChunks splits them into separate chunks that import each other,
 * causing a TDZ error for `ASTRO_VERSION` during manifest retrieval.
 */
function fixCircularAstroChunks() {
  return {
    name: 'fix-circular-astro-chunks',
    enforce: /** @type {'post'} */ ('post'),
    outputOptions(options) {
      const prev = options.manualChunks
      return {
        ...options,
        manualChunks(id, api) {
          // Colocate astro core + react renderer to break the circular chunk
          if (
            id.includes('node_modules/astro/') ||
            id.includes('node_modules/@astrojs/react/') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) {
            return 'astro-react-vendor'
          }
          if (typeof prev === 'function') return prev(id, api)
          return undefined
        },
      }
    },
  }
}

export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  site: 'https://your-site.pages.dev',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    markdoc(),
    keystatic(),
  ],
  vite: {
    plugins: [fixCircularAstroChunks()],
  },
})
