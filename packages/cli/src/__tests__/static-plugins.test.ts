import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { migrateSite } from '../services/migrate.js'
import { validateMigrationReport, writeMigrationReports } from '@depress-org/wp-migrate'

const dirs: string[] = []
const config = { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp9sAAAAASUVORK5CYII=', 'base64')
const post = (id: number, content: string, type = 'post', status = 'publish', slug = 'gallery') => `<item><title>Gallery</title><wp:post_id>${id}</wp:post_id><wp:post_type>${type}</wp:post_type><wp:post_name>${slug}</wp:post_name><wp:status>${status}</wp:status><wp:post_date>2024-01-01 00:00:00</wp:post_date><dc:creator>fixture</dc:creator><content:encoded><![CDATA[${content}]]></content:encoded></item>`
const attachment = (id: number, name: string, alt: string, status = 'inherit') => `<item><title>Asset</title><wp:post_id>${id}</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>asset-${id}</wp:post_name><wp:status>${status}</wp:status><wp:attachment_url>https://fixture.invalid/uploads/${name}.png</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attachment_image_alt</wp:meta_key><wp:meta_value>${alt}</wp:meta_value></wp:postmeta></item>`
async function fixture(body = '<p>Before мир.</p>[gallery ids="12,11"]', extra = '') {
  await mkdir(resolve('.tmp'), { recursive: true }); const dir = await mkdtemp(resolve('.tmp/plugin30-')); dirs.push(dir)
  const input = join(dir, 'export.xml'), wpDir = join(dir, 'wp')
  await mkdir(join(wpDir, 'uploads'), { recursive: true })
  await writeFile(join(wpDir, 'uploads/a.png'), png); await writeFile(join(wpDir, 'uploads/b.png'), png)
  await writeFile(input, `<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture</title><link>https://fixture.invalid</link>${post(1, body)}${attachment(11, 'a', 'First &amp; мир')}${attachment(12, 'b', 'Second')}${extra}</channel></rss>`)
  return { dir, input, wpDir, output: join(dir, 'site'), theme: 'scaffold' }
}
async function report(output: string) { return JSON.parse(await readFile(join(output, 'migration-report.json'), 'utf8')) }
function cli(args: string[]) { return spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/index.js', import.meta.url)), 'migrate', ...args], { encoding: 'utf8', timeout: 30000 }) }
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

describe('#30 actual shared service / built CLI parity', () => {
  it('P05/P11 emits ordered images and replay-valid canonical records with CLI parity', async () => {
    const f = await fixture()
    expect((await migrateSite({ ...f, staticPlugins: config })).qualityPassed).toBe(true)
    const a = await report(f.output)
    expect(a.compatibility.plugins).toEqual([{ id: 'core.static-gallery', version: '1' }])
    expect(a.compatibility.occurrences[0].outcome).toBe('verified')
    expect((await validateMigrationReport(f.output)).passed).toBe(true)
    const first = await readFile(join(f.output, 'src/content/articles/gallery/index.mdoc'), 'utf8')
    expect(first.indexOf('![Second](/media/b.png)')).toBeLessThan(first.indexOf('![First & мир](/media/a.png)'))
    const path = join(f.dir, 'plugins.json'); await writeFile(path, JSON.stringify(config))
    const output = join(f.dir, 'cli')
    const c = cli(['--input', f.input, '--wp-dir', f.wpDir, '--output', output, '--theme', 'scaffold', '--static-plugins', path])
    expect(c.stderr, c.stdout).toBe(''); expect(c.status).toBe(0)
    expect(await readFile(join(output, 'src/content/articles/gallery/index.mdoc'), 'utf8')).toBe(first)
    expect(await report(output)).toEqual(a)
    expect(await readFile(join(output, 'migration-report.md'), 'utf8')).toBe(await readFile(join(f.output, 'migration-report.md'), 'utf8'))
    // Canonical check rejects compatibility removal/forgery, image reorder,
    // commented and fenced images, missing bytes and Markdown divergence.
    const manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'))
    for (const body of [first.replace('![Second](/media/b.png)\n\n![First & мир](/media/a.png)', '![First & мир](/media/a.png)\n\n![Second](/media/b.png)'), first.replace('![Second](/media/b.png)', '<!-- ![Second](/media/b.png) -->'), first.replace('![Second](/media/b.png)', '`![Second](/media/b.png)`')]) {
      await writeFile(join(output, 'src/content/articles/gallery/index.mdoc'), body)
      expect((await writeMigrationReports(output, manifest, a.layout)).qualityPassed).toBe(false)
      expect((await validateMigrationReport(output)).passed).toBe(false)
    }
    await writeFile(join(output, 'src/content/articles/gallery/index.mdoc'), first)
    await writeMigrationReports(output, manifest, a.layout)
    const stored = await report(output); delete stored.compatibility
    await writeFile(join(output, 'migration-report.json'), JSON.stringify(stored))
    expect((await validateMigrationReport(output)).passed).toBe(false)
    await writeMigrationReports(output, manifest, a.layout)
    await writeFile(join(output, 'migration-report.md'), '# fabricated PASS')
    expect((await validateMigrationReport(output)).passed).toBe(false)
    await rm(join(output, 'public/media/b.png'))
    expect((await writeMigrationReports(output, manifest, a.layout)).qualityPassed).toBe(false)
  }, 30000)
  it.each(['[gallery ids="11,99"]', '[gallery ids="11,11"]', '[gallery ids="11" columns="2"]', '[gallery]', '[gallery ids="11"][/gallery]'])('P06 actual review and nonzero CLI: %s', async body => {
    const f = await fixture(body)
    expect((await migrateSite({ ...f, staticPlugins: config })).qualityPassed).toBe(false)
    const r = await report(f.output)
    expect(r.compatibility.diagnostics.some((d: any) => d.code.startsWith('GALLERY_'))).toBe(true)
    expect(await readFile(join(f.output, 'src/content/articles/gallery/index.mdoc'), 'utf8')).not.toContain('![')
    const path = join(f.dir, 'plugins.json'); await writeFile(path, JSON.stringify(config))
    expect(cli(['--input', f.input, '--wp-dir', f.wpDir, '--output', join(f.dir, 'cli'), '--theme', 'scaffold', '--static-plugins', path]).status).toBe(1)
  }, 30000)
  it('P06 missing or unsafe gallery-only asset is review, no network or partial image', async () => {
    const f = await fixture(); await rm(join(f.wpDir, 'uploads/b.png'))
    expect((await migrateSite({ ...f, staticPlugins: config })).qualityPassed).toBe(false)
    expect((await report(f.output)).compatibility.diagnostics[0].code).toBe('GALLERY_MEDIA_UNRESOLVED')
    expect(await readFile(join(f.output, 'src/content/articles/gallery/index.mdoc'), 'utf8')).not.toContain('![')
  }, 30000)
  it('P03/P04/P07 inventories types, draft/privacy and nested safe inner text by original ID', async () => {
    const f = await fixture('<p>Before.</p>[outer password="PRIVATE"][inner /]мир[/outer]', post(2, 'SECRET', 'post', 'private', 'private') + post(3, 'DRAFT', 'post', 'draft', 'draft') + post(4, '[cart]', 'product', 'publish', 'product') + post(5, 'Page', 'page', 'publish', 'gallery'))
    const result = await migrateSite(f); expect(result.qualityPassed).toBe(false)
    const r = await report(f.output)
    expect(r.items.map((i: any) => [i.id, i.status])).toEqual([[1, 'failed'], [11, 'skipped'], [12, 'skipped'], [2, 'skipped'], [3, 'skipped'], [4, 'unsupported'], [5, 'migrated']])
    expect(r.compatibility.occurrences.filter((o: any) => o.sourceId === 1)).toHaveLength(3)
    expect(JSON.stringify(r.compatibility)).not.toContain('PRIVATE')
    expect(await readdir(join(f.output, 'src/content/articles'))).toEqual(['gallery'])
    expect(await readFile(join(f.output, 'src/content/articles/gallery/index.mdoc'), 'utf8')).toContain('мир')
  }, 30000)
  it.each(['private', 'draft'].flatMap(status => [
    { status, native: false }, { status, native: true },
  ]))('never publishes $status attachment bytes (native reference: $native) and replay refuses forged public media', async ({ status, native }) => {
    const f = await fixture('[gallery ids="11,12"]' + (native ? '<img src="https://fixture.invalid/uploads/a.png" alt="Secret">' : ''))
    await writeFile(join(f.wpDir, 'uploads/b.png'), Buffer.concat([png, Buffer.from('public-image')]))
    const xml = await readFile(f.input, 'utf8')
    await writeFile(f.input, xml.replace(attachment(11, 'a', 'First &amp; мир'), attachment(11, 'a', 'First &amp; мир', status)))
    expect((await migrateSite({ ...f, staticPlugins: config })).qualityPassed).toBe(false)
    await expect(readFile(join(f.output, 'public/media/a.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    // Inspect every public file, not just the expected basename. The fixture's
    // second image is distinct so byte exclusion is meaningful.
    const publicFiles = await readdir(join(f.output, 'public'), { recursive: true, withFileTypes: true })
    for (const file of publicFiles.filter(f => f.isFile())) {
      expect((await readFile(join(file.parentPath, file.name))).equals(png)).toBe(false)
    }
    const r = await report(f.output)
    expect(r.compatibility.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GALLERY_MEDIA_UNRESOLVED' })]))
    expect(r.media.find((m: any) => m.id === 11).status).not.toBe('migrated')
    const manifest = JSON.parse(await readFile(join(f.output, 'source-manifest.json'), 'utf8'))
    await writeFile(join(f.output, 'public/media/a.png'), png)
    const replay = await writeMigrationReports(f.output, manifest, r.layout)
    expect(replay.qualityPassed).toBe(false)
    expect(replay.media.find(m => m.id === 11)?.findings.map(f => f.code)).toContain('non-public-media-output')
    expect(replay.compatibility.occurrences.every(o => o.outcome !== 'verified')).toBe(true)
    expect((await validateMigrationReport(f.output)).passed).toBe(false)
  }, 30000)
  it('dynamic WooCommerce cart block is inventoried and never green', async () => {
    const f = await fixture('<p>Before.</p><!-- wp:woocommerce/cart /-->')
    await writeFile(f.input, (await readFile(f.input, 'utf8')).replace(attachment(11, 'a', 'First &amp; мир'), '').replace(attachment(12, 'b', 'Second'), ''))
    const result = await migrateSite(f)
    expect(result.qualityPassed).toBe(false)
    const r = await report(f.output)
    expect(r.compatibility.sourceFeatures).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 1, kind: 'block' })]))
    expect(r.compatibility.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 1, code: 'WP_DYNAMIC_UNSUPPORTED', classification: 'unsupported-dynamic' })]))
    expect((await validateMigrationReport(f.output)).passed).toBe(false)
  }, 30000)
  it.each(['DEPRESSGALLERY0', '[[gallery ids="11"]]', '[gallery ids="11]'])('token pipeline preserves safe literal text: %s', async text => {
    const f = await fixture(`<p>${text}</p>`)
    await writeFile(f.input, (await readFile(f.input, 'utf8')).replace(attachment(11, 'a', 'First &amp; мир'), '').replace(attachment(12, 'b', 'Second'), ''))
    await migrateSite({ ...f, staticPlugins: config })
    const body = await readFile(join(f.output, 'src/content/articles/gallery/index.mdoc'), 'utf8')
    expect(body.replace(/\\([\[\]])/g, '$1')).toContain(text)
    expect(body).not.toContain('gallery: review manually')
    expect(body).not.toContain('![')
    const r = await report(f.output)
    if (text === '[gallery ids="11]') {
      expect(r.qualityPassed).toBe(false)
      expect(r.compatibility.occurrences).toEqual([expect.objectContaining({ tag: 'gallery', classification: 'manual-review', outcome: 'not-preserved', start: 3, end: 20 })])
      expect(r.compatibility.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WP_SHORTCODE_UNRESOLVED' })]))
      const manifest = JSON.parse(await readFile(join(f.output, 'source-manifest.json'), 'utf8'))
      expect((await writeMigrationReports(f.output, manifest, r.layout)).compatibility).toEqual(r.compatibility)
    } else {
      expect(r.compatibility.occurrences).toEqual([])
      expect(r.qualityPassed).toBe(true)
      expect((await validateMigrationReport(f.output)).passed).toBe(true)
    }
  }, 30000)
  it('P05 plugin off leaves explicit review and preserves versions/coverage', async () => {
    const f = await fixture(); expect((await migrateSite(f)).qualityPassed).toBe(false)
    const r = await report(f.output); expect(r.compatibility.plugins).toEqual([])
    expect(r.compatibility.diagnostics[0].code).toBe('WP_SHORTCODE_UNRESOLVED')
    expect(r.compatibility.coverage.pluginTables).toBe('not-assessed')
  }, 30000)
  it.each([{ api: 'v2', plugins: [] }, { ...config, plugins: [{ id: 'file:///PRIVATE.js', version: '1', options: {} }] }, { ...config, plugins: [...config.plugins, ...config.plugins] }])('P08 service/CLI config fails with report before content output', async value => {
    const f = await fixture()
    await expect(migrateSite({ ...f, staticPlugins: value })).rejects.toMatchObject({ code: 'PLUGIN_CONFIG_INVALID' })
    const r = await report(f.output); expect(r.compatibility.diagnostics[0].code).toBe('PLUGIN_CONFIG_INVALID')
    expect(JSON.stringify(r)).not.toContain('PRIVATE.js')
    expect(await readdir(f.output)).toEqual(expect.arrayContaining(['source-manifest.json', 'migration-report.json', 'migration-report.md']))
    expect(await readdir(f.output)).not.toContain('src')
    const path = join(f.dir, 'plugins.json'); await writeFile(path, JSON.stringify(value))
    const output = join(f.dir, 'cli')
    expect(cli(['--input', f.input, '--output', output, '--theme', 'scaffold', '--static-plugins', path]).status).toBe(1)
    expect((await report(output)).compatibility).toEqual(r.compatibility)
  }, 30000)
  it('P09 diagnostic/input budgets fail the service and real CLI with readable canonical report', async () => {
    for (const body of ['[unknown]'.repeat(257), 'a'.repeat(1_048_577)]) {
      const f = await fixture(body)
      await expect(migrateSite({ ...f, staticPlugins: config })).rejects.toThrow()
      const r = await report(f.output)
      expect(r.qualityPassed).toBe(false)
      expect(r.compatibility.diagnostics).toEqual([expect.objectContaining({ code: 'PLUGIN_BUDGET_EXCEEDED' })])
      expect((await validateMigrationReport(f.output)).passed).toBe(false)
      const output = join(f.dir, 'cli')
      expect(cli(['--input', f.input, '--wp-dir', f.wpDir, '--output', output, '--theme', 'scaffold']).status).toBe(1)
      expect((await report(output)).compatibility.diagnostics[0].code).toBe('PLUGIN_BUDGET_EXCEEDED')
    }
  }, 30000)
  it('P08 malformed JSON config fails through canonical service report without source value disclosure', async () => {
    const f = await fixture(), path = join(f.dir, 'plugins.json'), output = join(f.dir, 'cli')
    await writeFile(path, '{PRIVATE')
    expect(cli(['--input', f.input, '--output', output, '--theme', 'scaffold', '--static-plugins', path]).status).toBe(1)
    const r = await report(output)
    expect(r.compatibility.diagnostics[0].code).toBe('PLUGIN_CONFIG_INVALID')
    expect(JSON.stringify(r.compatibility)).not.toContain('PRIVATE')
  }, 30000)
  it('P03 duplicate source ID fails before content and retains item inventory', async () => {
    const f = await fixture('', post(1, 'Other', 'page', 'publish', 'other'))
    await expect(migrateSite(f)).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE_ID' })
    const r = await report(f.output); expect(r.items.filter((i: any) => i.id === 1)).toHaveLength(2)
    expect(r.items.filter((i: any) => i.id === 1).every((i: any) => i.findings.some((f: any) => f.code === 'duplicate-source-id'))).toBe(true)
    expect(await readdir(f.output)).not.toContain('src')
  }, 30000)
})
