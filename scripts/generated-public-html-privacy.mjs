import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateMigrationReport, writeMigrationReports } from '../packages/wp-migrate/dist/index.js'

// Bounded document inventory, not arbitrary media provenance/security analysis.
export async function verifyPublicHtmlPrivacy(root, site, manifest, layout) {
  const copies = join(site, 'public/html-privacy-26')
  const editor = join(site, 'src/content/pages/html-privacy-26')
  const draft = manifest.items.find(i => i.id === 104)
  assert.equal(draft.status, 'draft')
  const doc = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${draft.title}</title></head><body>${draft.content}</body></html>`
  try {
    mkdirSync(join(editor, 'section/_drafts/deeper'), { recursive: true })
    writeFileSync(join(editor, 'section/_drafts/deeper/index.mdoc'), '---\ntitle: Private editor\n---\nPrivate editor body')
    mkdirSync(copies, { recursive: true })
    for (const [name, bytes] of [['config.json', '{"safe":true}'], ['icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'], ['ordinary.pdf', '%PDF-1.4\n% harmless fixture']]) writeFileSync(join(copies, name), bytes)
    assert.equal((await writeMigrationReports(site, manifest, layout)).qualityPassed, true)
    assert.equal((await validateMigrationReport(site)).passed, true)
    console.log(JSON.stringify({ control: 'HTML-family ordinary media/config safe', passed: true }))

    // Build BEFORE checking rejection: retain a real copied artifact even on RED.
    writeFileSync(join(copies, 'renamed-secret.xhtml'), doc)
    const post = await validateMigrationReport(site)
    const fresh = await writeMigrationReports(site, manifest, layout)
    const validation = await validateMigrationReport(site)
    execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'], {
      cwd: site, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' },
    })
    const built = readFileSync(join(site, 'dist/client/html-privacy-26/renamed-secret.xhtml'), 'utf8')
    assert.equal(built, doc)
    assert(built.includes('Draft body marker excluded.'))
    console.log(JSON.stringify({ control: 'XHTML actual copied private document', source: 104, byteIdentical: true, postReportValidator: post.passed, freshReport: fresh.qualityPassed, freshValidator: validation.passed }))
    assert.equal(post.passed, false, 'post-report XHTML addition')
    assert.equal(fresh.qualityPassed, false, 'fresh XHTML report')
    assert.equal(validation.passed, false, 'fresh XHTML validator')
    rmSync(join(copies, 'renamed-secret.xhtml'))

    for (const ext of ['html', 'htm', 'xhtml', 'XHTML', 'xHtMl']) {
      assert.equal((await writeMigrationReports(site, manifest, layout)).qualityPassed, true)
      const path = join(copies, `renamed-secret.${ext}`)
      writeFileSync(path, doc)
      const post = await validateMigrationReport(site)
      const fresh = await writeMigrationReports(site, manifest, layout)
      const validation = await validateMigrationReport(site)
      assert.equal(post.passed, false, ext + ': post-report addition')
      assert.equal(fresh.qualityPassed, false, ext + ': fresh report')
      assert(fresh.items.some(i => i.findings.some(f => f.code === 'untracked-public-output' && f.detail.includes(`renamed-secret.${ext}`))))
      assert.equal(validation.passed, false, ext + ': fresh validator')
      console.log(JSON.stringify({ control: 'unclaimed HTML-family document', ext, postReportValidator: post.passed, freshReport: fresh.qualityPassed, freshValidator: validation.passed }))
      rmSync(path)
    }
    assert.equal((await writeMigrationReports(site, manifest, layout)).qualityPassed, true)
    assert.equal((await validateMigrationReport(site)).passed, true)
    console.log('Public HTML-family actual-copy/report/validator controls PASS (not arbitrary asset provenance)')
  } finally {
    rmSync(copies, { recursive: true, force: true })
    rmSync(editor, { recursive: true, force: true })
    await writeMigrationReports(site, manifest, layout)
  }
}
