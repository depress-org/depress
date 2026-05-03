import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { NavItem } from '@depress-org/core'


export interface ScaffoldOptions {
  siteTitle: string
  siteDescription: string
  siteUrl: string
  authorName: string
  navItems: NavItem[]
  allMenus?: Record<string, NavItem[]>
  homepageType?: 'latest_posts' | 'page' | 'category'
  homepageRef?: string
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
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
      },
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        heading: 'var(--color-heading)',
        body: 'var(--color-body)',
        muted: 'var(--color-muted)',
        link: 'var(--color-link)',
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

function genNavigationJson(navItems: NavItem[], allMenus?: Record<string, NavItem[]>): string {
  if (allMenus && Object.keys(allMenus).length > 0) {
    return JSON.stringify(allMenus, null, 2)
  }
  return JSON.stringify({ primary: navItems }, null, 2)
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
    <script is:inline>
      ;(function () {
        var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        document.documentElement.setAttribute('data-theme', t)
      })()
    </script>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title} — ${siteTitle}</title>
  </head>
  <body class="min-h-screen flex flex-col bg-bg text-body font-sans">
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
import navData from '../../data/navigation.json'

type NavItem = { label: string; href: string; children?: NavItem[] }
const navItems: NavItem[] = (navData as any).primary ?? Object.values(navData as any)[0] ?? []
const current = Astro.url.pathname

function isActive(href: string) {
  return href === '/' ? current === '/' : current.startsWith(href)
}
---

