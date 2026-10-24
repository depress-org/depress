import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// An actual generated build using the root npm-ci dependency graph, NOT an
// independent tarball/consumer install. No template/config edits are made here.
const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root, '.tmp'), { recursive: true })
const site = join(mkdtempSync(join(root, '.tmp/generated-site-')), 'site')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
run(process.execPath, ['packages/cli/dist/index.js', 'migrate', '--input',
  'packages/cli/src/__fixtures__/offline-export.xml', '--output', site, '--theme', 'scaffold'])
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
console.log(`Generated fixture build and rendered body/draft checks passed: ${site}`)

// #24: exercise actual generated build with source delimiters in uploaded text,
// not only unit-level string assertions. No remote media or executable input.
const { writeFileSync } = await import('node:fs')
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
run('npm', ['run', 'build', '--workspaces=false'], hostileSite)
const hostilePage = readFileSync(join(hostileSite, 'dist/blog/first-post/index.html'), 'utf8')
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
