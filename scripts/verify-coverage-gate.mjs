import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const config = new URL('../packages/cli/vitest.config.ts', import.meta.url)
const original = readFileSync(config, 'utf8')
assert(original.includes('statements: 37,'))
try {
  writeFileSync(config, original.replace('statements: 37,', 'statements: 99,'))
  const result = spawnSync('npm', ['test'], { encoding: 'utf8' })
  const output = result.stdout + result.stderr
  assert.notEqual(result.status, 0, 'Required root command accepted impossible threshold')
  assert.match(output, /Coverage for statements .* does not meet global threshold \(99%\)/)
  console.log(output)
  console.log(`PASS: required npm test rejected raised threshold, exit ${result.status}`)
} finally {
  writeFileSync(config, original)
}
