import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { SourceManifest, WPExport } from '@depress-org/core'
import { convertSafeExport } from '../safe-convert.js'

const dirs: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp9sAAAAASUVORK5CYII=', 'base64')
const secret = Buffer.from('PRIVATE-ATTACHMENT-BYTES')
const privateBytes = Buffer.concat([png, secret])
const publicBytes = Buffer.concat([png, Buffer.from('public-image')])
const aliases = [
  'https://fixture.invalid/uploads/a.png?v=1',
  'https://fixture.invalid/uploads/a.png#alias',
  '/uploads/a.png?v=1',
  '/uploads/a.png#alias',
  'uploads//a.png?v=1',
  'uploads//a.png#alias',
  '/uploads/%61.png',
  '/%75ploads/a.png',
  'https://fixture.invalid/%75ploads/%61.png?q=1#fragment',
  '/uploads/%61%2Epng',
]
const cases = (['private', 'draft'] as const).flatMap(status =>
  (['native', 'featured'] as const).flatMap(reference =>
    ['https://fixture.invalid/uploads/a.png', 'uploads//a.png?source=1#source'].flatMap(sourceUrl =>
      aliases.map(alias => ({ status, reference, sourceUrl, alias }))),
  ),
)
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function fixture(sourceUrl = '/uploads/é.png', alias = '/uploads/e%CC%81.png', status = 'private', gallery = false) {
  await mkdir(resolve('.tmp'), { recursive: true })
  const dir = await mkdtemp(resolve('.tmp/private-alias-control-')); dirs.push(dir)
  const wpDir = join(dir, 'wp'), output = join(dir, 'site')
  await mkdir(join(wpDir, 'uploads'), { recursive: true })
  await mkdir(join(wpDir, 'other'), { recursive: true })
  for (const filename of ['a.png', 'é.png']) await writeFile(join(wpDir, 'uploads', filename), privateBytes)
  await writeFile(join(wpDir, 'uploads/b.png'), publicBytes)
  await writeFile(join(wpDir, 'other/a.png'), publicBytes)
  const post = {
    id: 1, title: 'Public', slug: 'public', status: 'publish' as const, type: 'post',
    date: '2024-01-01 00:00:00', author: 'fixture', excerpt: '', categories: [], tags: [],
    content: gallery ? '[gallery ids="12,13"]' : `<img src="/uploads/b.png"><img src="${alias}">`,
  }
  const media = [
    { id: 11, url: sourceUrl, filename: 'secret.png', mimeType: 'image/png', altText: 'Secret' },
    { id: 12, url: alias, filename: 'alias.png', mimeType: 'image/png', altText: 'Alias' },
    { id: 13, url: '/uploads/b.png', filename: 'b.png', mimeType: 'image/png', altText: 'Public' },
  ]
  const data: WPExport = { siteTitle: 'Fixture', siteUrl: 'https://fixture.invalid', posts: [post], categories: [], tags: [], media }
  const manifest: SourceManifest = {
    schemaVersion: 1, sourceSha256: 'a'.repeat(64), media,
    items: [{ ...post, key: '0:post:1' }, ...media.map((m, index) => ({
      key: `${index + 1}:attachment:${m.id}`, id: m.id, type: 'attachment',
      status: m.id === 11 ? status : 'inherit', slug: `image-${m.id}`, title: 'Image', author: 'fixture', content: '',
    }))],
    ...(gallery ? { staticPlugins: { api: 'depress.static-plugin/v1', plugins: [{ id: 'core.static-gallery', version: '1', options: {} }] } } : {}),
  }
  return { data, manifest, wpDir, output }
}

async function expectNoSecret(output: string) {
  const files = await readdir(output, { recursive: true, withFileTypes: true }).catch((error: { code?: string }) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const file of files.filter(file => file.isFile()))
    expect((await readFile(join(file.parentPath, file.name))).includes(secret)).toBe(false)
}

