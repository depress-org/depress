import * as fs from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { ingestMediaArchive, validateSourceUpload } from '@depress-org/job-core'

export type FileRole = 'wxr' | 'sql' | 'media'
export interface IncomingFile { fileId: string; fileName?: string; size?: number }
export const uploadIO = { mkdir: fs.mkdir, mkdtemp: fs.mkdtemp, writeFile: fs.writeFile, rm: fs.rm }

/** Bounds the whole operation, including APIs/mocks that ignore AbortSignal. */
export async function deadline<T>(ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('IO_TIMEOUT')) }, ms) }),
    ])
  } finally { clearTimeout(timer); controller.abort() }
}

export class Uploads {
  private owned = new Set<string>()
  readonly root: string
  constructor(root: string, private maxBytes: number, private timeoutMs: number) { this.root = resolve(root) }
  async create(): Promise<string> {
    await uploadIO.mkdir(this.root, { recursive: true, mode: 0o700 })
    const dir = await uploadIO.mkdtemp(join(this.root, 'upload-'))
    this.owned.add(dir)
    return dir
  }
  async cleanup(dir?: string): Promise<void> {
    if (!dir || !this.owned.has(dir)) return
    // Bounded retries retain ownership until deletion actually succeeds. Never
    // propagate filesystem/provider details into chat or unhandled rejections.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await uploadIO.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
        this.owned.delete(dir)
        return
      } catch { /* retry only this server-owned path */ }
    }
    console.error('Owned bot upload cleanup failed after retries; operator cleanup required.')
  }
  accepts(file: IncomingFile, role: FileRole): boolean {
    return !!file.fileName && (role === 'wxr' ? /\.(xml|wxr)$/i : role === 'sql' ? /\.sql$/i : /\.zip$/i).test(file.fileName)
      && (file.size === undefined || Number.isSafeInteger(file.size) && file.size > 0 && file.size <= this.maxBytes)
  }
  async download(file: IncomingFile, role: FileRole, dir: string, getUrl: (signal: AbortSignal) => Promise<string>): Promise<string> {
    if (!this.owned.has(dir) || dirname(dir) !== this.root || !this.accepts(file, role)) throw new Error('INVALID_UPLOAD')
    // No external filename is ever passed to a filesystem API.
    const dest = join(dir, role === 'wxr' ? 'source.xml' : 'database.sql')
    const bytes = await deadline(this.timeoutMs, async signal => {
      const url = await getUrl(signal)
      if (signal.aborted) throw new Error('IO_TIMEOUT')
      const res = await fetch(url, { signal, redirect: 'error' })
      if (!res.ok || !res.body) throw new Error('DOWNLOAD_FAILED')
      const length = res.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > this.maxBytes)) { await res.body.cancel(); throw new Error('UPLOAD_TOO_LARGE') }
      const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
      const abort = () => { void reader.cancel().catch(() => {}) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (signal.aborted) throw new Error('IO_TIMEOUT')
          if (done) break
          size += value.byteLength
          if (size > this.maxBytes) { await reader.cancel(); throw new Error('UPLOAD_TOO_LARGE') }
          chunks.push(value)
        }
        if (!size) throw new Error('EMPTY_UPLOAD')
        return Buffer.concat(chunks)
      } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
    })
    if (role === 'media') return (await ingestMediaArchive(bytes, dir, { compressedBytes: this.maxBytes, timeoutMs: this.timeoutMs })).mediaDir
    validateSourceUpload(bytes, role)
    try { await uploadIO.writeFile(dest, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) { await uploadIO.rm(dest, { force: true }).catch(() => {}); throw error }
    return dest
  }
}
