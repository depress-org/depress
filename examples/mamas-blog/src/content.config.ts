import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const articles = defineCollection({
  loader: glob({ pattern: ['**/*.mdoc', '!**/_drafts/**'], base: './src/content/articles' }),
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
  loader: glob({ pattern: ['**/*.mdoc', '!**/_drafts/**'], base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    seoDescription: z.string().optional(),
  }),
})

const categories = defineCollection({
  loader: glob({ pattern: '**/*.{yaml,yml,json}', base: './src/content/categories' }),
  schema: z.object({
    name: z.string(),
    description: z.string().optional().default(''),
  }),
})

const tags = defineCollection({
  loader: glob({ pattern: '**/*.{yaml,yml,json}', base: './src/content/tags' }),
  schema: z.object({
    name: z.string(),
  }),
})

export const collections = { articles, pages, categories, tags }
