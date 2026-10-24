import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { WPExport, ReportLayout } from '@depress-org/core'
import { createSourceManifest, inspectMigration, validateMigrationReport, writeMigrationReports } from '../report.js'

const parsed: WPExport = { siteTitle: '', siteUrl: '', posts: [], media: [], categories: [], tags: [] }
const layout: ReportLayout = { contentDir: 'src/content/articles', pagesDir: 'src/content/pages', fileExt: 'mdoc', useDirectoryEntries: true }
const dirs: string[] = []
async function temp() { await mkdir(resolve('.tmp'), { recursive: true }); const d = await mkdtemp(resolve('.tmp/report-')); dirs.push(d); return d }
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
function item(id: number, type = 'post', slug = 'hello', status = 'publish', extra = '', body = '<p>Body</p>') {
  return `<item><title>Hello</title><wp:post_id>${id}</wp:post_id><wp:post_type>${type}</wp:post_type><wp:post_name>${slug}</wp:post_name><wp:status>${status}</wp:status><dc:creator>alice</dc:creator><content:encoded><![CDATA[${body}]]></content:encoded>${extra}</item>`
}
function manifest(items = item(1)) { return createSourceManifest(`<rss><channel>${items}</channel></rss>`, parsed) }
function meta(k: string, v: string) { return `<wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>` }
async function put(d: string, p: string, text: string) { await mkdir(join(d, p, '..'), { recursive: true }); await writeFile(join(d, p), text) }
async function good(d: string) {
  await put(d, 'src/content/articles/hello/index.mdoc', '---\ntitle: Hello\nauthor: alice\n---\nBody')
  await put(d, 'public/_redirects', '/?p=1 /blog/hello/ 301\n')
  await put(d, 'public/redirects.json', JSON.stringify({ '/?p=1': '/blog/hello/' }))
}
const codes = (r: Awaited<ReturnType<typeof inspectMigration>>) => r.items.flatMap(i => i.findings.map(f => f.code))

