import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: mocks.request }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
import { fetchMedia } from '../media-fetch.js'

describe('#24 actual HTTPS transport options with mocked sockets', () => {
  it('sets strict TLS, original host/SNI, pinned lookup, no agent/proxy, identity encoding and abort signal', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    mocks.request.mockImplementation((_url, _options, callback) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy: vi.fn() })
      const req = Object.assign(new EventEmitter(), { end: () => { callback(response); response.emit('data', Buffer.from('png')); response.emit('end') } })
      return req
    })
    expect((await fetchMedia('https://images.example/a.png', { remaining: 100 })).toString()).toBe('png')
    const [url, options] = mocks.request.mock.calls[0]
    expect(url.hostname).toBe('images.example')
    expect(options).toMatchObject({ rejectUnauthorized: true, agent: false, family: 4, headers: { 'Accept-Encoding': 'identity' } })
    const cb = vi.fn(); options.lookup('images.example', {}, cb)
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([{ 'content-length': '999999999' }, { 'content-encoding': 'gzip' }])('destroys oversized or compressed response %s', async headers => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const destroy = vi.fn()
    mocks.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), { end: () => callback({ statusCode: 200, headers, destroy }) }))
    await expect(fetchMedia('https://images.example/a.png', { remaining: 100 })).rejects.toThrow()
    expect(destroy).toHaveBeenCalled()
  })
})
