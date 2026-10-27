import { readFile } from 'node:fs/promises'
import type { RemarkPlugin, RehypePlugin } from '@astrojs/markdown-remark'
import { patchAstrowindAstroConfig } from './themes/astrowind.js'

const template = new URL('../bundled-themes/astrowind/', import.meta.url)
const contextFiles = ['package.json', 'tsconfig.json', 'src/utils/frontmatter.ts', 'src/content.config.ts', 'vendor/integration/index.ts', 'vendor/integration/utils/loadConfig.ts', 'vendor/integration/utils/configBuilder.ts']
const staticNodes = new Set(['root', 'text', 'paragraph', 'blockquote', 'heading', 'list', 'listItem', 'thematicBreak', 'break', 'code', 'inlineCode', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'definition', 'image', 'imageReference', 'table', 'tableRow', 'tableCell', 'html'])

// Admission only, not render proof. Raw HTML/custom contexts are deliberately
// unproven; code and escaped examples remain literal text in the real processor.
const staticGrammar: RemarkPlugin = () => tree => {
  const walk = (node: typeof tree | (typeof tree)['children'][number]): void => {
    if (!staticNodes.has(node.type)) throw new Error('Unproven Markdown syntax')
    if (node.type === 'html' && node.value.replace(/<!--[\s\S]*?-->/g, '').trim()) throw new Error('Unproven raw HTML')
    if (node.type === 'text' && /\{%|^\s*(?:import|export)\s/m.test(node.value)) throw new Error('Unproven custom context')
    if ('children' in node) for (const child of node.children) walk(child)
  }
  walk(tree)
}
// Engine-owned equivalents of the attested trusted plugins, never imports from
// generated code. Reading time changes frontmatter only, not this body/images
// projection. Tables and loading attributes retain the exact production order.
const responsiveTables: RehypePlugin = () => tree => {
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i]
    if (child.type === 'element' && child.tagName === 'table') {
      tree.children[i] = { type: 'element', tagName: 'div', properties: { style: 'overflow:auto' }, children: [child] }
      i++
    }
  }
}
const lazyImages: RehypePlugin = () => tree => {
  const walk = (node: typeof tree | (typeof tree)['children'][number]): void => {
    if (node.type === 'element' && node.tagName === 'img') node.properties.loading = 'lazy'
    if ('children' in node) for (const child of node.children) walk(child)
  }
  walk(tree)
}

/** Only the shipped generated AstroWind configuration. No evaluation, module
 * loading, arbitrary Astro/MDX/template support, route or privacy certification.
 * Captured actual bytes become canonical report artifacts for replay/tampering.
 */
export async function proveAstrowindMarkdown(read: (path: string) => Promise<Buffer>) {
  if (process.env.ASTRO_PERFORMANCE_BENCHMARK) throw new Error('Noncanonical processor mode')
  const artifacts: Record<string, Buffer> = {}
  const bases = ['astro.config', 'src/content.config', 'src/content', 'vendor/integration', 'vendor/integration/package', ...contextFiles.filter(p => p.endsWith('.ts')).map(p => p.slice(0, -3))]
  for (const base of new Set(bases)) {
    for (const ext of ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'json']) {
      const path = `${base}.${ext}`
      if (path === 'astro.config.ts' || contextFiles.includes(path)) continue
      try { await read(path) } catch (error: any) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw error }
      throw new Error('Competing renderer configuration')
    }
  }
  for (const path of contextFiles) {
    const actual = await read(path)
    if (!actual.equals(await readFile(new URL(path, template)))) throw new Error('Unproven renderer configuration')
    artifacts[path] = actual
  }
  const config = await read('astro.config.ts')
  const literal = config.toString('utf8').match(/^  site: ("(?:[^"\\\r\n]|\\.)*"),$/m)?.[1]
  const site: unknown = literal === undefined ? undefined : JSON.parse(literal)
  if (site !== undefined && typeof site !== 'string') throw new Error('Unproven site literal')
  const expected = patchAstrowindAstroConfig(await readFile(new URL('astro.config.ts', template), 'utf8'), site)
  if (config.toString('utf8') !== expected) throw new Error('Unproven Markdown configuration')
  artifacts['astro.config.ts'] = config
  // Dynamic import only after mode check: Astro snapshots benchmark mode at
  // module initialization. Use the declared ENGINE runtime, not consumer deps.
  const { createMarkdownProcessor } = await import('@astrojs/markdown-remark')
  const processor = await createMarkdownProcessor({
    remarkPlugins: [staticGrammar],
    rehypePlugins: [responsiveTables, lazyImages],
    image: { domains: ['cdn.pixabay.com'], remotePatterns: [] },
  })
  return { artifacts, render: async (body: string) => {
    if (process.env.ASTRO_PERFORMANCE_BENCHMARK) return undefined
    try {
      const rendered = await processor.render(body, { fileURL: new URL('proof.md', template) })
      // Local/remote assets still need Astro's later asset transform; public
      // /media paths do not. Never certify intermediate image placeholders.
      if (rendered.metadata.localImagePaths.length || rendered.metadata.remoteImagePaths.length || rendered.code.includes('__ASTRO_IMAGE_')) return undefined
      return rendered.code
    } catch { return undefined }
  } }
}