<header class="nav-header">
  <div class="nav-inner">
    <!-- Logo -->
    <a href="/" class="nav-logo">${siteTitle}</a>

    <!-- Desktop nav -->
    <ul class="nav-list">
      {navItems.map((item: NavItem) => {
        const hasChildren = item.children && item.children.length > 0
        return (
          <li class="nav-item">
            <a href={item.href} class={\`nav-link \${isActive(item.href) ? 'nav-link--active' : ''}\`}>
              <span class="nav-link-text">{item.label}</span>
              {hasChildren && (
                <svg class="nav-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              )}
            </a>
            {hasChildren && (
              <div class="nav-dropdown">
                <ul class="nav-dropdown-list">
                  {item.children!.map((child: NavItem) => (
                    <li>
                      <a href={child.href} class={\`nav-dropdown-link \${isActive(child.href) ? 'nav-dropdown-link--active' : ''}\`}>
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        )
      })}
    </ul>

    <!-- Theme toggle -->
    <button id="theme-toggle" class="theme-toggle" aria-label="Переключить тему">
      <!-- Sun icon — shown in dark mode (click to go light) -->
      <svg class="theme-icon theme-icon-sun" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <!-- Moon icon — shown in light mode (click to go dark) -->
      <svg class="theme-icon theme-icon-moon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M17 10.5A7 7 0 1 1 9.5 3c-.2 1.2 0 2.8.8 4 .8 1.2 2.2 2.3 3.7 2.8 1.5.5 2.8.4 3 .7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- Mobile hamburger -->
    <button id="menu-toggle" class="nav-burger" aria-label="Открыть меню" aria-expanded="false">
      <span class="nav-burger-bar"></span>
      <span class="nav-burger-bar"></span>
      <span class="nav-burger-bar"></span>
    </button>
  </div>

  <!-- Mobile drawer -->
  <div id="mobile-menu" class="nav-mobile" aria-hidden="true">
    <ul class="nav-mobile-list">
      {navItems.map((item: NavItem) => {
        const hasChildren = item.children && item.children.length > 0
        return (
          <li>
            <a href={item.href} class={\`nav-mobile-link \${isActive(item.href) ? 'nav-mobile-link--active' : ''}\`}>
              {item.label}
            </a>
            {hasChildren && (
              <ul class="nav-mobile-sub">
                {item.children!.map((child: NavItem) => (
                  <li>
                    <a href={child.href} class={\`nav-mobile-sub-link \${isActive(child.href) ? 'nav-mobile-sub-link--active' : ''}\`}>
                      {child.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  </div>
</header>

<style>
  .nav-header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: var(--nav-bg);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
  }

  .nav-inner {
    max-width: 72rem;
    margin: 0 auto;
    padding: 0 1.5rem;
    height: 3.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
  }

  /* Logo */
  .nav-logo {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .nav-logo:hover { color: var(--color-muted); }

  /* Desktop list */
  .nav-list {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    align-items: center;
    gap: 0.125rem;
    flex: 1;
    justify-content: flex-end;
  }
  @media (min-width: 768px) { .nav-list { display: flex; } }

  .nav-item {
    position: relative;
  }

  .nav-link {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 450;
    color: var(--color-muted);
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
    line-height: 1.35;
  }
  .nav-link:hover { color: var(--color-heading); background: var(--color-surface); }
  .nav-link--active { color: var(--color-heading); font-weight: 600; background: var(--color-surface); }

  .nav-link-text {
    display: block;
    max-width: 14rem;
  }

  .nav-chevron {
    width: 0.7rem;
    height: 0.7rem;
    flex-shrink: 0;
    margin-top: 0.2rem;
    opacity: 0.5;
    transition: transform 0.2s, opacity 0.2s;
  }
  .nav-item:hover .nav-chevron {
    transform: rotate(180deg);
    opacity: 0.8;
  }

  /* Dropdown */
  .nav-dropdown {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    min-width: 16rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 0.75rem;
    box-shadow: var(--shadow-dropdown);
    padding: 0.375rem;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s;
    pointer-events: none;
  }
  .nav-item:hover .nav-dropdown {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }

  .nav-dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .nav-dropdown-link {
    display: block;
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-body);
    text-decoration: none;
    transition: background 0.12s, color 0.12s;
  }
  .nav-dropdown-link:hover { background: var(--color-surface); color: var(--color-heading); }
  .nav-dropdown-link--active { background: var(--color-surface); color: var(--color-heading); font-weight: 600; }

  /* Hamburger */
  .nav-burger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0.4rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s;
  }
  .nav-burger:hover { background: var(--color-surface); }
  @media (min-width: 768px) { .nav-burger { display: none; } }

  .nav-burger-bar {
    display: block;
    width: 100%;
    height: 1.5px;
    background: var(--color-muted);
    border-radius: 1px;
    transition: transform 0.2s, opacity 0.2s;
  }
  .nav-burger.is-open .nav-burger-bar:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
  .nav-burger.is-open .nav-burger-bar:nth-child(2) { opacity: 0; }
  .nav-burger.is-open .nav-burger-bar:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

  /* Mobile drawer */
  .nav-mobile {
    display: none;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
  }
  .nav-mobile.is-open { display: block; }
  @media (min-width: 768px) { .nav-mobile { display: none !important; } }

  .nav-mobile-list {
    list-style: none;
    margin: 0;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .nav-mobile-link {
    display: block;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-body);
    text-decoration: none;
    transition: background 0.12s;
  }
  .nav-mobile-link:hover { background: var(--color-surface); }
  .nav-mobile-link--active { background: var(--color-surface); color: var(--color-heading); font-weight: 600; }

  .nav-mobile-sub {
    list-style: none;
    margin: 0.25rem 0 0.5rem 1rem;
    padding: 0;
    border-left: 2px solid var(--color-border);
    padding-left: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .nav-mobile-sub-link {
    display: block;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    color: var(--color-muted);
    text-decoration: none;
    transition: background 0.12s, color 0.12s;
  }
  .nav-mobile-sub-link:hover { background: var(--color-surface); color: var(--color-heading); }
  .nav-mobile-sub-link--active { color: var(--color-heading); font-weight: 600; }

  /* Theme toggle */
  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    cursor: pointer;
    color: var(--color-muted);
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .theme-toggle:hover { background: var(--color-surface); color: var(--color-heading); }

  .theme-icon { width: 1.125rem; height: 1.125rem; }

  /* Light mode: show moon (to switch to dark) */
  .theme-icon-sun { display: none; }
  .theme-icon-moon { display: block; }

  /* Dark mode: show sun (to switch to light) */
  :global([data-theme="dark"]) .theme-icon-sun { display: block; }
  :global([data-theme="dark"]) .theme-icon-moon { display: none; }
</style>

<script>
  // Mobile menu
  const btn = document.getElementById('menu-toggle')
  const menu = document.getElementById('mobile-menu')
  btn?.addEventListener('click', () => {
    const open = menu?.classList.toggle('is-open')
    btn.classList.toggle('is-open', open)
    btn.setAttribute('aria-expanded', String(open))
    menu?.setAttribute('aria-hidden', String(!open))
    btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню')
  })

  // Theme toggle
  const themeBtn = document.getElementById('theme-toggle')
  themeBtn?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light'
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  })
</script>
`
}

function genFooterAstro(siteTitle: string): string {
  return `---
const year = new Date().getFullYear()
---

<footer class="border-t border-border bg-surface mt-auto">
  <div class="container mx-auto px-4 max-w-3xl py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
    <p>&copy; {year} ${siteTitle}. All rights reserved.</p>
    <p>
      Built with <a href="https://astro.build" class="hover:text-body transition-colors">Astro</a>
      {' '}+{' '}
      <a href="https://keystatic.com" class="hover:text-body transition-colors">Keystatic</a>
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

<article class="group border border-border rounded-xl overflow-hidden bg-surface hover:shadow-[var(--shadow-card)] transition-all">
  <a href={\`/blog/\${slug}\`} class="block">
    {coverImage && (
      <div class="aspect-video overflow-hidden bg-surface">
        <img src={coverImage} alt={title} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
    )}
    <div class="p-5">
      {category && (
        <span class="text-xs font-medium text-link uppercase tracking-wide mb-2 block">
          {category}
        </span>
      )}
      <h2 class="text-base font-semibold text-heading mb-2 group-hover:text-link transition-colors leading-snug">
        {title}
      </h2>
      {excerpt && <p class="text-muted text-sm leading-relaxed line-clamp-3">{excerpt}</p>}
      {formattedDate && (
        <time class="text-xs text-muted mt-3 block">{formattedDate}</time>
      )}
    </div>
  </a>
</article>
`
}

function genIndexPage(siteTitle: string, siteDescription: string): string {
  return `---
import { getCollection, getEntry } from 'astro:content'
import { createReader } from '@keystatic/core/reader'
import keystaticConfig from '../../keystatic.config'
import BaseLayout from '../layouts/BaseLayout.astro'
import ArticleCard from '../components/ui/ArticleCard.astro'

const reader = createReader(process.cwd(), keystaticConfig)
const siteConfigData = await reader.singletons.siteConfig.read()

const homepageType = siteConfigData?.homepageType ?? 'latest_posts'
const homepageRef = siteConfigData?.homepageRef ?? ''
const pageSiteTitle = siteConfigData?.siteTitle ?? '${siteTitle}'
const pageSiteDescription = siteConfigData?.siteDescription ?? '${siteDescription}'

let pageEntry: any = null
let articles: any[] = []

if (homepageType === 'page' && homepageRef) {
  pageEntry = await getEntry('pages', homepageRef).catch(() => null)
} else {
  const allArticles = await getCollection('articles', (a: any) => !a.id.startsWith('_drafts/'))
  if (homepageType === 'category' && homepageRef) {
    articles = allArticles
      .filter((a: any) => a.data.category === homepageRef)
      .sort((a: any, b: any) => new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime())
      .slice(0, 9)
  } else {
    articles = allArticles
      .sort((a: any, b: any) => new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime())
      .slice(0, 9)
  }
}
---

<BaseLayout title={pageSiteTitle} description={pageSiteDescription}>
  {pageEntry ? (
    <div class="container mx-auto px-4 max-w-3xl py-16">
      <h1 class="text-4xl font-bold text-heading font-serif mb-8">{pageEntry.data.title}</h1>
      <div class="prose prose-gray max-w-none">
        {/* Markdoc render */}
      </div>
    </div>
  ) : (
    <section class="container mx-auto px-4 max-w-5xl py-16">
      <div class="text-center mb-12">
        <h1 class="text-4xl font-bold text-heading font-serif mb-4">{pageSiteTitle}</h1>
        <p class="text-lg text-muted">{pageSiteDescription}</p>
      </div>
      <div class="flex items-center justify-between mb-8">
        <h2 class="text-2xl font-semibold text-heading font-serif">Последние статьи</h2>
        <a href="/blog" class="text-sm text-link hover:text-link font-medium">Все статьи →</a>
      </div>
      {articles.length > 0 ? (
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          {articles.map((article: any) => (
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
        <p class="text-gray-400 text-center py-20">Статьи появятся здесь.</p>
      )}
    </section>
  )}
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
  <h1 class="text-3xl font-bold text-heading mb-8 font-serif">Все статьи</h1>

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
        <span class="text-xs font-medium text-link uppercase tracking-wide mb-3 block">
          {article.data.category}
        </span>
      )}
      <h1 class="text-3xl sm:text-4xl font-bold text-heading font-serif leading-tight mb-4">
        {article.data.title}
      </h1>
      {article.data.excerpt && (
        <p class="text-lg text-muted leading-relaxed">{article.data.excerpt}</p>
      )}
      {formattedDate && <time class="text-sm text-muted mt-3 block">{formattedDate}</time>}
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
  .prose h1, .prose h2, .prose h3 { font-family: Georgia, serif; color: var(--color-heading); }
  .prose p { line-height: 1.8; color: var(--color-body); }
  .prose a { color: var(--color-link); }
  .prose a:hover { color: var(--color-link-hover); }
  .prose img { border-radius: 0.5rem; max-width: 100%; height: auto; }
  .prose blockquote { border-left-color: var(--color-border); color: var(--color-muted); }
  .prose code { background: var(--color-surface); padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875em; }
  .prose pre { background: var(--color-surface); border: 1px solid var(--color-border); }
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
    <h1 class="text-3xl font-bold text-heading font-serif mb-8">{page.data.title}</h1>
    <div class="prose prose-gray max-w-none">
      <Content />
    </div>
  </article>
</BaseLayout>

<style is:global>
  .prose h1, .prose h2, .prose h3 { font-family: Georgia, serif; color: var(--color-heading); }
  .prose p { line-height: 1.8; color: var(--color-body); }
  .prose a { color: var(--color-link); }
  .prose a:hover { color: var(--color-link-hover); }
  .prose img { border-radius: 0.5rem; max-width: 100%; height: auto; }
  .prose blockquote { border-left-color: var(--color-border); color: var(--color-muted); }
  .prose code { background: var(--color-surface); padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875em; }
  .prose pre { background: var(--color-surface); border: 1px solid var(--color-border); }
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
  <h1 class="text-3xl font-bold text-heading font-serif mb-8">{category}</h1>

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

@layer base {
  :root {
    --color-bg: #ffffff;
    --color-surface: #f8f8f8;
    --color-border: #ebebeb;
    --color-heading: #111111;
    --color-body: #374151;
    --color-muted: #6b7280;
    --color-link: #2563eb;
    --color-link-hover: #1d4ed8;
    --nav-bg: rgba(255, 255, 255, 0.92);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
    --shadow-card: 0 1px 4px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04);
    --shadow-dropdown: 0 8px 28px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  [data-theme="dark"] {
    --color-bg: #0d0d0d;
    --color-surface: #1c1c1c;
    --color-border: #2e2e2e;
    --color-heading: #f0f0f0;
    --color-body: #c9cdd5;
    --color-muted: #888888;
    --color-link: #60a5fa;
    --color-link-hover: #93c5fd;
    --nav-bg: rgba(13, 13, 13, 0.92);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
    --shadow-card: 0 1px 4px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-dropdown: 0 8px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  body {
    background-color: var(--color-bg);
    color: var(--color-body);
  }
}
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
        homepageType: fields.select({
          label: 'Homepage shows',
          options: [
            { label: 'Latest posts', value: 'latest_posts' },
            { label: 'A specific page', value: 'page' },
            { label: 'Posts from a category', value: 'category' },
          ],
          defaultValue: 'latest_posts',
        }),
        homepageRef: fields.text({ label: 'Page or category slug (when not using latest posts)' }),
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
  homepageType?: string
  homepageRef?: string
}): string {
  const navYaml = opts.navItems
    .map(
      (n) =>
        `  - label: ${JSON.stringify(n.label)}\n    href: ${JSON.stringify(n.href)}`,
    )
    .join('\n')

  const homepageType = opts.homepageType ?? 'latest_posts'
  const homepageRef = opts.homepageRef ?? ''

  return `siteTitle: ${JSON.stringify(opts.siteTitle)}
siteDescription: ${JSON.stringify(opts.siteDescription)}
authorName: ${JSON.stringify(opts.authorName)}
authorBio: ""
homepageType: ${JSON.stringify(homepageType)}
homepageRef: ${JSON.stringify(homepageRef)}
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
  const { siteTitle, siteDescription, siteUrl, authorName, navItems, allMenus, homepageType, homepageRef, hasCategories, hasTags } = opts

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
    ['src/data/navigation.json', genNavigationJson(navItems, allMenus)],
    ['src/content/config.ts', genContentConfig(hasCategories, hasTags)],
    ['site-config.yaml', genSiteConfigYaml({ siteTitle, siteDescription, authorName, navItems, homepageType, homepageRef })],

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

