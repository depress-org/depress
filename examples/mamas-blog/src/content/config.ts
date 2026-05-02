import { defineCollection, z } from 'astro:content'

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    publishedAt: z.string().optional(),
    excerpt: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
})

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    seoDescription: z.string().optional(),
  }),
})

const categories = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    description: z.string().optional().default(''),
  }),
})

const tags = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
  }),
})

export const collections = { articles, pages, categories, tags }
