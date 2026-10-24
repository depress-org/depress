import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import { deflateRawSync } from 'node:zlib'
import { createRequire } from 'node:module'
const crc32 = createRequire(import.meta.url)('buffer-crc32') as { unsigned(data: Buffer, previous?: number): number }
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ingestMediaArchive } from '../media-archive.js'
import { Readable } from 'node:stream'
import * as yauzl from 'yauzl'
vi.mock('yauzl', async original => { const actual = await original<typeof import('yauzl')>(); return { ...actual, fromBuffer: vi.fn(actual.fromBuffer) } })

// Deliberately constructs hostile ZIPs; no shell, network or ZIP writer sanitization.
function zip(entries: { name: string; data?: Buffer; mode?: number; method?: number; badCrc?: boolean }[]) {
  let offset = 0; const locals: Buffer[] = [], centrals: Buffer[] = []
  for (const e of entries) {
    const name = Buffer.from(e.name), data = e.data ?? Buffer.from('fixture media'), method = e.method ?? 8
    const compressed = method === 8 ? deflateRawSync(data) : data
    const crc = e.badCrc ? 0 : crc32.unsigned(data)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((e.mode ?? 0o100644) * 65536) >>> 0, 38); central.writeUInt32LE(offset, 42)
    const bytes = Buffer.concat([local, name, compressed]); locals.push(bytes); centrals.push(Buffer.concat([central, name])); offset += bytes.length
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}
let root: string
const file = 'wp-content/uploads/2026/10/photo.png'
beforeEach(async () => { await mkdir(resolve('.tmp'), { recursive: true }); root = await mkdtemp(resolve('.tmp/archive-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const expectClean = async (bytes: Buffer, limits = {}) => {
  await expect(ingestMediaArchive(bytes, root, limits)).rejects.toThrow('MEDIA_ARCHIVE_INVALID')
  expect(await readdir(root)).toEqual([])
}
describe('shared bounded media archive ingestion', () => {
  it('rejects symlink upload root and symlink ancestors without creating output', async () => {
    const target = join(root, 'target'); await mkdir(target)
    await writeFile(join(target, 'marker'), 'unchanged')
    const link = join(root, 'link'); await symlink(target, link)
    for (const dir of [link, join(link, 'nested')]) {
      if (dir.endsWith('nested')) await mkdir(join(target, 'nested'))
      await expect(ingestMediaArchive(zip([{ name: file }]), dir)).rejects.toThrow('MEDIA_ARCHIVE_INVALID')
    }
    expect(await readdir(target)).toEqual(['marker', 'nested'])
    expect(await readdir(join(target, 'nested'))).toEqual([])
    expect(await readFile(join(target, 'marker'), 'utf8')).toBe('unchanged')
  })
  it('extracts only regular media into private owned WordPress-root layout and cleans idempotently', async () => {
    const archive = await ingestMediaArchive(zip([{ name: file }]), root)
    expect(await readFile(join(archive.mediaDir, file), 'utf8')).toBe('fixture media')
    expect(archive.files).toBe(1); expect(archive.expandedBytes).toBe(Buffer.byteLength('fixture media'))
    await archive.cleanup(); await archive.cleanup(); expect(await readdir(root)).toEqual([])
  })
  it.each(['../escape.png', '/absolute.png', 'C:/escape.png', 'wp-content/uploads/../escape.png', 'wp-content\\uploads\\escape.png', 'wp-content/uploads//x.png', 'wp-content/uploads/./x.png', 'wp-content/uploads/x\0.png', 'wp-content/uploads/%2e%2e/x.png', 'uploads/photo.png', 'wp-content/uploads/evil.php', 'wp-content/uploads/evil.svg'])('rejects path/layout/type %s before writing', async name => {
    await expectClean(zip([{ name: file }, { name }]))
  })
  it.each([0o120777, 0o020600, 0o010600])('rejects symlink/device/FIFO mode %s', async mode => { await expectClean(zip([{ name: file, mode }])) })
  it.each([file, file.toUpperCase()])('rejects duplicate/case conflict %s', async name => { await expectClean(zip([{ name: file }, { name }])) })
  it('rejects file/directory conflicts', async () => { await expectClean(zip([{ name: 'wp-content/uploads/a.png' }, { name: 'wp-content/uploads/a.png/b.png' }])) })
  it('rejects truncated and non-ZIP inputs', async () => { await expectClean(zip([{ name: file }]).subarray(0, 50)); await expectClean(Buffer.from('CREATE TABLE wp_options;')) })
  it('rejects invalid compressed data and CRC mismatch, cleaning partial extraction', async () => {
    await expectClean(zip([{ name: file, badCrc: true }]))
    const bytes = zip([{ name: file }]); bytes.fill(255, 30 + Buffer.byteLength(file), 35 + Buffer.byteLength(file)); await expectClean(bytes)
  })
  it('bounds compressed bytes, expanded bytes, entry count, nesting, per-file bytes and elapsed time', async () => {
    const bytes = zip([{ name: file, data: Buffer.alloc(4096) }])
    for (const limits of [{ compressedBytes: 20 }, { expandedBytes: 4000 }, { fileBytes: 4000 }, { depth: 3 }, { timeoutMs: 0 }]) await expectClean(bytes, limits)
    await expectClean(zip([{ name: file }, { name: 'wp-content/uploads/b.png' }]), { entries: 1 })
  })
  it('rejects empty archive and unsupported compression', async () => { await expectClean(zip([])); await expectClean(zip([{ name: file, method: 99 }])) })
  it('supports directory entries, stored files and multi-chunk CRCs', async () => {
    const data = Buffer.alloc(100_000, 42)
    const a = await ingestMediaArchive(zip([{ name: 'wp-content/', mode: 0o040755, data: Buffer.alloc(0) }, { name: 'wp-content/uploads/', mode: 0o040755, data: Buffer.alloc(0) }, { name: file, data, method: 0 }]), root)
    expect(await readFile(join(a.mediaDir, file))).toEqual(data); await a.cleanup()
  })
  it('rejects implicit parent case conflicts, reserved names and directory data', async () => {
    await expectClean(zip([{ name: 'wp-content/uploads/Abc/a.png' }, { name: 'wp-content/uploads/abc/b.png' }]))
    await expectClean(zip([{ name: 'wp-content/uploads/CON.png' }]))
    await expectClean(zip([{ name: 'wp-content/uploads/x./a.png' }]))
    await expectClean(zip([{ name: 'wp-content/uploads/', mode: 0o040755 }]))
  })
  it('real timeout destroys an active stalled reader, awaits cleanup and leaves no late writes', async () => {
    const original = vi.mocked(yauzl.fromBuffer).getMockImplementation()! as typeof yauzl.fromBuffer
    const stalled = new Readable({ read() {} })
    const spy = vi.spyOn(yauzl, 'fromBuffer').mockImplementation(((buffer: Buffer, options: import('yauzl').Options, callback: (error: Error | null, archive: import('yauzl').ZipFile) => void) => original(buffer, options, (error, archive) => {
      if (archive) archive.openReadStream = ((_entry: unknown, cb: (error: null, stream: Readable) => void) => cb(null, stalled)) as typeof archive.openReadStream
      callback(error, archive)
    })) as typeof yauzl.fromBuffer)
    try {
      await expectClean(zip([{ name: file }]), { timeoutMs: 100 })
      expect(stalled.destroyed).toBe(true)
      await new Promise(r => setTimeout(r, 20)); expect(await readdir(root)).toEqual([])
    } finally { spy.mockRestore(); stalled.destroy() }
  })
  it('enforces elapsed deadline independently of the timer callback', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2)
    try { await expectClean(zip([{ name: file }]), { timeoutMs: 1 }) } finally { clock.mockRestore() }
  })
  it('rejects encryption and forged declared expansion', async () => {
    const encrypted = zip([{ name: file }]); const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); encrypted.writeUInt16LE(1, central + 8)
    await expectClean(encrypted)
    const forged = zip([{ name: file, data: Buffer.alloc(100_000) }]); const c = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); forged.writeUInt32LE(1, c + 24)
    await expectClean(forged)
  })
  it('does not include unrelated synthetic environment data in extracted bytes', async () => {
    process.env.ARCHIVE_SYNTHETIC_SECRET = 'not archive data'
    try { const a = await ingestMediaArchive(zip([{ name: file }]), root); expect(await readFile(join(a.mediaDir, file), 'utf8')).not.toContain(process.env.ARCHIVE_SYNTHETIC_SECRET); await a.cleanup() }
    finally { delete process.env.ARCHIVE_SYNTHETIC_SECRET }
  })
})
