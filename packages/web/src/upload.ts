import busboy from 'busboy'
import type { Limits } from './security.js'

export class UploadError extends Error {
  constructor(public readonly status: 400 | 408 | 413 | 415, message: string) { super(message) }
}
export interface Upload { fields: Record<string, string>; files: Map<string, Buffer> }
const fields = new Set(['theme', 'mode', 'deployTarget', 'projectName'])
const files = new Set(['wxr', 'sql'])

/** Streaming limits precede aggregation; never calls Request.formData/arrayBuffer. */
export async function readUpload(request: Request, limits: Readonly<Limits>): Promise<Upload> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.length > 256 || !/^multipart\/form-data\s*;/i.test(contentType))
    throw new UploadError(415, 'multipart/form-data required')
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d{1,16}$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    throw new UploadError(400, 'Invalid content length')
  if (declared !== null && Number(declared) > limits.requestBytes)
    throw new UploadError(413, 'Request too large')
  if (!request.body) throw new UploadError(400, 'Missing upload')
  let parser: ReturnType<typeof busboy>
  try {
    parser = busboy({ headers: { 'content-type': contentType }, limits: {
      // Busboy emits partsLimit when the count is reached (not exceeded).
      // Reserve one sentinel part; claim() rejects it before aggregation.
      fileSize: limits.fileBytes + 1, files: 2, fields: 4, parts: 7,
      fieldSize: 128, fieldNameSize: 32,
    } })
  } catch { throw new UploadError(400, 'Malformed multipart upload') }
  const reader = request.body.getReader()
  const result: Upload = { fields: Object.create(null), files: new Map() }
  const seen = new Set<string>()
  let error: UploadError | undefined
  let rejectFailure!: (err: UploadError) => void
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject })
  const fail = (err: UploadError) => {
    if (error) return
    error = err
    rejectFailure(err)
    // Do not await cancellation: a hostile/abandoned source may never acknowledge it.
    void reader.cancel().catch(() => {})
    parser.destroy()
  }
  let parts = 0
  const claim = (name: string, allowed: Set<string>) => {
    if (++parts > 6) { fail(new UploadError(413, 'Too many upload parts')); return false }
    if (!allowed.has(name) || seen.has(name)) {
      fail(new UploadError(400, 'Unknown or duplicate upload field'))
      return false
    }
    seen.add(name)
    return true
  }
  parser.on('file', (name, file) => {
    file.on('error', () => fail(new UploadError(400, 'Malformed file')))
    if (!claim(name, files)) { file.resume(); return }
    let size = 0
    const chunks: Buffer[] = []
    file.on('limit', () => fail(new UploadError(413, 'File too large')))
    file.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limits.fileBytes) { fail(new UploadError(413, 'File too large')); return }
      if (!error) chunks.push(Buffer.from(chunk))
    })
    file.on('end', () => {
      if (!error) result.files.set(name, Buffer.concat(chunks, size))
    })
  })
  parser.on('field', (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated) { fail(new UploadError(413, 'Field too large')); return }
    if (claim(name, fields)) result.fields[name] = value
  })
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
    parser.on(event, () => fail(new UploadError(413, 'Too many upload parts')))
  parser.on('error', () => fail(new UploadError(400, 'Malformed multipart upload')))
  const done = new Promise<void>((resolve) => parser.on('close', resolve))
  const timer = setTimeout(() => fail(new UploadError(408, 'Upload deadline exceeded')), limits.uploadMs)
  const aborted = () => fail(new UploadError(400, 'Upload aborted'))
  request.signal.addEventListener('abort', aborted, { once: true })
  if (request.signal.aborted) aborted()
  try {
    await Promise.race([failure, (async () => {
      let bytes = 0
      while (!error) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > limits.requestBytes) throw new UploadError(413, 'Request too large')
        // Busboy consumers above drain each bounded part synchronously.
        parser.write(value)
      }
      if (error) throw error
      if (declared !== null && Number(declared) !== bytes)
        throw new UploadError(400, 'Content length mismatch')
      parser.end()
      await done
      if (error) throw error
    })()])
    return result
  } catch (err) {
    const safe = err instanceof UploadError ? err : new UploadError(400, 'Malformed upload')
    fail(safe)
    throw safe
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', aborted)
    // A pending reader.read() can outlive this function after deadline; cancellation
    // was requested above and Promise.race observes its eventual rejection.
    if (!error) reader.releaseLock()
  }
}
