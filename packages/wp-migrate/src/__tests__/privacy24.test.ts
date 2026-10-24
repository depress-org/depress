import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { scaffoldAstroProject, scaffoldFiles } from '../scaffold.js'
import { proveScaffoldDraftExclusion } from '../report-privacy.js'

it.each(['Ordinary', 'O\'Reilly "quoted" ` ${literal} </title> {value} \\ \n---\nUnicode мир \u2028\u2029'])('canonical privacy proof parses literal data, preserves exact bytes and rejects changed/unknown readers: %s', async text => {
  await mkdir('.tmp', { recursive: true }); const root = await mkdtemp(resolve('.tmp/privacy24-'))
  try {
    const opts = { siteTitle: text, siteDescription: text, siteUrl: 'https://fixture.invalid/path?x="quoted"&y=1', authorName: '', navItems: [], hasCategories: true, hasTags: true }
    const files = scaffoldFiles(opts)
    expect(files).toEqual(scaffoldFiles(opts))
    await scaffoldAstroProject(opts, root)
    for (const [path, expected] of files) expect(await readFile(join(root, path), 'utf8')).toBe(expected)
    const proof = () => proveScaffoldDraftExclusion(p => readFile(join(root, p)), async p => join(root, p))
    expect(Object.keys(await proof())).toContain('astro.config.mjs')
    const path = join(root, 'src/pages/blog/[slug].astro')
    const original = await readFile(path, 'utf8')
    await writeFile(path, original.replace(".filter((a) => !a.id.startsWith('_drafts/'))", ''))
    await expect(proof()).rejects.toThrow()
    await writeFile(path, original)
    await writeFile(join(root, 'src/pages/unknown.astro'), 'Unknown reader')
    await expect(proof()).rejects.toThrow()
    await rm(join(root, 'src/pages/unknown.astro'))
    const configPath = join(root, 'astro.config.mjs'), config = await readFile(configPath, 'utf8')
    await writeFile(configPath, config.replace(/^  site: .*,$/m, '  site: (globalThis.__privacy24 = "executed"),'))
    await expect(proof()).rejects.toThrow()
    expect((globalThis as any).__privacy24).toBeUndefined()
    await writeFile(configPath, config)
    expect(Object.keys(await proof())).toContain('astro.config.mjs')
  } finally { await rm(root, { recursive: true, force: true }) }
})
