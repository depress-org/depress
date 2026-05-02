import type { WPExport, KeystaticConfig } from '@depress-dev/core'

/**
 * Generate keystatic.config.ts based on analyzed WordPress content structure.
 * This is the AI-powered step — analyzes real WP data and generates typed config.
 */
export function generateKeystaticConfig(wpExport: WPExport, repo: string): string {
  const hasCategories = wpExport.categories.length > 0
  const hasTags = wpExport.tags.length > 0
  const hasPages = wpExport.posts.some((p) => p.type === 'page')

  const collectionsCode = buildCollections(hasCategories, hasTags, hasPages)
  const singletonsCode = buildSingletons(wpExport.siteTitle)

  return `import { config, fields, collection, singleton } from '@keystatic/core'

export default config({
  storage: {
    kind: 'github',
    repo: '${repo}',
  },

  collections: {
${collectionsCode}
  },

  singletons: {
${singletonsCode}
  },
})
`
}

function buildCollections(hasCategories: boolean, hasTags: boolean, hasPages: boolean): string {
  const parts: string[] = []

  // Articles collection
  parts.push(`    articles: collection({
      label: 'Articles',
      slugField: 'title',
      path: 'src/content/articles/*',
      entryLayout: 'content',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        excerpt: fields.text({ label: 'Excerpt', multiline: true }),
        cover: fields.image({ label: 'Cover image', directory: 'public/media/articles' }),
        publishedAt: fields.datetime({ label: 'Published at', defaultValue: { kind: 'now' } }),
        ${hasCategories ? "category: fields.relationship({ label: 'Category', collection: 'categories' })," : ''}
        ${hasTags ? "tags: fields.array(fields.relationship({ label: 'Tag', collection: 'tags' }), { label: 'Tags' })," : ''}
        seoTitle: fields.text({ label: 'SEO Title' }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),`)

  if (hasCategories) {
    parts.push(`
    categories: collection({
      label: 'Categories',
      slugField: 'name',
      path: 'src/content/categories/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        description: fields.text({ label: 'Description', multiline: true }),
      },
    }),`)
  }

  if (hasTags) {
    parts.push(`
    tags: collection({
      label: 'Tags',
      slugField: 'name',
      path: 'src/content/tags/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
      },
    }),`)
  }

  if (hasPages) {
    parts.push(`
    pages: collection({
      label: 'Pages',
      slugField: 'title',
      path: 'src/content/pages/*',
      entryLayout: 'content',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),`)
  }

  return parts.join('\n')
}

function buildSingletons(siteTitle: string): string {
  return `    siteConfig: singleton({
      label: 'Site Settings',
      path: 'src/content/config',
      schema: {
        siteTitle: fields.text({ label: 'Site Title', defaultValue: ${JSON.stringify(siteTitle)} }),
        siteDescription: fields.text({ label: 'Site Description', multiline: true }),
        authorName: fields.text({ label: 'Author Name' }),
        authorBio: fields.text({ label: 'Author Bio', multiline: true }),
        authorPhoto: fields.image({ label: 'Author Photo', directory: 'public/media' }),
        navItems: fields.array(
          fields.object({
            label: fields.text({ label: 'Menu Item Label' }),
            href: fields.text({ label: 'URL' }),
          }),
          { label: 'Navigation' }
        ),
      },
    }),`
}
