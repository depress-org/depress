import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import matter from 'gray-matter'
import { migrateSite } from '../services/migrate.js'
import { validateMigrationReport } from '@depress-org/wp-migrate'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const meta = (key: string, value: string) => `<wp:postmeta><wp:meta_key>${key}</wp:meta_key><wp:meta_value><![CDATA[${value}]]></wp:meta_value></wp:postmeta>`
async function fixture(extra = '') {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(resolve('.tmp/native-report24-')); roots.push(root)
  let xml = await readFile(resolve('src/__fixtures__/offline-export.xml'), 'utf8')
  xml = xml.replace('<p>First body marker alpha.</p>', '<p>First body marker alpha.</p><img src="https://fixture.invalid/photo.png" alt="First context"><img src="https://fixture.invalid/photo.png" alt="Second context &amp; quote"><img src="https://fixture.invalid/photo.png" alt="">')
    .replace('<wp:post_id>101</wp:post_id>', `${meta('_yoast_wpseo_title', 'SEO title')}${meta('_yoast_wpseo_metadesc', 'SEO description')}${meta('_thumbnail_id', '8')}<category domain="category" nicename="news">News</category><category domain="post_tag" nicename="tag">Tag</category>${extra}<wp:post_id>101</wp:post_id>`)
    .replace('</channel>', `<item><title>Attachment</title><wp:post_id>8</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>photo</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://fixture.invalid/photo.png</wp:attachment_url><wp:post_mime_type>image/png</wp:post_mime_type>${meta('_wp_attachment_image_alt', 'Attachment fallback')}</item></channel>`)
  await writeFile(join(root, 'export.xml'), xml)
  await mkdir(join(root, 'media'))
  await writeFile(join(root, 'media/photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVxoAAAAASUVORK5CYII=', 'base64'))
  return { root, input: join(root, 'export.xml'), wpDir: join(root, 'media'), output: join(root, 'site'), theme: 'scaffold' }
}
it('actual native service preserves metadata, ordered occurrence alts and unique empty-alt fallback with raw reports', async () => {
  const options = await fixture()
  const result = await migrateSite(options)
  const raw = await readFile(join(options.output, 'src/content/articles/first-post/index.mdoc'), 'utf8')
  const { data, content } = matter(raw)
  expect(data).toMatchObject({ author: 'fixture-author', seoTitle: 'SEO title', seoDescription: 'SEO description', category: 'news', tags: ['tag'], coverImage: '/media/photo.png', excerpt: 'First body marker alpha.' })
  expect(content).toContain('![First context](/media/photo.png)')
  expect(content).toContain('![Attachment fallback](/media/photo.png)')
  expect(content).not.toContain('![image]')
  expect(result.qualityPassed, await readFile(result.reportPath, 'utf8')).toBe(true)
  expect((await validateMigrationReport(options.output)).passed).toBe(true)
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'))
  expect(report.schemaVersion).toBe(1)
  expect(report.items.find((i: any) => i.id === 101).status).toBe('migrated')
  expect(JSON.parse(await readFile(join(options.output, 'source-manifest.json'), 'utf8')).items).toHaveLength(5)
})
it('unsupported native source remains non-green and missing local media retains explicit failed-item report', async () => {
  const options = await fixture(meta('custom_field', 'unsupported'))
  expect((await migrateSite(options)).qualityPassed).toBe(false)
  await rm(options.output, { recursive: true })
  await rm(join(options.wpDir, 'photo.png'))
  await expect(migrateSite(options)).rejects.toMatchObject({ code: 'MIGRATION_FAILED' })
  const report = JSON.parse(await readFile(join(options.output, 'migration-report.json'), 'utf8'))
  expect(report.qualityPassed).toBe(false)
  expect(report.items.find((i: any) => i.id === 101).status).toBe('failed')
})

it('ambiguous attachment basename never supplies fallback or overwrites inline choices', async () => {
  const options = await fixture()
  const xml = await readFile(options.input, 'utf8')
  await writeFile(options.input, xml.replace('</channel>', `<item><title>Ambiguous</title><wp:post_id>9</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>duplicate</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://other.invalid/photo.png</wp:attachment_url>${meta('_wp_attachment_image_alt', 'Other fallback')}</item></channel>`))
  expect((await migrateSite(options)).qualityPassed).toBe(false)
  const raw = await readFile(join(options.output, 'src/content/articles/first-post/index.mdoc'), 'utf8')
  expect(raw).toContain('![First context](/media/photo.png)')
  expect(raw).toContain('![](/media/photo.png)')
  expect(raw).not.toContain('![Attachment fallback]')
  expect(raw).not.toContain('![Other fallback]')
})

it('syntax-bearing inline alt cannot inject Markdown and stays truthfully non-green if encoded lossily', async () => {
  const options = await fixture()
  await writeFile(options.input, (await readFile(options.input, 'utf8')).replace('First context', 'First [choice] &quot; ](https://fixture.invalid/never) ![other'))
  const result = await migrateSite(options)
  expect(result.qualityPassed).toBe(false)
  const raw = await readFile(join(options.output, 'src/content/articles/first-post/index.mdoc'), 'utf8')
  expect(raw).toContain('&#91;choice&#93;')
  expect(raw).not.toContain('![other')
  expect(raw).not.toContain('shortcode:[choice]')
  expect((await validateMigrationReport(options.output)).passed).toBe(false)
})
