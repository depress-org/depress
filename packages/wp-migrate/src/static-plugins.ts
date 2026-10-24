import type { PluginDiagnostic, SourceItem, SourceManifest } from '@depress-org/core'
import { scanShortcodes, maskShortcodes, type ShortcodeToken } from './shortcode-tokens.js'
import { staticGallery } from './static-gallery.js'
import { coverage, diagnostic, frozen, PLUGIN_LIMITS, runHook, StaticPluginError, validateConfig, validateDiagnostics, validateReplacements, type LocalMedia, type SourceView, type RegisteredStaticPlugin, type ItemView } from './static-plugin-host.js'

/** Raw inventory, not the parser's filtered media list, owns publication policy. */
export function attachmentEligible(manifest: SourceManifest, id: number): boolean {
  const matches = manifest.items.filter(i => i.id === id)
  return matches.length === 1 && matches[0].type === 'attachment' && ['inherit', 'publish'].includes(matches[0].status)
}

const registry: readonly RegisteredStaticPlugin[] = Object.freeze([staticGallery])
export const validateStaticPluginConfig = (value?: unknown) => validateConfig(value, registry)
const dynamic = (tag: string) => /(?:form|cart|checkout|login|membership|account)/i.test(tag)
export function tokenDiagnostic(token: ShortcodeToken, sourceId: number): PluginDiagnostic {
  return diagnostic(dynamic(token.tag) ? 'WP_DYNAMIC_UNSUPPORTED' : 'WP_SHORTCODE_UNRESOLVED', sourceId, token.tokenId)
}
function attributes(token: ShortcodeToken, all: ShortcodeToken[]): ItemView['tokens'][number] {
  // Gallery v1 accepts one ids attr only. Do not project any other source value.
  const m = /^\s+ids\s*=\s*(?:"([\d,\s]+)"|'([\d,\s]+)'|([\d,]+))\s*$/.exec(token.rawAttributes)
  return { tokenId: token.tokenId, tag: token.tag, attrs: m ? { ids: m[1] ?? m[2] ?? m[3] } : {},
    valid: !!m && !token.closing && !all.some(t => t.tag === token.tag && t.closing) }
}
export function createStaticPluginHost(manifest: SourceManifest, value?: unknown) {
  const config = validateStaticPluginConfig(value)
  if (manifest.items.length > PLUGIN_LIMITS.items || Buffer.byteLength(JSON.stringify(manifest)) > PLUGIN_LIMITS.inputBytes) throw new StaticPluginError('PLUGIN_BUDGET_EXCEEDED')
  if (new Set(manifest.items.map(i => i.id)).size !== manifest.items.length) throw new Error('duplicate-source-id')
  const scanned = new Map(manifest.items.map(i => [i.key, scanShortcodes(i.content, i.key)]))
  if ([...scanned.values()].reduce((n, ts) => n + ts.length, 0) > PLUGIN_LIMITS.tokens) throw new StaticPluginError('PLUGIN_BUDGET_EXCEEDED')
  const sourceView: SourceView = frozen({ items: manifest.items.map(i => ({ sourceId: i.id, sourceType: i.type, sourceStatus: i.status, featureRefs: scanned.get(i.key)!.map(t => t.tokenId) })), coverage })
  const configured = config.plugins.map(p => registry.find(r => r.id === p.id)!)
  const owns = (token: ShortcodeToken) => token.malformed ? undefined : configured.find(p => p.ownsTokens.includes(token.tag))
  let diagnosticCount = 0
  function quota(diagnostics: PluginDiagnostic[]) {
    diagnosticCount += diagnostics.length
    if (diagnosticCount > PLUGIN_LIMITS.diagnostics) throw new StaticPluginError('PLUGIN_BUDGET_EXCEEDED')
    return diagnostics
  }
  return {
    config, sourceView,
    tokens: (item: SourceItem) => scanned.get(item.key) ?? [],
    prepare(item: SourceItem) { return { content: maskShortcodes(item.content, scanned.get(item.key) ?? []) } },
    async inspect() {
      const diagnostics: PluginDiagnostic[] = []
      // Narrow recognition only: inventory of other blocks is not WP support.
      for (const item of manifest.items) {
        if (item.status !== 'publish' || !['post', 'page'].includes(item.type)) continue
        for (const match of item.content.matchAll(/<!--\s*wp:([\w/-]+)[\s\S]*?-->/g)) {
          if (dynamic(match[1])) diagnostics.push(...quota([diagnostic('WP_DYNAMIC_UNSUPPORTED', item.id)]))
        }
      }
      for (const plugin of configured) {
        const returned = validateDiagnostics(await runHook(v => plugin.inspectSource(v, frozen({})), sourceView))
        if (returned.some(d => (d.sourceId !== undefined && !sourceView.items.some(i => i.sourceId === d.sourceId)) || d.pluginId !== plugin.id)) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
        diagnostics.push(...quota(returned))
      }
      return diagnostics
    },
    async transform(item: SourceItem, normalizedMarkdown: string, mediaBySourceId: LocalMedia) {
      const tokens = scanned.get(item.key) ?? [], diagnostics: PluginDiagnostic[] = []
      let replacements: Array<{ tokenId: string; markdown: string }> = []
      if (item.status !== 'publish' || !['post', 'page'].includes(item.type)) return { markdown: normalizedMarkdown, replacements, diagnostics }
      // Each plugin sees the original item, never a partially committed delta.
      for (const plugin of configured) {
        const owned = tokens.filter(t => owns(t) === plugin)
        if (!owned.length) continue
        const result = validateReplacements(await runHook(v => plugin.transformItem(v, frozen({})), {
          sourceId: item.id, destinationKind: item.type, normalizedMarkdown,
          tokens: owned.map(t => attributes(t, tokens)), mediaBySourceId,
        }), owned, mediaBySourceId)
        if (result.diagnostics.some(d => d.sourceId !== item.id || d.pluginId !== plugin.id || !owned.some(t => t.tokenId === d.tokenId))) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
        replacements.push(...result.replacements); diagnostics.push(...result.diagnostics)
      }
      for (const token of tokens.filter(t => !owns(t))) diagnostics.push(tokenDiagnostic(token, item.id))
      // Any finding rolls back ALL replacements for this item.
      if (diagnostics.length) replacements = []
      const ids = new Set(replacements.map(r => r.tokenId))
      for (const token of tokens) if (owns(token) && !ids.has(token.tokenId) && !diagnostics.some(d => d.tokenId === token.tokenId)) diagnostics.push(tokenDiagnostic(token, item.id))
      quota(diagnostics)
      let markdown = normalizedMarkdown
      for (const token of tokens) {
        if (token.malformed) continue // converter retains this candidate as safe literal text
        if (markdown.split(token.marker).length !== 2) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
        markdown = markdown.replace(token.marker, () => replacements.find(r => r.tokenId === token.tokenId)?.markdown ?? `<!-- depress review ${token.tokenId} -->`)
      }
      return { markdown, replacements, diagnostics }
    },
  }
}
