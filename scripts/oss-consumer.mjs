// #36 / PR-05: exercise real npm artifacts, never workspace links or publication.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, lstatSync, existsSync, renameSync, rmSync } from 'node:fs'
import { resolve, join, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
mkdirSync(join(root, '.tmp'), { recursive: true })
const work = mkdtempSync(join(root, '.tmp/oss-consumer-'))
// A sibling of the checkout cannot walk up into checkout/node_modules.
const isolatedParent = join(dirname(root), '.tmp')
mkdirSync(isolatedParent, { recursive: true })
const isolatedWork = mkdtempSync(join(isolatedParent, 'oss-installed-'))
const packs = join(work, 'packs'), consumer = join(isolatedWork, 'consumer'), home = join(isolatedWork, 'home')
for (const dir of [packs, consumer, home]) mkdirSync(dir)
// npm run injects checkout/ancestor/workspace bins. Only explicitly selected
// .tmp/toolchain bins are exempt: those contain Node/npm tools, not repo deps.
const toolchain = join(root, '.tmp/toolchain')
const path = (process.env.PATH ?? '').split(delimiter).filter(entry => {
  if (!entry) return false
  const absolute = resolve(entry)
  if (absolute === toolchain || absolute.startsWith(toolchain + '/')) return true
  return !/(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/.test(absolute)
}).join(delimiter)
const env = { PATH: path, HOME: home, TMPDIR: isolatedWork, ASTRO_TELEMETRY_DISABLED: '1', NO_COLOR: '1', CI: '1' }
const commands = [], inventory = []
const report = { schemaVersion: 1, node: process.version, work, isolatedWork, consumer, home, path, packagingGate: 'FAIL', consumerGate: 'NOT_RUN', releaseGate: 'NO-GO (#26 remains)', inventory, commands, noPublicationOrDeployment: true }
const save = () => writeFileSync(join(work, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`OSS consumer evidence: ${work}`)
function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  const log = join(work, label + '.log')
  writeFileSync(log, `cwd: ${cwd}\nisolatedWork: ${isolatedWork}\n` + (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? String(result.error) : ''))
  commands.push({ label, command, args, cwd, exit: result.status, signal: result.signal, log })
  save()
  console.log(`${label}: exit=${result.status} signal=${result.signal}`)
  return result
}
function mustRun(...args) {
  const result = run(...args)
  assert.equal(result.status, 0, `${args[0]} failed; see ${work}`)
  return result
}
try {
  for (const directory of ['core', 'wp-migrate', 'cli']) {
    const result = mustRun('pack-' + directory, 'npm', ['pack', './packages/' + directory, '--json', '--pack-destination', packs])
    const [pack] = JSON.parse(result.stdout)
    const archive = join(packs, pack.filename)
    const pkg = JSON.parse(mustRun('manifest-' + directory, 'tar', ['-xOf', archive, 'package/package.json']).stdout)
    const paths = pack.files.map(f => f.path)
    inventory.push({ name: pkg.name, filename: pack.filename, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), files: paths, dependencies: pkg.dependencies ?? {} })
    assert(paths.includes('LICENSE'), 'Every public package must retain the project MIT notice')
    assert.equal(mustRun('license-' + directory, 'tar', ['-xOf', archive, 'package/LICENSE']).stdout, readFileSync(join(root, 'LICENSE'), 'utf8'))
    assert(paths.every(p => !/(?:^|\/)(?:\.git|\.github|node_modules|coverage|__tests__|__fixtures__|\.tmp)(?:\/|$)|(?:\.test\.|migration-report|source-manifest)/i.test(p)), `${pkg.name}: private/development files packed`)
    if (directory === 'wp-migrate') {
      for (const asset of ['package.json', 'LICENSE.md', 'astro.config.ts', 'tailwind.config.js', 'tsconfig.json', 'src/config.yaml', 'src/pages/index.astro', 'vendor/integration/index.ts', 'public/robots.txt']) {
        assert(paths.includes('bundled-themes/astrowind/' + asset), `Supported AstroWind asset missing: ${asset}`)
      }
      assert(paths.filter(p => p.startsWith('bundled-themes/')).every(p => p.startsWith('bundled-themes/astrowind/')), 'Only the safe bundled Markdown adapter ships; Rocket is disabled (#24)')
      assert(!paths.some(p => /\.mdx$/.test(p)), 'Do not ship executable demo MDX')
      assert.equal(mustRun('theme-license', 'tar', ['-xOf', archive, 'package/bundled-themes/astrowind/LICENSE.md']).stdout, readFileSync(join(root, 'packages/wp-migrate/bundled-themes/astrowind/LICENSE.md'), 'utf8'))
    }
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (name.startsWith('@depress-org/')) assert.equal(range, '^0.1.0', 'Public 0.1.x packages must stay in the compatible minor release line')
      assert(!/^(?:workspace:|file:|link:)/.test(range), 'Workspace dependency leaked into public manifest')
    }
  }
  report.packagingGate = 'PASS'
  if (!process.argv.includes('--pack-only')) {
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'oss-consumer-36', private: true, type: 'module', dependencies: Object.fromEntries(inventory.map(p => [p.name, 'file:' + join(packs, p.filename)])) }, null, 2))
    copyFileSync(join(root, 'scripts/oss-consumer-probe.mjs'), join(consumer, 'probe.mjs'))
    mustRun('preinstall-isolation', process.execPath, ['probe.mjs', '--assert-clean'], consumer)
    mustRun('install', 'npm', ['install', '--legacy-peer-deps'], consumer)
    mustRun('installed-resolution', process.execPath, ['probe.mjs', '--assert-installed'], consumer)
    for (const pkg of inventory) assert.equal(lstatSync(join(consumer, 'node_modules', pkg.name)).isSymbolicLink(), false)
    const bin = join(consumer, 'node_modules/.bin/depress')
    mustRun('help', bin, ['--help'], consumer)
    copyFileSync(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), join(consumer, 'offline.xml'))
    copyFileSync(join(root, 'fixtures/media-archive/database.sql'), join(consumer, 'database.sql'))
    copyFileSync(join(root, 'fixtures/media-archive/photo.png'), join(consumer, 'photo.png'))
    // Extend the real local-media fixture with explicit synthetic Yoast metadata.
    const xml = readFileSync(join(root, 'fixtures/media-archive/export.xml'), 'utf8').replace('<wp:post_id>201</wp:post_id>', '<wp:post_id>201</wp:post_id><wp:postmeta><wp:meta_key>_yoast_wpseo_title</wp:meta_key><wp:meta_value>Installed fixture SEO title</wp:meta_value></wp:postmeta><wp:postmeta><wp:meta_key>_yoast_wpseo_metadesc</wp:meta_key><wp:meta_value>Installed fixture SEO description</wp:meta_value></wp:postmeta>')
    writeFileSync(join(consumer, 'media.xml'), xml)
    writeFileSync(join(consumer, 'bad.xml'), '<rss><channel>broken')
    const uploads = join(consumer, 'wordpress/wp-content/uploads/2026/10')
    mkdirSync(uploads, { recursive: true }); copyFileSync(join(consumer, 'photo.png'), join(uploads, 'photo.png'))
    mustRun('default-migrate', bin, ['migrate', '--input', 'offline.xml', '--output', 'default-site'], consumer)
    mustRun('scaffold-migrate', bin, ['migrate', '--input', 'offline.xml', '--theme', 'scaffold', '--output', 'scaffold-site'], consumer)
    mustRun('media-migrate', bin, ['migrate', '--input', 'media.xml', '--db', 'database.sql', '--wp-dir', 'wordpress', '--theme', 'scaffold', '--output', 'cli-media'], consumer)
    mustRun('library-parity-isolation-media', process.execPath, ['probe.mjs'], consumer)
    for (const site of ['scaffold-site', 'library-media']) {
      const directory = join(consumer, site)
      mustRun(site + '-install', 'npm', ['install', '--legacy-peer-deps'], directory)
      assert.equal(lstatSync(join(directory, 'node_modules')).isSymbolicLink(), false)
      mustRun(site + '-check-build', bin, ['check', '--dir', directory], consumer)
    }
    // CF14 changed the filesystem artifact layout, NOT the public permalinks.
    // Require its exact client/server contract; never search/fall back to a stale
    // dist root (and never treat client-only checks as Pages deploy approval).
    const scaffoldPublic = join(consumer, 'scaffold-site/dist/client')
    const mediaPublic = join(consumer, 'library-media/dist/client')
    const verifyRendered = () => {
      for (const site of ['scaffold-site', 'library-media']) {
        const directory = join(consumer, site)
        assert(lstatSync(join(directory, 'dist/client')).isDirectory())
        assert(lstatSync(join(directory, 'dist/server/wrangler.json')).isFile())
        assert(lstatSync(join(directory, '.wrangler/deploy/config.json')).isFile())
        for (const output of ['dist', 'dist/client', 'dist/server']) {
          for (const file of ['source-manifest.json', 'migration-report.json', 'migration-report.md']) assert.equal(existsSync(join(directory, output, file)), false, `${output}/${file} must stay private`)
        }
      }
      for (const [route, title, marker] of [
        ['blog/first-post', 'First fixture post', 'First body marker alpha.'],
        ['blog/second-post', 'Second fixture post', 'Second body marker beta.'],
        ['about', 'About fixture page', 'Page body marker gamma.'],
      ]) {
        const html = readFileSync(join(scaffoldPublic, route, 'index.html'), 'utf8')
        assert(html.includes(title) && html.includes(marker), `Scaffold generated route lost: ${route}`)
      }
      assert.equal(existsSync(join(scaffoldPublic, 'blog/secret-draft/index.html')), false)
      assert(!readFileSync(join(scaffoldPublic, 'blog/index.html'), 'utf8').includes('Secret fixture draft'))
      const redirects = readFileSync(join(scaffoldPublic, '_redirects'), 'utf8')
      for (const line of ['/2024/01/first-post/  /blog/first-post/  301', '/?p=101  /blog/first-post/  301', '/2024/01/second-post/  /blog/second-post/  301', '/2024/01/about/  /about/  301']) assert(redirects.includes(line), `Original permalink redirect lost: ${line}`)
      const html = readFileSync(join(mediaPublic, 'blog/archive-post/index.html'), 'utf8')
      assert(html.includes('<title>Installed fixture SEO title — Offline archive fixture</title>'), 'Generated title must preserve Yoast title with the scaffold site suffix')
      assert(/<meta\b[^>]*name="description"[^>]*content="Installed fixture SEO description"/.test(html))
      assert(html.includes('Archive body marker.'))
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
      for (const alt of ['Inline context one', 'Inline context two', 'Attachment fallback']) assert(images.some(image => image.includes(`alt="${alt}"`) && image.includes('/media/photo.png')))
      assert.deepEqual(readFileSync(join(mediaPublic, 'media/photo.png')), readFileSync(join(consumer, 'photo.png')))
    }
    verifyRendered()
    // Mutate the ACTUAL cold built artifacts: representative route, content,
    // metadata, media and privacy regressions must reject, then restored bytes pass.
    const negatives = [
      ['route', join(scaffoldPublic, 'blog/first-post/index.html'), null],
      ['title', join(scaffoldPublic, 'blog/first-post/index.html'), text => text.replaceAll('First fixture post', 'Lost title')],
      ['body', join(scaffoldPublic, 'blog/first-post/index.html'), text => text.replaceAll('First body marker alpha.', 'Lost body')],
      ['page', join(scaffoldPublic, 'about/index.html'), null],
      ['permalink', join(scaffoldPublic, '_redirects'), text => text.replaceAll('/blog/first-post/', '/wrong/')],
      ['seo-title', join(mediaPublic, 'blog/archive-post/index.html'), text => text.replaceAll('Installed fixture SEO title', 'Lost SEO title')],
      ['seo-description', join(mediaPublic, 'blog/archive-post/index.html'), text => text.replaceAll('Installed fixture SEO description', 'Lost description')],
      ['media-body', join(mediaPublic, 'blog/archive-post/index.html'), text => text.replaceAll('Archive body marker.', 'Lost archive body')],
      ...['Inline context one', 'Inline context two', 'Attachment fallback'].map(alt => ['alt:' + alt, join(mediaPublic, 'blog/archive-post/index.html'), text => text.replaceAll(`alt="${alt}"`, 'alt="lost"')]),
      ['media-bytes', join(mediaPublic, 'media/photo.png'), () => 'wrong media bytes'],
      ['draft-listing', join(scaffoldPublic, 'blog/index.html'), text => text + 'Secret fixture draft'],
    ]
    report.renderedNegativeControls = []
    for (const [label, file, mutate] of negatives) {
      const bytes = readFileSync(file)
      try {
        if (mutate) writeFileSync(file, mutate(bytes.toString('utf8')))
        else renameSync(file, file + '.negative-control')
        assert.throws(verifyRendered, undefined, `Rendered negative accepted: ${label}`)
      } finally {
        if (!mutate) renameSync(file + '.negative-control', file)
        else writeFileSync(file, bytes)
      }
      verifyRendered()
      report.renderedNegativeControls.push(label)
      save()
    }
    for (const [label, file] of [
      ['draft-route', join(scaffoldPublic, 'blog/secret-draft/index.html')],
      ...['source-manifest.json', 'migration-report.json', 'migration-report.md'].map(name => ['private:' + name, join(scaffoldPublic, name)]),
    ]) {
      assert(!existsSync(file))
      mkdirSync(dirname(file), { recursive: true })
      try {
        writeFileSync(file, 'private negative fixture')
        assert.throws(verifyRendered, undefined, `Private negative accepted: ${label}`)
      } finally { rmSync(file) }
      verifyRendered()
      report.renderedNegativeControls.push(label)
      save()
    }
    // Reinstall/rebuild the generated sites from their UNCHANGED locks too,
    // then repeat every positive semantic assertion on the new build bytes.
    report.generatedLockSha256 = {}
    for (const site of ['scaffold-site', 'library-media']) {
      const directory = join(consumer, site)
      const lock = readFileSync(join(directory, 'package-lock.json'))
      mustRun(site + '-same-lock-ci', 'npm', ['ci', '--legacy-peer-deps'], directory)
      mustRun(site + '-same-lock-check-build', bin, ['check', '--dir', directory], consumer)
      assert.deepEqual(readFileSync(join(directory, 'package-lock.json')), lock)
      report.generatedLockSha256[site] = createHash('sha256').update(lock).digest('hex')
      save()
    }
    verifyRendered()
    console.log(`PASS: exact CF14 client routes/permalinks/body/media/metadata/privacy; ${report.renderedNegativeControls.length} real-artifact negatives and unchanged-lock rebuilds`)
    // #26 owns the DEFAULT toolchain and complete report/build support. Run it
    // for real, report nonzero faithfully, and offer a strict release gate below.
    const defaultDirectory = join(consumer, 'default-site')
    const defaultInstall = run('default-install', 'npm', ['install', '--legacy-peer-deps'], defaultDirectory)
    const defaultCheck = run('default-check-build', bin, ['check', '--dir', defaultDirectory], consumer)
    assert.notEqual(defaultInstall.status, null, 'Default install did not finish')
    assert.notEqual(defaultCheck.status, null, 'Default check did not finish')
    report.defaultToolchain = { issue: 26, installExit: defaultInstall.status, checkBuildExit: defaultCheck.status, gate: defaultInstall.status === 0 && defaultCheck.status === 0 ? 'PASS' : 'NO-GO' }
    console.log(`Default theme toolchain: ${report.defaultToolchain.gate}; see default-install.log/default-check-build.log. Packaging success is NOT release approval.`)
    const lock = readFileSync(join(consumer, 'package-lock.json'))
    mustRun('same-lock-consumer-ci', 'npm', ['ci', '--legacy-peer-deps'], consumer)
    assert.deepEqual(readFileSync(join(consumer, 'package-lock.json')), lock)
    mustRun('reinstalled-resolution', process.execPath, ['probe.mjs', '--assert-installed'], consumer)
    mustRun('reinstalled-cli', bin, ['--help'], consumer)
    report.consumerGate = 'PASS_BOUNDED_PACKAGING_SCAFFOLD_ONLY'
    if (process.argv.includes('--require-default-build')) assert.equal(report.defaultToolchain.gate, 'PASS', 'Default build/check NO-GO (#26); packaging success is not release approval')
  }
} catch (error) {
  report.error = String(error)
  report.errorStack = error.stack
  process.exitCode = 1
} finally {
  save()
  console.log(JSON.stringify({ work, packagingGate: report.packagingGate, consumerGate: report.consumerGate, defaultToolchain: report.defaultToolchain, releaseGate: report.releaseGate, error: report.error }, null, 2))
}
