import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { NavItem } from '@depress-org/core'

export interface ScaffoldOptions {
  siteTitle: string
  siteDescription: string
  siteUrl: string
  authorName: string
  navItems: NavItem[]
  hasCategories: boolean
  hasTags: boolean
}

// ── Individual file generators ───────────────────────────────────────────────

function genPackageJson(siteTitle: string): string {
  const name = siteTitle
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'my-blog'
  return JSON.stringify(
    {
      name,
      type: 'module',
      version: '0.1.0',
      private: true,
      scripts: {
        setup: "node -e \"require('fs').existsSync('node_modules')||require('child_process').execSync('npm install',{stdio:'inherit'})\"",
        dev: 'npm run setup && astro dev',
        start: 'npm run setup && astro dev',
        build: 'npm run setup && astro build',
        preview: 'astro preview',
        astro: 'astro',
        'go-public': "node -e \"const fs=require('fs');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/PUBLIC_SITE=\\\\S+/,'PUBLIC_SITE=true'));console.log('✅ Site is now public — rebuild to apply.')\"",
        'go-private': "node -e \"const fs=require('fs');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/PUBLIC_SITE=\\\\S+/,'PUBLIC_SITE=false'));console.log('🔒 Site is now hidden from search engines — rebuild to apply.')\"",
      },
      dependencies: {
        '@astrojs/cloudflare': '^10.0.0',
        '@astrojs/markdoc': '^0.11.0',
        '@astrojs/react': '^3.6.0',
        '@astrojs/sitemap': '^3.0.0',
        '@astrojs/tailwind': '^5.1.0',
        '@keystatic/astro': '^5.0.0',
        '@keystatic/core': '^0.5.0',
        astro: '^4.16.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        sharp: '^0.33.4',
        tailwindcss: '^3.4.1',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
      },
    },
    null,
    2,
  )
}

function genAstroConfig(siteUrl: string): string {
  const url = siteUrl || 'https://your-site.pages.dev'
  return `import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import sitemap from '@astrojs/sitemap'
import markdoc from '@astrojs/markdoc'
import keystatic from '@keystatic/astro'

export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  site: '${url}',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    sitemap(),
    markdoc(),
    keystatic(),
  ],
})
`
}

function genTailwindConfig(): string {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
`
}

function genTsConfig(): string {
  return JSON.stringify(
    { extends: 'astro/tsconfigs/strict', compilerOptions: { baseUrl: '.' } },
    null,
    2,
  )
}

function genEnvDts(): string {
  return `/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
`
}

function genContentConfig(hasCategories: boolean, hasTags: boolean): string {
  const collections = [`
const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    publishedAt: z.string().optional(),
    excerpt: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    coverImage: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
})

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    seoDescription: z.string().optional(),
  }),
})`]

  if (hasCategories) {
    collections.push(`
const categories = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    description: z.string().optional().default(''),
  }),
})`)
  }

  if (hasTags) {
    collections.push(`
const tags = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
  }),
})`)
  }

  const exportParts = ['articles', 'pages']
  if (hasCategories) exportParts.push('categories')
  if (hasTags) exportParts.push('tags')

  return `import { defineCollection, z } from 'astro:content'
${collections.join('\n')}

export const collections = { ${exportParts.join(', ')} }
`
}

function genNavigationJson(navItems: NavItem[]): string {
  return JSON.stringify(navItems, null, 2)
}

function genBaseLayout(siteTitle: string): string {
  return `---
import Header from '../components/layout/Header.astro'
import Footer from '../components/layout/Footer.astro'
import '../styles/global.css'

interface Props {
  title: string
  description?: string
}

const { title, description = '' } = Astro.props
---

<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <meta name="generator" content={Astro.generator} />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title} — ${siteTitle}</title>
  </head>
  <body class="min-h-screen flex flex-col bg-white text-gray-900 font-sans">
    <Header />
    <main class="flex-1 container mx-auto px-4 py-10 max-w-3xl w-full">
      <slot />
    </main>
    <Footer />
  </body>
</html>
`
}

function genHeaderAstro(siteTitle: string): string {
  return `---
import nav from '../../data/navigation.json'

const current = Astro.url.pathname
---

