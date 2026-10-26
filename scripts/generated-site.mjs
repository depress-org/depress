import { verifyGeneratedImageEvidence } from './generated-image-evidence.mjs'
import { verifyGeneratedProseEvidence } from './generated-prose-evidence.mjs'
import assert from 'node:assert/strict'
import { validateMigrationReport, writeMigrationReports } from '../packages/wp-migrate/dist/index.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

// An actual generated build using the root npm-ci dependency graph, NOT an
// independent tarball/consumer install. No template/config edits are made here.
const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root, '.tmp'), { recursive: true })
const site = join(mkdtempSync(join(root, '.tmp/generated-site-')), 'site')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
run(process.execPath, ['packages/cli/dist/index.js', 'migrate', '--input',
  'packages/cli/src/__fixtures__/offline-export.xml', '--output', site, '--theme', 'scaffold'])
const quality = await validateMigrationReport(site)
assert(quality.passed, quality.detail)
const report = JSON.parse(readFileSync(join(site, 'migration-report.json')))
assert.equal(report.items.filter(i => i.status === 'migrated').length, 3)
assert.equal(report.items.find(i => i.id === 104).status, 'skipped')
const pkg = JSON.parse(readFileSync(join(site, 'package.json')))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')))
for (const name of Object.keys(pkg.dependencies)) {
  assert(lock.packages[`node_modules/${name}`]?.version, `Generated dependency ${name} missing from root lock`)
}
// npm ci at root installed these exact locked versions; reuse them rather than
// silently downloading newer packages from the generated caret ranges.
symlinkSync(join(root, 'node_modules'), join(site, 'node_modules'), 'dir')
run('npm', ['run', 'build', '--workspaces=false'], site)
for (const [route, title, marker] of [
  ['blog/first-post', 'First fixture post', 'First body marker alpha.'],
  ['blog/second-post', 'Second fixture post', 'Second body marker beta.'],
  ['about', 'About fixture page', 'Page body marker gamma.'],
]) {
  const html = readFileSync(join(site, 'dist/client', route, 'index.html'), 'utf8')
  assert(html.includes(title), `${route}: missing title`)
  assert(html.includes(marker), `${route}: missing rendered body`)
}
assert(!existsSync(join(site, 'dist/client/blog/secret-draft/index.html')), 'Draft leaked into public routes')
const blog = readFileSync(join(site, 'dist/client/blog/index.html'), 'utf8')
assert(!blog.includes('Secret fixture draft'), 'Draft leaked into listing')
// Actual built false-green reproductions: intentionally copy a nonpublic source
// to the public collection. Both statuses must fail fresh reports and validators,
// and the real Astro build demonstrates the leak the verifier is preventing.
const manifest = JSON.parse(readFileSync(join(site, 'source-manifest.json')))
const { verifyNestedPrivacy } = await import('./generated-nested-privacy.mjs')
await verifyNestedPrivacy(root, site, manifest, report.layout)
const { verifyPublicHtmlPrivacy } = await import('./generated-public-html-privacy.mjs')
await verifyPublicHtmlPrivacy(root, site, manifest, report.layout)
// Native #24 deliberately emits no drafts. Seed the same explicit editor-store
// fixture to retain report34's canonical-reader publication negative controls.
mkdirSync(join(site, 'src/content/articles/_drafts/secret-draft'), { recursive: true })
writeFileSync(join(site, 'src/content/articles/_drafts/secret-draft/index.mdoc'), '---\ntitle: Secret fixture draft\nslug: editor-leak\nauthor: fixture-author\n---\nDraft body marker excluded.')
const editor = readFileSync(join(site, 'src/content/articles/_drafts/secret-draft/index.mdoc'), 'utf8')
for (const status of ['draft', 'private']) {
  const slug = `secret-${status}`
  const changed = structuredClone(manifest)
  Object.assign(changed.items.find(i => i.id === 104), { status, slug })
  const path = join(site, 'src/content/articles', slug)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'index.mdoc'), editor.replace('slug: editor-leak\n', ''))
  const negative = await writeMigrationReports(site, changed, report.layout)
  assert.equal(negative.qualityPassed, false, `${status} public collection leak was accepted`)
  assert(negative.items.find(i => i.id === 104).findings.some(f => f.code === 'nonpublic-output'))
  assert.equal((await validateMigrationReport(site)).passed, false)
  run('npm', ['run', 'build', '--workspaces=false'], site)
  assert(existsSync(join(site, 'dist/client/blog', slug, 'index.html')), 'Negative control did not actually publish')
  assert(readFileSync(join(site, 'dist/client/blog/index.html'), 'utf8').includes('Secret fixture draft'))
  rmSync(path, { recursive: true })
}
// At Astro7's loader boundary, slug frontmatter overrides the generated id.
// Canonical source proof must reject a loader that admits the editor directory,
// and the real build must demonstrate why the old route-only predicate is unsafe.
const loaderPath = join(site, 'src/content.config.ts')
const safeLoader = readFileSync(loaderPath, 'utf8')
writeFileSync(loaderPath, safeLoader.replaceAll("['**/*.mdoc', '!**/_drafts/**']", "'**/*.mdoc'"))
assert.equal((await writeMigrationReports(site, manifest, report.layout)).qualityPassed, false)
assert.equal((await validateMigrationReport(site)).passed, false)
run('npm', ['run', 'build', '--workspaces=false'], site)
assert(existsSync(join(site, 'dist/client/blog/editor-leak/index.html')), 'Unsafe loader control did not publish editor slug')
assert(readFileSync(join(site, 'dist/client/blog/index.html'), 'utf8').includes('Secret fixture draft'))
writeFileSync(loaderPath, safeLoader)
// Altering the formerly safe draft route must invalidate the exception, even if
// all source/content snapshots are unchanged. No arbitrary custom reader proof.
const route = join(site, 'src/pages/blog/[slug].astro')
const safeRoute = readFileSync(route, 'utf8')
writeFileSync(route, safeRoute.replace(".filter((a) => !a.id.startsWith('_drafts/'))", ''))
assert.equal((await writeMigrationReports(site, manifest, report.layout)).qualityPassed, false)
assert.equal((await validateMigrationReport(site)).passed, false)
writeFileSync(route, safeRoute)
assert.equal((await writeMigrationReports(site, manifest, report.layout)).qualityPassed, true)
run('npm', ['run', 'build', '--workspaces=false'], site)
assert.equal((await validateMigrationReport(site)).passed, true)
for (const slug of ['secret-draft', 'secret-private', 'editor-leak']) assert(!existsSync(join(site, 'dist/client/blog', slug, 'index.html')))
assert(!readFileSync(join(site, 'dist/client/blog/index.html'), 'utf8').includes('Secret fixture draft'))
console.log('Actual built draft/private publication negatives and changed-reader rejection passed')
await verifyGeneratedImageEvidence(root, site, report.layout)
await verifyGeneratedProseEvidence(site, report.layout)
console.log(`Generated fixture build and rendered body/draft checks passed: ${site}`)

