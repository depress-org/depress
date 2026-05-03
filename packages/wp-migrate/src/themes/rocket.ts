import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ThemeAdapter, ArticleFM, PatchConfigOpts } from './types.js'

export const rocketAdapter: ThemeAdapter = {
  id: 'rocket',
  name: 'Astro Rocket',
  repo: 'hansmartens68/Astro-Rocket',
  branch: 'main',
  description: 'Production-ready site — 57+ components, 12 colour themes, dark mode, blog',
  contentDir: 'src/content/blog',
  mediaDir: 'public/images',
  fileExt: 'md',
  sampleContentDirs: ['src/content/blog'],

  mapFrontmatter(fm: ArticleFM, siteAuthor: string): Record<string, unknown> {
    return {
      title: fm.title ?? 'Untitled',
      description: fm.excerpt ?? fm.seoDescription ?? '',
      publishedAt: fm.publishedAt ?? '',
      image: fm.coverImage ?? '',
      tags: fm.tags ?? [],
      author: siteAuthor || 'Team',
      draft: false,
      featured: false,
      locale: 'en',
    }
  },

  async patchConfig(outputDir: string, opts: PatchConfigOpts): Promise<void> {
    const configPaths = [
      join(outputDir, 'src', 'config', 'site.config.ts'),
      join(outputDir, 'src', 'constants.ts'),
      join(outputDir, 'src', 'config.ts'),
    ]
    for (const configPath of configPaths) {
      try {
        let content = await readFile(configPath, 'utf-8')
        content = content.replace(/(title\s*:\s*)(['"`])[^'"`]*\2/, `$1$2${opts.siteTitle}$2`)
        content = content.replace(/(description\s*:\s*)(['"`])[^'"`]*\2/, `$1$2${opts.siteDescription}$2`)
        await writeFile(configPath, content, 'utf-8')
      } catch {
        // File doesn't exist or can't be read — skip silently
      }
    }
  },
}
