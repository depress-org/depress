import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSourceManifest, writeMigrationReports, validateMigrationReport } from '../packages/wp-migrate/dist/index.js'

// Exercise the public built API AND the actual generated Astro/Markdoc renderer.
// No network/source image downloads: the image is an explicit local SVG fixture.
export async function verifyGeneratedImageEvidence(root, site, layout) {
  const article = join(site, 'src/content/articles/first-post/index.mdoc')
  const originalArticle = readFileSync(article, 'utf8')
  const originalManifest = JSON.parse(readFileSync(join(site, 'source-manifest.json')))
  const originalXml = readFileSync(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8')
  const media = join(site, 'public/media/qa-alt.svg')
  mkdirSync(join(site, 'public/media'), { recursive: true })
  writeFileSync(media, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>')
  const image = alt => `<img src="https://source.invalid/qa-alt.svg" alt="${alt}">`
  const md = alt => `![${alt}](/media/qa-alt.svg)`
  const results = []
  try {
    for (const [name, body, sourceAlts, renderedAlts, passed] of [
      ['correct', md('Important inline alt'), ['Important inline alt'], ['Important inline alt'], true],
      // Astro enables allowComments: even Markdown inside comments is stripped.
      ['comment-markdown', '<!-- ' + md('Important inline alt') + ' -->\n' + md(''), ['Important inline alt'], [''], false],
      ['comment-html', '<!-- <img src="/media/qa-alt.svg" alt="Important inline alt"> -->\n' + md(''), ['Important inline alt'], [''], false],
      ['escaped-markdown', '\\' + md('Important inline alt') + '\n' + md(''), ['Important inline alt'], [''], false],
      ['html-only', '<img src="/media/qa-alt.svg" alt="Important inline alt">', ['Important inline alt'], [], false],
      ['inline-code', '``' + md('Important inline alt') + '``\n' + md(''), ['Important inline alt'], [''], false],
      ['fenced-code', '~~~md\n' + md('Important inline alt') + '\n~~~\n' + md(''), ['Important inline alt'], [''], false],
      ['distinct-contexts', md('First context') + '\n' + md('Second context'), ['First context', 'Second context'], ['First context', 'Second context'], true],
      ['swapped-contexts', md('Second context') + '\n' + md('First context'), ['First context', 'Second context'], ['Second context', 'First context'], false],
    ]) {
      const xml = originalXml.replace('<p>First body marker alpha.</p>', '<p>First body marker alpha.</p>' + sourceAlts.map(image).join(''))
        .replace('</channel>', '<item><title>Photo</title><wp:post_id>105</wp:post_id><wp:post_type>attachment</wp:post_type><wp:post_name>qa-alt</wp:post_name><wp:status>inherit</wp:status><wp:attachment_url>https://source.invalid/qa-alt.svg</wp:attachment_url></item></channel>')
      const manifest = createSourceManifest(xml, { posts: [], media: [], categories: [], tags: [], siteTitle: '', siteUrl: '' })
      writeFileSync(article, originalArticle + '\n' + body + '\n')
      const report = await writeMigrationReports(site, manifest, layout)
      const validation = await validateMigrationReport(site)
      assert.equal(report.qualityPassed, passed, `${name}: incorrect quality verdict`)
      assert.equal(validation.passed, passed, `${name}: incorrect validator verdict`)
      const findings = report.items.find(i => i.id === 101).findings
      if (!passed) assert(findings.some(f => f.code === 'inline-alt-mismatch'), `${name}: missing inline-alt finding`)
      execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: site, stdio: 'inherit' })
      const html = readFileSync(join(site, 'dist/blog/first-post/index.html'), 'utf8')
      const tags = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]).filter(t => t.includes('src="/media/qa-alt.svg"'))
      assert.deepEqual(tags.map(t => /\balt="([^"]*)"/.exec(t)?.[1]), renderedAlts, `${name}: actual rendered images differ`)
      results.push({ name, qualityPassed: report.qualityPassed, validatorPassed: validation.passed, actualImages: tags, findings })
    }
  } finally {
    writeFileSync(article, originalArticle)
    rmSync(media)
    assert.equal((await writeMigrationReports(site, originalManifest, layout)).qualityPassed, true)
  }
  execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: site, stdio: 'inherit' })
  assert.equal((await validateMigrationReport(site)).passed, true)
  console.log('Actual generated image/alt controls: ' + JSON.stringify(results))
  return results
}
