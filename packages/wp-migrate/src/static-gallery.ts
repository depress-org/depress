import type { ItemView, RegisteredStaticPlugin } from './static-plugin-host.js'
import { diagnostic, imageMarkdown } from './static-plugin-host.js'

/** Reviewed in-tree demonstrator; no filesystem/network/process access. */
export const staticGallery: RegisteredStaticPlugin = Object.freeze({
  id: 'core.static-gallery', version: '1', api: 'depress.static-plugin/v1', ownsTokens: ['gallery'],
  inspectSource: () => [],
  transformItem(view: ItemView) {
    const replacements: Array<{ tokenId: string; markdown: string }> = []
    for (const token of view.tokens) {
      const fail = (code: 'GALLERY_ATTRIBUTES_UNSUPPORTED' | 'GALLERY_MEDIA_UNRESOLVED') => ({ replacements: [], diagnostics: [diagnostic(code, view.sourceId, token.tokenId, 'core.static-gallery')] })
      if (!token.valid || Object.keys(token.attrs).join(',') !== 'ids' || !/^\s*[1-9]\d*(?:\s*,\s*[1-9]\d*)*\s*$/.test(token.attrs.ids)) return fail('GALLERY_ATTRIBUTES_UNSUPPORTED')
      const ids = token.attrs.ids.split(',').map(id => id.trim())
      if (ids.some(id => !Number.isSafeInteger(Number(id))) || new Set(ids).size !== ids.length) return fail('GALLERY_ATTRIBUTES_UNSUPPORTED')
      const images: string[] = []
      for (const id of ids) {
        const media = view.mediaBySourceId[id]
        if (!media || media.copyStatus !== 'copied') return fail('GALLERY_MEDIA_UNRESOLVED')
        try { images.push(imageMarkdown(media.alt, media.publicUrl)) } catch { return fail('GALLERY_MEDIA_UNRESOLVED') }
      }
      replacements.push({ tokenId: token.tokenId, markdown: images.join('\n\n') })
    }
    return { replacements, diagnostics: [] }
  },
})
