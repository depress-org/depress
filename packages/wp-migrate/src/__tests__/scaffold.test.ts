import { it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { scaffoldAstroProject } from '../scaffold.js'

// Replaces the Astro4-only chunk source assertion with its consumer contract.
it('builds real nested Markdoc routes and excludes editor drafts on the supported toolchain (#26)', async () => {
  const root = resolve(import.meta.dirname, '../../../..')
  await mkdir(join(root, '.tmp'), { recursive: true })
  const site = await mkdtemp(join(root, '.tmp/scaffold26-'))
  try {
    await scaffoldAstroProject({ siteTitle: 'Fixture', siteDescription: '', siteUrl: 'https://fixture.invalid', authorName: '', navItems: [], hasCategories: true, hasTags: false }, site)
    for (const [collection, slug, title, permalink, body] of [
      ['articles', 'visible', 'Visible title 26', 'visible', 'Visible body 26.'],
      ['articles', '_drafts/secret', 'Private title 26', 'leaked-editor', 'Private body 26.'],
      ['pages', 'ordinary', 'Ordinary page 26', 'ordinary', 'Ordinary page body 26.'],
      ['pages', '_drafts/secret-page', 'Private page title 26', 'leaked-page', 'Private page body 26.'],
    ]) {
      const path = join(site, 'src/content', collection!, slug!)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'index.mdoc'), `---\ntitle: ${title}\nslug: ${permalink}\ncategory: ${slug!.startsWith('_drafts/') ? 'private-category' : 'public-category'}\n---\n${body}`)
    }
    await mkdir(join(site, 'src/content/categories'), { recursive: true })
    await writeFile(join(site, 'src/content/categories/public-category.yaml'), 'name: Public category\n')
    await symlink(join(root, 'node_modules'), join(site, 'node_modules'), 'dir')
    execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: site, timeout: 180_000, stdio: 'pipe', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' } })
    expect(await readFile(join(site, 'dist/client/blog/visible/index.html'), 'utf8')).toContain('Visible body 26.')
    expect(await readFile(join(site, 'dist/client/blog/index.html'), 'utf8')).not.toContain('Private title 26')
    expect(await readFile(join(site, 'dist/client/index.html'), 'utf8')).not.toContain('Private title 26')
    expect(await readFile(join(site, 'dist/client/ordinary/index.html'), 'utf8')).toContain('Ordinary page body 26.')
    await expect(readFile(join(site, 'dist/client/blog/leaked-editor/index.html'))).rejects.toThrow()
    await expect(readFile(join(site, 'dist/client/leaked-page/index.html'))).rejects.toThrow()
    const category = await readFile(join(site, 'dist/client/category/public-category/index.html'), 'utf8')
    expect(category).toContain('Visible title 26')
    expect(category).not.toContain('Private title 26')
    await expect(readFile(join(site, 'dist/client/category/private-category/index.html'))).rejects.toThrow()
    await expect(readFile(join(site, 'dist/client/blog/_drafts/secret/index.html'))).rejects.toThrow()
    await expect(readFile(join(site, 'dist/client/blog/drafts/secret/index.html'))).rejects.toThrow()
  } finally { await rm(site, { recursive: true, force: true }) }
}, 210_000)
