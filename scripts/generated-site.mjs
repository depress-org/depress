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
