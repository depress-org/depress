import { describe, expect, it } from 'vitest'
import { createStaticPluginHost, validateStaticPluginConfig } from '../static-plugins.js'
import { scanShortcodes, shortcodeSourceText } from '../shortcode-tokens.js'
import { runHook, validateConfig, validateReplacements, type RegisteredStaticPlugin } from '../static-plugin-host.js'

const config = { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] }
const item = { key: '0:post:1', id: 1, type: 'post', status: 'publish', slug: 'one', title: 'One', author: 'A', content: '<p>Before</p>[gallery ids="12,11"]' }
const media = { '11': { publicUrl: '/media/a.png', alt: 'Первый & ordinary', copyStatus: 'copied' as const }, '12': { publicUrl: '/media/b.png', alt: 'Second', copyStatus: 'copied' as const } }
const source = { schemaVersion: 1 as const, sourceSha256: 'a'.repeat(64), items: [item], media: [] }

describe('#30 static-plugin v1', () => {
  it('P04 scans nested boundaries, quotes and HTML without regex-only attribute loss', () => {
    const text = '<img alt="[fake ids=99]">[vc_row][unknown x="a]b"]мир[child /][/unknown][/vc_row] [[literal]] <!-- [hidden] -->'
    const tokens = scanShortcodes(text, item.key)
    expect(tokens.map(t => t.tag)).toEqual(['vc_row', 'unknown', 'child', 'unknown', 'vc_row'])
    expect(tokens[1].rawAttributes).toBe(' x="a]b"')
    expect(tokens[1].start).toBe(text.indexOf('[unknown'))
    expect(new Set(tokens.map(t => t.tokenId)).size).toBe(tokens.length)
    expect(scanShortcodes(text, item.key)).toEqual(tokens)
  })
  it('malformed candidates retain stable spans without consuming escaped shortcodes or safe text', async () => {
    const content = 'DEPRESSGALLERY0 [[gallery ids="11"]] [gallery ids="11]'
    const bad = { ...item, content }
    const tokens = scanShortcodes(content, bad.key)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ tag: 'gallery', malformed: true, start: content.lastIndexOf('[gallery'), end: content.length })
    expect(scanShortcodes(content, bad.key)).toEqual(tokens)
    const host = createStaticPluginHost({ ...source, items: [bad] }, config)
    const prepared = host.prepare(bad).content
    expect(prepared).toBe(`DEPRESSGALLERY0 [[gallery ids="11"]] ${tokens[0].marker}`)
    const result = await host.transform(bad, prepared, media)
    expect(result.markdown).toBe(`DEPRESSGALLERY0 [[gallery ids="11"]] \n\n<!-- depress review ${tokens[0].tokenId} -->\n\n`)
    expect(result.replacements).toEqual([])
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'WP_SHORTCODE_UNRESOLVED', tokenId: tokens[0].tokenId })])
  })
  it.each([
    '[contact-form password="PRIVATE] inner safe.',
    "[contact-form password='PRIVATE] inner safe.",
    '[gallery ids="PRIVATE\ninner safe.',
    '[gallery ids="PRIVATE\rinner safe.',
    '[gallery ids="PRIVATE<p>inner safe.</p>',
    '[/gallery password="PRIVATE] inner safe.',
    '[gallery ids="PRIVATE[unknown]inner safe.[/unknown]',
  ])('P04 masks only recognized malformed spans and preserves safe inner prose: %s', async candidate => {
    const content = `DEPRESSOPAQUE Before ${candidate} After safe.`
    const bad = { ...item, content }
    const host = createStaticPluginHost({ ...source, items: [bad] }, config)
    const prepared = host.prepare(bad).content
    const malformed = host.tokens(bad).find(t => t.malformed)!
    expect(content.slice(malformed.start, malformed.end)).toContain('PRIVATE')
    expect(prepared).not.toContain('PRIVATE')
    expect(prepared).toContain('inner safe.')
    expect(shortcodeSourceText(content, bad.key)).not.toContain('PRIVATE')
    expect(shortcodeSourceText(content, bad.key)).toContain('inner safe.')
    const result = await host.transform(bad, prepared, media)
    expect(result.markdown).toContain('DEPRESSOPAQUE Before')
    expect(result.markdown).toContain('inner safe.')
    expect(result.markdown).toContain('After safe.')
    expect(result.markdown).toContain(`<!-- depress review ${malformed.tokenId} -->`)
    expect(result.replacements).toEqual([])
    expect(JSON.stringify(host.sourceView)).not.toContain('PRIVATE')
    expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE')
    for (const changed of [prepared.replace(malformed.marker, ''), prepared + malformed.marker]) {
      await expect(host.transform(bad, changed, media)).rejects.toThrow('PLUGIN_OUTPUT_REJECTED')
    }
  })
  it.each([1, 2])('P04 owns the complete multiline boundary (%s newlines), not its inner prose', async breaks => {
    const content = `<p>First.</p>[unknown-widget${'\n'.repeat(breaks)}internal="PRIVATE"]Safe inner prose.[/unknown-widget]<p>Tail.</p>`
    const bad = { ...item, content }
    const tokens = scanShortcodes(content, bad.key)
    expect(tokens).toHaveLength(2)
    expect(content.slice(tokens[0].start, tokens[0].end)).toBe(`[unknown-widget${'\n'.repeat(breaks)}internal="PRIVATE"]`)
    expect(tokens[0].malformed).toBeUndefined()
    expect(shortcodeSourceText(content, bad.key)).toBe('<p>First.</p>Safe inner prose.<p>Tail.</p>')
    const host = createStaticPluginHost({ ...source, items: [bad] })
    expect(host.prepare(bad).content).not.toContain('PRIVATE')
    const result = await host.transform(bad, host.prepare(bad).content, {})
    expect(result.markdown).not.toContain('PRIVATE')
    expect(result.markdown).toContain('Safe inner prose.')
    expect(result.replacements).toEqual([])
  })
  it('P09 malformed owned-looking gallery stays unowned and rolls back adjacent valid gallery', async () => {
    const bad = { ...item, content: '[gallery ids="11,12"] safe [gallery ids="PRIVATE] inner safe.' }
    const host = createStaticPluginHost({ ...source, items: [bad] }, config)
    const result = await host.transform(bad, host.prepare(bad).content, media)
    expect(result.replacements).toEqual([])
    expect(result.markdown).not.toContain('![')
    expect(result.markdown).not.toContain('PRIVATE')
    expect(result.markdown).toContain('inner safe.')
    expect(result.diagnostics).toEqual([1, 0].map(index => expect.objectContaining({ code: 'WP_SHORTCODE_UNRESOLVED', tokenId: host.tokens(bad)[index].tokenId })))
  })
  it('P05 preserves ordered local gallery images, default off is unresolved', async () => {
    const host = createStaticPluginHost(source, config)
    const prepared = host.prepare(item)
    expect(prepared.content).not.toContain('12,11')
    const result = await host.transform(item, prepared.content, media)
    expect(result.markdown).toContain('![Second](/media/b.png)\n\n![Первый & ordinary](/media/a.png)')
    expect(result.diagnostics).toEqual([])
    expect(result.replacements).toHaveLength(1)
    expect((await createStaticPluginHost(source).transform(item, prepared.content, media)).diagnostics[0].code).toBe('WP_SHORTCODE_UNRESOLVED')
  })
  it.each(['', 'ids=""', 'ids="11,11"', 'ids="-1"', 'ids="1e1"', 'ids="11,99"', 'ids="11" columns="2"', 'ids="11" ids="12"'])('P06 no partial replacement for %s', async attrs => {
    const bad = { ...item, content: `[gallery ${attrs}]` }
    const host = createStaticPluginHost({ ...source, items: [bad] }, config)
    const r = await host.transform(bad, host.prepare(bad).content, media)
    expect(r.replacements).toEqual([]); expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0].classification).toBe('manual-review')
    expect(r.markdown).not.toContain('![')
  })
  it.each([{}, { api: 'v2', plugins: [] }, { ...config, plugins: [...config.plugins, ...config.plugins] }, { ...config, extra: 1 }, { ...config, plugins: [{ id: '../evil', version: '1', options: {} }] }, { ...config, plugins: [{ ...config.plugins[0], version: '2' }] }, { ...config, plugins: [{ ...config.plugins[0], options: { anything: true } }] }])('P08 strict invalid config', value => {
    expect(() => validateStaticPluginConfig(value)).toThrow('PLUGIN_CONFIG_INVALID')
  })
  it('P07/P11 projections are safe, deterministic and omit raw metadata/content', async () => {
    const s = { ...source, items: [{ ...item, content: '[contact-form password="PRIVATE"]', customFields: { secret: 'PRIVATE' } }] }
    const host = createStaticPluginHost(s)
    expect(JSON.stringify(host.sourceView)).not.toContain('PRIVATE')
    expect(host.sourceView.coverage.pluginTables).toBe('not-assessed')
    expect(host.sourceView.items[0].featureRefs).toHaveLength(1)
    expect(Object.isFrozen(host.sourceView.items[0])).toBe(true)
    const a = await host.transform(s.items[0], host.prepare(s.items[0]).content, {})
    const b = await host.transform(s.items[0], host.prepare(s.items[0]).content, {})
    expect(a).toEqual(b); expect(a.diagnostics[0].classification).toBe('unsupported-dynamic')
    expect(JSON.stringify(a.diagnostics)).not.toContain('PRIVATE')
  })
  it('P09 rolls back a valid gallery when a neighboring unsupported token needs review', async () => {
    const mixed = { ...item, content: '[gallery ids="11,12"][unknown]' }
    const host = createStaticPluginHost({ ...source, items: [mixed] }, config)
    const r = await host.transform(mixed, host.prepare(mixed).content, media)
    expect(r.replacements).toEqual([]); expect(r.markdown).not.toContain('![')
    expect(r.diagnostics.map(d => d.code)).toContain('WP_SHORTCODE_UNRESOLVED')
  })
  it('P10 rejects altered alt and accepts exactly host-issued canonical images', () => {
    const valid = { replacements: [{ tokenId: 'one', markdown: '![Second](/media/b.png)' }], diagnostics: [] }
    expect(validateReplacements(valid, [{ tokenId: 'one' }], media)).toEqual(valid)
    expect(() => validateReplacements({ ...valid, replacements: [{ tokenId: 'one', markdown: '![Fake](/media/b.png)' }] }, [{ tokenId: 'one' }], media)).toThrow('PLUGIN_OUTPUT_REJECTED')
  })
  it('P03 duplicate source IDs fail before transforms', () => {
    expect(() => createStaticPluginHost({ ...source, items: [item, { ...item, key: '1:page:1', type: 'page' }] })).toThrow('duplicate-source-id')
  })
  it('P09 catches exceptions/rejection/timeouts and bounds hook results', async () => {
    for (const hook of [() => { throw new Error('PRIVATE') }, async () => { throw new Error('PRIVATE') }, () => new Promise(() => {})]) {
      await expect(runHook(hook, {}, 10)).rejects.toThrow(/PLUGIN_EXECUTION_FAILED/)
    }
    await expect(runHook(() => ({ value: 'a'.repeat(1_048_577) }), {})).rejects.toThrow('PLUGIN_BUDGET_EXCEEDED')
  })
  it('P08/P11 rejects competing ownership before any hook runs', () => {
    const plugin = { id: 'test', api: config.api, version: '1', ownsTokens: ['gallery'], inspectSource: () => [], transformItem: () => ({ replacements: [], diagnostics: [] }) } as RegisteredStaticPlugin
    expect(() => validateConfig({ ...config, plugins: [{ id: 'a', version: '1', options: {} }, { id: 'b', version: '1', options: {} }] }, [{ ...plugin, id: 'a' }, { ...plugin, id: 'b' }])).toThrow('PLUGIN_CONFIG_INVALID')
  })
  it.each(['<img src="/media/a.png">', '{danger}', 'import x from "x"', '![x](https://evil.test/a.png)', '![x](/media/../a.png)', '![x](/media/a.png)\n<script>x</script>', '![x](/media/a.png)\u0000', '![x](/media/a.png) extra', '![x](//evil/a.png)'])('P10 rejects unsafe Markdown: %s', markdown => {
    expect(() => validateReplacements({ replacements: [{ tokenId: 'one', markdown }], diagnostics: [] }, [{ tokenId: 'one' }], media)).toThrow('PLUGIN_OUTPUT_REJECTED')
  })
  it('P10 rejects foreign/duplicate token and malformed diagnostics atomically', () => {
    for (const result of [{ replacements: [{ tokenId: 'foreign', markdown: '![x](/media/a.png)' }], diagnostics: [] }, { replacements: [{ tokenId: 'one', markdown: '![x](/media/a.png)' }, { tokenId: 'one', markdown: '![x](/media/a.png)' }], diagnostics: [] }, { replacements: [], diagnostics: [{ code: 'PRIVATE', message: '<script>secret</script>' }] }]) expect(() => validateReplacements(result, [{ tokenId: 'one' }], media)).toThrow('PLUGIN_OUTPUT_REJECTED')
  })
})
