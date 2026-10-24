import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runMigrate, writeTaxonomy } from '../commands/migrate.js'
import { runWp2md } from '../commands/wp2md.js'
import { xml } from '../__fixtures__/single-export.js'
let root: string, input: string
beforeEach(async () => {
  await mkdir('.tmp', { recursive: true }); root = await mkdtemp(resolve('.tmp/security24-'))
  input = join(root, 'export.xml'); await writeFile(input, xml)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const run = (input: string, root: string, wpDir?: string) => runMigrate({ input, output: join(root, 'output'), theme: 'scaffold', wpDir })
describe('#24 actual migration boundary before conversion/fetch/write', () => {
  it.each(['../outside','%2e%2e%2foutside','%252e%252e%252foutside','bad%','a\\b','bad\nslug'])('rejects unsafe WXR slug %s before output exists', async slug => {
    await writeFile(input, xml.replace('<wp:post_name>hello</wp:post_name>', `<wp:post_name>${slug}</wp:post_name>`))
    await expect(run(input, root)).rejects.toThrow()
    expect(await readdir(root)).toEqual(['export.xml'])
  })
  it('rejects case-fold collisions before conversion', async () => {
    const item = xml.match(/<item>.*?<\/item>/s)![0].replace('<wp:post_name>hello', '<wp:post_name>Hello')
    await writeFile(input, xml.replace('</channel>', item + '</channel>'))
    await expect(run(input, root)).rejects.toThrow()
    expect(await readdir(root)).toEqual(['export.xml'])
  })
  it('checks taxonomy slugs before any category write', async () => {
    await expect(writeTaxonomy([{ slug: '%2e%2e%2foutside', name: 'Name', description: '' }], [], join(root, 'output'))).rejects.toThrow()
    expect(await readdir(root)).toEqual(['export.xml'])
  })
  it('rejects output and local-media symlink ancestors without modifying targets', async () => {
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'keep')
    await symlink(outside, join(root, 'output'))
    await expect(run(input, root)).rejects.toThrow()
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('keep')
  })
  it('copies a referenced local raster without a loopback file server or external download', async () => {
    const wpDir = join(root, 'wordpress'); await mkdir(join(wpDir, 'wp-content/uploads'), { recursive: true })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XkAAAAASUVORK5CYII=', 'base64')
    await writeFile(join(wpDir, 'wp-content/uploads/fixture.png'), png)
    await writeFile(input, xml.replace('Local fixture body.</p>', 'Local fixture body.</p><img src="https://fixture.invalid/wp-content/uploads/fixture.png">'))
    await expect(run(input, root, wpDir)).resolves.toMatchObject({ posts: 1 })
    expect(await readFile(join(root, 'output/public/media/fixture.png'))).toEqual(png)
    expect(await readFile(join(root, 'output/src/content/articles/hello/index.mdoc'), 'utf8')).toContain('/media/fixture.png')
  })
  it('never falls back to network when local raster is missing', async () => {
    const wpDir = join(root, 'wordpress'); await mkdir(wpDir)
    await writeFile(input, xml.replace('Local fixture body.</p>', 'Local fixture body.</p><img src="https://fixture.invalid/missing.png">'))
    await expect(run(input, root, wpDir)).rejects.toThrow()
  })
  it('rejects private-host media URL without probing it', async () => {
    await writeFile(input, xml.replace('Local fixture body.</p>', 'Local fixture body.</p><img src="https://127.0.0.1/pic.png">'))
    await expect(run(input, root)).rejects.toThrow()
    expect(await readdir(root)).toEqual(['export.xml'])
  })
  it('fails closed for raw upstream command and MDX-only themes', async () => {
    await expect(runWp2md({} as never)).rejects.toThrow('disabled')
    await expect(runMigrate({ input, output: join(root, 'output'), theme: 'rocket' })).rejects.toThrow('MDX-only')
    expect(await readdir(root)).toEqual(['export.xml'])
  })
})
