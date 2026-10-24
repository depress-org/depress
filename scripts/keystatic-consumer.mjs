import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

/** Actual consumer CMS reader; filesystem API stays in Node test code, never worker routes. */
export async function verifyKeystaticConsumer(site, theme = 'scaffold', configSourceOverride) {
  const tmp = join(site, '.tmp/toolchain26')
  await mkdir(tmp, { recursive: true })
  const configSource = configSourceOverride ?? await readFile(join(site, 'keystatic.config.ts'), 'utf8')
  const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  await writeFile(join(tmp, configSourceOverride === undefined ? 'config.mjs' : 'example-config.mjs'), compiled)
  const { default: config } = await import(pathToFileURL(join(tmp, configSourceOverride === undefined ? 'config.mjs' : 'example-config.mjs')).href)
  const require = createRequire(join(site, 'package.json'))
  const { createReader } = await import(pathToFileURL(require.resolve('@keystatic/core/reader')).href)
  const reader = createReader(site, config)
  const collection = theme === 'scaffold' ? 'articles' : 'posts'
  const posts = await reader.collections[collection].list()
  assert(posts.includes('first-post'), `${theme}: CMS cannot enumerate emitted directory content`)
  const article = await reader.collections[collection].read('first-post')
  assert.equal(article?.title, 'First fixture post', `${theme}: CMS cannot read emitted article metadata`)
  assert.equal(typeof article?.content, 'function', `${theme}: CMS cannot edit migrated body`)
  const content = await article.content()
  assert(JSON.stringify(content).includes('First body marker alpha.'), `${theme}: CMS lost migrated body`)
  if (theme === 'scaffold') {
    const page = await reader.collections.pages.read('about')
    assert.equal(page?.title, 'About fixture page')
    assert(JSON.stringify(await page.content()).includes('Page body marker gamma.'), 'CMS lost page body')
  }
  console.log(JSON.stringify({ keystatic: 'PASS', theme, posts, title: article.title }))
}
