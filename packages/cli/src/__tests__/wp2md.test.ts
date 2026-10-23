import { describe, it, expect } from 'vitest'
import { patchXmlUrls, extractSiteUrl, resolveWp2mdBin } from '../commands/wp2md.js'

describe('extractSiteUrl', () => {
  it('extracts the site URL from a WXR <link> element', () => {
    const xml = '<rss><channel><link>https://instinsight.com</link></channel></rss>'
    expect(extractSiteUrl(xml)).toBe('https://instinsight.com')
  })

  it('falls back to example.com when no link element is present', () => {
    expect(extractSiteUrl('<rss><channel></channel></rss>')).toBe('https://example.com')
  })

  it('trims trailing whitespace around the URL', () => {
    const xml = '<link>https://foo.com  </link>'
    expect(extractSiteUrl(xml)).toBe('https://foo.com')
  })
})

describe('patchXmlUrls', () => {
  const localBase = 'http://127.0.0.1:54321'

  it('replaces https site origin with the local base', () => {
    const xml = '<url>https://instinsight.com/wp-content/uploads/foo.jpg</url>'
    const out = patchXmlUrls(xml, 'https://instinsight.com', localBase)
    expect(out).toContain(`${localBase}/wp-content/uploads/foo.jpg`)
    expect(out).not.toContain('instinsight.com')
  })

  it('replaces the http variant of the site origin too', () => {
    const xml = '<url>http://instinsight.com/wp-content/uploads/foo.jpg</url>'
    const out = patchXmlUrls(xml, 'https://instinsight.com', localBase)
    expect(out).toContain(`${localBase}/wp-content/uploads/foo.jpg`)
  })

  it('strips the /wp prefix from 127.0.0.1/wp/ URLs', () => {
    const xml = '<url>http://127.0.0.1/wp/wp-content/uploads/x.png</url>'
    const out = patchXmlUrls(xml, 'https://example.com', localBase)
    expect(out).toBe(`<url>${localBase}/wp-content/uploads/x.png</url>`)
  })

  it('makes relative wp:attachment_url CDATA absolute', () => {
    const xml = '<wp:attachment_url><![CDATA[/wp-content/uploads/pic.jpg]]></wp:attachment_url>'
    const out = patchXmlUrls(xml, 'https://example.com', localBase)
    expect(out).toContain(`${localBase}/wp-content/uploads/pic.jpg`)
  })

  it('makes relative <link> elements absolute', () => {
    const xml = '<link>/2020/01/my-post/</link>'
    const out = patchXmlUrls(xml, 'https://example.com', localBase)
    expect(out).toBe(`<link>${localBase}/2020/01/my-post/</link>`)
  })

  it('leaves unrelated content untouched', () => {
    const xml = '<title>Hello World</title>'
    expect(patchXmlUrls(xml, 'https://example.com', localBase)).toBe(xml)
  })
})

describe('resolveWp2mdBin', () => {
  it('resolves to the installed wordpress-export-to-markdown entry point', () => {
    // In the monorepo dev environment the dependency is hoisted to the workspace root,
    // so this should resolve without throwing.
    expect(() => resolveWp2mdBin()).not.toThrow()
    expect(resolveWp2mdBin()).toMatch(/wordpress-export-to-markdown[/\\]app\.js$/)
  })
})
