import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { migrateSite } from '../packages/cli/dist/services/migrate.js'
import { validateMigrationReport } from '../packages/wp-migrate/dist/index.js'

/** #30 P04/P10: build the actual service AND CLI outputs, not just Markdown
 * or excerpts. Root dependencies are reused; this is not cold-theme acceptance. */
export async function verifyGeneratedMalformedShortcodeEvidence(root) {
  const dir = await mkdtemp(join(root, '.tmp/generated-malformed30-'))
  const base = await readFile(join(root, 'packages/cli/src/__fixtures__/offline-export.xml'), 'utf8')
  const sentinel = 'PRIVATE_QA_MALFORMED_ATTRIBUTE_924'
  const config = { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] }
  const configPath = join(dir, 'plugins.json')
  await writeFile(configPath, JSON.stringify(config))
  const cases = [
    // Exact independently reproduced suffix; the generated excerpt is unchanged.
    `First body marker alpha.</p>[contact-form password="${sentinel}]`,
    // Same first paragraph: generated excerpts must not become a second leak,
    // and neither an entire safe paragraph nor ordinary inner prose may vanish.
    `First body marker alpha. [contact-form password="${sentinel}] Inner safe prose.[/contact-form] Tail safe prose.</p>`,
  ]
  for (const enabled of [false, true]) for (const [index, body] of cases.entries()) {
    const input = join(dir, `input-${enabled}-${index}.xml`)
    await writeFile(input, base.replace('First body marker alpha.</p>', body))
    const service = join(dir, `service-${enabled}-${index}`)
    const result = await migrateSite({ input, output: service, theme: 'scaffold', ...(enabled ? { staticPlugins: config } : {}) })
    assert.equal(result.qualityPassed, false)
    const cli = join(dir, `cli-${enabled}-${index}`)
    const child = spawnSync(process.execPath, [join(root, 'packages/cli/dist/index.js'), 'migrate', '--input', input, '--output', cli, '--theme', 'scaffold', ...(enabled ? ['--static-plugins', configPath] : [])], { encoding: 'utf8', timeout: 30000 })
    assert.equal(child.status, 1, child.stdout + child.stderr)
    const path = 'src/content/articles/first-post/index.mdoc'
    assert.equal(await readFile(join(service, path), 'utf8'), await readFile(join(cli, path), 'utf8'))
    assert.deepEqual(JSON.parse(await readFile(join(service, 'migration-report.json'), 'utf8')), JSON.parse(await readFile(join(cli, 'migration-report.json'), 'utf8')))
    for (const output of [service, cli]) {
      const markdown = await readFile(join(output, path), 'utf8')
      // Turndown can escape underscores: a raw substring check alone is invalid.
      assert(!markdown.replace(/\\([_\[\]])/g, '$1').includes(sentinel))
      assert(!markdown.includes('password'))
      assert.match(markdown, /<!-- depress review [a-f0-9]{64} -->/)
      const manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'))
      assert(manifest.items.find(i => i.id === 101).content.includes(sentinel))
      const report = JSON.parse(await readFile(join(output, 'migration-report.json'), 'utf8'))
      assert(!JSON.stringify(report.compatibility).includes(sentinel))
      assert(report.compatibility.occurrences.every(o => o.outcome === 'not-preserved'))
      assert(report.compatibility.diagnostics.some(d => d.code === 'WP_DYNAMIC_UNSUPPORTED'))
      assert.equal((await validateMigrationReport(output)).passed, false)
      await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
      execFileSync('npm', ['run', 'build', '--workspaces=false'], { cwd: output, stdio: 'inherit', timeout: 120000 })
      const html = await readFile(join(output, 'dist/client/blog/first-post/index.html'), 'utf8')
      // Exact nested prose container, excluding the unchanged header/excerpt.
      const article = /<div class="prose[^\"]*">([\s\S]*?)<\/div>/.exec(html)?.[1]
      assert(article, 'missing actual rendered body container')
      assert(article.includes('First body marker alpha.'))
      if (index === 1) for (const prose of ['Inner safe prose.', 'Tail safe prose.']) assert(article.includes(prose), `lost ${prose}`)
      assert(!html.includes(sentinel), 'attribute leaked into actual HTML/excerpt')
      assert(!html.includes('password='))
      for (const area of ['public', 'dist']) {
        for (const file of await readdir(join(output, area), { recursive: true, withFileTypes: true })) {
          if (file.isFile()) assert(!(await readFile(join(file.parentPath, file.name))).includes(Buffer.from(sentinel)), `${area}/${file.name}: private attribute published`)
        }
      }
    }
  }
  console.log(`#30 malformed attribute actual renderer: default-empty/enabled x exact/same-paragraph x service/CLI (8 builds) PASS: ${dir}`)
}
