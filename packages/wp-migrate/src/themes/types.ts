export interface ArticleFM {
  title?: string
  publishedAt?: string
  excerpt?: string
  category?: string
  tags?: string[]
  coverImage?: string
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
}

export interface ThemeAdapter {
  id: string
  name: string
  repo: string           // 'user/repo' on GitHub
  branch: string         // usually 'main'
  description: string
  contentDir: string     // relative path in theme where blog posts go, e.g. 'src/content/blog'
  pagesDir?: string      // where pages go (if theme supports pages)
  mediaDir: string       // e.g. 'public/images' or 'public'
  fileExt: 'md' | 'mdx'
  sampleContentDirs: string[]  // dirs to clear sample content from (delete .md/.mdx files)
  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown>
  mapPageFrontmatter?(fm: PageFM): Record<string, unknown>
  patchConfig?(outputDir: string, opts: PatchConfigOpts): Promise<void>
}
