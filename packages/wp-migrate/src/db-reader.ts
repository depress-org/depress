import { readFile } from 'fs/promises'

export interface WPDBData {
  /** post_id → { meta_key: meta_value } */
  postMeta: Map<number, Record<string, string>>
  /** user_id → user data */
  users: Map<number, { login: string; displayName: string; email: string }>
  /** wp_options key → value */
  options: Record<string, string>
}

/**
 * Parse a WordPress MySQL dump (plain .sql text file) without a live DB connection.
 * Extracts wp_postmeta, wp_users, wp_usermeta (display_name), and wp_options.
 *
 * Works on mysqldump output with both single-row and multi-row INSERT statements.
 */
export async function readWPDatabase(sqlPath: string): Promise<WPDBData> {
  const sql = await readFile(sqlPath, 'utf-8')

  const postMeta = new Map<number, Record<string, string>>()
  const users = new Map<number, { login: string; displayName: string; email: string }>()
  const options: Record<string, string> = {}

  // Detect table prefix (most installs use `wp_` but it can differ)
  const prefixMatch = sql.match(/INSERT INTO `([a-z0-9_]+)postmeta`/i)
  const prefix = prefixMatch ? prefixMatch[1] : 'wp_'

  parsePostMeta(sql, prefix, postMeta)
  parseUsers(sql, prefix, users)
  parseUserMeta(sql, prefix, users)
  parseOptions(sql, prefix, options)

  return { postMeta, users, options }
}

// ── wp_postmeta ─────────────────────────────────────────────────────────────

function parsePostMeta(
  sql: string,
  prefix: string,
  out: Map<number, Record<string, string>>,
): void {
  // Match all INSERT INTO `wp_postmeta` blocks (single or multi-row)
  const tableRe = new RegExp(
    `INSERT INTO \`${escRe(prefix)}postmeta\`[^;]+;`,
    'gi',
  )
  for (const block of sql.matchAll(tableRe)) {
    const rows = extractRows(block[0])
    for (const row of rows) {
      // Columns: meta_id, post_id, meta_key, meta_value
      if (row.length < 4) continue
      const postId = toInt(row[1])
      const key = unquote(row[2])
      const val = unquote(row[3])
      if (!postId || !key) continue
      if (!out.has(postId)) out.set(postId, {})
      out.get(postId)![key] = val
    }
  }
}

// ── wp_users ─────────────────────────────────────────────────────────────────

function parseUsers(
  sql: string,
  prefix: string,
  out: Map<number, { login: string; displayName: string; email: string }>,
): void {
  const tableRe = new RegExp(
    `INSERT INTO \`${escRe(prefix)}users\`[^;]+;`,
    'gi',
  )
  for (const block of sql.matchAll(tableRe)) {
    const rows = extractRows(block[0])
    for (const row of rows) {
      // Columns: ID, user_login, user_pass, user_nicename, user_email,
      //          user_url, user_registered, user_activation_key, user_status, display_name
      if (row.length < 10) continue
      const id = toInt(row[0])
      if (!id) continue
      out.set(id, {
        login: unquote(row[1]),
        displayName: unquote(row[9]),
        email: unquote(row[4]),
      })
    }
  }
}

// ── wp_usermeta (display_name override from billing/profile meta) ─────────────

function parseUserMeta(
  sql: string,
  prefix: string,
  users: Map<number, { login: string; displayName: string; email: string }>,
): void {
  const tableRe = new RegExp(
    `INSERT INTO \`${escRe(prefix)}usermeta\`[^;]+;`,
    'gi',
  )
  for (const block of sql.matchAll(tableRe)) {
    const rows = extractRows(block[0])
    for (const row of rows) {
      // Columns: umeta_id, user_id, meta_key, meta_value
      if (row.length < 4) continue
      const userId = toInt(row[1])
      const key = unquote(row[2])
      const val = unquote(row[3])
      if (!userId) continue
      const user = users.get(userId)
      if (!user) continue
      // Some setups store a nicer display name in user meta
      if (key === 'first_name' || key === 'nickname') {
        if (val && val !== user.login) user.displayName = val
      }
    }
  }
}

