import Markdoc from '@markdoc/markdoc'
import type { PluginDiagnostic, PluginFailureCode, StaticPluginConfig } from '@depress-org/core'

// Defensive in-process bounds, not hosted isolation/resource guarantees (#24/#25).
export const PLUGIN_LIMITS = Object.freeze({ inputBytes: 1_048_576, resultBytes: 1_048_576, diagnostics: 256, tokens: 4096, items: 10000, hookMs: 1000 })
export class StaticPluginError extends Error {
  constructor(public readonly code: PluginFailureCode) { super(code) }
}
export type LocalMedia = Readonly<Record<string, { publicUrl: string; alt: string; copyStatus: 'copied' }>>
export interface SourceView {
  items: Array<{ sourceId: number; sourceType: string; sourceStatus: string; featureRefs: string[] }>
  coverage: { wxr: 'scanned'; pluginTables: 'not-assessed'; phpRuntime: 'not-assessed'; omittedExports: 'not-assessed' }
}
export interface ItemView {
  sourceId: number
  destinationKind: string
  normalizedMarkdown: string
  tokens: Array<{ tokenId: string; tag: string; attrs: Record<string, string>; valid: boolean }>
  mediaBySourceId: LocalMedia
}
export interface PluginResult { replacements: Array<{ tokenId: string; markdown: string }>; diagnostics: PluginDiagnostic[] }
/** Internal trusted registry contract. Never accepted from config/module paths. */
export interface RegisteredStaticPlugin {
  id: string; api: string; version: string; ownsTokens: string[]
  inspectSource(view: SourceView, options: Record<string, never>): unknown
  transformItem(view: ItemView, options: Record<string, never>): unknown
}
export const coverage: SourceView['coverage'] = Object.freeze({ wxr: 'scanned', pluginTables: 'not-assessed', phpRuntime: 'not-assessed', omittedExports: 'not-assessed' })
export const templates = {
  WP_SHORTCODE_UNRESOLVED: ['Source shortcode requires review.', 'Review this source occurrence before cutover.'],
  WP_DYNAMIC_UNSUPPORTED: ['Dynamic source behavior is not implemented.', 'Use a separately reviewed service or remove this dependency.'],
  GALLERY_ATTRIBUTES_UNSUPPORTED: ['Gallery syntax or attributes are outside ids-only v1.', 'Use a unique positive ids list with no other attributes.'],
  GALLERY_MEDIA_UNRESOLVED: ['Gallery attachment is not a safe successfully copied local image.', 'Supply and verify all referenced local images and safe alt text.'],
  PLUGIN_CONFIG_INVALID: ['Static-plugin configuration is invalid.', 'Use the documented pinned in-tree configuration.'],
  PLUGIN_EXECUTION_FAILED: ['Static-plugin hook failed or exceeded its deadline.', 'Review the plugin failure; do not publish this run.'],
  PLUGIN_OUTPUT_REJECTED: ['Static-plugin output failed host validation.', 'Review the plugin failure; do not publish this run.'],
  PLUGIN_BUDGET_EXCEEDED: ['Static-plugin resource budget was exceeded.', 'Reduce the input or use an independently reviewed bounded workflow.'],
} as const
export type DiagnosticCode = keyof typeof templates
export function diagnostic(code: DiagnosticCode, sourceId?: number, tokenId?: string, pluginId?: string): PluginDiagnostic {
  return { code, severity: code.startsWith('PLUGIN_') ? 'error' : 'warning', classification: code === 'WP_DYNAMIC_UNSUPPORTED' ? 'unsupported-dynamic' : 'manual-review',
    ...(sourceId === undefined ? {} : { sourceId }), ...(tokenId === undefined ? {} : { tokenId }), ...(pluginId === undefined ? {} : { pluginId }), message: templates[code][0], action: templates[code][1] }
}
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }
  return value
}
function bounded(value: unknown, max: number): void {
  let json: string | undefined
  try { json = JSON.stringify(value) } catch { throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED') }
  if (json === undefined) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
  if (Buffer.byteLength(json) > max) throw new StaticPluginError('PLUGIN_BUDGET_EXCEEDED')
}
/** Timers bound async hooks, not synchronous CPU. OS process isolation is separate. */
export async function runHook<T>(hook: (view: T) => unknown, view: T, timeoutMs: number = PLUGIN_LIMITS.hookMs): Promise<unknown> {
  bounded(view, PLUGIN_LIMITS.inputBytes)
  let timer: ReturnType<typeof setTimeout> | undefined
  const started = performance.now()
  try {
    const result = await Promise.race([Promise.resolve().then(() => hook(frozen(structuredClone(view)))), new Promise((_, reject) => { timer = setTimeout(() => reject(new StaticPluginError('PLUGIN_EXECUTION_FAILED')), timeoutMs) })])
    if (performance.now() - started > timeoutMs) throw new StaticPluginError('PLUGIN_EXECUTION_FAILED')
    bounded(result, PLUGIN_LIMITS.resultBytes)
    return result
  } catch (error) { throw error instanceof StaticPluginError ? error : new StaticPluginError('PLUGIN_EXECUTION_FAILED') }
  finally { clearTimeout(timer) }
}
export function validateDiagnostics(value: unknown): PluginDiagnostic[] {
  if (!Array.isArray(value)) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
  if (value.length > PLUGIN_LIMITS.diagnostics) throw new StaticPluginError('PLUGIN_BUDGET_EXCEEDED')
  for (const d of value) {
    if (!d || typeof d.code !== 'string' || !Object.hasOwn(templates, d.code)) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
    const expected = diagnostic(d.code as DiagnosticCode, d.sourceId, d.tokenId, d.pluginId)
    if (JSON.stringify(Object.keys(d).sort()) !== JSON.stringify(Object.keys(expected).sort()) || Object.keys(expected).some(k => d[k] !== expected[k as keyof PluginDiagnostic]) ||
      (d.sourceId !== undefined && (!Number.isSafeInteger(d.sourceId) || d.sourceId <= 0)) || (d.tokenId !== undefined && !/^[a-f0-9]{64}$/.test(d.tokenId)) || (d.pluginId !== undefined && !/^[a-z][a-z0-9.-]{0,63}$/.test(d.pluginId))) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
  }
  return structuredClone(value)
}
/** Image-only canonical serializer. No raw HTML/MDX/imports, code, links, paths
 * or plugin-chosen URLs. Validate Markdoc AST AND byte-for-byte reserialization.
 */
export function imageMarkdown(alt: string, publicUrl: string): string {
  if (/[\x00-\x1f\x7f\\`*_{}\[\]()!#<>]/.test(alt) || !/^\/media\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(publicUrl) || publicUrl.includes('..')) throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED')
  return `![${alt}](${publicUrl})`
}
export function validateReplacements(value: unknown, owned: Array<{ tokenId: string }>, media: LocalMedia): PluginResult {
  const fail = () => { throw new StaticPluginError('PLUGIN_OUTPUT_REJECTED') }
  if (!value || typeof value !== 'object') return fail()
  const r = value as PluginResult
  if (Object.keys(r).sort().join(',') !== 'diagnostics,replacements' || !Array.isArray(r.replacements)) return fail()
  bounded(r, PLUGIN_LIMITS.resultBytes)
  const diagnostics = validateDiagnostics(r.diagnostics), seen = new Set<string>()
  for (const replacement of r.replacements) {
    if (!replacement || Object.keys(replacement).sort().join(',') !== 'markdown,tokenId' || !owned.some(t => t.tokenId === replacement.tokenId) || seen.has(replacement.tokenId) || typeof replacement.markdown !== 'string') return fail()
    seen.add(replacement.tokenId)
    const text = replacement.markdown
    if (/[\x00-\x1f\x7f]/.test(text.replace(/\n\n/g, ''))) return fail()
    const ast = Markdoc.parse(text), nodes = [...ast.walk()]
    if (Markdoc.validate(ast).length || nodes.some(n => !['paragraph', 'inline', 'image', 'softbreak'].includes(n.type) || n.annotations.length || n.errors.length)) return fail()
    const images = nodes.filter(n => n.type === 'image')
    if (!images.length) return fail()
    let canonical: string
    try {
      canonical = images.map(n => {
        const { src, alt } = n.attributes
        if (typeof src !== 'string' || typeof alt !== 'string' || !Object.values(media).some(m => m.copyStatus === 'copied' && m.publicUrl === src && m.alt === alt)) return fail()
        return imageMarkdown(alt, src)
      }).join('\n\n')
    } catch { return fail() }
    if (text !== canonical) return fail()
  }
  // Review/error plus a delta for the same item is forbidden: never partial success.
  if (diagnostics.length && r.replacements.length) return fail()
  return { replacements: structuredClone(r.replacements), diagnostics }
}
export function validateConfig(value: unknown, registry: readonly RegisteredStaticPlugin[]): StaticPluginConfig {
  const fail = () => { throw new StaticPluginError('PLUGIN_CONFIG_INVALID') }
  const v: StaticPluginConfig = value === undefined ? { api: 'depress.static-plugin/v1', plugins: [] } : value as StaticPluginConfig
  try { bounded(v, PLUGIN_LIMITS.inputBytes) } catch { return fail() }
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'api,plugins' || v.api !== 'depress.static-plugin/v1' || !Array.isArray(v.plugins) || v.plugins.length > registry.length) return fail()
  const seen = new Set<string>(), claims = new Set<string>()
  for (const p of v.plugins) {
    if (!p || Object.keys(p).sort().join(',') !== 'id,options,version' || typeof p.id !== 'string' || typeof p.version !== 'string' || !p.options || typeof p.options !== 'object' || Array.isArray(p.options) || Object.keys(p.options).length || seen.has(p.id)) return fail()
    const plugin = registry.find(r => r.id === p.id && r.version === p.version && r.api === v.api)
    if (!plugin) return fail()
    seen.add(p.id)
    for (const tag of plugin.ownsTokens) { if (claims.has(tag)) return fail(); claims.add(tag) }
  }
  return frozen(structuredClone(v))
}
