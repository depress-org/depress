import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { containedPath, safeWriteFile } from './input-boundary.js'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import matter from 'gray-matter'
import TurndownService from 'turndown'
import Markdoc, { type RenderableTreeNode } from '@markdoc/markdoc'
import { proveScaffoldDraftExclusion } from './report-privacy.js'
import type { WPExport, SourceManifest, SourceItem, ReportLayout, MigrationReportV1, MigrationItem, MigrationMedia, ReportFinding } from '@depress-org/core'

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const text = (value: any): string => value == null ? '' : typeof value === 'object' ? text(value['#text']) : String(value)
const decode = (value: string) => { try { return decodeURIComponent(value) } catch { return value } }
const count = <T>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

/** Inventory raw WXR, before the ordinary parser filters unsupported item types. */
export function createSourceManifest(xml: string, parsed: WPExport): SourceManifest {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid source XML')
  const raw = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false,
    isArray: name => ['item', 'wp:postmeta'].includes(name) }).parse(xml)
  if (raw?.rss?.channel === undefined) throw new Error('Invalid source XML: missing channel')
  const rawItems: any[] = raw.rss.channel.item ?? []
  const ids = count(rawItems, x => String(Number(text(x['wp:post_id']))))
  const parsedIds = count(parsed.posts, p => String(p.id))
  const media: SourceManifest['media'] = []
  const items = rawItems.map((rawItem, index): SourceItem => {
    const id = Number(text(rawItem['wp:post_id']))
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid source item ID at ordinal ${index}`)
    const type = text(rawItem['wp:post_type'])
    const meta: Record<string, string> = {}
    for (const m of rawItem['wp:postmeta'] ?? []) meta[text(m['wp:meta_key'])] = text(m['wp:meta_value'])
    const customFields = Object.fromEntries(Object.entries(meta).filter(([k]) => k && !k.startsWith('_')))
    const enriched = ids.get(String(id)) === 1 && parsedIds.get(String(id)) === 1 && ['post', 'page'].includes(type)
      ? parsed.posts.find(p => p.id === id) : undefined
    const item: SourceItem = { key: `${index}:${type}:${id}`, id, type, status: text(rawItem['wp:status']),
      slug: decode(text(rawItem['wp:post_name'])), title: text(rawItem.title), author: text(rawItem['dc:creator']),
      content: text(rawItem['content:encoded']),
      seoTitle: meta['_yoast_wpseo_title'] ?? enriched?.seoTitle,
      seoDescription: meta['_yoast_wpseo_metadesc'] ?? enriched?.seoDescription,
      featuredImageId: meta['_thumbnail_id'] ?? enriched?.featuredImageId,
      customFields: { ...enriched?.customFields, ...customFields } }
    if (type === 'attachment') {
      const url = text(rawItem['wp:attachment_url']) || text(rawItem.guid)
      media.push({ id, url, filename: basename(url), mimeType: text(rawItem['wp:post_mime_type']), altText: meta['_wp_attachment_image_alt'] ?? '' })
    }
    return item
  })
  return { schemaVersion: 1, sourceSha256: sha(xml), items, media }
}

function basename(url: string): string {
  try { return decode(new URL(url, 'https://source.invalid').pathname.split('/').pop() ?? '') } catch { return '' }
}
function safeRelative(path: string): boolean {
  return !!path && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(p => p === '..' || p === '.' || p === '')
}
class UnsafePath extends Error {}
/** Resolve existing ancestors too, so a missing leaf beneath an escaped symlink is unsafe. */
async function safePath(root: string, path: string): Promise<string> {
  if (!safeRelative(path)) throw new UnsafePath('Unsafe relative path')
  const base = await realpath(root)
  const target = resolve(base, path)
  let ancestor = target
  for (;;) {
    try {
      const actual = await realpath(ancestor)
      const rel = relative(base, actual)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new UnsafePath('Symlink escapes output directory')
      return target
    } catch (error: any) {
      if (error instanceof UnsafePath || !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
      if (ancestor === base) throw error
      ancestor = dirname(ancestor)
    }
  }
}
async function readSafe(root: string, path: string): Promise<Buffer> { return readFile(await safePath(root, path)) }
function expectedPath(item: SourceItem, layout: ReportLayout): string {
  const dir = item.type === 'page' ? layout.pagesDir : layout.contentDir
  if (!dir || !safeRelative(dir) || !safeRelative(item.slug) || item.slug.includes('/') || !/^[a-zA-Z0-9]+$/.test(layout.fileExt)) throw new UnsafePath('Invalid output layout or slug')
  return `${dir}/${item.slug}${(item.type === 'page' ? layout.pagesUseDirectoryEntries : layout.useDirectoryEntries) ? '/index' : ''}.${layout.fileExt}`
}
// Compare complete normalized VISIBLE text, never literal Markdown/metadata.
// Images have separate per-occurrence evidence; punctuation/spacing remain normalized.
const normalizeText = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const staticNodes = new Set(['blockquote', 'code', 'comment', 'document', 'em', 'fence', 'hardbreak', 'heading', 'hr', 'image', 'inline', 'item', 'link', 'list', 'paragraph', 's', 'softbreak', 'strong', 'table', 'tbody', 'td', 'text', 'th', 'thead', 'tr'])
function staticDocument(value: string) {
  const tokenizer = new Markdoc.Tokenizer({ allowComments: true })
  const ast = Markdoc.parse(tokenizer.tokenize(value))
  // Only built-in, static grammar may reach transform. Never resolve variables,
  // functions, custom tags, annotations or slots, even alongside retained prose.
  if ([ast, ...ast.walk()].some(node => !staticNodes.has(node.type) || node.errors.length || node.annotations.length || Object.keys(node.slots).length ||
    Object.values(node.attributes).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) throw new Error('Unproven Markdoc context')
  if (Markdoc.validate(ast).length) throw new Error('Invalid Markdoc document')
  return ast
}
const blockTags = new Set(['article', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre'])
const inlineTags = new Set(['em', 'strong', 's', 'a', 'code'])
function renderedText(node: RenderableTreeNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node === null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(renderedText).join('')
  if (!Markdoc.Tag.isTag(node)) throw new Error('Unproven rendered node')
  if (node.name === 'img') return '' // alt/src/title are not body prose
  if (node.name === 'br' || node.name === 'hr') return '\n'
  const content = node.children.map(renderedText).join('')
  if (blockTags.has(node.name)) return `\n${content}\n`
  if (inlineTags.has(node.name)) return content // Do not split Bo**dy** into words.
  throw new Error('Unproven rendered element')
}
function bodyText(value: string, fileExt: string): string | undefined {
  if (fileExt !== 'mdoc') return undefined
  try { return normalizeText(renderedText(Markdoc.transform(staticDocument(value)))) }
  catch { return undefined } // Unknown renderer/dynamic context is NOT empty-text proof.
}
function sourceText(value: string): string {
  // Source is HTML, not Markdoc. Flatten parsed HTML without introducing Markdown
  // formatting or reparsing escaped literal examples as active comments/tags.
  const html = new TurndownService()
  html.addRule('report-visible-text', {
    filter: () => true,
    replacement: (content, node) => {
      if (node.nodeName === 'BR') return '\n'
      if (['IMG', 'SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD'].includes(node.nodeName)) return ''
      return 'isBlock' in node && node.isBlock ? `\n${content}\n` : content
    },
  })
  return normalizeText(html.turndown(value))
}
const finding = (findings: ReportFinding[], code: string, detail: string) => findings.push({ code, detail })

type ImageEvidence = { src: string; alt: string }

// Source is HTML: inspect parsed elements, not commented/escaped example text.
// Turndown already owns source HTML parsing; never execute source or custom tags.
function sourceImages(value: string): ImageEvidence[] {
  const found: ImageEvidence[] = []
  const html = new TurndownService()
  html.addRule('report-images', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('src')
      if (src) found.push({ src, alt: node.getAttribute('alt') ?? '' })
      return ''
    },
  })
  html.turndown(value)
  return found
}

// Parse the same Markdoc grammar as the generated .mdoc renderer. HTML is text
// there; Astro enables allowComments to strip HTML comments before parsing.
// No transform/resolve: dynamic tags/annotations/custom formats are unproven.
function images(value: string, fileExt: string): ImageEvidence[] {
  if (fileExt !== 'mdoc') return []
  try {
    const tokenizer = new Markdoc.Tokenizer({ allowComments: true })
    const nodes = [...Markdoc.parse(tokenizer.tokenize(value)).walk()]
    if (nodes.some(node => node.type === 'tag' || node.errors.length || node.annotations.length)) return []
    return nodes.filter(node => node.type === 'image')
      .filter(node => typeof node.attributes.src === 'string' && typeof node.attributes.alt === 'string')
      .map(node => ({ src: node.attributes.src, alt: node.attributes.alt }))
  } catch { return [] }
}

/** Inspect actual bytes, not transform counters. No source content is executed. */
export async function inspectMigration(outputDir: string, manifest: SourceManifest, layout: ReportLayout): Promise<MigrationReportV1> {
  const ids = count(manifest.items, i => String(i.id))
  const eligible = manifest.items.filter(i => i.status === 'publish' && ['post', 'page'].includes(i.type))
  const slugs = count(eligible, i => `${i.type}:${i.slug.toLocaleLowerCase('en-US')}`)
  const paths = count(eligible, i => { try { return expectedPath(i, layout).toLocaleLowerCase('en-US') } catch { return `invalid:${i.key}` } })
  const output = new Map<string, string>()
  let redirects = '', redirectMap: any = null
  const artifacts: Record<string, string> = {}
  try { const bytes = await readSafe(outputDir, 'public/_redirects'); artifacts['public/_redirects'] = sha(bytes); redirects = bytes.toString('utf8') } catch { /* per-item findings below */ }
  try { const bytes = await readSafe(outputDir, 'public/redirects.json'); artifacts['public/redirects.json'] = sha(bytes); redirectMap = JSON.parse(bytes.toString('utf8')) } catch { /* per-item findings below */ }
  const items: MigrationItem[] = []
  for (const source of manifest.items) {
    const item: MigrationItem = { key: source.key, id: source.id, type: source.type, sourceStatus: source.status, slug: source.slug, status: 'skipped', findings: [] }
    items.push(item)
    for (const shortcode of source.content.matchAll(/\[(?!\[)(\/?[A-Za-z_][\w:-]*)(?:\s[^\]\r\n]*)?\s*\/?\]/g)) finding(item.findings, 'unsupported-shortcode', `Source shortcode not proven migrated: ${shortcode[0]}`)
    for (const key of Object.keys(source.customFields ?? {})) finding(item.findings, 'unsupported-custom-field', `Source custom field not proven migrated: ${key}`)
    if (ids.get(String(source.id))! > 1) finding(item.findings, 'duplicate-source-id', `Source ID ${source.id} is not unique`)
    if (source.type === 'attachment') continue // Media is inspected independently, including inherit-status attachments.
    if (source.status !== 'publish') {
      if (!['post', 'page'].includes(source.type)) continue
      try {
        const path = expectedPath(source, layout)
        const publicPaths = [path, `public/${source.type === 'page' ? '' : 'blog/'}${source.slug}/index.html`]
        for (const candidate of publicPaths) {
          try {
            const bytes = await readSafe(outputDir, candidate)
            artifacts[candidate] = sha(bytes)
            finding(item.findings, 'nonpublic-output', `Nonpublished source ${source.id} has public output ${candidate}`)
          } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
        }
        const dir = source.type === 'page' ? layout.pagesDir! : layout.contentDir
        const editorPath = `${dir}/_drafts/${path.slice(dir.length + 1)}`
        let editor: Buffer | undefined
        try { editor = await readSafe(outputDir, editorPath) }
        catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
        if (editor) {
          item.outputPath = editorPath; item.contentSha256 = sha(editor)
          try {
            if (source.type !== 'post' || layout.contentDir !== 'src/content/articles' || layout.fileExt !== 'mdoc' || !layout.useDirectoryEntries) throw new Error('Unknown draft storage')
            const proof = await proveScaffoldDraftExclusion(p => readSafe(outputDir, p), p => p ? safePath(outputDir, p) : realpath(outputDir))
            for (const [file, bytes] of Object.entries(proof)) artifacts[file] = sha(bytes)
          } catch { finding(item.findings, 'unproven-draft-exclusion', 'Editor storage is not byte-proven excluded by canonical public routes and listings') }
        }
      } catch { finding(item.findings, 'unsafe-path', 'Cannot safely prove nonpublished output exclusion') }
      if (item.findings.length) item.status = 'failed'
      continue
    }
    if (!['post', 'page'].includes(source.type)) { item.status = 'unsupported'; finding(item.findings, 'unsupported-type', `Published ${source.type} is unsupported`); continue }
    item.status = 'failed'
    let path: string
    try { path = expectedPath(source, layout) } catch { finding(item.findings, 'unsafe-path', 'Unsafe output slug or layout'); continue }
    if (slugs.get(`${source.type}:${source.slug.toLocaleLowerCase('en-US')}`)! > 1 || paths.get(path.toLocaleLowerCase('en-US'))! > 1) finding(item.findings, 'duplicate-slug', 'Multiple source items claim the same output path')
    if (item.findings.some(f => f.code === 'duplicate-source-id' || f.code === 'duplicate-slug')) continue
    let raw: string
    let body = ''
    try {
      const bytes = await readSafe(outputDir, path)
      raw = bytes.toString('utf8'); item.outputPath = path; item.contentSha256 = sha(bytes)
    } catch (error) { finding(item.findings, error instanceof UnsafePath ? 'unsafe-path' : 'missing-output', `Cannot safely read expected output ${path}`); continue }
    try {
      const fm = matter(raw, { engines: { javascript: () => { throw new Error('Executable frontmatter is forbidden') } } })
      body = fm.content; output.set(source.key, body)
      if (fm.data.title !== source.title) finding(item.findings, 'title-mismatch', 'Output title differs from source title')
      if (fm.data.author !== source.author) finding(item.findings, 'author-mismatch', `Author for source ID ${source.id} was not preserved exactly`)
      if (source.content.trim() && !fm.content.trim()) finding(item.findings, 'empty-body', 'Nonempty source has empty output body')
      const expectedText = sourceText(source.content)
      const actualText = bodyText(fm.content, layout.fileExt)
      if (expectedText === undefined || actualText === undefined || expectedText !== actualText) finding(item.findings, 'body-text-mismatch', 'Complete normalized visible source prose differs from destination body or its render context is unproven')
      for (const [field, mapped, code] of [['seoTitle', 'title', 'seo-title-mismatch'], ['seoDescription', 'description', 'seo-description-mismatch']] as const) {
        if (source[field] !== undefined && (fm.data[field] ?? fm.data.metadata?.[mapped] ?? fm.data.seo?.[mapped]) !== source[field]) finding(item.findings, code, `Source ${field} was not preserved exactly`)
      }
    } catch { finding(item.findings, 'invalid-frontmatter', 'Output frontmatter cannot be safely parsed') }
    const destination = source.type === 'page' ? `/${source.slug}/` : `/blog/${source.slug}/`
    const from = `/?p=${source.id}`
    const redirectRows = redirects.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[0] === from)
    if (redirectRows.length !== 1 || redirectRows[0][1] !== destination || !/^301!?$/.test(redirectRows[0][2] ?? '')) finding(item.findings, 'redirect-text-mismatch', `Expected ${from} → ${destination} in public/_redirects`)
    if (!redirectMap || Array.isArray(redirectMap) || redirectMap[from] !== destination) finding(item.findings, 'redirect-json-mismatch', `Expected ${from} → ${destination} in public/redirects.json`)
    if (source.featuredImageId) {
      const matches = manifest.media.filter(m => String(m.id) === source.featuredImageId)
      if (matches.length !== 1) finding(item.findings, 'missing-featured-attachment', `Featured attachment ${source.featuredImageId} missing or ambiguous`)
      else if (!raw.includes(`/media/${basename(matches[0].url)}`)) finding(item.findings, 'featured-image-mismatch', `Featured attachment ${source.featuredImageId} is not referenced locally`)
    }
    const actualImages = images(body, layout.fileExt)
    const occurrences = new Map<string, number>()
    for (const image of sourceImages(source.content)) {
      const local = `/media/${basename(image.src)}`
      const index = occurrences.get(local) ?? 0
      occurrences.set(local, index + 1)
      const actual = actualImages.filter(i => i.src === local)[index]
      if (!manifest.media.some(m => m.url === image.src) || !actual) finding(item.findings, 'source-image-unverified', `Source image reference not verified: ${image.src}`)
      if (image.alt && actual?.alt !== image.alt) finding(item.findings, 'inline-alt-mismatch', `Source image occurrence ${index + 1} alt differs on ${local}`)
      try { await readSafe(outputDir, `public${local}`) } catch { finding(item.findings, 'missing-image-file', `Missing safe local media for source image: ${image.src}`) }
    }
    item.status = item.findings.length ? 'failed' : 'migrated'
  }
  const names = count(manifest.media, m => basename(m.url).toLocaleLowerCase('en-US'))
  const media: MigrationMedia[] = []
  for (const source of manifest.media) {
    const entry: MigrationMedia = { ...source, status: 'failed', findings: [] }; media.push(entry)
    const name = basename(source.url)
    if (!name || !safeRelative(name) || name.includes('/')) { finding(entry.findings, 'unsafe-path', 'Unsafe attachment filename'); continue }
    if (names.get(name.toLocaleLowerCase('en-US'))! > 1 || ids.get(String(source.id))! > 1) { entry.status = 'unsupported'; finding(entry.findings, 'ambiguous-media', `Attachment ${source.id} has duplicate ID or local basename`); continue }
    try { const bytes = await readSafe(outputDir, `public/media/${name}`); entry.outputPath = `public/media/${name}`; entry.contentSha256 = sha(bytes); if (!bytes.length) finding(entry.findings, 'empty-media', `Attachment ${source.id} has zero bytes`) }
    catch (error) { finding(entry.findings, error instanceof UnsafePath ? 'unsafe-path' : 'missing-media', `Attachment ${source.id} local file is unavailable`) }
    if (source.altText) {
      const local = `/media/${name}`
      const preserved = [...output.values()].some(body => images(body, layout.fileExt).some(image => image.src === local && image.alt === source.altText))
      if (!preserved) finding(entry.findings, 'unsupported-alt', `Source alt for attachment ${source.id} is not proven preserved on a local image`)
    }
    entry.status = entry.findings.length ? (entry.findings.every(f => f.code === 'unsupported-alt') ? 'unsupported' : 'failed') : 'migrated'
  }
  return { schemaVersion: 1, sourceSha256: manifest.sourceSha256, layout: { ...layout }, items, media, artifacts,
    qualityPassed: manifest.items.length > 0 && items.every(i => i.findings.length === 0 && (i.sourceStatus !== 'publish' || i.type === 'attachment' || i.status === 'migrated')) && media.every(m => m.status === 'migrated') }
}

export async function writeMigrationReports(outputDir: string, manifest: SourceManifest, layout: ReportLayout): Promise<MigrationReportV1> {
  await containedPath(outputDir, '.')
  const report = await inspectMigration(outputDir, manifest, layout)
  const escape = (s: string) => s.replace(/[\r\n|]/g, ' ')
  const markdown = ['# Migration report (schema 1)', '', `Quality: ${report.qualityPassed ? 'PASS' : 'FAIL'}`, `Source SHA-256: ${manifest.sourceSha256}`, '',
    '| Source ID | Type | Outcome | Findings |', '| --- | --- | --- | --- |',
    ...report.items.map(i => `| ${i.id} | ${escape(i.type)} | ${i.status} | ${i.findings.map(f => escape(`${f.code}: ${f.detail}`)).join('; ')} |`), '', '## Media',
    ...report.media.map(m => `- ID ${m.id}: ${m.status}; ${m.findings.map(f => escape(`${f.code}: ${f.detail}`)).join('; ')}`), '',
    'The source manifest contains source content and may contain private information. Unsupported features are not preservation claims.', ''].join('\n')
  for (const [path, value] of [['source-manifest.json', JSON.stringify(manifest, null, 2)], ['migration-report.json', JSON.stringify(report, null, 2)], ['migration-report.md', markdown]]) await safeWriteFile(outputDir, path, value)
  return report
}

function assertManifest(value: any): asserts value is SourceManifest {
  if (!value || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !Array.isArray(value.items) || !value.items.length || !Array.isArray(value.media)) throw new Error('Invalid or empty source manifest')
  const keys = new Set<string>()
  for (const i of value.items) {
    if (!i || !Number.isSafeInteger(i.id) || i.id <= 0 || ['key', 'type', 'status', 'slug', 'title', 'author', 'content'].some(k => typeof i[k] !== 'string') || !i.key || keys.has(i.key)) throw new Error('Invalid or duplicate source item')
    keys.add(i.key)
    for (const k of ['seoTitle', 'seoDescription', 'featuredImageId']) if (i[k] !== undefined && typeof i[k] !== 'string') throw new Error('Invalid source feature')
    if (i.customFields !== undefined && (!i.customFields || Array.isArray(i.customFields) || typeof i.customFields !== 'object' || Object.values(i.customFields).some(v => typeof v !== 'string'))) throw new Error('Invalid custom fields')
  }
  const attachments = value.items.filter((i: SourceItem) => i.type === 'attachment')
  if (attachments.length !== value.media.length) throw new Error('Missing attachment inventory')
  for (const m of value.media) if (!m || !Number.isSafeInteger(m.id) || ['url', 'filename', 'mimeType', 'altText'].some(k => typeof m[k] !== 'string') || !attachments.some((i: SourceItem) => i.id === m.id)) throw new Error('Invalid media inventory')
  const inventoryIds = attachments.map((i: SourceItem) => i.id).sort((a: number, b: number) => a - b)
  if (JSON.stringify(inventoryIds) !== JSON.stringify(value.media.map((m: MigrationMedia) => m.id).sort((a: number, b: number) => a - b))) throw new Error('Incomplete attachment inventory')
}
function assertLayout(layout: any): asserts layout is ReportLayout {
  if (!layout || typeof layout.contentDir !== 'string' || !safeRelative(layout.contentDir) || (layout.pagesDir !== undefined && (typeof layout.pagesDir !== 'string' || !safeRelative(layout.pagesDir))) || typeof layout.fileExt !== 'string' || !/^[A-Za-z0-9]+$/.test(layout.fileExt) || typeof layout.useDirectoryEntries !== 'boolean') throw new Error('Invalid report layout')
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
/** Fail closed and compare a fresh byte-backed report, never just its green boolean. */
export async function validateMigrationReport(outputDir: string): Promise<{ passed: boolean; detail: string }> {
  try {
    const manifest = JSON.parse((await readSafe(outputDir, 'source-manifest.json')).toString('utf8'))
    assertManifest(manifest)
    const stored = JSON.parse((await readSafe(outputDir, 'migration-report.json')).toString('utf8'))
    if (!stored || stored.schemaVersion !== 1 || stored.sourceSha256 !== manifest.sourceSha256 || !Array.isArray(stored.items) || !Array.isArray(stored.media) || typeof stored.qualityPassed !== 'boolean') throw new Error('Invalid migration report schema')
    assertLayout(stored.layout)
    if (!(await readSafe(outputDir, 'migration-report.md')).toString('utf8').trim()) throw new Error('Missing Markdown report')
    const fresh = await inspectMigration(outputDir, manifest, stored.layout)
    if (canonical(fresh) !== canonical(stored)) throw new Error('Stored report does not match the source inventory and current output bytes')
    if (!fresh.qualityPassed) return { passed: false, detail: 'Migration report contains failed or unsupported source features' }
    return { passed: true, detail: 'Version 1 report matches the source inventory and verified output bytes' }
  } catch (error) { return { passed: false, detail: error instanceof Error ? error.message : 'Invalid migration report' } }
}
