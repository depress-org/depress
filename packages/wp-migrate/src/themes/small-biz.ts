import type { ThemeAdapter, ArticleFM } from './types.js'

export const smallBizAdapter: ThemeAdapter = {
  id: 'small-biz',
  name: 'Small Business Starter',
  repo: 'alancuenca/small-business-starter',
  branch: 'main',
  description: 'Clean business site with blog — landing page + blog section',
  contentDir: 'src/content/blog',
  mediaDir: 'public',
  fileExt: 'md',
  sampleContentDirs: ['src/content/blog'],

  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown> {
    return {
      title: fm.title ?? 'Untitled',
      description: fm.excerpt ?? fm.seoDescription ?? '',
      date: fm.publishedAt ?? '',
      tags: fm.tags ?? [],
      author: siteAuthor || 'Team',
      draft: false,
    }
  },
}
