import { readFile } from 'fs/promises'
import { safeWriteFile, assertSafeTree } from '../input-boundary.js'
import { dirname, basename } from 'node:path'
const writeFile = async (path: string, data: string, _encoding: string) => safeWriteFile(dirname(path), basename(path), data)
import { existsSync } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import { SITE_DEPENDENCIES, SITE_ENGINES } from '../toolchain.js'
import { sourceString, htmlText, localHref } from './serialization.js'
import type { ThemeAdapter, ArticleFM, PageFM, PatchConfigOpts, NavItem } from './types.js'

/**
 * AstroWind – https://github.com/onwidget/astrowind
 *
 * Highly customizable Astro 7 + Tailwind CSS 4 site template.
 * Multiple home layouts (startup, SaaS, personal, mobile-app), landing page templates,
 * blog, about, contact, pricing, services pages — all CSS-var-driven so colours/fonts
 * can be changed in one place.
 *
 * Bundled in bundled-themes/astrowind/ — copied locally, never downloaded at runtime.
 *
 * Content structure (Keystatic-compatible directory entries):
 *   src/data/post/<slug>/index.md  blog posts
 *   public/images/blog/             media
 */
export const astrowindAdapter: ThemeAdapter = {
  id: 'astrowind',
  name: 'AstroWind',
  repo: 'onwidget/astrowind',
  branch: 'main',
  description:
    'Astro 7 + Tailwind CSS 4 — multiple home/landing templates, blog, dark mode, CSS-var theming',
  bundled: true,

  contentDir: 'src/data/post',
  mediaDir: 'public/images/blog',
  fileExt: 'md',
  useDirectoryEntries: true,
  sampleContentDirs: ['src/data/post'],

  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown> {
    return {
      // Must be a Date object (not ISO string) — AstroWind schema uses z.date()
      publishDate: fm.publishedAt ? new Date(fm.publishedAt) : new Date(),
      title: fm.seoTitle || fm.title || 'Untitled',
      excerpt: fm.seoDescription || fm.excerpt || '',
      // Images are in public/images/blog/ (served as static assets).
      // AstroWind's <Image> component requires explicit width+height for public/ files;
      // omit the field so the theme skips the hero image rather than throwing.
      // To enable hero images, move them to src/assets/ and import them instead.
      category: fm.category ?? '',
      tags: fm.tags ?? [],
      author: fm.author || siteAuthor || 'Author',
      draft: false,
    }
  },

  mapPageFrontmatter(fm: PageFM): Record<string, unknown> {
    return {
      title: fm.title ?? 'Page',
      metadata: {
        title: fm.title ?? '',
        description: fm.seoDescription ?? '',
      },
    }
  },

  async patchConfig(outputDir: string, opts: PatchConfigOpts): Promise<void> {
    await assertSafeTree(outputDir)
    // 1. Patch src/config.yaml — site name, description, URL
    const configYamlPath = join(outputDir, 'src', 'config.yaml')
    if (existsSync(configYamlPath)) {
      // Parse and reserialize the document: uploaded strings are YAML data,
      // never source fragments (quotes, newlines, tags and anchors stay inert).
      const original = await readFile(configYamlPath, 'utf-8')
      const data = matter(`---\n${original}\n---\n`).data
      data.site ??= {}
      data.site.name = opts.siteTitle
      if (opts.siteUrl) data.site.site = opts.siteUrl
      data.metadata ??= {}
      data.metadata.title ??= {}
      data.metadata.title.default = opts.siteTitle
      data.metadata.description = opts.siteDescription
      // JSON is a YAML 1.2 document and avoids context-dependent quoting entirely.
      const yaml = JSON.stringify(data, null, 2) + '\n'
      await writeFile(configYamlPath, yaml, 'utf-8')
    }

    // 2. Patch src/navigation.ts — write nav from WP menus (or sensible fallback)
    const navPath = join(outputDir, 'src', 'navigation.ts')
    if (existsSync(navPath)) {
      const navContent = `import { getPermalink, getAsset } from './utils/permalinks';

export const headerData = {
  links: [
${serializeAstrowindLinks(opts.navItems)}  ],
  actions: [],
};

export const footerData = {
  links: [],
  secondaryLinks: [
    { text: 'Terms', href: getPermalink('/terms') },
    { text: 'Privacy Policy', href: getPermalink('/privacy') },
  ],
  socialLinks: [
    { ariaLabel: 'RSS', icon: 'tabler:rss', href: getAsset('/rss.xml') },
  ],
  footNote: \`© \${new Date().getFullYear()} \${${sourceString(htmlText(opts.siteTitle))}}. All rights reserved.\`,
};
`
      await writeFile(navPath, navContent, 'utf-8')
    }

    // 3. Patch astro.config.ts — static output + Node adapter + Keystatic
    const astroCfgPath = join(outputDir, 'astro.config.ts')
    if (existsSync(astroCfgPath)) {
      const cfg = patchAstrowindAstroConfig(await readFile(astroCfgPath, 'utf-8'), opts.siteUrl)

      await writeFile(astroCfgPath, cfg, 'utf-8')
    }

    // 4. Add Keystatic deps to package.json
    const pkgPath = join(outputDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      pkg.dependencies = {
        ...pkg.dependencies,
        astro: SITE_DEPENDENCIES.astro,
        vite: SITE_DEPENDENCIES.vite,
        '@astrojs/node': '11.1.9',
        '@astrojs/react': SITE_DEPENDENCIES['@astrojs/react'],
        '@keystatic/astro': SITE_DEPENDENCIES['@keystatic/astro'],
        '@keystatic/core': SITE_DEPENDENCIES['@keystatic/core'],
        react: SITE_DEPENDENCIES.react,
        'react-dom': SITE_DEPENDENCIES['react-dom'],
      }
      pkg.engines = SITE_ENGINES
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    }

    // 5. Write keystatic.config.ts
    const keystaticcfgPath = join(outputDir, 'keystatic.config.ts')
    if (!existsSync(keystaticcfgPath)) {
      const keystaticcfg = `import { config, fields, collection } from '@keystatic/core'

export default config({
  storage: {
    kind: 'local',
  },

  collections: {
    posts: collection({
      label: 'Blog Posts',
      slugField: 'title',
      path: 'src/data/post/*/',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        publishDate: fields.datetime({ label: 'Publish Date', defaultValue: { kind: 'now' } }),
        excerpt: fields.text({ label: 'Excerpt', multiline: true }),
        category: fields.text({ label: 'Category' }),
        tags: fields.array(fields.text({ label: 'Tag' }), { label: 'Tags', itemLabel: (props) => props.fields.value.value }),
        author: fields.text({ label: 'Author' }),
        draft: fields.checkbox({ label: 'Draft', defaultValue: false }),
        content: fields.markdoc({ label: 'Content', extension: 'md' }),
      },
    }),
  },
})
`
      await writeFile(keystaticcfgPath, keystaticcfg, 'utf-8')
    }

  },
}

