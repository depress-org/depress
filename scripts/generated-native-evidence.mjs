import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { migrateSite } from '../packages/cli/dist/services/migrate.js'
import { writeMigrationReports, validateMigrationReport } from '../packages/wp-migrate/dist/index.js'

/** Exercise the actual native service, retained raw inventory and rendered alts. */
export async function verifyGeneratedNativeEvidence(root) {
  const work = await mkdtemp(join(root, '.tmp/generated-native24-'))
  const output = join(work, 'site'), wpDir = join(work, 'wordpress'), input = join(work, 'export.xml')
  const meta = (key, value) => `<wp:postmeta><wp:meta_key>${key}</wp:meta_key><wp:meta_value>${value}</wp:meta_value></wp:postmeta>`
  const xml = (await readFile(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8'))
    .replace('<p>First body marker alpha.</p>', '<p>First body marker alpha.</p><img src="https://fixture.invalid/photo.png" alt="First context"><img src="https://fixture.invalid/photo.png" alt="Second context &amp; quote"><img src="https://fixture.invalid/photo.png" alt="">')
    .replace('<wp:post_id>101</wp:post_id>', `${meta('_yoast_wpseo_title', 'Native SEO')}${meta('_yoast_wpseo_metadesc', 'Native description')}${meta('_thumbnail_id', '8')}<category domain="category" nicename="news">News</category><wp:post_id>101</wp:post_id>`)
    .replace('</channel>', `<item><title>Photo</title><wp:post_id>8</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>photo</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://fixture.invalid/photo.png</wp:attachment_url><wp:post_mime_type>image/png</wp:post_mime_type>${meta('_wp_attachment_image_alt', 'Attachment fallback')}</item></channel>`)
  await mkdir(wpDir)
  await writeFile(input, xml)
  await writeFile(join(wpDir, 'photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVxoAAAAASUVORK5CYII=', 'base64'))
  const result = await migrateSite({ input, output, wpDir, theme: 'scaffold' })
  assert.equal(result.qualityPassed, true)
  assert.equal((await validateMigrationReport(output)).passed, true)
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'))
  const manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'))
  const path = join(output, 'src/content/articles/first-post/index.mdoc')
  const original = await readFile(path, 'utf8')
  assert(original.includes('author: "fixture-author"'))
  assert(original.includes('seoTitle: "Native SEO"'))
  assert(original.includes('category: "news"'))
  assert(original.includes('coverImage: "/media/photo.png"'))
  await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
  const build = () => execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: output, stdio: 'inherit' })
  build()
  const html = await readFile(join(output, 'dist/blog/first-post/index.html'), 'utf8')
  const actualImages = [...html.matchAll(/<img\b[^>]*src="\/media\/photo.png"[^>]*>/g)].map(m => m[0])
  // The cover is outside body evidence; the final three images are the source
  // body's exact ordered occurrences, including the empty-alt fallback.
  assert.deepEqual(actualImages.slice(-3).map(tag => /\balt="([^"]*)"/.exec(tag)?.[1]?.replace(/&(?:amp|#38|#x26);/gi, '&')), ['First context', 'Second context & quote', 'Attachment fallback'])
  assert(html.includes('First body marker alpha.'))
  for (const name of ['source-manifest.json', 'migration-report.json', 'migration-report.md']) await assert.rejects(readFile(join(output, 'dist', name)), { code: 'ENOENT' })
  await writeFile(path, original.replace('![Second context & quote]', '![Wrong alt]'))
  const negative = await writeMigrationReports(output, manifest, report.layout)
  assert.equal(negative.qualityPassed, false)
  assert.equal((await validateMigrationReport(output)).passed, false)
  assert(negative.items.find(i => i.id === 101).findings.some(f => f.code === 'inline-alt-mismatch'))
  await writeFile(path, original)
  assert.equal((await writeMigrationReports(output, manifest, report.layout)).qualityPassed, true)
  assert.equal((await validateMigrationReport(output)).passed, true)
  console.log(`Actual native metadata/ordered-alt/fallback build, negative and restored report controls PASS: ${JSON.stringify({ output, actualImages, result })}`)
}
