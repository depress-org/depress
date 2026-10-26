import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, lstat, symlink, link, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectArtifact } from './collect-artifact.mjs'
import { POLICY, artifactBytes } from './protocol.mjs'

const temporary = fileURLToPath(new URL('../../.tmp/', import.meta.url))
async function fixture(t) {
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'collect-artifact-test-'))
  const client = join(root, 'client'), outside = join(root, 'outside')
  // Cleanup owns only this freshly allocated root, never .tmp or an existing path.
  t.after(async () => {
    try { assert.equal(await readFile(join(outside, 'marker.html'), 'utf8'), 'outside marker') }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  await mkdir(client)
  await mkdir(outside)
  await writeFile(join(outside, 'marker.html'), 'outside marker', { flag: 'wx' })
  return { client, outside }
}

test('collector accepts real nested directories with ordinary Linux link counts and preserves preview bytes', async t => {
  const { client } = await fixture(t)
  await mkdir(join(client, 'assets', 'nested'), { recursive: true })
  assert((await lstat(join(client, 'assets'))).nlink > 1)
  const expected = [
    { path: 'index.html', data: Buffer.from('<h1>Preview</h1>').toString('base64') },
    { path: 'assets/site.css', data: Buffer.from('body{}').toString('base64') },
    { path: 'assets/nested/icon.png', data: Buffer.from([0, 255, 1, 128]).toString('base64') },
  ]
  for (const file of expected) {
    await writeFile(join(client, file.path), Buffer.from(file.data, 'base64'))
    assert.equal((await lstat(join(client, file.path))).nlink, 1)
  }
  await writeFile(join(client, 'ignored.map'), 'not an allowed MIME type')
  const artifact = await collectArtifact(client)
  assert.equal(artifact.kind, 'preview-only')
  assert.deepEqual(artifact.files.sort((a, b) => a.path.localeCompare(b.path)), expected.sort((a, b) => a.path.localeCompare(b.path)))
  assert.equal(artifactBytes(artifact), expected.reduce((total, file) => total + Buffer.from(file.data, 'base64').length, 0))
})

for (const kind of ['file', 'directory', 'dangling']) test(`collector rejects a real ${kind} symlink without touching its outside target`, async t => {
  const { client, outside } = await fixture(t)
  const target = kind === 'directory' ? outside : join(outside, kind === 'file' ? 'marker.html' : 'missing.html')
  await symlink(target, join(client, kind === 'directory' ? 'linked' : 'linked.html'))
  await assert.rejects(collectArtifact(client), /Invalid artifact/)
})

for (const name of ['linked.html', 'linked.map']) test(`collector rejects real hardlinked file ${name}, even before MIME filtering`, async t => {
  const { client, outside } = await fixture(t)
  await link(join(outside, 'marker.html'), join(client, name))
  assert((await lstat(join(client, name))).nlink > 1)
  await assert.rejects(collectArtifact(client), /Invalid artifact/)
})

test('collector preserves the aggregate artifact-byte limit at and above the boundary', async t => {
  const { client } = await fixture(t)
  await writeFile(join(client, 'a.txt'), Buffer.alloc(POLICY.artifactBytes - 1, 65))
  await writeFile(join(client, 'b.txt'), 'B')
  assert.equal(artifactBytes(await collectArtifact(client)), POLICY.artifactBytes)
  await writeFile(join(client, 'b.txt'), 'BB')
  await assert.rejects(collectArtifact(client), /Artifact limit/)
})

test('collector preserves the 128-file limit at and above the boundary', async t => {
  const { client } = await fixture(t)
  for (let i = 0; i < 128; i++) await writeFile(join(client, `${i}.txt`), '')
  assert.equal((await collectArtifact(client)).files.length, 128)
  await writeFile(join(client, 'extra.txt'), '')
  await assert.rejects(collectArtifact(client), /Artifact limit/)
})

for (const path of ['.hidden.html', 'reports/report.json']) test(`collector preserves path rejection for ${path}`, async t => {
  const { client } = await fixture(t)
  if (path.includes('/')) await mkdir(join(client, 'reports'))
  await writeFile(join(client, path), 'not public')
  await assert.rejects(collectArtifact(client), /Invalid artifact path/)
})

test('collector preserves case-insensitive duplicate-path rejection', async t => {
  const { client } = await fixture(t)
  await writeFile(join(client, 'index.html'), 'one')
  await writeFile(join(client, 'INDEX.html'), 'two')
  await assert.rejects(collectArtifact(client), /Duplicate artifact path/)
})

test('preview excludes executable CMS bundles without truncating any admitted static content',async t=>{
 const {client}=await fixture(t)
 await writeFile(join(client,'index.html'),'<h1>All preview content</h1>')
 await writeFile(join(client,'cms.js'),Buffer.alloc(POLICY.artifactBytes+1,65))
 const artifact=await collectArtifact(client)
 assert.deepEqual(artifact.files,[{path:'index.html',data:Buffer.from('<h1>All preview content</h1>').toString('base64')}])
 assert.throws(()=>artifactBytes({kind:'preview-only',files:[{path:'cms.js',data:''}]}),/Invalid artifact path/)
})

test('collector rejects an empty artifact after MIME filtering', async t => {
  const { client } = await fixture(t)
  await writeFile(join(client, 'ignored.map'), 'not public')
  await assert.rejects(collectArtifact(client), /Invalid artifact/)
})
