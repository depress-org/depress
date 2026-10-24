/** Navigation is always local; reject protocol-relative/control/scheme values. */
export function localHref(value: string): string {
  if (!/^\/(?!\/)/.test(value) || /[\x00-\x20\\]/.test(value)) throw new Error('Unsafe navigation URL')
  return value
}

/** Escape a plain string only at a known raw-HTML sink (not YAML/TS data). */
export function htmlText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/** A JS/TS data literal, also safe inside Astro expressions and frontmatter. */
export function sourceString(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}
