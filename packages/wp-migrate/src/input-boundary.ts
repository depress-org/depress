import { lstat, mkdir, readdir, realpath, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative, isAbsolute, join, dirname, parse } from 'node:path'

/** Decode exactly once; residual percent escapes are ambiguous to downstream tools. */
export function safeSegment(raw: string): string {
  if (typeof raw !== 'string') throw new Error('Invalid path segment')
  const value = decodeURIComponent(raw).normalize('NFC')
  if (!value || Buffer.byteLength(value) > 180 || !/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(value) ||
      /[. ]$/.test(value) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value))
    throw new Error('Unsafe path segment')
  return value
}

/** Reject rather than silently overwrite/rename ambiguous slugs or filenames. */
export function assertUniqueSegments(values: string[]): void {
  const seen = new Set<string>()
  for (const raw of values) {
    const key = safeSegment(raw).toLowerCase()
    if (seen.has(key)) throw new Error('Path collision')
    seen.add(key)
  }
}

async function noSymlinkAncestors(path: string): Promise<void> {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of relative(current, absolute).split('/').filter(Boolean)) {
    try {
      const siblings = await readdir(current)
      if (siblings.some(s => s !== part && s.normalize('NFC').toLowerCase() === part.normalize('NFC').toLowerCase())) throw new Error('Path case/normalization collision')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    current = join(current, part)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export async function containedPath(root: string, path: string): Promise<string> {
  const base = resolve(root), target = resolve(base, path)
  const rel = relative(base, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Path escapes output')
  await noSymlinkAncestors(target)
  // Verify real parents as well as lexical containment (for existing roots).
  await mkdir(base, { recursive: true })
  const realBase = await realpath(base)
  let ancestor = target
  while (true) {
    try {
      const real = await realpath(ancestor), check = relative(realBase, real)
      if (check === '..' || check.startsWith('../') || isAbsolute(check)) throw new Error('Realpath escapes output')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ancestor = dirname(ancestor)
    }
  }
  return target
}

/** Preflight caller-owned output/source trees; no symlink or case-fold aliases. */
export async function assertSafeTree(root: string): Promise<void> {
  await noSymlinkAncestors(root)
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = entry.name.normalize('NFC').toLowerCase()
    if (seen.has(key) || entry.isSymbolicLink()) throw new Error('Unsafe filesystem tree')
    seen.add(key)
    if (entry.isDirectory()) await assertSafeTree(join(root, entry.name))
    else if (!entry.isFile() || (await lstat(join(root, entry.name))).nlink !== 1) throw new Error('Special files/hardlinks are not allowed')
  }
}

export async function safeWriteFile(root: string, path: string, data: string | Uint8Array): Promise<void> {
  const target = await containedPath(root, path)
  await mkdir(dirname(target), { recursive: true })
  await containedPath(root, path)
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  try {
    if (!(await handle.stat()).isFile() || (await handle.stat()).nlink !== 1) throw new Error('Unsafe output file')
    await handle.truncate(0)
    await handle.writeFile(data)
  } finally { await handle.close() }
}
