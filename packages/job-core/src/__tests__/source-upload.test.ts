import { describe, expect, it } from 'vitest'
import { validateSourceUpload } from '../source-upload.js'
const wxr = '<rss><channel><wp:wxr_version>1.2</wp:wxr_version></channel></rss>'
describe('shared role admission', () => {
  it('admits WXR and SQL only in their explicit role', () => {
    expect(() => validateSourceUpload(Buffer.from(wxr), 'wxr')).not.toThrow()
    expect(() => validateSourceUpload(Buffer.from('-- MySQL dump\nINSERT INTO wp_options VALUES (1);'), 'sql')).not.toThrow()
  })
  it.each(['', 'PK\u0000binary', '\u0000', '<rss/>', '<rss><channel>', '<!DOCTYPE rss><rss/>', '<!ENTITY a "b"><rss/>', '-- MySQL dump'])('rejects invalid WXR %j', text => {
    expect(() => validateSourceUpload(Buffer.from(text), 'wxr')).toThrow('INVALID_SOURCE_UPLOAD')
  })
  it.each(['', 'PK\u0000binary', wxr, 'hello', '\u0000CREATE TABLE t()'])('rejects non-SQL role bytes %j', text => {
    expect(() => validateSourceUpload(Buffer.from(text), 'sql')).toThrow('INVALID_SOURCE_UPLOAD')
  })
  it('rejects non-UTF8 bytes without leaking them', () => {
    expect(() => validateSourceUpload(Buffer.from([0xff, 0xfe]), 'wxr')).toThrow('INVALID_SOURCE_UPLOAD')
  })
})
