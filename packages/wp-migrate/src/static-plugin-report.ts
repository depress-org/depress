import { createHash } from 'node:crypto'
import type { SourceManifest, StaticPluginCompatibility, PluginFailureCode } from '@depress-org/core'
import { attachmentEligible, createStaticPluginHost, tokenDiagnostic } from './static-plugins.js'
import { coverage, diagnostic, StaticPluginError, type LocalMedia } from './static-plugin-host.js'
import { scanShortcodes, shortcodeSourceText } from './shortcode-tokens.js'
import { rasterExtension, MEDIA_LIMITS } from './media-fetch.js'

/** Replayed from private inventory and actual contained local bytes, not a
 * plugin-authored success flag. Report module owns final rendered evidence. */
export async function assessStaticPlugins(manifest: SourceManifest, read: (path: string) => Promise<Buffer>) {
  const compatibility: StaticPluginCompatibility = { api: 'depress.static-plugin/v1', matrixVersion: 1, plugins: [], coverage, diagnostics: [], sourceFeatures: [], occurrences: [] }
  const sourceContent = new Map(manifest.items.map(i => [i.key, shortcodeSourceText(i.content, i.key)]))
  const replaced = new Set<string>()
  for (const item of manifest.items) {
    for (const key of item.metadataKeys ?? Object.keys(item.customFields ?? {})) compatibility.sourceFeatures.push({ sourceId: item.id, kind: 'metadata', reference: createHash('sha256').update(key).digest('hex') })
    for (const match of item.content.matchAll(/<!--[\s\S]*?-->/g)) compatibility.sourceFeatures.push({ sourceId: item.id, kind: /^<!--\s*\/?wp:/.test(match[0]) ? 'block' : 'comment', reference: `offset:${match.index}`, start: match.index, end: match.index + match[0].length })
  }
  const allTokens = manifest.items.flatMap(i => scanShortcodes(i.content, i.key).map(token => ({ source: i, token })))
  const fail = (code: PluginFailureCode) => { compatibility.diagnostics = [diagnostic(code)] }
  try {
    if (manifest.pluginFailure) throw new StaticPluginError(manifest.pluginFailure)
    const host = createStaticPluginHost(manifest, manifest.staticPlugins)
    compatibility.plugins = host.config.plugins.map(p => ({ id: p.id, version: p.version }))
    compatibility.diagnostics.push(...await host.inspect())
    const local: Record<string, LocalMedia[string]> = {}
    for (const media of manifest.media) {
      if (!attachmentEligible(manifest, media.id)) continue
      try {
        const name = new URL(media.url, 'https://source.invalid').pathname.split('/').at(-1)!
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..') || manifest.media.filter(m => m.id === media.id || new URL(m.url, 'https://source.invalid').pathname.split('/').at(-1) === name).length !== 1) continue
        const bytes = await read(`public/media/${name}`)
        if (bytes.length > MEDIA_LIMITS.maxBytes) continue
        const ext = rasterExtension(bytes)
        if (!name.toLowerCase().endsWith(ext) && !(ext === '.jpg' && name.toLowerCase().endsWith('.jpeg'))) continue
        local[String(media.id)] = { publicUrl: `/media/${name}`, alt: media.altText, copyStatus: 'copied' }
      } catch { /* unresolved media is diagnosed by gallery */ }
    }
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    for (const item of manifest.items) {
      if (item.status !== 'publish' || !['post', 'page'].includes(item.type)) continue
      const result = await host.transform(item, host.prepare(item).content, local)
      compatibility.diagnostics.push(...result.diagnostics)
      let expected = '', cursor = 0
      for (const token of host.tokens(item)) {
        if (token.malformed) continue
        expected += item.content.slice(cursor, token.start); cursor = token.end
        const replacement = result.replacements.find(r => r.tokenId === token.tokenId)
        if (replacement) {
          replaced.add(token.tokenId)
          for (const match of replacement.markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
            const source = manifest.media.find(m => local[String(m.id)]?.publicUrl === match[2])!
            expected += `<img src="${escape(source.url)}" alt="${escape(source.altText)}">`
          }
        }
      }
      sourceContent.set(item.key, expected + item.content.slice(cursor))
    }
  } catch (error) {
    const code = error instanceof StaticPluginError ? error.code : 'PLUGIN_EXECUTION_FAILED'
    fail(code); replaced.clear()
  }
  for (const { source, token } of allTokens) {
    const successful = replaced.has(token.tokenId)
    compatibility.occurrences.push({ sourceId: source.id, tokenId: token.tokenId, tag: token.tag, start: token.start, end: token.end,
      ...(successful ? { pluginId: 'core.static-gallery' } : {}), classification: successful ? 'static-replacement' : tokenDiagnostic(token, source.id).classification,
      outcome: successful ? 'observed' : 'not-preserved' })
  }
  return { compatibility, sourceContent, replaced }
}
