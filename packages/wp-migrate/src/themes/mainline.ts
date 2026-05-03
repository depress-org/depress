import type { ThemeAdapter, ArticleFM } from './types.js'

export const mainlineAdapter: ThemeAdapter = {
  id: 'mainline',
  name: 'Mainline (shadcn)',
  repo: 'shadcnblocks/mainline-astro-template',
  branch: 'main',
  description: 'shadcn/ui-inspired clean template with blog (Astro + Tailwind)',
  contentDir: 'src/content/blog',
  mediaDir: 'public',
  fileExt: 'md',
  sampleContentDirs: ['src/content/blog'],

  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown> {
    return {
      title: fm.title ?? 'Untitled',
      description: fm.excerpt ?? fm.seoDescription ?? '',
      pubDate: fm.publishedAt ?? '',
      image: fm.coverImage ?? '',
      authorName: siteAuthor || '',
    }
  },
}
