import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ThemeAdapter, ArticleFM, PageFM, PatchConfigOpts } from './types.js'

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
 * Content structure:
 *   src/data/post/<slug>.md    blog posts  (flat files, Astro glob loader)
 *   public/images/blog/        media
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
  fileExt: 'md',
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
      metadata: {
        title: fm.seoTitle ?? fm.title ?? '',
        description: fm.seoDescription ?? fm.excerpt ?? '',
      },
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

      // Replace site.name value
      yaml = yaml.replace(
        /(^|\n)(  name:\s*)(['"`]?)([^'"`\n]*)(\3)/,
        (_m, pre, key, q, _old, qEnd) =>
          `${pre}${key}${q || "'"}${opts.siteTitle}${qEnd || "'"}`,
      )
      // Replace site.site (URL)
      if (opts.siteUrl) {
        yaml = yaml.replace(
          /(^|\n)(  site:\s*)(['"`])([^'"`\n]*)(\3)/,
          (_m, pre, key, q, _old, qEnd) => `${pre}${key}${q}${opts.siteUrl}${qEnd}`,
        )
      }
      // Replace default metadata title
      yaml = yaml.replace(
        /(^\s*default:\s*)(['"`]?)([^'"`\n]*)(\2)/m,
        (_m, key, q, _old, qEnd) => `${key}${q || "'"}${opts.siteTitle}${qEnd || "'"}`,
      )
      // Replace metadata description (first occurrence)
      yaml = yaml.replace(
        /(description:\s*)(['"`"])([\s\S]*?)(\2)/,
        (_m, key, q, _old, qEnd) => `${key}${q}${opts.siteDescription}${qEnd}`,
      )
      await writeFile(configYamlPath, yaml, 'utf-8')
    }

    // 2. Patch src/navigation.ts — replace demo links with simple Blog nav
    const navPath = join(outputDir, 'src', 'navigation.ts')
    if (existsSync(navPath)) {
      const navContent = `import { getPermalink, getBlogPermalink, getAsset } from './utils/permalinks';

export const headerData = {
  links: [
    {
      text: 'Home',
      href: getPermalink('/'),
    },
    {
      text: 'Blog',
      href: getBlogPermalink(),
    },
    {
      text: 'About',
      href: getPermalink('/about'),
    },
    {
      text: 'Contact',
      href: getPermalink('/contact'),
    },
  ],
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

    // 3. Patch astro.config.ts — set site URL + noop image service
    // The noop service is needed because migrated content images live in public/
    // and Astro's optimizer can't infer dimensions for public/ files.
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
      // Inject noop image service before the closing }) of defineConfig
      if (!cfg.includes('noop')) {
        cfg = cfg.replace(
          /(\bintegrations:\s*\[)/,
          `image: { service: { entrypoint: 'astro/assets/services/noop' } },\n\n  $1`,
        )
      }
      await writeFile(astroCfgPath, cfg, 'utf-8')
    }
  },
}