/** Pure canonical adapter config; shared with bounded report-context attestation. */
export function patchAstrowindAstroConfig(cfg: string, siteUrl?: string): string {

  if (siteUrl) {
    if (/site:\s*['"`]/.test(cfg)) {
      cfg = cfg.replace(/(site:\s*)(['"`])[^'"`]*\2/, (_m, key) => `${key}${sourceString(siteUrl)}`)
    } else {
      cfg = cfg.replace('export default defineConfig({', () => `export default defineConfig({\n  site: ${sourceString(siteUrl)},`)
    }
  }

  // Add Keystatic: switch to hybrid output, add node adapter + react + keystatic
  if (!cfg.includes('keystatic')) {
    cfg = cfg.replace(
      /import \{ defineConfig \} from 'astro\/config';/,
      `import { defineConfig } from 'astro/config';\nimport node from '@astrojs/node';\nimport react from '@astrojs/react';\nimport keystatic from '@keystatic/astro';`,
    )
    // Keep output: 'static' (Astro 7 default, supports per-page prerender=false)
    // Just inject the node adapter before integrations
    cfg = cfg.replace(
      /export default defineConfig\(\{/,
      `export default defineConfig({\n  adapter: node({ mode: 'standalone' }),`,
    )
    cfg = cfg.replace(
      /(\bintegrations:\s*\[)/,
      `$1\n    react(),\n    keystatic(),`,
    )
  }
  return cfg
}

function serializeAstrowindLinks(navItems: NavItem[], indent = '    '): string {
  const items = navItems.length > 0
    ? navItems
    : [{ label: 'Home', href: '/', children: [] }, { label: 'Blog', href: '/blog', children: [] }]

  return items.map((item) => {
    if (item.children && item.children.length > 0) {
      const children = item.children
        .map((c) => `${indent}    { text: ${JSON.stringify(c.label)}, href: getPermalink(${JSON.stringify(localHref(c.href))}) },`)
        .join('\n')
      return `${indent}{\n${indent}  text: ${JSON.stringify(item.label)},\n${indent}  links: [\n${children}\n${indent}  ],\n${indent}},`
    }
    return `${indent}{ text: ${JSON.stringify(item.label)}, href: getPermalink(${JSON.stringify(localHref(item.href))}) },`
  }).join('\n') + '\n'
}
