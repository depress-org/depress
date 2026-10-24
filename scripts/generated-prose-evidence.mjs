import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import TurndownService from 'turndown'
import { writeMigrationReports, validateMigrationReport } from '../packages/wp-migrate/dist/index.js'

// Inspect ONLY the canonical body article, never the outer title/excerpt article.
function renderedBody(html) {
  const bodies = []
  const parser = new TurndownService()
  parser.addRule('capture-body', {
    filter: 'article',
    replacement: (content, node) => {
      for (const body of node.querySelectorAll('.prose > article')) {
        bodies.push({ html: body.innerHTML, text: body.textContent.trim() })
      }
      return content
    },
  })
  parser.turndown(html)
  assert.equal(bodies.length, 1, 'Expected exactly one nested canonical body article')
  return bodies[0]
}

export async function verifyGeneratedProseEvidence(site, layout) {
  const path = join(site, 'src/content/articles/first-post/index.mdoc')
  const original = readFileSync(path, 'utf8')
  const manifestBytes = readFileSync(join(site, 'source-manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestBytes)
  const marker = 'First body marker alpha.'
  const index = original.lastIndexOf(marker)
  assert(index > original.indexOf('\n---', 4), 'Marker must be in body, not frontmatter')
  const prefix = original.slice(0, index)
  const suffix = original.slice(index + marker.length)
  assert(prefix.includes(marker), 'Unchanged excerpt must retain the same marker')
  assert.equal(suffix.trim(), '', 'Replace only the final body marker')
  const results = []
  try {
    for (const [name, markdown, passed, visible] of [
      ['comment-only', `<!-- ${marker} -->`, false, ''],
      ['comment-partial', 'First body <!-- marker alpha. -->', false, 'First body'],
      ['plain-control', marker, true, marker],
      ['formatted-control', '**First** body marker alpha.', true, marker],
      ['retained-prose-comment', `<!-- ignored -->\n${marker}`, true, marker],
      ['inline-code-control', '`' + marker + '`', true, marker],
      ['fenced-code-control', '~~~text\n' + marker + '\n~~~', true, marker],
      ['escaped-control', '\\*' + marker + '\\*', true, '*' + marker + '*'],
    ]) {
      writeFileSync(path, prefix + markdown + suffix)
      assert.equal(readFileSync(path, 'utf8').slice(0, index), prefix, 'Frontmatter/excerpt changed')
      const report = await writeMigrationReports(site, manifest, layout)
      const validator = await validateMigrationReport(site)
      const findings = report.items.find(i => i.id === 101).findings
      assert.equal(report.qualityPassed, passed, `${name}: incorrect report verdict`)
      assert.equal(validator.passed, passed, `${name}: incorrect validator verdict`)
      if (!passed) assert(findings.some(f => f.code === 'body-text-mismatch'), `${name}: missing body finding`)
      execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: site, stdio: 'inherit' })
      const body = renderedBody(readFileSync(join(site, 'dist/client/blog/first-post/index.html'), 'utf8'))
      assert.equal(body.text, visible, `${name}: actual body differs (excerpt is NOT evidence)`)
      assert.equal(readFileSync(join(site, 'source-manifest.json'), 'utf8'), manifestBytes)
      results.push({ name, qualityPassed: report.qualityPassed, validatorPassed: validator.passed, body, findings })
    }
  } finally {
    writeFileSync(path, original)
    assert.equal((await writeMigrationReports(site, manifest, layout)).qualityPassed, true)
  }
  execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: site, stdio: 'inherit' })
  assert.equal((await validateMigrationReport(site)).passed, true)
  writeFileSync(join(site, 'prose-evidence.json'), JSON.stringify(results, null, 2))
  console.log('Actual generated visible-body controls: ' + JSON.stringify(results))
  return results
}
