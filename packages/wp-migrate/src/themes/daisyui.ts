import type { ThemeAdapter, ArticleFM } from './types.js'

export const daisyuiAdapter: ThemeAdapter = {
  id: 'daisyui',
  name: 'DaisyUI Starter',
  repo: 'aholbreich/astro-tailwind-daisyui-starter',
  branch: 'main',
  description: 'Tailwind CSS + DaisyUI starter with blog and dark mode',
  contentDir: 'src/content/blog',
  mediaDir: 'public',
  fileExt: 'md',
  sampleContentDirs: ['src/content/blog'],

  mapFrontmatter(fm: ArticleFM, _siteAuthor: string): Record<string, unknown> {
    return {
      title: fm.title ?? 'Untitled',
      description: fm.excerpt ?? fm.seoDescription ?? '',
      pubDate: fm.publishedAt ?? '',
      heroImage: fm.coverImage ?? '',
      draft: false,
    }
  },
}
