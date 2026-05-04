import type { NavItem } from '@depress-org/core'
export type { NavItem }

export interface ArticleFM {
  title?: string
  publishedAt?: string
  excerpt?: string
  author?: string
  category?: string
  tags?: string[]
  coverImage?: string
  featuredImageUrl?: string
  seoTitle?: string
  seoDescription?: string
}

export interface PageFM {
  title?: string
  seoDescription?: string
}

export interface PatchConfigOpts {
  siteTitle: string
  siteDescription: string
  siteUrl: string
  authorName: string
  navItems: NavItem[]
  allMenus: Record<string, NavItem[]>
}

export interface ThemeAdapter {
  id: string
  name: string
  repo: string           // 'user/repo' on GitHub
  branch: string         // usually 'main'
  description: string
  /**
   * When true the theme is stored in bundled-themes/<id>/ inside the package
   * and will be copied locally instead of downloaded from GitHub at generation time.
   * This guarantees the theme never changes, moves, or disappears.
   */
  bundled?: boolean
  contentDir: string     // relative path in theme where blog posts go, e.g. 'src/data/post'
  pagesDir?: string      // where pages go (if theme supports pages)
  mediaDir: string       // e.g. 'public/images' or 'public'
  fileExt: 'md' | 'mdx'
  /** When true, each post is written as <contentDir>/<slug>/index.<ext> (directory entry, Keystatic-compatible) */
  useDirectoryEntries?: boolean
  sampleContentDirs: string[]  // dirs to clear sample content from (delete .md/.mdx files)
  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown>
  mapPageFrontmatter?(fm: PageFM): Record<string, unknown>
  patchConfig?(outputDir: string, opts: PatchConfigOpts): Promise<void>
}
