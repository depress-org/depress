import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import matter from 'gray-matter'
import { scaffoldAstroProject } from '../scaffold.js'
import { astrowindAdapter } from '../themes/astrowind.js'
import { rocketAdapter } from '../themes/rocket.js'
import { sourceString, htmlText } from '../themes/serialization.js'
import { injectContent } from '../theme-inject.js'

const roots: string[] = []
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'depress-source-safety-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const hostile = "O'Reilly \"quoted\" \\ ` ${globalThis.pwned = true} </title><script>bad()</script> {process.exit()}\n---\n!tag &anchor : value\u2028\u2029 $& $1"
const opts = {
  siteTitle: hostile, siteDescription: hostile, siteUrl: "https://fixture.invalid/'\\\n$&$1",
  authorName: hostile, navItems: [{ label: hostile, href: '/safe', children: [] }], allMenus: {},
}
async function put(root: string, name: string, text: string) {
  const path = join(root, name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}
function evaluate(source: string) {
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true })
  expect(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error)).toEqual([])
  const context = { exports: {} as Record<string, any> }
  runInNewContext(result.outputText, context)
  return context.exports
}

describe('#24 generated source is serialized data', () => {
  it('round-trips source delimiters without executing expressions', () => {
    const literal = sourceString(hostile)
    expect(literal).not.toMatch(/[<>&\u2028\u2029]/)
    expect(runInNewContext(literal)).toBe(hostile)
  })

  it('generates inert Astro expressions and valid TS fallbacks', async () => {
    const root = await temp()
    await scaffoldAstroProject({ ...opts, hasCategories: true, hasTags: true }, root)
    for (const name of ['src/layouts/BaseLayout.astro', 'src/components/layout/Header.astro', 'src/components/layout/Footer.astro']) {
      const source = await readFile(join(root, name), 'utf8')
      expect(source).not.toContain(hostile)
      expect(source).toContain(`const siteTitle = ${sourceString(hostile)}`)
      expect(source).toContain("{siteTitle}")
    }
    const index = await readFile(join(root, 'src/pages/index.astro'), 'utf8')
    expect(index).toContain(`?? ${sourceString(hostile)}`)
    const config = await readFile(join(root, 'astro.config.mjs'), 'utf8')
    expect(config).toContain(`site: ${sourceString(opts.siteUrl)}`)
    const yaml = matter(`---\n${await readFile(join(root, 'site-config.yaml'), 'utf8')}\n---`).data
    expect(yaml.siteTitle).toBe(hostile)
    expect(yaml.siteDescription).toBe(hostile)
  })

  it('patches AstroWind YAML structurally and navigation as TS data', async () => {
    const root = await temp()
    await put(root, 'src/config.yaml', 'site:\n  name: old\n  site: https://old.invalid\nmetadata:\n  title:\n    default: old\n    template: "%s - old"\n  description: old\nother: true\n')
    await put(root, 'src/navigation.ts', '')
    await put(root, 'astro.config.ts', "import { defineConfig } from 'astro/config';\nexport default defineConfig({ integrations: [] });")
    await astrowindAdapter.patchConfig!(root, opts)
    const data = JSON.parse(await readFile(join(root, 'src/config.yaml'), 'utf8'))
    expect(data.site.name).toBe(hostile)
    expect(data.site.site).toBe(opts.siteUrl)
    expect(data.metadata.title.default).toBe(hostile)
    expect(data.metadata.description).toBe(hostile)
    expect(data.other).toBe(true)
    const nav = (await readFile(join(root, 'src/navigation.ts'), 'utf8')).replace(/^import .*;\n/, 'const getPermalink = (x: string) => x; const getAsset = (x: string) => x;\n')
    const exports = evaluate(nav)
    expect(exports.headerData.links[0].text).toBe(hostile)
    expect(exports.footerData.footNote).toContain(htmlText(hostile))
    expect(exports.footerData.footNote).not.toContain("<script>")
    expect(await readFile(join(root, 'keystatic.config.ts'), 'utf8')).toContain("fields.markdoc({ label: 'Content', extension: 'md' })")
    expect(await readFile(join(root, 'astro.config.ts'), 'utf8')).toContain(`site: ${sourceString(opts.siteUrl)}`)
  })

  it('patches Rocket metadata without quote/template execution', async () => {
    const root = await temp()
    await put(root, 'src/config/site.config.ts', "export const siteConfig = {\n name: 'old',\n description: `old`,\n author: \"old\",\n};")
    await rocketAdapter.patchConfig!(root, opts)
    const exports = evaluate(await readFile(join(root, 'src/config/site.config.ts'), 'utf8'))
    expect(exports.siteConfig.name).toBe(hostile)
    expect(exports.siteConfig.description).toBe(hostile.slice(0, 200))
    expect(exports.siteConfig.author).toBe(hostile)
  })
})

describe('#24 untrusted content never enters the MDX compiler', () => {
  it('writes plain Markdown for posts and pages, with raw markup inert', async () => {
    const source = await temp(); const output = await temp()
    const body = "import fs from 'node:fs'\n\nexport const pwn = process.exit()\n\n{process.exit()}\n\n<script>bad()</script>\n\n# Real heading\n"
    for (const kind of ['articles', 'pages']) await put(source, `src/content/${kind}/fixture/index.mdoc`, matter.stringify(body, { title: hostile, publishedAt: '2025-01-01' }))
    const adapter = { ...astrowindAdapter, pagesDir: 'src/content/pages' }
    expect(await injectContent(source, output, adapter, 'Author')).toMatchObject({ postsInjected: 1, pagesInjected: 1 })
    expect(await readdir(join(output, 'src/data/post/fixture'))).toEqual(['index.md'])
    for (const name of ['src/data/post/fixture/index.md', 'src/content/pages/fixture.md']) {
      const result = matter(await readFile(join(output, name), 'utf8'))
      expect(result.data.title).toBe(hostile)
      expect(result.content).toContain('{process.exit()}')
      expect(result.content).toContain('# Real heading')
      expect(result.content).not.toContain('<script>')
    }
  })

  it('fails closed for MDX-only themes before writing content', async () => {
    const source = await temp(); const output = await temp()
    await expect(injectContent(source, output, rocketAdapter, 'Author')).rejects.toThrow('requires executable MDX')
    expect(await readdir(output)).toEqual([])
  })

  it('rejects executable gray-matter language engines', async () => {
    const source = await temp(); const output = await temp()
    await put(source, 'src/content/articles/fixture/index.mdoc', '---js\n({ title: process.exit() })\n---\nbody')
    await expect(injectContent(source, output, astrowindAdapter, 'Author')).rejects.toThrow('requires YAML frontmatter')
  })
})
