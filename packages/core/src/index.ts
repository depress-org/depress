// Core types for depress

export interface DepressConfig {
  /** GitHub repository in format "org/repo" */
  repo: string
  /** Site URL */
  siteUrl: string
  /** Content directory */
  contentDir: string
}

export interface WPPost {
  id: number
  title: string
  slug: string
  content: string
  excerpt: string
  status: 'publish' | 'draft' | 'private'
  type: 'post' | 'page' | string
  date: string
  categories: string[]
  tags: string[]
  featuredImage?: string
  customFields?: Record<string, unknown>
}

export interface WPCategory {
  id: number
  name: string
  slug: string
  description: string
  parentId?: number
}

export interface WPTag {
  id: number
  name: string
  slug: string
}

export interface WPMedia {
  id: number
  url: string
  filename: string
  mimeType: string
  altText: string
}

export interface WPExport {
  siteTitle: string
  siteUrl: string
  posts: WPPost[]
  categories: WPCategory[]
  tags: WPTag[]
  media: WPMedia[]
}

export interface MigrationReport {
  total: number
  success: number
  errors: number
  skipped: number
  errorDetails: Array<{
    slug: string
    error: string
  }>
}

export interface KeystaticField {
  type: 'text' | 'slug' | 'image' | 'datetime' | 'select' | 'relationship' | 'markdoc' | 'array' | 'object'
  label: string
  required?: boolean
  options?: string[]
  collection?: string
  multiline?: boolean
}

export interface KeystaticCollection {
  label: string
  slugField: string
  path: string
  entryLayout?: 'content' | 'form'
  schema: Record<string, KeystaticField>
}

export interface KeystaticConfig {
  collections: Record<string, KeystaticCollection>
  singletons: Record<string, {
    label: string
    path: string
    schema: Record<string, KeystaticField>
  }>
}

export interface NavItem {
  label: string
  href: string
  children?: NavItem[]
}

export interface WPSiteInfo {
  title: string
  url: string
  description: string
}
