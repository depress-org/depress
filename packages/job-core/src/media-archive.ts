import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { performance } from 'node:perf_hooks'
import * as yauzl from 'yauzl'
import { createRequire } from 'node:module'
const crc32 = createRequire(import.meta.url)('buffer-crc32') as { unsigned(data: Buffer, previous?: number): number }

export interface MediaArchiveLimits {
  compressedBytes: number
  expandedBytes: number
  fileBytes: number
  entries: number
  depth: number
  timeoutMs: number
}
export const DEFAULT_MEDIA_ARCHIVE_LIMITS: Readonly<MediaArchiveLimits> = Object.freeze({
  compressedBytes: 20 * 1024 * 1024, expandedBytes: 100 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024, entries: 2000, depth: 10, timeoutMs: 30_000,
})
export class MediaArchiveError extends Error {
  constructor() { super('MEDIA_ARCHIVE_INVALID: Unsupported, unsafe or excessive media ZIP'); this.name = 'MediaArchiveError' }
}
export interface IngestedMediaArchive {
  /** WordPress root, containing wp-content/uploads; never a user-supplied path. */
  mediaDir: string
  files: number
  expandedBytes: number
  cleanup(): Promise<void>
}
const extensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.mp4', '.webm', '.ogv', '.mp3', '.ogg', '.wav', '.pdf'])
const invalid = () => new MediaArchiveError()

/** ZIP only, exact wp-content/uploads layout. No subprocess, environment, network,
 * archive executables, symlinks or user-controlled destination. All central paths
 * and declared resources are validated before any directory/file is created.
 * The caller supplies its already-owned upload directory and owns final cleanup.
 */
export async function ingestMediaArchive(bytes: Buffer, ownedUploadDir: string, overrides: Partial<MediaArchiveLimits> = {}): Promise<IngestedMediaArchive> {
  const limits = { ...DEFAULT_MEDIA_ARCHIVE_LIMITS, ...overrides }
  if (Object.keys(overrides).some(k => !(k in DEFAULT_MEDIA_ARCHIVE_LIMITS)) ||
      Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0) ||
      !Buffer.isBuffer(bytes) || bytes.length > limits.compressedBytes || bytes.length < 22) throw invalid()
  const deadline = performance.now() + limits.timeoutMs
  let zip: yauzl.ZipFile | undefined, active: Readable | undefined, directory: string | undefined
  let expired = false
  const check = () => { if (expired || performance.now() >= deadline) throw invalid() }
  // Timeout cancels the actual reader; no Promise.race leaving extraction writes alive.
  const timer = setTimeout(() => { expired = true; active?.destroy(invalid()); zip?.close() }, limits.timeoutMs)
  try {
    zip = await new Promise<yauzl.ZipFile>((accept, reject) => {
      yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (err, archive) => err || !archive ? reject(invalid()) : accept(archive))
    })
    check()
    if (!zip.entryCount || zip.entryCount > limits.entries) throw invalid()
    const entries = await new Promise<yauzl.Entry[]>((accept, reject) => {
      const found: yauzl.Entry[] = []
      const error = () => reject(invalid())
      zip!.once('error', error); zip!.once('close', error)
      zip!.on('entry', entry => {
        try { check(); if (found.length >= limits.entries) throw invalid(); found.push(entry); zip!.readEntry() }
        catch { reject(invalid()) }
      })
      zip!.once('end', () => { zip!.removeListener('close', error); accept(found) })
      zip!.readEntry()
    })
    // Keep the error listener above installed so a late reader error is consumed.
    const names = new Map<string, boolean>(), spellings = new Map<string, string>(); let declared = 0, fileCount = 0
    for (const entry of entries) {
      check()
      const name = entry.fileName, isDir = name.endsWith('/'), clean = isDir ? name.slice(0, -1) : name
      const parts = clean.split('/')
      if (parts.length > limits.depth || clean.length > 512 || parts.some(p => !p || p === '.' || p === '..' || !/^[A-Za-z0-9_ .()-]+$/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw invalid()
      if (!(clean === 'wp-content' && isDir || clean === 'wp-content/uploads' && isDir || clean.startsWith('wp-content/uploads/'))) throw invalid()
      const type = (entry.externalFileAttributes >>> 16) & 0o170000
      if (type !== 0 && type !== (isDir ? 0o040000 : 0o100000) || entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) throw invalid()
      for (let i = 1; i <= parts.length; i++) {
        const spelling = parts.slice(0, i).join('/'), key = spelling.toLowerCase()
        if (spellings.has(key) && spellings.get(key) !== spelling) throw invalid()
        spellings.set(key, spelling)
      }
      const key = clean.toLowerCase()
      if (names.has(key)) throw invalid()
      names.set(key, isDir)
      if (isDir) { if (entry.uncompressedSize !== 0) throw invalid() }
      else {
        if (!extensions.has(extname(clean).toLowerCase()) || entry.uncompressedSize > limits.fileBytes) throw invalid()
        declared += entry.uncompressedSize; fileCount++
        if (!Number.isSafeInteger(declared) || declared > limits.expandedBytes) throw invalid()
      }
    }
    if (!fileCount) throw invalid()
    // Detect parent-as-file conflicts independent of entry ordering/case.
    for (const name of names.keys()) {
      const parts = name.split('/')
      for (let i = 1; i < parts.length; i++) if (names.get(parts.slice(0, i).join('/')) === false) throw invalid()
    }
    check()
    directory = await mkdtemp(join(resolve(ownedUploadDir), 'media-'))
    const root = directory; let expanded = 0
    for (const entry of entries) {
      check()
      if (entry.fileName.endsWith('/')) continue
      const dest = resolve(root, entry.fileName)
      if (!dest.startsWith(root + sep)) throw invalid()
      const source = await new Promise<Readable>((accept, reject) => zip!.openReadStream(entry, (err, stream) => err || !stream ? reject(invalid()) : accept(stream)))
      active = source
      const chunks: Buffer[] = []; let size = 0, crc = 0
      try {
        for await (const chunk of source) {
          check(); const data = Buffer.from(chunk); size += data.length; expanded += data.length
          if (size > limits.fileBytes || expanded > limits.expandedBytes || size > entry.uncompressedSize) throw invalid()
          crc = crc32.unsigned(data, crc); chunks.push(data)
        }
      } finally { source.destroy(); active = undefined }
      check()
      if (size !== entry.uncompressedSize || crc !== entry.crc32) throw invalid()
      await mkdir(resolve(dest, '..'), { recursive: true, mode: 0o700 }); check()
      const file = await open(dest, 'wx', 0o600)
      try { await file.writeFile(Buffer.concat(chunks, size)); check() } finally { await file.close() }
    }
    return { mediaDir: root, files: fileCount, expandedBytes: expanded,
      cleanup: () => rm(root, { recursive: true, force: true }) }
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true })
    throw invalid()
  } finally { clearTimeout(timer); active?.destroy(); zip?.close() }
}
