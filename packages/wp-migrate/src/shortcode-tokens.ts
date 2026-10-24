import { createHash } from 'node:crypto'

export interface ShortcodeToken {
  tokenId: string
  marker: string
  tag: string
  start: number
  end: number
  closing: boolean
  selfClosing: boolean
  malformed?: boolean
  rawAttributes: string
}

/** Conservative boundary lexer, not a WordPress interpreter. Quoted brackets,
 * HTML attributes/comments and escaped [[shortcodes]] cannot create tokens.
 * Unbalanced boundaries remain inventoried, never certified compatible.
 */
export function scanShortcodes(content: string, sourceKey: string): ShortcodeToken[] {
  const tokens: ShortcodeToken[] = []
  let prefix = 'DEPRESSOPAQUE'
  while (content.includes(prefix)) prefix += 'X'
  let i = 0
  while (i < content.length) {
    if (content.startsWith('<!--', i)) { const end = content.indexOf('-->', i + 4); i = end < 0 ? content.length : end + 3; continue }
    if (content[i] === '<' && /^<\/?[A-Za-z]/.test(content.slice(i))) {
      let quote = ''; i++
      for (; i < content.length; i++) {
        const ch = content[i]
        if (quote) { if (ch === quote) quote = '' }
        else if (ch === '"' || ch === "'") quote = ch
        else if (ch === '>') { i++; break }
      }
      continue
    }
    if (content.startsWith('[[', i)) { const end = content.indexOf(']]', i + 2); i = end < 0 ? content.length : end + 2; continue }
    if (content[i] !== '[') { i++; continue }
    const head = /^\[(\/)?([A-Za-z_][\w:-]*)(?=[\s/\]])/.exec(content.slice(i))
    if (!head) { i++; continue }
    const start = i, attrsStart = i + head[0].length
    let quote = '', end = attrsStart
    for (; end < content.length; end++) {
      const ch = content[end]
      if (quote) { if (ch === quote) quote = '' }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === ']') break
      else if (ch === '[' || ch === '\n' || ch === '\r') break
    }
    if (content[end] !== ']' || quote) {
      // Keep stable evidence for an unterminated candidate without claiming a
      // supported boundary or hiding its safe text from the converter.
      let stop = attrsStart
      while (stop < content.length && !['\n', '\r', '<', '['].includes(content[stop])) {
        if (content[stop++] === ']') break
      }
      const tokenId = createHash('sha256').update(`${sourceKey}:${start}:${stop}`).digest('hex')
      tokens.push({ tokenId, marker: `${prefix}${tokenId}M`, tag: head[2].toLowerCase(), start, end: stop,
        closing: !!head[1], selfClosing: false, rawAttributes: '', malformed: true })
      i = stop; continue
    }
    const raw = content.slice(attrsStart, end)
    const tokenId = createHash('sha256').update(`${sourceKey}:${start}:${end + 1}`).digest('hex')
    tokens.push({ tokenId, marker: `${prefix}${tokenId}M`, tag: head[2].toLowerCase(), start, end: end + 1,
      closing: !!head[1], selfClosing: /\/\s*$/.test(raw), rawAttributes: raw.replace(/\/\s*$/, '') })
    i = end + 1
  }
  return tokens
}

export function maskShortcodes(content: string, tokens: ShortcodeToken[]): string {
  let result = '', start = 0
  for (const token of tokens.filter(t => !t.malformed)) { result += content.slice(start, token.start) + token.marker; start = token.end }
  return result + content.slice(start)
}

/** Source prose excludes boundaries but retains ordinary inner HTML/text. */
export function shortcodeSourceText(content: string, sourceKey: string): string {
  let result = '', start = 0
  for (const token of scanShortcodes(content, sourceKey).filter(t => !t.malformed)) { result += content.slice(start, token.start); start = token.end }
  return result + content.slice(start)
}
