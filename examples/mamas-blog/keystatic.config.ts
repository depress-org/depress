import { config, fields, collection, singleton } from '@keystatic/core'

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
        cover: fields.image({ label: 'Cover image', directory: 'public/media/articles' }),
        publishedAt: fields.datetime({ label: 'Published at', defaultValue: { kind: 'now' } }),
        category: fields.relationship({ label: 'Category', collection: 'categories' }),
        tags: fields.array(fields.relationship({ label: 'Tag', collection: 'tags' }), { label: 'Tags' }),
        seoTitle: fields.text({ label: 'SEO Title' }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),

    categories: collection({
      label: 'Categories',
      slugField: 'name',
      path: 'src/content/categories/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        description: fields.text({ label: 'Description', multiline: true }),
      },
    }),

    tags: collection({
      label: 'Tags',
      slugField: 'name',
      path: 'src/content/tags/*',
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
      },
    }),

    pages: collection({
      label: 'Pages',
      slugField: 'title',
      path: 'src/content/pages/*',
      entryLayout: 'content',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),
  },

  singletons: {
    siteConfig: singleton({
      label: 'Site Settings',
      path: 'src/content/config',
      schema: {
        siteTitle: fields.text({ label: 'Site Title', defaultValue: "Insight" }),
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
    }),
  },
})