describe('source inventory and migration reports', () => {
  it('inventories raw items including filtered types and preserves numeric-looking text', () => {
    const m = manifest(item(1) + item(2, 'page', 'about') + item(3, 'post', 'draft', 'draft') + item(4, 'product') + item(5, 'attachment') + item(6, 'nav_menu_item'))
    expect(m.items).toHaveLength(6); expect(new Set(m.items.map(i => i.key)).size).toBe(6)
    expect(manifest(item(9, 'post', '001', 'publish', meta('sku', '001'))).items[0].customFields?.sku).toBe('001')
  })
  it('passes verified outputs and detects changed body snapshots', async () => {
    const d = await temp(); await good(d)
    const r = await writeMigrationReports(d, manifest(), layout)
    expect(r.qualityPassed).toBe(true); expect((await validateMigrationReport(d)).passed).toBe(true)
    await put(d, 'src/content/articles/hello/index.mdoc', '---\ntitle: Hello\nauthor: alice\n---\nChanged')
    expect((await validateMigrationReport(d)).passed).toBe(false)
  })
  it('uses flat pages, skips drafts, and identifies unsupported published types', async () => {
    const d = await temp(); await good(d)
    await put(d, 'src/content/pages/about.mdoc', '---\ntitle: Hello\nauthor: alice\n---\nBody')
    await put(d, 'public/_redirects', '/?p=1 /blog/hello/ 301\n/?p=2 /about/ 301')
    await put(d, 'public/redirects.json', JSON.stringify({ '/?p=1': '/blog/hello/', '/?p=2': '/about/' }))
    const r = await inspectMigration(d, manifest(item(1) + item(2, 'page', 'about') + item(3, 'post', 'draft', 'draft') + item(4, 'product')), layout)
    expect(r.items.map(i => i.status)).toEqual(['migrated', 'migrated', 'skipped', 'unsupported']); expect(r.qualityPassed).toBe(false)
  })
  it('fails missing outputs, wrong authors, Yoast fields and unrelated redirects', async () => {
    const d = await temp(); await good(d)
    const m = manifest(item(1, 'post', 'hello', 'publish', meta('_yoast_wpseo_title', 'SEO') + meta('_yoast_wpseo_metadesc', 'Description')))
    expect(codes(await inspectMigration(d, m, layout))).toContain('seo-title-mismatch')
    await put(d, 'src/content/articles/hello/index.mdoc', '---\ntitle: Wrong\nauthor: bob\nseoTitle: Wrong\nseoDescription: Wrong\n---\n')
    await put(d, 'public/redirects.json', '{"/?p=999":"/blog/hello/"}')
    const c = codes(await inspectMigration(d, m, layout))
    expect(c).toEqual(expect.arrayContaining(['title-mismatch', 'author-mismatch', 'empty-body', 'seo-title-mismatch', 'seo-description-mismatch', 'redirect-json-mismatch']))
    await rm(join(d, 'src/content/articles/hello/index.mdoc'))
    expect(codes(await inspectMigration(d, m, layout))).toContain('missing-output')
  })
  it('detects duplicate slugs case-insensitively and duplicate IDs without sharing output', async () => {
    const d = await temp(); await good(d)
    const r = await inspectMigration(d, manifest(item(1) + item(2, 'post', 'HELLO') + item(1, 'page', 'about')), layout)
    expect(codes(r)).toEqual(expect.arrayContaining(['duplicate-slug', 'duplicate-source-id']))
    expect(r.items.every(i => !i.outputPath)).toBe(true)
  })
  it('reports source-linked shortcodes, custom fields and missing featured images', async () => {
    const d = await temp(); await good(d)
    const r = await inspectMigration(d, manifest(item(1, 'post', 'hello', 'publish', meta('color', 'red') + meta('_thumbnail_id', '99'), '[gallery ids="2,3"]')), layout)
    expect(codes(r)).toEqual(expect.arrayContaining(['unsupported-shortcode', 'unsupported-custom-field', 'missing-featured-attachment']))
    expect(r.items[0].findings.find(f => f.code === 'unsupported-shortcode')?.detail).toContain('ids="2,3"')
  })
  it('accounts for attachment bytes and never claims unused source alt preserved', async () => {
    const d = await temp(); await good(d)
    const m = manifest(item(1) + item(8, 'attachment', 'photo', 'inherit', '<wp:attachment_url>https://old.test/photo.jpg</wp:attachment_url>' + meta('_wp_attachment_image_alt', 'Source alt')))
    let r = await inspectMigration(d, m, layout)
    expect(r.media[0].findings.map(f => f.code)).toContain('missing-media')
    await put(d, 'public/media/photo.jpg', 'image bytes')
    r = await inspectMigration(d, m, layout)
    expect(r.media[0].findings.map(f => f.code)).toContain('unsupported-alt'); expect(r.qualityPassed).toBe(false)
  })
  it('fails unsafe paths and symlink escapes without reading target', async () => {
    const d = await temp(); await good(d)
    expect(codes(await inspectMigration(d, manifest(item(1, 'post', '../escape')), layout))).toContain('unsafe-path')
    const outside = await temp(); await put(outside, 'index.mdoc', 'secret')
    await rm(join(d, 'src/content/articles/hello'), { recursive: true }); await symlink(outside, join(d, 'src/content/articles/hello'))
    expect(codes(await inspectMigration(d, manifest(), layout))).toContain('unsafe-path')
  })
  it('accepts exact theme SEO mapping and verifies image alt, then detects image tampering', async () => {
    const d = await temp(); await good(d)
    const m = manifest(item(1, 'post', 'hello', 'publish', meta('_yoast_wpseo_title', 'Exact SEO') + meta('_yoast_wpseo_metadesc', 'Exact description'), '<img src="https://old.test/photo.jpg" alt="Source alt">') + item(8, 'attachment', 'photo', 'inherit', '<wp:attachment_url>https://old.test/photo.jpg</wp:attachment_url>' + meta('_wp_attachment_image_alt', 'Source alt')))
    await put(d, 'src/content/articles/hello/index.mdoc', '---\ntitle: Hello\nauthor: alice\nmetadata:\n  title: Exact SEO\n  description: Exact description\n---\n![Source alt](/media/photo.jpg)')
    await put(d, 'public/media/photo.jpg', 'original bytes')
    expect((await writeMigrationReports(d, m, layout)).qualityPassed).toBe(true)
    expect((await validateMigrationReport(d)).passed).toBe(true)
    await put(d, 'public/media/photo.jpg', 'changed bytes')
    expect((await validateMigrationReport(d)).passed).toBe(false)
  })
  it('does not execute JavaScript frontmatter', async () => {
    const d = await temp(); await good(d)
    await put(d, 'src/content/articles/hello/index.mdoc', '---js\n(globalThis.__reportExecuted = true, {title: "Hello", author: "alice"})\n---\nBody')
    expect(codes(await inspectMigration(d, manifest(), layout))).toContain('invalid-frontmatter')
    expect((globalThis as any).__reportExecuted).toBeUndefined()
  })
  it('rejects ambiguous media basenames and source image references without inventory', async () => {
    const d = await temp(); await good(d)
    const m = manifest(item(1, 'post', 'hello', 'publish', '', '<img src="https://old.test/lost.png">') + item(8, 'attachment', 'one', 'inherit', '<wp:attachment_url>https://one.test/photo.jpg</wp:attachment_url>') + item(9, 'attachment', 'two', 'inherit', '<wp:attachment_url>https://two.test/photo.jpg</wp:attachment_url>'))
    const r = await inspectMigration(d, m, layout)
    expect(codes(r)).toEqual(expect.arrayContaining(['source-image-unverified', 'missing-image-file']))
    expect(r.media.every(m => m.status === 'unsupported')).toBe(true)
  })
  it('fails closed for missing, malformed, incomplete and empty reports', async () => {
    const d = await temp(); expect((await validateMigrationReport(d)).passed).toBe(false)
    await good(d); await writeMigrationReports(d, manifest(), layout)
    const stored = JSON.parse(await readFile(join(d, 'migration-report.json'), 'utf8'))
    stored.items = []; await put(d, 'migration-report.json', JSON.stringify(stored)); expect((await validateMigrationReport(d)).passed).toBe(false)
    await put(d, 'migration-report.json', '{'); expect((await validateMigrationReport(d)).passed).toBe(false)
    await writeMigrationReports(d, manifest(), layout)
    await put(d, 'migration-report.md', ''); expect((await validateMigrationReport(d)).passed).toBe(false)
    await writeMigrationReports(d, manifest(), layout)
    const source = JSON.parse(await readFile(join(d, 'source-manifest.json'), 'utf8'))
    source.items.push(source.items[0]); await put(d, 'source-manifest.json', JSON.stringify(source)); expect((await validateMigrationReport(d)).passed).toBe(false)
    await writeMigrationReports(d, manifest(), layout)
    await put(d, 'public/_redirects', '/?p=1 /blog/hello/ 301\n# changed supporting bytes\n'); expect((await validateMigrationReport(d)).passed).toBe(false)
    await writeMigrationReports(d, manifest(''), layout); expect((await validateMigrationReport(d)).passed).toBe(false)
  })
})
