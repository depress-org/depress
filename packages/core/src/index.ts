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
  author: string
  categories: string[]
  tags: string[]
  featuredImageId?: string
  featuredImageUrl?: string
  seoTitle?: string
  seoDescription?: string
  customFields?: Record<string, string>
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

/** Local, versioned source inventory. Content can contain private source data. */
export interface SourceItem {
  /** Names only, including private schema/oEmbed keys; no new raw values. */
  metadataKeys?: string[]
  key: string
  id: number
  type: string
  status: string
  slug: string
  title: string
  author: string
  content: string
  seoTitle?: string
  seoDescription?: string
  customFields?: Record<string, string>
  featuredImageId?: string
}
export interface SourceManifest {
  schemaVersion: 1
  sourceSha256: string
  items: SourceItem[]
  media: WPMedia[]
  /** Validated in-tree configuration; absent means the empty configuration. */
  staticPlugins?: unknown
  pluginFailure?: PluginFailureCode
}
export interface ReportLayout {
  contentDir: string
  pagesDir?: string
  fileExt: string
  useDirectoryEntries: boolean
  pagesUseDirectoryEntries?: boolean
}
export interface ReportFinding { code: string; detail: string }
export type MigrationOutcome = 'migrated' | 'skipped' | 'unsupported' | 'failed'
export interface MigrationItem {
  key: string
  id: number
  type: string
  status: MigrationOutcome
  sourceStatus: string
  slug: string
  outputPath?: string
  contentSha256?: string
  findings: ReportFinding[]
}
export interface MigrationMedia extends WPMedia {
  status: MigrationOutcome
  outputPath?: string
  contentSha256?: string
  findings: ReportFinding[]
}
export interface MigrationReportV1 {
  schemaVersion: 1
  sourceSha256: string
  layout: ReportLayout
  items: MigrationItem[]
  media: MigrationMedia[]
  qualityPassed: boolean
  /** SHA-256 snapshots of report-relevant supporting files. */
  artifacts?: Record<string, string>
  compatibility: StaticPluginCompatibility
}

export interface StaticPluginConfig {
  api: 'depress.static-plugin/v1'
  plugins: Array<{ id: string; version: string; options: Record<string, never> }>
}
export type PluginFailureCode = 'PLUGIN_CONFIG_INVALID' | 'PLUGIN_EXECUTION_FAILED' | 'PLUGIN_OUTPUT_REJECTED' | 'PLUGIN_BUDGET_EXCEEDED'
export interface PluginDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  classification: 'static-replacement' | 'manual-review' | 'unsupported-dynamic'
  sourceId?: number
  tokenId?: string
  pluginId?: string
  message: string
  action: string
}
export interface StaticPluginCompatibility {
  api: 'depress.static-plugin/v1'
  matrixVersion: 1
  plugins: Array<{ id: string; version: string }>
  coverage: { wxr: 'scanned'; pluginTables: 'not-assessed'; phpRuntime: 'not-assessed'; omittedExports: 'not-assessed' }
  diagnostics: PluginDiagnostic[]
  sourceFeatures: Array<{ sourceId: number; kind: 'metadata' | 'comment' | 'block'; reference: string; start?: number; end?: number }>
  occurrences: Array<{
    sourceId: number; tokenId: string; tag: string; start: number; end: number
    pluginId?: string
    classification: 'static-replacement' | 'manual-review' | 'unsupported-dynamic'
    outcome: 'observed' | 'verified' | 'not-preserved'
  }>
}
