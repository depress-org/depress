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
  const html = readFileSync(join(site, 'dist', route, 'index.html'), 'utf8')
  assert(html.includes(title), `${route}: missing title`)
  assert(html.includes(marker), `${route}: missing rendered body`)
}
assert(!existsSync(join(site, 'dist/blog/secret-draft/index.html')), 'Draft leaked into public routes')
const blog = readFileSync(join(site, 'dist/blog/index.html'), 'utf8')
assert(!blog.includes('Secret fixture draft'), 'Draft leaked into listing')
// Actual built false-green reproductions: intentionally copy a nonpublic source
// to the public collection. Both statuses must fail fresh reports and validators,
// and the real Astro build demonstrates the leak the verifier is preventing.
const manifest = JSON.parse(readFileSync(join(site, 'source-manifest.json')))
const editor = readFileSync(join(site, 'src/content/articles/_drafts/secret-draft/index.mdoc'), 'utf8')
for (const status of ['draft', 'private']) {
  const slug = `secret-${status}`
  const changed = structuredClone(manifest)
  Object.assign(changed.items.find(i => i.id === 104), { status, slug })
  const path = join(site, 'src/content/articles', slug)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'index.mdoc'), editor)
  const negative = await writeMigrationReports(site, changed, report.layout)
  assert.equal(negative.qualityPassed, false, `${status} public collection leak was accepted`)
  assert(negative.items.find(i => i.id === 104).findings.some(f => f.code === 'nonpublic-output'))
  assert.equal((await validateMigrationReport(site)).passed, false)
  run('npm', ['run', 'build', '--workspaces=false'], site)
  assert(existsSync(join(site, 'dist/blog', slug, 'index.html')), 'Negative control did not actually publish')
  assert(readFileSync(join(site, 'dist/blog/index.html'), 'utf8').includes('Secret fixture draft'))
  rmSync(path, { recursive: true })
}
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
for (const slug of ['secret-draft', 'secret-private']) assert(!existsSync(join(site, 'dist/blog', slug, 'index.html')))
assert(!readFileSync(join(site, 'dist/blog/index.html'), 'utf8').includes('Secret fixture draft'))
console.log('Actual built draft/private publication negatives and changed-reader rejection passed')
await verifyGeneratedImageEvidence(root, site, report.layout)
await verifyGeneratedProseEvidence(site, report.layout)
console.log(`Generated fixture build and rendered body/draft checks passed: ${site}`)
