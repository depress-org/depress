import type { ThemeAdapter, ArticleFM } from './types.js'

export const brookAdapter: ThemeAdapter = {
  id: 'brook',
  name: 'Brook 2',
  repo: 'holger1411/astro-brook',
  branch: 'main',
  description: 'Minimal blog — ultra-clean typography, content-first design',
  contentDir: 'src/content/posts',
  mediaDir: 'public',
  fileExt: 'md',
  sampleContentDirs: ['src/content/posts'],

  mapFrontmatter(fm: ArticleFM, _siteAuthor: string): Record<string, unknown> {
    return {
      title: fm.title ?? 'Untitled',
      date: fm.publishedAt ?? '',
      excerpt: fm.excerpt ?? '',
      image: fm.coverImage ?? '',
      tags: fm.tags ?? [],
    }
  },
}
