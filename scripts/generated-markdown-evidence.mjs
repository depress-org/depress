import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import TurndownService from 'turndown'
import { migrateSite } from '../packages/cli/dist/services/migrate.js'
import { inspectMigration, writeMigrationReports, validateMigrationReport } from '../packages/wp-migrate/dist/index.js'
import { verifyKeystaticConsumer } from './keystatic-consumer.mjs'

// Full actual AstroWind .md renderer controls. Each site owns dependencies and
// cache; this is serialized with the other generated-site builds. The optional
// evidence root lets independent acceptance run outside checkout ancestry.
export async function verifyGeneratedMarkdownEvidence(root) {
  const parent = resolve(process.env.DEPRESS_MD_EVIDENCE_ROOT || join(root, '.tmp'))
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'generated-markdown-'))
  const site = join(dir, 'site'), wpDir = join(dir, 'wp'), input = join(dir, 'input.xml')
  await mkdir(join(wpDir, 'uploads'), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVxoAAAAASUVORK5CYII=', 'base64')
  const assets = { a: Buffer.concat([png, Buffer.from('source-A')]), b: Buffer.concat([png, Buffer.from('source-B')]) }
  for (const [name, bytes] of Object.entries(assets)) await writeFile(join(wpDir, `uploads/${name}.png`), bytes)
  const attachment = (id, name, alt) => `<item><title>Asset</title><wp:post_id>${id}</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>asset-${id}</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://fixture.invalid/uploads/${name}.png</wp:attachment_url><wp:postmeta><wp:meta_key>_wp_attachment_image_alt</wp:meta_key><wp:meta_value>${alt}</wp:meta_value></wp:postmeta></item>`
  const xml = (await readFile(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8'))
    .replace('First body marker alpha.</p>', 'First body marker alpha.</p>[gallery ids="812,811"]')
    .replace('Second body marker beta.</p>', 'Second body marker beta.</p>[gallery ids="missing"]')
    .replace('</channel>', attachment(811, 'a', 'First &amp; мир') + attachment(812, 'b', 'Second') + '</channel>')
  await writeFile(input, xml)
  const config = { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] }
  const configPath = join(dir, 'plugins.json'); await writeFile(configPath, JSON.stringify(config))
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('MD evidence source-origin fetch denied') }
  await assert.rejects(fetch('https://fixture.invalid/probe'), /source-origin fetch denied/)
  let result
  try { result = await migrateSite({ input, output: site, wpDir, theme: 'astrowind', staticPlugins: config }) }
  finally { globalThis.fetch = savedFetch }
  assert.equal(result.qualityPassed, false) // unsupported page/bad neighbor/public inventory remain
  const report = JSON.parse(await readFile(join(site, 'migration-report.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(site, 'source-manifest.json'), 'utf8'))
  const first = report.items.find(i => i.id === 101), original = await readFile(join(site, first.outputPath), 'utf8')
  assert.equal(first.status, 'migrated', 'Supported .md body/gallery must prove preservation')
  assert(report.compatibility.occurrences.filter(o => o.sourceId === 101).every(o => o.outcome === 'verified'))
  assert.equal(report.items.find(i => i.id === 102).status, 'failed')
  assert(report.items.find(i => i.id === 103).findings.some(f => f.code === 'unsupported-page'))
  assert(report.items.flatMap(i => i.findings).some(f => f.code === 'untracked-public-output'))
  const command = (name, args, cwd = site, expected = 0) => {
    try {
      const out = execFileSync('npm', args, { cwd, encoding: 'utf8', timeout: 480000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } })
      return writeFile(join(dir, `${name}.log`), out).then(() => assert.equal(expected, 0))
    } catch (error) {
      return writeFile(join(dir, `${name}.log`), (error.stdout || '') + (error.stderr || '')).then(() => assert.equal(error.status, expected, name))
    }
  }
  const cli = join(dir, 'cli')
  let cliExit = 0
  try { execFileSync(process.execPath, [join(root, 'packages/cli/dist/index.js'), 'migrate', '--input', input, '--output', cli, '--wp-dir', wpDir, '--theme', 'astrowind', '--static-plugins', configPath], { encoding: 'utf8', timeout: 120000 }) }
  catch (error) { cliExit = error.status; await writeFile(join(dir, 'cli.log'), (error.stdout || '') + (error.stderr || '')) }
  assert.equal(cliExit, 1)
  assert.deepEqual(JSON.parse(await readFile(join(cli, 'migration-report.json'), 'utf8')), report)
  assert.equal(await readFile(join(cli, 'migration-report.md'), 'utf8'), await readFile(join(site, 'migration-report.md'), 'utf8'))
  await command('install', ['install', '--legacy-peer-deps', '--workspaces=false', '--no-audit', '--no-fund'])
  assert.equal((await lstat(join(site, 'node_modules'))).isSymbolicLink(), false)
  const req = createRequire(join(site, 'package.json'))
  assert((await realpath(req.resolve('astro'))).startsWith(site + '/node_modules/'))
  await command('build', ['run', 'build', '--workspaces=false'])
  await verifyKeystaticConsumer(site, 'astrowind')
  const measured = []
  const measure = async () => {
    const html = await readFile(join(site, 'dist/client/first-post/index.html'), 'utf8')
    const bodies = []
    const parser = new TurndownService()
    parser.addRule('article-body', { filter: node => node.nodeName === 'DIV' && node.getAttribute('class')?.split(/\s+/).includes('prose'), replacement: (content, node) => {
      bodies.push({ text: node.textContent.trim(), images: Array.from(node.querySelectorAll('img')).map(img => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' })) }); return content
    } })
    parser.turndown(html)
    assert.equal(bodies.length, 1, 'Measure actual div.prose, not an excerpt/title')
    for (const [name, bytes] of Object.entries(assets)) {
      assert((await readFile(join(site, `public/media/${name}.png`))).equals(bytes))
      assert((await readFile(join(site, `dist/client/media/${name}.png`))).equals(bytes))
    }
    return bodies[0]
  }
  const expectedImages = [{ src: '/media/b.png', alt: 'Second' }, { src: '/media/a.png', alt: 'First & мир' }]
  const positive = await measure(); assert.equal(positive.text, 'First body marker alpha.'); assert.deepEqual(positive.images, expectedImages)
  const lock = await readFile(join(site, 'package-lock.json'))
  await command('same-lock-ci', ['ci', '--legacy-peer-deps', '--workspaces=false', '--no-audit', '--no-fund'])
  await command('same-lock-build', ['run', 'build', '--workspaces=false'])
  assert.deepEqual(await readFile(join(site, 'package-lock.json')), lock)
  assert.deepEqual(await measure(), positive); await verifyKeystaticConsumer(site, 'astrowind')
  const bodyAt = original.indexOf('\n---', 4) + 4, prefix = original.slice(0, bodyAt)
  const gallery = '![Second](/media/b.png)\n![First & мир](/media/a.png)'
  try {
    for (const [name, body, passed, images] of [
      ['plain', `First body marker alpha.\n\n${gallery}`, true, expectedImages],
      ['formatted', `**First** body marker alpha.\n\n${gallery}`, true, expectedImages],
      ['code-prose', '`First body marker alpha.`\n\n' + gallery, true, expectedImages],
      ['fenced-prose', '~~~text\nFirst body marker alpha.\n~~~\n\n' + gallery, true, expectedImages],
      ['comment-body', '<!-- First body marker alpha. -->\n\n' + gallery, false, expectedImages],
      ['part-comment', 'First body <!-- marker alpha. -->\n\n' + gallery, false, expectedImages],
      ['comment-images', `First body marker alpha.\n\n<!-- ${gallery} -->`, false, []],
      ['inline-image-code', 'First body marker alpha.\n\n`' + gallery.replace('\n', ' ') + '`', false, []],
      ['fenced-image-code', 'First body marker alpha.\n\n~~~md\n' + gallery + '\n~~~', false, []],
      ['escaped-images', 'First body marker alpha.\n\n\\![Second](/media/b.png)\n\\![First & мир](/media/a.png)', false, []],
      ['forged-order', 'First body marker alpha.\n\n![First & мир](/media/a.png)\n![Second](/media/b.png)', false, [...expectedImages].reverse()],
      ['forged-alt', 'First body marker alpha.\n\n![Forged](/media/b.png)\n![First & мир](/media/a.png)', false, [{ src: '/media/b.png', alt: 'Forged' }, expectedImages[1]]],
    ]) {
      await writeFile(join(site, first.outputPath), prefix + '\n' + body + '\n')
      const current = await writeMigrationReports(site, manifest, report.layout)
      assert.equal(current.items.find(i => i.id === 101).status, passed ? 'migrated' : 'failed', name)
      assert(current.compatibility.occurrences.filter(o => o.sourceId === 101).every(o => o.outcome === (passed ? 'verified' : 'not-preserved')), name)
      assert.deepEqual(await inspectMigration(site, manifest, report.layout), current)
      const validation = await validateMigrationReport(site)
      assert.equal(validation.passed, false); assert.match(validation.detail, /contains failed or unsupported/)
      await writeFile(join(dir, `${name}-source.md`), prefix + '\n' + body + '\n')
      await writeFile(join(dir, `${name}-report.json`), JSON.stringify(current, null, 2))
      await writeFile(join(dir, `${name}-report.md`), await readFile(join(site, 'migration-report.md')))
      await command(name, ['run', 'build', '--workspaces=false'])
      await writeFile(join(dir, `${name}-rendered.html`), await readFile(join(site, 'dist/client/first-post/index.html')))
      const actual = await measure(); assert.deepEqual(actual.images, images, name)
      assert.equal(actual.text === 'First body marker alpha.' && JSON.stringify(actual.images) === JSON.stringify(expectedImages), passed, name)
      measured.push({ name, passed, actual, findings: current.items.find(i => i.id === 101).findings })
    }
  } finally { await writeFile(join(site, first.outputPath), original); await writeMigrationReports(site, manifest, report.layout) }
  await command('restored-build', ['run', 'build', '--workspaces=false'])
  assert.deepEqual(await measure(), positive)
  assert.deepEqual(await inspectMigration(site, manifest, report.layout), report)
  await writeFile(join(dir, 'measured.json'), JSON.stringify({ site, node: process.version, positive, measured, lockSha256: createHash('sha256').update(lock).digest('hex'), sourceHashes: Object.fromEntries(Object.entries(assets).map(([n,b]) => [n, createHash('sha256').update(b).digest('hex')])), fullAllThemeP12Passed: false }, null, 2))
  console.log('Actual supported AstroWind Markdown body/image/canonical controls: ' + JSON.stringify({ dir, count: measured.length, fullAllThemeP12Passed: false }))
  return dir
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyGeneratedMarkdownEvidence(resolve(import.meta.dirname, '..'))