<header class="border-b border-gray-200 bg-white sticky top-0 z-10">
  <nav class="container mx-auto px-4 max-w-5xl flex items-center justify-between h-14">
    <a href="/" class="text-lg font-semibold text-gray-900 hover:text-gray-700 transition-colors">
      ${siteTitle}
    </a>
    <ul class="flex gap-5 flex-wrap">
      {
        nav.map((item: { label: string; href: string }) => (
          <li>
            <a
              href={item.href}
              class={\`text-sm transition-colors \${
                current === item.href || (item.href !== '/' && current.startsWith(item.href))
                  ? 'text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-900'
              }\`}
            >
              {item.label}
            </a>
          </li>
        ))
      }
    </ul>
  </nav>
</header>
`
}

function genFooterAstro(siteTitle: string): string {
  return `---
const year = new Date().getFullYear()
---

<footer class="border-t border-gray-100 bg-gray-50 mt-auto">
  <div class="container mx-auto px-4 max-w-3xl py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
    <p>&copy; {year} ${siteTitle}. All rights reserved.</p>
    <p>
      Built with <a href="https://astro.build" class="hover:text-gray-600 transition-colors">Astro</a>
      {' '}+{' '}
      <a href="https://keystatic.com" class="hover:text-gray-600 transition-colors">Keystatic</a>
    </p>
  </div>
</footer>
`
}

function genArticleCard(): string {
  return `---
interface Props {
  title: string
  slug: string
  excerpt?: string
  publishedAt?: string
  category?: string
  coverImage?: string
}

const { title, slug, excerpt, publishedAt, category, coverImage } = Astro.props

const formattedDate = publishedAt
  ? new Date(publishedAt).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  : null
---

<article class="group border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all">
  <a href={\`/blog/\${slug}\`} class="block">
    {coverImage && (
      <div class="aspect-video overflow-hidden bg-gray-100">
        <img src={coverImage} alt={title} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
    )}
    <div class="p-5">
      {category && (
        <span class="text-xs font-medium text-blue-600 uppercase tracking-wide mb-2 block">
          {category}
        </span>
      )}
      <h2 class="text-base font-semibold text-gray-900 mb-2 group-hover:text-blue-700 transition-colors leading-snug">
        {title}
      </h2>
      {excerpt && <p class="text-gray-500 text-sm leading-relaxed line-clamp-3">{excerpt}</p>}
      {formattedDate && (
        <time class="text-xs text-gray-400 mt-3 block">{formattedDate}</time>
      )}
    </div>
  </a>
</article>
`
}

function genIndexPage(siteTitle: string, siteDescription: string): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro'
import ArticleCard from '../components/ui/ArticleCard.astro'
import { getCollection } from 'astro:content'

const articles = (await getCollection('articles'))
  .filter((a) => !a.id.startsWith('_drafts/'))
  .sort(
    (a, b) =>
      new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime(),
  )
  .slice(0, 6)
---

<BaseLayout title="Главная" description="${siteDescription}">
  <section class="mb-12">
    <h1 class="text-4xl font-bold text-gray-900 mb-4 font-serif">${siteTitle}</h1>
    <p class="text-lg text-gray-600 leading-relaxed">${siteDescription}</p>
  </section>

  {
    articles.length > 0 ? (
      <section>
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-semibold text-gray-900">Последние статьи</h2>
          <a href="/blog" class="text-sm text-blue-600 hover:text-blue-800 transition-colors">
            Все статьи →
          </a>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {articles.map((article) => (
            <ArticleCard
              title={article.data.title}
              slug={article.slug}
              excerpt={article.data.excerpt}
              publishedAt={article.data.publishedAt}
              category={article.data.category}
              coverImage={article.data.coverImage}
            />
          ))}
        </div>
      </section>
    ) : (
      <p class="text-gray-400 text-center py-20">Статьи появятся здесь.</p>
    )
  }
</BaseLayout>
`
}

function genBlogIndexPage(): string {
  return `---
import BaseLayout from '../../layouts/BaseLayout.astro'
import ArticleCard from '../../components/ui/ArticleCard.astro'
import { getCollection } from 'astro:content'

const articles = (await getCollection('articles'))
  .filter((a) => !a.id.startsWith('_drafts/'))
  .sort(
    (a, b) =>
      new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime(),
  )
---

<BaseLayout title="Все статьи" description="Все статьи блога.">
  <h1 class="text-3xl font-bold text-gray-900 mb-8 font-serif">Все статьи</h1>

  {
    articles.length > 0 ? (
      <div class="grid gap-4 sm:grid-cols-2">
        {articles.map((article) => (
          <ArticleCard
            title={article.data.title}
            slug={article.slug}
            excerpt={article.data.excerpt}
            publishedAt={article.data.publishedAt}
            category={article.data.category}
            coverImage={article.data.coverImage}
          />
        ))}
      </div>
    ) : (
      <p class="text-gray-400 text-center py-20">Статьи не найдены.</p>
    )
  }
</BaseLayout>
`
}

function genBlogSlugPage(): string {
  return `---
import BaseLayout from '../../layouts/BaseLayout.astro'
import { getCollection } from 'astro:content'

export async function getStaticPaths() {
  const articles = await getCollection('articles')
  return articles
    .filter((a) => !a.id.startsWith('_drafts/'))
    .map((article) => ({
      params: { slug: article.slug },
      props: { article },
    }))
}

const { article } = Astro.props
const { Content } = await article.render()

const formattedDate = article.data.publishedAt
  ? new Date(article.data.publishedAt).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  : null
---

<BaseLayout
  title={article.data.seoTitle ?? article.data.title}
  description={article.data.seoDescription ?? article.data.excerpt ?? ''}
>
  <article>
    <header class="mb-10">
      {article.data.category && (
        <span class="text-xs font-medium text-blue-600 uppercase tracking-wide mb-3 block">
          {article.data.category}
        </span>
      )}
      <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 font-serif leading-tight mb-4">
        {article.data.title}
      </h1>
      {article.data.excerpt && (
        <p class="text-lg text-gray-500 leading-relaxed">{article.data.excerpt}</p>
      )}
      {formattedDate && <time class="text-sm text-gray-400 mt-3 block">{formattedDate}</time>}
      {article.data.coverImage && (
        <div class="mt-6 rounded-xl overflow-hidden">
          <img src={article.data.coverImage} alt={article.data.title} class="w-full" />
        </div>
      )}
    </header>

    <div class="prose prose-gray max-w-none">
      <Content />
    </div>

    {article.data.tags && article.data.tags.length > 0 && (
      <div class="mt-10 pt-6 border-t border-gray-100 flex flex-wrap gap-2">
        {article.data.tags.map((tag: string) => (
          <span class="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{tag}</span>
        ))}
      </div>
    )}
  </article>

  <div class="mt-12 pt-8 border-t border-gray-100">
    <a href="/blog" class="text-sm text-blue-600 hover:text-blue-800 transition-colors">
      ← Все статьи
    </a>
  </div>
</BaseLayout>

<style is:global>
  .prose h1, .prose h2, .prose h3 { font-family: Georgia, serif; color: #111827; }
  .prose p { line-height: 1.8; color: #374151; }
  .prose a { color: #2563eb; }
  .prose a:hover { color: #1d4ed8; }
  .prose img { border-radius: 0.5rem; max-width: 100%; height: auto; }
  .prose blockquote { border-left-color: #e5e7eb; color: #6b7280; }
</style>
`
}

function genPageSlugPage(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro'
import { getCollection } from 'astro:content'

export async function getStaticPaths() {
  const pages = await getCollection('pages')
  return pages.map((page) => ({
    params: { slug: page.slug },
    props: { page },
  }))
}

const { page } = Astro.props
const { Content } = await page.render()
---

<BaseLayout title={page.data.title} description={page.data.seoDescription ?? ''}>
  <article>
    <h1 class="text-3xl font-bold text-gray-900 font-serif mb-8">{page.data.title}</h1>
    <div class="prose prose-gray max-w-none">
      <Content />
    </div>
  </article>
</BaseLayout>

<style is:global>
  .prose h1, .prose h2, .prose h3 { font-family: Georgia, serif; color: #111827; }
  .prose p { line-height: 1.8; color: #374151; }
  .prose a { color: #2563eb; }
  .prose a:hover { color: #1d4ed8; }
  .prose img { border-radius: 0.5rem; max-width: 100%; height: auto; }
</style>
`
}

function genCategorySlugPage(): string {
  return `---
import BaseLayout from '../../layouts/BaseLayout.astro'
import ArticleCard from '../../components/ui/ArticleCard.astro'
import { getCollection } from 'astro:content'

export async function getStaticPaths() {
  const articles = await getCollection('articles')
  const categorySet = new Set(articles.map((a) => a.data.category).filter(Boolean))
  return [...categorySet].map((category) => ({
    params: { slug: category },
    props: { category },
  }))
}

const { category } = Astro.props
const articles = (await getCollection('articles'))
  .filter((a) => a.data.category === category && !a.id.startsWith('_drafts/'))
  .sort((a, b) => new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime())
---

<BaseLayout title={category ?? 'Category'} description={\`Articles in \${category}\`}>
  <div class="mb-8">
    <a href="/blog" class="text-sm text-blue-600 hover:text-blue-800 transition-colors">← All articles</a>
  </div>
  <h1 class="text-3xl font-bold text-gray-900 font-serif mb-8">{category}</h1>

  {
    articles.length > 0 ? (
      <div class="grid gap-4 sm:grid-cols-2">
        {articles.map((article) => (
          <ArticleCard
            title={article.data.title}
            slug={article.slug}
            excerpt={article.data.excerpt}
            publishedAt={article.data.publishedAt}
            category={article.data.category}
            coverImage={article.data.coverImage}
          />
        ))}
      </div>
    ) : (
      <p class="text-gray-400 text-center py-20">No articles found.</p>
    )
  }
</BaseLayout>
`
}

function genKeystatiParams(): string {
  return `---
export const prerender = false
---
`
}

function genGlobalCss(): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;
`
}

function genFavicon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y=".9em" font-size="90">📝</text>
</svg>
`
}

function genRedirects(): string {
  return `# Cloudflare Pages redirects
# Add WordPress URL redirects here after migration.
# Format: /old-path  /new-path  301
#
# Examples:
# /2024/01/my-post-slug/  /blog/my-post-slug  301
# /?p=123  /blog/my-post-slug  301
`
}

function genGitignore(): string {
  return `# build output
dist/
.output/
.vercel/
.netlify/

# dependencies
node_modules/

# Astro
.astro/

# env files — .env.local for secrets, .env is committed (site config only)
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db
`
}

function genReadme(siteTitle: string): string {
  return `# ${siteTitle}

Migrated from WordPress using [depress](https://github.com/depress-org/depress).

## Getting started

\`\`\`bash
npm install
npm start        # → http://localhost:4321
\`\`\`

## CMS

Open Keystatic admin: **http://localhost:4321/keystatic**

## Build

\`\`\`bash
npm run build
\`\`\`

## Deploy

Deploy the \`dist/\` folder to **Cloudflare Pages** (connect your GitHub repo for automatic deploys).

To enable Keystatic in production, update \`keystatic.config.ts\`:
\`\`\`ts
storage: {
  kind: 'github',
  repo: 'your-org/your-repo',
}
\`\`\`
`
}

function genKeystatiConfig(
  siteTitle: string,
  hasCategories: boolean,
  hasTags: boolean,
): string {
  const categoriesCollection = hasCategories
    ? `
    categories: collection({
      label: 'Categories',
      slugField: 'name',
      path: 'src/content/categories/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        description: fields.text({ label: 'Description', multiline: true }),
      },
    }),`
    : ''

  const tagsCollection = hasTags
    ? `
    tags: collection({
      label: 'Tags',
      slugField: 'name',
      path: 'src/content/tags/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
      },
    }),`
    : ''

  const relationFields = [
    hasCategories
      ? "        category: fields.relationship({ label: 'Category', collection: 'categories' }),"
      : '',
    hasTags
      ? "        tags: fields.array(fields.relationship({ label: 'Tag', collection: 'tags' }), { label: 'Tags' }),"
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return `import { config, fields, collection, singleton } from '@keystatic/core'

export default config({
  storage: {
    // Switch to kind: 'github' with your repo for production
    kind: 'local',
  },

  collections: {
    articles: collection({
      label: 'Articles',
      slugField: 'title',
      path: 'src/content/articles/*',
      entryLayout: 'content',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        excerpt: fields.text({ label: 'Excerpt', multiline: true }),
        coverImage: fields.image({ label: 'Cover image', directory: 'public/media' }),
        publishedAt: fields.datetime({ label: 'Published at', defaultValue: { kind: 'now' } }),
${relationFields}
        seoTitle: fields.text({ label: 'SEO Title' }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true }),
      },
    }),
${categoriesCollection}${tagsCollection}
    pages: collection({
      label: 'Pages',
      slugField: 'title',
      path: 'src/content/pages/*',
      entryLayout: 'content',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true }),
      },
    }),
  },

  singletons: {
    siteConfig: singleton({
      label: 'Site Settings',
      path: 'site-config',
      schema: {
        siteTitle: fields.text({ label: 'Site Title', defaultValue: '${siteTitle}' }),
        siteDescription: fields.text({ label: 'Site Description', multiline: true }),
        authorName: fields.text({ label: 'Author Name' }),
        authorBio: fields.text({ label: 'Author Bio', multiline: true }),
        navItems: fields.array(
          fields.object({
            label: fields.text({ label: 'Menu Item Label' }),
            href: fields.text({ label: 'URL' }),
          }),
          { label: 'Navigation' },
        ),
      },
    }),
  },
})
`
}

function genSiteConfigYaml(opts: {
  siteTitle: string
  siteDescription: string
  authorName: string
  navItems: NavItem[]
}): string {
  const navYaml = opts.navItems
    .map(
      (n) =>
        `  - label: ${JSON.stringify(n.label)}\n    href: ${JSON.stringify(n.href)}`,
    )
    .join('\n')

  return `siteTitle: ${JSON.stringify(opts.siteTitle)}
siteDescription: ${JSON.stringify(opts.siteDescription)}
authorName: ${JSON.stringify(opts.authorName)}
authorBio: ""
navItems:
${navYaml}
`
}

function genRobotsTxt(): string {
  return `import type { APIRoute } from 'astro'

const isPublic = import.meta.env.PUBLIC_SITE === 'true'

export const GET: APIRoute = ({ site }) => {
  if (!isPublic) {
    return new Response('User-agent: *\\nDisallow: /\\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  const siteUrl = site ? site.href.replace(/\\/$/, '') : ''
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    ...(siteUrl ? [\`Sitemap: \${siteUrl}/sitemap-index.xml\`] : []),
  ].join('\\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } })
}
`
}

function genDotEnv(): string {
  return `# Set to true when the site is ready for search engine indexing.
# Run: npm run go-public
PUBLIC_SITE=false
`
}

// ── Main scaffold function ────────────────────────────────────────────────────

export async function scaffoldAstroProject(
  opts: ScaffoldOptions,
  outputDir: string,
): Promise<void> {
  const { siteTitle, siteDescription, siteUrl, authorName, navItems, hasCategories, hasTags } = opts

  const writes: Array<[string, string]> = [
    // Root config files
    ['package.json', genPackageJson(siteTitle)],
    ['astro.config.mjs', genAstroConfig(siteUrl)],
    ['tailwind.config.mjs', genTailwindConfig()],
    ['tsconfig.json', genTsConfig()],
    ['.gitignore', genGitignore()],
    ['.env', genDotEnv()],
    ['README.md', genReadme(siteTitle)],
    ['keystatic.config.ts', genKeystatiConfig(siteTitle, hasCategories, hasTags)],

    // Public
    ['public/favicon.svg', genFavicon()],
    ['public/_redirects', genRedirects()],

    // src/
    ['src/env.d.ts', genEnvDts()],
    ['src/styles/global.css', genGlobalCss()],
    ['src/data/navigation.json', genNavigationJson(navItems)],
    ['src/content/config.ts', genContentConfig(hasCategories, hasTags)],
    ['site-config.yaml', genSiteConfigYaml({ siteTitle, siteDescription, authorName, navItems })],

    // Layouts
    ['src/layouts/BaseLayout.astro', genBaseLayout(siteTitle)],

    // Components
    ['src/components/layout/Header.astro', genHeaderAstro(siteTitle)],
    ['src/components/layout/Footer.astro', genFooterAstro(siteTitle)],
    ['src/components/ui/ArticleCard.astro', genArticleCard()],

    // Pages
    ['src/pages/index.astro', genIndexPage(siteTitle, siteDescription)],
    ['src/pages/blog/index.astro', genBlogIndexPage()],
    ['src/pages/robots.txt.ts', genRobotsTxt()],
    ['src/pages/blog/[slug].astro', genBlogSlugPage()],
    ['src/pages/[...slug].astro', genPageSlugPage()],
    ['src/pages/keystatic/[...params].astro', genKeystatiParams()],
    ...(hasCategories ? [['src/pages/category/[slug].astro', genCategorySlugPage()] as [string, string]] : []),
  ]

  for (const [relPath, content] of writes) {
    const fullPath = join(outputDir, relPath)
    await mkdir(join(outputDir, relPath, '..'), { recursive: true })
    // Don't overwrite keystatic.config.ts if already written by generate-config
    await writeFile(fullPath, content, 'utf-8')
  }
}

