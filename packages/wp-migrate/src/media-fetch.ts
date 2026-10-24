import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request } from 'node:https'
import type { LookupFunction } from 'node:net'

export const MEDIA_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 3, maxFiles: 128, migrationTimeoutMs: 60_000 })
export interface MediaBudget { remaining: number }
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  // Fail closed on IPv4-mapped, NAT64, local, multicast, documentation and transition addresses.
  if (isIP(address) !== 6) return false
  const s = new URL(`https://[${address}]/`).hostname.slice(1, -1)
  const [first, second = 0] = s.split(':').map(part => parseInt(part || '0', 16))
  return first >= 0x2000 && first < 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && first !== 0x2002 && !s.includes('.')
}
export function mediaUrl(raw: string): URL {
  if (/[\x00-\x20\\]/.test(raw)) throw new Error('Invalid media URL')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash)
    throw new Error('Only credential-free HTTPS media on port 443 is allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !publicAddress(host)) throw new Error('Non-public media address')
  if (!isIP(host) && (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host))) throw new Error('Non-public media host')
  return url
}

interface ResponseData { status: number; location?: string; body: Buffer }
export interface MediaTransport {
  resolve(host: string): Promise<Array<{ address: string; family: number }>>
  get(url: URL, address: { address: string; family: number }, signal: AbortSignal, consume: (size: number) => void): Promise<ResponseData>
}
const transport: MediaTransport = {
  resolve: host => lookup(host, { all: true, verbatim: true }),
  get: (url, address, signal, consume) => new Promise((res, reject) => {
    // Connect only to the validated answer, preserving original SNI/hostname TLS verification.
    const pinned: LookupFunction = (_host, _options, cb) => cb(null, address.address, address.family)
    const req = request(url, { agent: false, lookup: pinned, family: address.family,
      rejectUnauthorized: true, signal, headers: { 'Accept-Encoding': 'identity', Accept: 'image/*' } }, response => {
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(new Error('Compressed media disabled')); return
      }
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        response.destroy(); res({ status, location: response.headers.location, body: Buffer.alloc(0) }); return
      }
      if (status !== 200) { response.destroy(); reject(new Error('Media response failed')); return }
      const length = Number(response.headers['content-length'])
      if (Number.isFinite(length) && length > MEDIA_LIMITS.maxBytes) { response.destroy(); reject(new Error('Media byte limit')); return }
      const parts: Buffer[] = []
      response.on('data', (part: Buffer) => {
        try { consume(part.length); parts.push(part) } catch (error) { response.destroy(error as Error) }
      })
      response.on('error', reject)
      response.on('end', () => res({ status, body: Buffer.concat(parts) }))
    })
    req.on('error', reject); req.end()
  }),
}

/** One deadline covers DNS, redirects and body. Budget is shared across a migration. No retries/proxies. */
export async function fetchMedia(raw: string, budget: MediaBudget, io: MediaTransport = transport, timeoutMs: number = MEDIA_LIMITS.timeoutMs): Promise<Buffer> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const operation = async () => {
    let url = mediaUrl(raw), size = 0
    for (let redirects = 0; ; redirects++) {
      if (controller.signal.aborted) throw new Error('Media deadline')
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await io.resolve(host)
      if (controller.signal.aborted) throw new Error('Media deadline')
      if (!answers.length || answers.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new Error('Non-public DNS response')
      const response = await io.get(url, answers[0], controller.signal, count => {
        size += count; budget.remaining -= count
        if (size > MEDIA_LIMITS.maxBytes || budget.remaining < 0) throw new Error('Media byte limit')
      })
      if (response.status === 200) return response.body
      if (![301,302,303,307,308].includes(response.status) || !response.location || redirects >= MEDIA_LIMITS.maxRedirects) throw new Error('Media redirect limit')
      url = mediaUrl(new URL(response.location, url).href)
    }
  }
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Media deadline')) }, timeoutMs)
    })])
  } finally { clearTimeout(timer); controller.abort() }
}

/** No active SVG/HTML, archives or executable formats in public artifacts. */
export function rasterExtension(data: Buffer): string {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return '.jpg'
  if (/^GIF8[79]a$/.test(data.subarray(0,6).toString())) return '.gif'
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return '.webp'
  throw new Error('Unsupported raster media')
}