// #24: exercise actual generated build with source delimiters in uploaded text,
// not only unit-level string assertions. No remote media or executable input.
const hostile = `O'Reilly "quoted" \\ backtick\` \${literal} </title><script>text-only</script> {literal}\n---\nUnicode: мир & anchor \u2028\u2029`
const hostileXml = readFileSync(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8')
  .replace('<title>Offline Fixture</title>', () => `<title><![CDATA[${hostile}]]></title>`)
  .replace('<title>First fixture post</title>', () => `<title><![CDATA[${hostile}]]></title>`)
  .replace('First body marker alpha.</p>', 'First body marker alpha.</p>[custom][click](javascript:fixture) ![image](https://fixture.invalid/unfetched.png)[/custom]')
const hostileInput = join(site, '..', 'hostile.xml')
const hostileSite = join(site, '..', 'hostile-site')
writeFileSync(hostileInput, hostileXml)
run(process.execPath, ['packages/cli/dist/index.js', 'migrate', '--input', hostileInput, '--output', hostileSite, '--theme', 'scaffold'])
symlinkSync(join(root, 'node_modules'), join(hostileSite, 'node_modules'), 'dir')
mkdirSync(join(hostileSite, 'src/content/articles/_drafts/secret-draft'), { recursive: true })
writeFileSync(join(hostileSite, 'src/content/articles/_drafts/secret-draft/index.mdoc'), editor)
const { proveScaffoldDraftExclusion } = await import('../packages/wp-migrate/dist/report-privacy.js')
const { readFile } = await import('node:fs/promises')
const unusualProof = () => proveScaffoldDraftExclusion(p => readFile(join(hostileSite, p)), async p => join(hostileSite, p))
await unusualProof()
const unusualRoute = join(hostileSite, 'src/pages/blog/[slug].astro')
const unusualSafe = readFileSync(unusualRoute, 'utf8')
writeFileSync(unusualRoute, unusualSafe.replace(".filter((a) => !a.id.startsWith('_drafts/'))", ''))
await assert.rejects(unusualProof())
writeFileSync(unusualRoute, unusualSafe)
await unusualProof()
run('npm', ['run', 'build', '--workspaces=false'], hostileSite)
assert(!existsSync(join(hostileSite, 'dist/client/blog/secret-draft/index.html')))
assert(!readFileSync(join(hostileSite, 'dist/client/blog/index.html'), 'utf8').includes('Secret fixture draft'))
for (const dir of [site, hostileSite]) for (const name of ['source-manifest.json', 'migration-report.json', 'migration-report.md']) assert(!existsSync(join(dir, 'dist/client', name)))
const hostilePage = readFileSync(join(hostileSite, 'dist/client/blog/first-post/index.html'), 'utf8')
assert(hostilePage.includes('First body marker alpha.'), 'Hostile-title build lost body')
assert(hostilePage.includes('O&#39;Reilly') || hostilePage.includes("O'Reilly"), 'Hostile-title build lost text')
assert(!hostilePage.includes('<script>text-only</script>'), 'Uploaded title became active HTML')
assert(hostilePage.includes('&lt;script&gt;text-only&lt;/script&gt;'), 'Uploaded title was not rendered as escaped text')
assert(!/href=["']javascript:/i.test(hostilePage), 'Recovered shortcode became an active link')
assert(!/src=["']https:\/\/fixture\.invalid\/unfetched\.png/i.test(hostilePage), 'Recovered shortcode bypassed media policy')
console.log(`Generated hostile-metadata build and escaped-text checks passed: ${hostileSite}`)

// Render the AstroWind raw-HTML footer sink with the real Astro compiler. This
// isolates source/content acceptance from the bundled demo/toolchain blockers
// tracked in #26; it is not a claim that the complete default theme builds.
const { astrowindAdapter } = await import('../packages/wp-migrate/dist/themes/astrowind.js')
const sinkSite = join(site, '..', 'theme-sink-site')
mkdirSync(join(sinkSite, 'src/pages'), { recursive: true })
writeFileSync(join(sinkSite, 'src/navigation.ts'), '')
mkdirSync(join(sinkSite, 'src/utils'), { recursive: true })
writeFileSync(join(sinkSite, 'src/utils/permalinks.ts'), 'export const getPermalink = (x: string) => x; export const getAsset = (x: string) => x;')
await astrowindAdapter.patchConfig(sinkSite, { siteTitle: hostile, siteDescription: hostile, authorName: hostile, siteUrl: 'https://fixture.invalid', navItems: [] })
writeFileSync(join(sinkSite, 'package.json'), JSON.stringify({ type: 'module', private: true, scripts: { build: 'astro build' } }))
writeFileSync(join(sinkSite, 'astro.config.mjs'), "import { defineConfig } from 'astro/config'; export default defineConfig({});")
writeFileSync(join(sinkSite, 'src/pages/index.astro'), `---\nimport { footerData } from '../navigation';\n---\n<html><body><footer><Fragment set:html={footerData.footNote} /></footer></body></html>`)
symlinkSync(join(root, 'node_modules'), join(sinkSite, 'node_modules'), 'dir')
run('npm', ['run', 'build', '--workspaces=false'], sinkSite)
const sinkHtml = readFileSync(join(sinkSite, 'dist/index.html'), 'utf8')
assert(!sinkHtml.includes('<script>text-only</script>'), 'AstroWind footer activated uploaded HTML')
assert(sinkHtml.includes('&lt;script&gt;text-only&lt;/script&gt;'), 'AstroWind footer lost escaped text')
console.log('AstroWind footer sink real generated build passed (not full theme acceptance)')
const { verifyGeneratedNativeEvidence } = await import('./generated-native-evidence.mjs')
await verifyGeneratedNativeEvidence(root)
