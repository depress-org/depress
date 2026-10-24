import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { migrateSite } from '../packages/cli/dist/services/migrate.js'
import { validateMigrationReport, writeMigrationReports } from '../packages/wp-migrate/dist/index.js'

/** #30 engineering fixture only. Reuses root dependencies; not #19/P12's
 * independent cold consumer/theme acceptance or evidence of customer demand. */
export async function verifyGeneratedStaticPluginEvidence(root) {
  const dir = await mkdtemp(join(root, '.tmp/generated-plugin30-'))
  const input = join(dir, 'export.xml'), output = join(dir, 'site'), wpDir = join(dir, 'wp')
  const config = { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] }
  const configPath = join(dir, 'plugins.json')
  await writeFile(configPath, JSON.stringify(config))
  await mkdir(join(wpDir, 'uploads'), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVxoAAAAASUVORK5CYII=', 'base64')
  await writeFile(join(wpDir, 'uploads/a.png'), png); await writeFile(join(wpDir, 'uploads/b.png'), png)
  const attachment = (id, name, alt) => `<item><title>Asset</title><wp:post_id>${id}</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>asset-${id}</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://fixture.invalid/uploads/${name}.png</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attachment_image_alt</wp:meta_key><wp:meta_value>${alt}</wp:meta_value></wp:postmeta></item>`
  const base = await readFile(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8')
  const xml = base.replace('First body marker alpha.</p>', 'First body marker alpha.</p>[gallery ids="812,811"]')
    .replace('</channel>', attachment(811, 'a', 'First &amp; мир') + attachment(812, 'b', 'Second') + '</channel>')
  await writeFile(input, xml)
  const migrated = await migrateSite({ input, output, wpDir, theme: 'scaffold', staticPlugins: config })
  assert.equal(migrated.qualityPassed, true)
  const machine = JSON.parse(await readFile(join(output, 'migration-report.json'), 'utf8'))
  assert.equal(machine.compatibility.occurrences[0].outcome, 'verified')
  assert.equal((await validateMigrationReport(output)).passed, true)
  const cliOutput = join(dir, 'cli')
  execFileSync(process.execPath, [join(root, 'packages/cli/dist/index.js'), 'migrate', '--input', input, '--output', cliOutput, '--wp-dir', wpDir, '--theme', 'scaffold', '--static-plugins', configPath], { cwd: root, stdio: 'inherit' })
  assert.deepEqual(JSON.parse(await readFile(join(cliOutput, 'migration-report.json'), 'utf8')), machine)
  const bodyPath = 'src/content/articles/first-post/index.mdoc'
  const original = await readFile(join(output, bodyPath), 'utf8')
  assert.equal(await readFile(join(cliOutput, bodyPath), 'utf8'), original)
  await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
  const build = () => execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: output, stdio: 'inherit', timeout: 120000 })
  build()
  const html = await readFile(join(output, 'dist/blog/first-post/index.html'), 'utf8')
  const article = html.slice(html.indexOf('<article'))
  assert.match(article, /<img[^>]*src="\/media\/b.png"[^>]*alt="Second"/)
  assert.match(article, /<img[^>]*src="\/media\/a.png"[^>]*alt="First (?:&amp;|&#38;) мир"/)
  assert(article.indexOf('src="/media/b.png"') < article.indexOf('src="/media/a.png"'))
  assert.deepEqual(await readFile(join(output, 'dist/media/a.png')), png)
  assert.deepEqual(await readFile(join(output, 'dist/media/b.png')), png)
  const manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'))
  for (const replacement of ['<!-- ![Second](/media/b.png) -->', '`![Second](/media/b.png)`']) {
    await writeFile(join(output, bodyPath), original.replace('![Second](/media/b.png)', replacement))
    const negative = await writeMigrationReports(output, manifest, machine.layout)
    assert.equal(negative.qualityPassed, false)
    assert.equal(negative.compatibility.occurrences[0].outcome, 'not-preserved')
    assert.equal((await validateMigrationReport(output)).passed, false)
    build()
    const changed = await readFile(join(output, 'dist/blog/first-post/index.html'), 'utf8')
    assert(!/<img[^>]+src="\/media\/b.png"/.test(changed), 'negative control still renders gallery image')
  }
  await writeFile(join(output, bodyPath), original)
  assert.equal((await writeMigrationReports(output, manifest, machine.layout)).qualityPassed, true)
  build()
  const disabled = spawnSync(process.execPath, [join(root, 'packages/cli/dist/index.js'), 'migrate', '--input', input, '--output', join(dir, 'disabled'), '--wp-dir', wpDir, '--theme', 'scaffold'], { cwd: root, encoding: 'utf8' })
  assert.equal(disabled.status, 1)
  assert.equal(JSON.parse(await readFile(join(dir, 'disabled/migration-report.json'), 'utf8')).qualityPassed, false)
  console.log(`#30 actual generated gallery ordered images/alts/bytes, service/CLI parity, disabled review and rendered negative controls PASS: ${output}`)
}