describe('#30 validated read identity controls', () => {
  it.each([
    ['/uploads/é.png', '/uploads/e%CC%81.png'],
    ['/uploads/e%CC%81.png', '/uploads/é.png'],
    ['/uploa%64s/%C3%A9.png', 'uploads//é.png?q=1#x'],
    ['/café/a.png', '/cafe%CC%81/%61.png'],
  ])('excludes NFC identity %s via %s', async (source, alias) => {
    const f = await fixture(source, alias)
    await mkdir(join(f.wpDir, 'café'), { recursive: true })
    await writeFile(join(f.wpDir, 'café/a.png'), privateBytes)
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(1)
    await expectNoSecret(f.output)
  })

  const invalid = ['/uploads/%.png', '/uploads/%GG.png', '/uploads/%2561.png', '/uploads/../uploads/a.png', '/uploads/%2e%2e/uploads/a.png', '/uploads/%252e%252e/a.png', '/uploads/a%2fb.png', '/uploads/a%5cb.png']
  it.each(invalid)('rejects native malformed/traversal reference before writes: %s', async alias => {
    const f = await fixture('/uploads/a.png', alias)
    await expect(convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).rejects.toThrow()
    await expect(readdir(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(invalid)('rejects invalid excluded identity before writes: %s', async source => {
    const f = await fixture(source, '/uploads/a.png')
    await expect(convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).rejects.toThrow()
    await expect(readdir(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(invalid)('does not normalize invalid gallery-only reference into a copy: %s', async alias => {
    const f = await fixture('/uploads/a.png', alias, 'private', true)
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(1)
    await expectNoSecret(f.output)
  })
  it.each(['private', 'draft'])('blocks public gallery alias of %s identity', async status => {
    const f = await fixture('/uploads/a.png', '/%75ploads/%61.png', status, true)
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(1)
    await expectNoSecret(f.output)
    expect(await readFile(join(f.output, 'src/content/articles/public/index.mdoc'), 'utf8')).not.toContain('/media/a.png')
  })
  it.each([false, true])('copies public percent/NFC alias (gallery: %s)', async gallery => {
    const filename = gallery ? 'a.png' : 'é.png'
    const f = await fixture(`/uploads/${filename}`, gallery ? '/%75ploads/%61.png' : '/%75ploads/e%CC%81.png', 'inherit', gallery)
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(2)
    expect(await readFile(join(f.output, 'public/media', filename))).toEqual(privateBytes)
    expect(await readFile(join(f.output, 'src/content/articles/public/index.mdoc'), 'utf8')).toContain(`/media/${encodeURIComponent(filename)}`)
  })
  it.each(['private', 'inherit'])('uses NFC directory identity for gallery with %s source', async status => {
    const f = await fixture('/café/a.png', '/cafe%CC%81/%61.png', status, true)
    await mkdir(join(f.wpDir, 'café'))
    await writeFile(join(f.wpDir, 'café/a.png'), privateBytes)
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(status === 'private' ? 1 : 2)
    if (status === 'private') await expectNoSecret(f.output)
    else {
      expect(await readFile(join(f.output, 'public/media/a.png'))).toEqual(privateBytes)
      expect(await readFile(join(f.output, 'src/content/articles/public/index.mdoc'), 'utf8')).toContain('/media/a.png')
    }
  })
  it('does not exclude a different directory with the same basename', async () => {
    const f = await fixture('/uploads/a.png', '/other/a.png')
    expect((await convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).imagesCopied).toBe(2)
    expect(await readFile(join(f.output, 'public/media/a.png'))).toEqual(publicBytes)
    await expectNoSecret(f.output)
  })
  it.each(['a.png', 'A.png'])('rejects public flattening/case collision: %s', async name => {
    const f = await fixture('/uploads/a.png', `/other/${name}`, 'inherit')
    if (name === 'A.png') {
      await rm(join(f.wpDir, 'other/a.png'))
      await writeFile(join(f.wpDir, 'other/A.png'), publicBytes)
    }
    f.data.posts[0].content += '<img src="/uploads/a.png">'
    await expect(convertSafeExport(f.data, f.output, f.wpDir, f.manifest)).rejects.toThrow(/collision|Unsafe filesystem tree/)
    await expect(readdir(f.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('#30 private attachment local-resource aliases', () => {
  it.each(cases)('excludes $status $reference $alias (source: $sourceUrl) from every public file', async ({ status, reference, sourceUrl, alias }) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const dir = await mkdtemp(resolve('.tmp/private-alias-')); dirs.push(dir)
    const wpDir = join(dir, 'wp'), output = join(dir, 'site')
    await mkdir(join(wpDir, 'uploads'), { recursive: true })
    await writeFile(join(wpDir, 'uploads/a.png'), privateBytes)
    await writeFile(join(wpDir, 'uploads/b.png'), publicBytes)
    const post = {
      id: 1, title: 'Public', slug: 'public', status: 'publish' as const, type: 'post',
      date: '2024-01-01 00:00:00', author: 'fixture', excerpt: '', categories: [], tags: [],
      content: '<img src="/uploads/b.png" alt="Public">' + (reference === 'native' ? `<img src="${alias}" alt="Secret">` : ''),
      featuredImageUrl: reference === 'featured' ? alias : undefined,
    }
    const media = { id: 11, url: sourceUrl, filename: 'a.png', mimeType: 'image/png', altText: 'Secret' }
    const data: WPExport = { siteTitle: 'Fixture', siteUrl: 'https://fixture.invalid', posts: [post], categories: [], tags: [], media: [media] }
    const manifest: SourceManifest = {
      schemaVersion: 1, sourceSha256: 'a'.repeat(64), media: [media],
      items: [
        { ...post, key: '0:post:1' },
        { key: '1:attachment:11', id: 11, type: 'attachment', status, slug: 'secret', title: 'Secret', author: 'fixture', content: '' },
      ],
    }
    expect((await convertSafeExport(data, output, wpDir, manifest)).imagesCopied).toBe(1)
    expect(await readFile(join(output, 'public/media/b.png'))).toEqual(publicBytes)
    await expect(readFile(join(output, 'public/media/a.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    const files = await readdir(join(output, 'public'), { recursive: true, withFileTypes: true })
    for (const file of files.filter(file => file.isFile())) {
      const bytes = await readFile(join(file.parentPath, file.name))
      expect(bytes.includes(privateBytes)).toBe(false)
      expect(bytes.includes(secret)).toBe(false)
    }
    const markdown = await readFile(join(output, 'src/content/articles/public/index.mdoc'), 'utf8')
    expect(markdown).not.toContain('/media/a.png')
    expect(markdown).not.toContain('coverImage:')
  })
})
