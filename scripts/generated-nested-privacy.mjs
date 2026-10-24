import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateMigrationReport, writeMigrationReports } from '../packages/wp-migrate/dist/index.js'

// Actual loader/build/report controls. No dependence on source slug, normalized
// Astro IDs or the historical top-level editor filename. Called by required CI.
export async function verifyNestedPrivacy(root, site, manifest, layout) {
  const loader = join(site, 'src/content.config.ts')
  const safe = readFileSync(loader, 'utf8')
  const unsafe = safe.replaceAll("['**/*.mdoc', '!**/_drafts/**']", "'**/*.mdoc'")
  assert.notEqual(unsafe, safe)
  const tokens = ['Secret fixture draft', 'Draft body marker excluded.', 'Nested private page 26', 'Nested page body 26.']
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const build = () => execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'], {
    cwd: site, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' },
  })
  const check = async (source, passed, label) => {
    const report = await writeMigrationReports(site, source, layout)
    const validation = await validateMigrationReport(site)
    console.log(JSON.stringify({ control: label, qualityPassed: report.qualityPassed, validatorPassed: validation.passed, findings: report.items.filter(i => i.findings.length).map(i => ({ id: i.id, findings: i.findings })) }))
    assert.equal(report.qualityPassed, passed, label + ': report')
    assert.equal(validation.passed, passed, label + ': validator')
  }
  const clean = () => {
    for (const collection of ['articles', 'pages']) rmSync(join(site, 'src/content', collection, 'section'), { recursive: true, force: true })
  }
  const seed = (editor) => {
    for (const [collection, title, body, slug] of [['articles', tokens[0], tokens[1], 'nested-article-26'], ['pages', tokens[2], tokens[3], 'nested-page-26']]) {
      const path = join(site, 'src/content', collection, editor ? 'section/_drafts/deeper/unrelated' : 'section/public/deeper/unrelated')
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'index.mdoc'), `---\ntitle: ${title}\nslug: ${slug}\nauthor: fixture-author\ncategory: private-nested-26\n---\n${body}\n`)
    }
  }
  try {
    seed(true)
    await check(manifest, true, 'nested canonical safe')
    build()
    let scanned = 0
    for (const file of walk(join(site, 'dist'))) {
      const bytes = readFileSync(file)
      for (const token of tokens) assert(!bytes.includes(Buffer.from(token)), `Private bytes: ${file}`)
      scanned++
    }
    assert(!existsSync(join(site, 'dist/client/category/private-nested-26/index.html')))
    console.log(JSON.stringify({ control: 'nested safe client+server scan', files: scanned, privateTokens: 0 }))
    for (const status of ['draft', 'private']) {
      const source = structuredClone(manifest)
      const known = source.items.find(i => i.id === 104)
      known.status = status
      source.items.push({ ...known, key: `nested-page:${status}:904`, id: 904, type: 'page', slug: 'unrelated-source-page', title: tokens[2], content: `<p>${tokens[3]}</p>` })
      writeFileSync(loader, unsafe)
      // Build BEFORE assertions so a RED report still retains real leak evidence.
      build()
      assert(readFileSync(join(site, 'dist/client/blog/nested-article-26/index.html'), 'utf8').includes(tokens[1]))
      assert(readFileSync(join(site, 'dist/client/nested-page-26/index.html'), 'utf8').includes(tokens[3]))
      assert(readFileSync(join(site, 'dist/client/blog/index.html'), 'utf8').includes(tokens[0]))
      console.log(JSON.stringify({ control: `nested unsafe ${status} actual article+page+listing leak`, knownSource: 104, pageSource: 904, physicalPath: 'section/_drafts/deeper/unrelated', published: true }))
      await check(source, false, `nested unsafe ${status}`)
      writeFileSync(loader, safe)
      await check(source, true, `nested restored ${status}`)
      clean(); seed(false)
      build()
      assert(readFileSync(join(site, 'dist/client/blog/nested-article-26/index.html'), 'utf8').includes(tokens[1]))
      assert(readFileSync(join(site, 'dist/client/nested-page-26/index.html'), 'utf8').includes(tokens[3]))
      await check(source, false, `renamed public-copy ${status}`)
      clean(); seed(true)
    }
    // Unknown-source public content is not silently treated as safe either.
    clean(); seed(false)
    await check(manifest, false, 'unknown public copy')
    clean()
    const staticCopy = join(site, 'public/renamed/deeper/index.html')
    mkdirSync(join(site, 'public/renamed/deeper'), { recursive: true })
    writeFileSync(staticCopy, `<h1>${tokens[0]}</h1><p>${tokens[1]}</p>`)
    await check(manifest, false, 'renamed static public copy')
    rmSync(join(site, 'public/renamed'), { recursive: true })
    seed(true)
    await check(manifest, true, 'final restored nested safe')
    build()
    for (const file of walk(join(site, 'dist'))) for (const token of tokens) assert(!readFileSync(file).includes(Buffer.from(token)), `Restored private bytes: ${file}`)
    console.log('Nested privacy actual-build/report/validator draft+private article+page/public-copy RED-to-GREEN controls PASS')
  } finally {
    writeFileSync(loader, safe)
    clean()
    await writeMigrationReports(site, manifest, layout)
  }
}
