import { describe, it, expect, vi } from 'vitest'
import { fetchMedia, publicAddress, mediaUrl, MEDIA_LIMITS, rasterExtension, type MediaTransport } from '../media-fetch.js'
const address = { address: '93.184.216.34', family: 4 }
const body = Buffer.from([137,80,78,71,13,10,26,10])
const fake = (): MediaTransport => ({ resolve: vi.fn(async () => [address]), get: vi.fn(async (_url, _ip, _signal, consume) => { consume(body.length); return { status: 200, body } }) })
describe('#24 outbound media policy (mock DNS/transport only)', () => {
  it.each(['127.0.0.1','10.0.0.1','169.254.169.254','172.31.1.1','192.168.0.1','100.64.0.1','0.0.0.0','198.18.0.1','192.0.0.1','224.0.0.1','::1','::ffff:127.0.0.1','64:ff9b::a00:1','fc00::1','fe80::1','2001:db8::1','2002:a00::1','2001::1'])('denies nonpublic address %s', ip => expect(publicAddress(ip)).toBe(false))
  it.each(['http://media.example/a.jpg','https://name:secret@media.example/a.jpg','https://media.example:8080/a.jpg','https://2130706433/a.jpg','https://[::ffff:7f00:1]/a.jpg','https://localhost/a.jpg','file:///a.jpg'])('rejects URL before DNS/connect %s', value => expect(() => mediaUrl(value)).toThrow())
  it('accepts public IPv4 and global IPv6', () => {
    expect(publicAddress('93.184.216.34')).toBe(true)
    expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('rejects a mixed public/private DNS answer before any request', async () => {
    const io = fake(); io.resolve = vi.fn(async () => [address, { address: '10.1.2.3', family: 4 }])
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, io)).rejects.toThrow('DNS')
    expect(io.get).not.toHaveBeenCalled()
  })
  it('pins exactly the validated address rather than re-resolving', async () => {
    const io = fake()
    expect(await fetchMedia('https://media.example/a.png', { remaining: 100 }, io)).toEqual(body)
    expect(io.resolve).toHaveBeenCalledTimes(1)
    expect(vi.mocked(io.get).mock.calls[0][1]).toEqual(address)
  })
  it('rejects redirect into a private host before connection', async () => {
    const io = fake(); io.get = vi.fn(async () => ({ status: 302, location: 'https://127.0.0.1/a.jpg', body: Buffer.alloc(0) }))
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, io)).rejects.toThrow('Non-public')
    expect(io.get).toHaveBeenCalledTimes(1)
  })
  it('revalidates each redirect DNS answer (rebinding)', async () => {
    const io = fake(); let count = 0
    io.resolve = vi.fn(async () => ++count === 1 ? [address] : [{ address: '169.254.169.254', family: 4 }])
    io.get = vi.fn(async () => ({ status: 302, location: '/next.jpg', body: Buffer.alloc(0) }))
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, io)).rejects.toThrow('DNS')
    expect(io.get).toHaveBeenCalledTimes(1)
  })
  it('bounds redirects, streamed bytes and aggregate bytes', async () => {
    const io = fake(); io.get = vi.fn(async () => ({ status: 302, location: '/next.jpg', body: Buffer.alloc(0) }))
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, io)).rejects.toThrow('redirect limit')
    expect(io.get).toHaveBeenCalledTimes(MEDIA_LIMITS.maxRedirects + 1)
    io.get = vi.fn(async (_u,_ip,_s,consume) => { consume(MEDIA_LIMITS.maxBytes + 1); return { status: 200, body } })
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: MEDIA_LIMITS.totalBytes }, io)).rejects.toThrow('byte limit')
    await expect(fetchMedia('https://media.example/a.png', { remaining: 2 }, fake())).rejects.toThrow('byte limit')
  })
  it('bounds DNS and response hangs with one deadline', async () => {
    const io = fake(); io.resolve = () => new Promise(() => {})
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, io, 10)).rejects.toThrow('deadline')
    const stalled = fake(); stalled.get = () => new Promise(() => {})
    await expect(fetchMedia('https://media.example/a.jpg', { remaining: 100 }, stalled, 10)).rejects.toThrow('deadline')
  })
  it('permits only raster signatures, never active SVG/HTML', () => {
    expect(rasterExtension(body)).toBe('.png')
    expect(() => rasterExtension(Buffer.from('<svg><script/></svg>'))).toThrow()
    expect(() => rasterExtension(Buffer.from('<html>'))).toThrow()
  })
})
