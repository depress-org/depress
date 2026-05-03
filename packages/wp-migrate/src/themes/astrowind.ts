import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ThemeAdapter, ArticleFM, PageFM, PatchConfigOpts, NavItem } from './types.js'

/**
 * AstroWind – https://github.com/onwidget/astrowind
 *
 * Highly customizable Astro 5 + Tailwind CSS site template.
 * Multiple home layouts (startup, SaaS, personal, mobile-app), landing page templates,
 * blog, about, contact, pricing, services pages — all CSS-var-driven so colours/fonts
 * can be changed in one place.
 *
 * Bundled in bundled-themes/astrowind/ — copied locally, never downloaded at runtime.
 *
 * Content structure (Keystatic-compatible directory entries):
 *   src/data/post/<slug>/index.mdx  blog posts
 *   public/images/blog/             media
 */
export const astrowindAdapter: ThemeAdapter = {
  id: 'astrowind',
  name: 'AstroWind',
  repo: 'onwidget/astrowind',
  branch: 'main',
  description:
    'Astro 5 + Tailwind CSS — multiple home/landing templates, blog, dark mode, CSS-var theming',
  bundled: true,

  contentDir: 'src/data/post',
  mediaDir: 'public/images/blog',
  fileExt: 'mdx',
  useDirectoryEntries: true,
  sampleContentDirs: ['src/data/post'],

  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown> {
    return {
      // Must be a Date object (not ISO string) — AstroWind schema uses z.date()
      publishDate: fm.publishedAt ? new Date(fm.publishedAt) : new Date(),
      title: fm.title ?? 'Untitled',
      excerpt: fm.excerpt ?? fm.seoDescription ?? '',
      // Images are in public/images/blog/ (served as static assets).
      // AstroWind's <Image> component requires explicit width+height for public/ files;
      // omit the field so the theme skips the hero image rather than throwing.
      // To enable hero images, move them to src/assets/ and import them instead.
      category: fm.category ?? '',
      tags: fm.tags ?? [],
      author: siteAuthor || 'Author',
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
    // 1. Patch src/config.yaml — site name, description, URL
    const configYamlPath = join(outputDir, 'src', 'config.yaml')
    if (existsSync(configYamlPath)) {
      let yaml = await readFile(configYamlPath, 'utf-8')

      yaml = yaml.replace(
        /(^|\n)(  name:\s*)(['"`]?)([^'"`\n]*)(\3)/,
        (_m, pre, key, q, _old, qEnd) =>
          `${pre}${key}${q || "'"}${opts.siteTitle}${qEnd || "'"}`,
      )
      if (opts.siteUrl) {
        yaml = yaml.replace(
          /(^|\n)(  site:\s*)(['"`])([^'"`\n]*)(\3)/,
          (_m, pre, key, q, _old, qEnd) => `${pre}${key}${q}${opts.siteUrl}${qEnd}`,
        )
      }
      yaml = yaml.replace(
        /(^\s*default:\s*)(['"`]?)([^'"`\n]*)(\2)/m,
        (_m, key, q, _old, qEnd) => `${key}${q || "'"}${opts.siteTitle}${qEnd || "'"}`,
      )
      yaml = yaml.replace(
        /(description:\s*)(['"`"])([\s\S]*?)(\2)/,
        (_m, key, q, _old, qEnd) => `${key}${q}${opts.siteDescription}${qEnd}`,
      )
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
  footNote: \`© \${new Date().getFullYear()} ${opts.siteTitle}. All rights reserved.\`,
};
`
      await writeFile(navPath, navContent, 'utf-8')
    }

    // 3. Patch astro.config.ts — hybrid output + noop image service + Keystatic
    const astroCfgPath = join(outputDir, 'astro.config.ts')
    if (existsSync(astroCfgPath)) {
      let cfg = await readFile(astroCfgPath, 'utf-8')

      if (opts.siteUrl) {
        if (/site:\s*['"`]/.test(cfg)) {
          cfg = cfg.replace(/(site:\s*)(['"`])[^'"`]*\2/, `$1$2${opts.siteUrl}$2`)
        } else {
          cfg = cfg.replace('export default defineConfig({', `export default defineConfig({\n  site: '${opts.siteUrl}',`)
        }
      }

      // Replace existing image: block or inject before integrations:
      if (!cfg.includes('noop')) {
        if (/^\s*image\s*:/m.test(cfg)) {
          cfg = cfg.replace(/\bimage\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\},?\s*/s, `image: { service: { entrypoint: 'astro/assets/services/noop' } },\n\n  `)
        } else {
          cfg = cfg.replace(
            /(\bintegrations:\s*\[)/,
            `image: { service: { entrypoint: 'astro/assets/services/noop' } },\n\n  $1`,
          )
        }
      }

      // Add Keystatic: switch to hybrid output, add node adapter + react + keystatic
      if (!cfg.includes('keystatic')) {
        cfg = cfg.replace(
          /import \{ defineConfig \} from 'astro\/config';/,
          `import { defineConfig } from 'astro/config';\nimport node from '@astrojs/node';\nimport react from '@astrojs/react';\nimport keystatic from '@keystatic/astro';`,
        )
        // Keep output: 'static' (Astro 5 default, supports per-page prerender=false)
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

      await writeFile(astroCfgPath, cfg, 'utf-8')
    }

    // 4. Add Keystatic deps to package.json
    const pkgPath = join(outputDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      if (!pkg.dependencies?.['@keystatic/core']) {
        pkg.dependencies = {
          ...pkg.dependencies,
          '@keystatic/core': '^0.5.0',
          '@keystatic/astro': '^5.0.0',
          '@astrojs/react': '^3.0.0',
          '@astrojs/node': '^9.0.0',
          'react': '^18.3.0',
          'react-dom': '^18.3.0',
        }
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
      }
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
        content: fields.mdx({ label: 'Content' }),
      },
    }),
  },
})
`
      await writeFile(keystaticcfgPath, keystaticcfg, 'utf-8')
    }

  },
}

function serializeAstrowindLinks(navItems: NavItem[], indent = '    '): string {
  const items = navItems.length > 0
    ? navItems
    : [{ label: 'Home', href: '/', children: [] }, { label: 'Blog', href: '/blog', children: [] }]

  return items.map((item) => {
    if (item.children && item.children.length > 0) {
      const children = item.children
        .map((c) => `${indent}    { text: ${JSON.stringify(c.label)}, href: getPermalink(${JSON.stringify(c.href)}) },`)
        .join('\n')
      return `${indent}{\n${indent}  text: ${JSON.stringify(item.label)},\n${indent}  links: [\n${children}\n${indent}  ],\n${indent}},`
    }
    return `${indent}{ text: ${JSON.stringify(item.label)}, href: getPermalink(${JSON.stringify(item.href)}) },`
  }).join('\n') + '\n'
}
