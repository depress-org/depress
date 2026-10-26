import { XMLParser, XMLValidator } from 'fast-xml-parser'

export class SourceUploadError extends Error {
  constructor() { super('INVALID_SOURCE_UPLOAD: Expected WXR XML or SQL text for this role'); this.name = 'SourceUploadError' }
}
/** Admission only. No entity expansion, SQL execution, URL fetching or filename inference. */
export function validateSourceUpload(bytes: Buffer, role: 'wxr' | 'sql'): void {
  try {
    if (!bytes.length) throw new Error()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\0')) throw new Error()
    if (role === 'wxr') {
      if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error()
      const parsed = new XMLParser({ processEntities: false }).parse(text)
      if (!parsed?.rss?.channel?.['wp:wxr_version']) throw new Error()
    } else if (/^\s*</.test(text) || !/(?:^|\n)\s*(?:CREATE TABLE|INSERT INTO|DROP TABLE|SET\s|-- MySQL dump|-- MariaDB dump)/i.test(text)) throw new Error()
  } catch { throw new SourceUploadError() }
}