// ── wp_options ───────────────────────────────────────────────────────────────

function parseOptions(
  sql: string,
  prefix: string,
  out: Record<string, string>,
): void {
  const tableRe = new RegExp(
    `INSERT INTO \`${escRe(prefix)}options\`[^;]+;`,
    'gi',
  )
  const INTERESTING = new Set([
    'siteurl', 'blogname', 'blogdescription', 'admin_email',
    'blogpublic', 'permalink_structure',
  ])
  for (const block of sql.matchAll(tableRe)) {
    const rows = extractRows(block[0])
    for (const row of rows) {
      // Columns: option_id, option_name, option_value, autoload
      if (row.length < 3) continue
      const key = unquote(row[1])
      if (INTERESTING.has(key)) {
        out[key] = unquote(row[2])
      }
    }
  }
}

// ── Row parsing helpers ──────────────────────────────────────────────────────

/**
 * Extract all VALUE tuples from an INSERT statement as arrays of raw token strings.
 * Handles: NULL, integers, single-quoted strings with escaped quotes.
 */
function extractRows(insertStatement: string): string[][] {
  // Find VALUES (...), (...), ...
  const valuesMatch = insertStatement.match(/VALUES\s*([\s\S]+);?\s*$/i)
  if (!valuesMatch) return []

  const valuesStr = valuesMatch[1].trim().replace(/;$/, '')
  const rows: string[][] = []
  let i = 0

  while (i < valuesStr.length) {
    // Skip whitespace and commas between tuples
    while (i < valuesStr.length && (valuesStr[i] === ',' || valuesStr[i] === '\n' || valuesStr[i] === '\r' || valuesStr[i] === ' ')) i++
    if (i >= valuesStr.length) break
    if (valuesStr[i] !== '(') { i++; continue }

    // Parse one tuple
    i++ // skip (
    const row: string[] = []
    while (i < valuesStr.length && valuesStr[i] !== ')') {
      // Skip whitespace and commas between fields
      while (i < valuesStr.length && (valuesStr[i] === ',' || valuesStr[i] === ' ' || valuesStr[i] === '\n')) i++
      if (i >= valuesStr.length || valuesStr[i] === ')') break

      if (valuesStr[i] === "'") {
        // Quoted string — scan to closing quote, respecting \' and ''
        let s = "'"
        i++
        while (i < valuesStr.length) {
          if (valuesStr[i] === '\\' && i + 1 < valuesStr.length) {
            s += valuesStr[i] + valuesStr[i + 1]
            i += 2
          } else if (valuesStr[i] === "'" && valuesStr[i + 1] === "'") {
            s += "''"
            i += 2
          } else if (valuesStr[i] === "'") {
            s += "'"
            i++
            break
          } else {
            s += valuesStr[i++]
          }
        }
        row.push(s)
      } else {
        // Unquoted token (NULL, integer, float)
        let tok = ''
        while (i < valuesStr.length && valuesStr[i] !== ',' && valuesStr[i] !== ')') {
          tok += valuesStr[i++]
        }
        row.push(tok.trim())
      }
    }
    if (i < valuesStr.length && valuesStr[i] === ')') i++ // skip )
    if (row.length > 0) rows.push(row)
  }

  return rows
}

/** Remove surrounding single quotes and unescape MySQL escape sequences */
function unquote(token: string): string {
  if (!token || token === 'NULL') return ''
  if (token.startsWith("'") && token.endsWith("'")) {
    return token
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/''/g, "'") // SQL standard escaping
  }
  return token
}

function toInt(token: string): number {
  const n = parseInt(token, 10)
  return isNaN(n) ? 0 : n
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
