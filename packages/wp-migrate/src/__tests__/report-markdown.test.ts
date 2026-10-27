import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createSourceManifest, validateMigrationReport, writeMigrationReports } from '../report.js'
import { astrowindAdapter } from '../themes/astrowind.js'

// Break caught: denying the supported renderer (or trusting literal Markdown)
// must not lose real plain-.md body/image evidence or bless hidden decoys.
const trusted = resolve(import.meta.dirname, '../../bundled-themes/astrowind')
const files = ['astro.config.ts', 'package.json', 'tsconfig.json', 'src/utils/frontmatter.ts', 'src/content.config.ts', 'vendor/integration/index.ts', 'vendor/integration/utils/loadConfig.ts', 'vendor/integration/utils/configBuilder.ts']
const layout = { contentDir: 'src/data/post', fileExt: 'md', useDirectoryEntries: true }
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function put(d: string, path: string, bytes: string | Buffer) { await mkdir(join(d, path, '..'), { recursive: true }); await writeFile(join(d, path), bytes) }
async function fixture(body = 'Body', source = '<p>Body</p>') {
  await mkdir(resolve('.tmp'), { recursive: true })
  const d = await mkdtemp(resolve('.tmp/report-md-')); dirs.push(d)
  for (const path of files) await put(d, path, await readFile(join(trusted, path)))
  await astrowindAdapter.patchConfig!(d, { siteTitle: 'Fixture', siteDescription: '', siteUrl: 'https://fixture.invalid', authorName: 'alice', navItems: [], allMenus: {} })
  await put(d, 'src/data/post/hello/index.md', `---\ntitle: Hello\nauthor: alice\n---\n${body}`)
  await put(d, 'public/_redirects', '/?p=1 /blog/hello/ 301\n')
  await put(d, 'public/redirects.json', '{"/?p=1":"/blog/hello/"}')
  const manifest = createSourceManifest(`<rss><channel><item><title>Hello</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><wp:post_name>hello</wp:post_name><wp:status>publish</wp:status><dc:creator>alice</dc:creator><content:encoded><![CDATA[${source}]]></content:encoded></item></channel></rss>`, { posts: [], media: [], categories: [], tags: [], siteTitle: '', siteUrl: '' })
  return { d, manifest }
}
it.each(['Body', '**Bo**dy', '> Body', '- Body', '# Body', 'Bo&#100;y', '`Body`', '~~~text\nBody\n~~~', '<!-- ignored -->\nBody'])('proves complete visible known AstroWind .md body: %s', async body => {
  const { d, manifest } = await fixture(body)
  expect((await writeMigrationReports(d, manifest, layout)).qualityPassed).toBe(true)
  expect((await validateMigrationReport(d)).passed).toBe(true)
})
it('proves line breaks and GFM tables with the production processor', async () => {
  const { d, manifest } = await fixture('Bo  \ndy\n\n| A | B |\n| - | - |\n| C | D |', '<p>Bo<br>dy</p><table><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></table>')
  expect((await writeMigrationReports(d, manifest, layout)).qualityPassed).toBe(true)
})
it.each(['<!-- Body -->', 'Bo<!-- dy -->', '<span hidden>Body</span>', '<x-body>Body</x-body>', 'import Body from "./x"', '{% Body %}'])('does not certify hidden or custom .md contexts: %s', async body => {
  const { d, manifest } = await fixture(body)
  const r = await writeMigrationReports(d, manifest, layout)
  expect(r.items[0].findings.map(f => f.code)).toContain('body-text-mismatch')
  expect((await validateMigrationReport(d)).passed).toBe(false)
})
it.each([...files, 'astro.config.mjs', 'src/content.config.js', 'src/utils/frontmatter.js', 'vendor/integration/index.js', 'vendor/integration/utils/loadConfig.mjs', 'vendor/integration/utils/configBuilder.js', 'vendor/integration/package.json'])('rejects changed or competing renderer context and invalidates stored proof: %s', async path => {
  const { d, manifest } = await fixture()
  expect((await writeMigrationReports(d, manifest, layout)).qualityPassed).toBe(true)
  await put(d, path, '// unknown renderer context')
  expect((await validateMigrationReport(d)).passed).toBe(false)
  expect((await writeMigrationReports(d, manifest, layout)).items[0].findings.map(f => f.code)).toContain('body-text-mismatch')
})
it.each([
  ['![First & мир](/media/a.png)\n![Second](/media/a.png)', true],
  ['![Second](/media/a.png)\n![First & мир](/media/a.png)', false],
  ['<!-- ![First & мир](/media/a.png) -->\n![Second](/media/a.png)', false],
  ['`![First & мир](/media/a.png)`\n![Second](/media/a.png)', false],
  ['~~~md\n![First & мир](/media/a.png)\n~~~\n![Second](/media/a.png)', false],
  ['\\![First & мир](/media/a.png)\n![Second](/media/a.png)', false],
  ['<img src="/media/a.png" alt="First & мир">\n![Second](/media/a.png)', false],
  ['![First & мир](./a.png)\n![Second](/media/a.png)', false],
  ['![First & мир](https://cdn.pixabay.com/a.png)\n![Second](/media/a.png)', false],
] as const)('matches actual ordered repeated-image alts, never code/comment/asset decoys: %s', async (body, passed) => {
  const { d, manifest } = await fixture(body, '<img src="https://old.invalid/a.png" alt="First &amp; мир"><img src="https://old.invalid/a.png" alt="Second">')
  manifest.items.push({ key: '1:attachment:8', id: 8, type: 'attachment', status: 'inherit', slug: 'a', title: 'A', author: '', content: '' })
  manifest.media.push({ id: 8, url: 'https://old.invalid/a.png', filename: 'a.png', mimeType: 'image/png', altText: 'First & мир' })
  await put(d, 'public/media/a.png', 'nonempty fixture bytes; not decode/provenance proof')
  expect((await writeMigrationReports(d, manifest, layout)).qualityPassed).toBe(passed)
  expect((await validateMigrationReport(d)).passed).toBe(passed)
})
it('rejects .md source/report tamper and restores the exact canonical proof', async () => {
  const { d, manifest } = await fixture()
  const report = await writeMigrationReports(d, manifest, layout)
  for (const path of ['source-manifest.json', 'migration-report.json', 'migration-report.md', 'src/data/post/hello/index.md']) {
    const original = await readFile(join(d, path))
    await put(d, path, path === 'source-manifest.json' ? JSON.stringify({ ...manifest, sourceSha256: '0'.repeat(64) }) : path === 'migration-report.json' ? JSON.stringify({ ...report, artifacts: {} }) : Buffer.concat([original, Buffer.from('\nTAMPER')]))
    expect((await validateMigrationReport(d)).passed).toBe(false)
    await put(d, path, original)
    expect((await validateMigrationReport(d)).passed).toBe(true)
  }
})
it('binds exact accepted renderer bytes into canonical report replay', async () => {
  const { d, manifest } = await fixture()
  const report = await writeMigrationReports(d, manifest, layout)
  expect(report.qualityPassed).toBe(true)
  expect(report.artifacts?.['src/utils/frontmatter.ts']).toMatch(/^[a-f0-9]{64}$/)
  const path = join(d, 'astro.config.ts'), original = await readFile(path, 'utf8')
  await writeFile(path, original.replace('https://fixture.invalid', 'https://other.invalid'))
  expect((await validateMigrationReport(d)).passed).toBe(false)
  expect((await writeMigrationReports(d, manifest, layout)).qualityPassed).toBe(true)
})
