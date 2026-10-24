import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// npm itself expands the workspace globs, including newly added workspaces.
const workspaces = JSON.parse(execFileSync('npm', ['query', '.workspace'], { encoding: 'utf8' }))
const withoutTests = new Set(['@depress-org/core', 'mamas-blog']) // types only; example built by CI
for (const workspace of workspaces) {
  const pkg = JSON.parse(readFileSync(`${workspace.path}/package.json`, 'utf8'))
  if (!pkg.scripts?.test) {
    if (!withoutTests.has(pkg.name)) throw new Error(`${pkg.name}: add a test script or justify exemption`)
    console.log(`${pkg.name}: no tests (explicit exemption; still built/typechecked)`)
    continue
  }
  if (!pkg.scripts['test:coverage']) throw new Error(`${pkg.name}: missing required test:coverage script`)
  const script = process.argv.includes('--unit') ? 'test' : 'test:coverage'
  execFileSync('npm', ['run', script, '--workspace', pkg.name], { stdio: 'inherit' })
}
