/** #26: coordinated consumer contract, not arbitrary audit-force overrides.
 * Revalidate with cold consumers whenever changing a pin. React 18 is deliberate:
 * both Astro's renderer and Keystatic 6 support it; the renderer version is 7.
 */
export const SITE_ENGINES = { node: '^22.23.4 || ^24.22.1', npm: '^10.8.2 || ^11.21.1' }
export const SITE_DEPENDENCIES = {
  astro: '7.4.2',
  vite: '8.3.5',
  '@astrojs/cloudflare': '14.4.2',
  '@astrojs/markdoc': '2.1.1',
  '@astrojs/react': '7.1.1',
  '@astrojs/sitemap': '3.7.4',
  '@keystatic/astro': '6.0.0',
  '@keystatic/core': '0.6.9',
  react: '18.3.1',
  'react-dom': '18.3.1',
  sharp: '0.35.5',
  tailwindcss: '4.3.3',
  '@tailwindcss/vite': '4.3.3',
  yaml: '2.9.1',
  wrangler: '4.152.0',
} as const
export const SITE_DEV_DEPENDENCIES = { '@types/react': '18.3.31', '@types/react-dom': '18.3.7' }
// Miniflare 5 pins vulnerable undici 7.29.1. Same-major targeted patch only;
// never force undici 8 into the emulator or override unrelated consumers.
export const SITE_OVERRIDES = { 'miniflare@5.20261019.2-beta': { undici: '7.30.1' } }
