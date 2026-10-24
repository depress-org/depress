import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { migrateSite } from '../services/migrate.js'
import { checkMigrationReport, checkAuthors, checkSeoMeta, checkRedirects } from '../commands/check.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('real service inventories posts/pages/drafts, preserves page author and Yoast and checks actual item bytes', async () => {
  await mkdir('.tmp', {recursive:true}); const root = await mkdtemp(resolve('.tmp/report-service-')); roots.push(root)
  let xml = await readFile(resolve('src/__fixtures__/offline-export.xml'), 'utf8')
  xml = xml.replace('</channel>', '<item><title>Hidden product</title><link>https://fixture.invalid/product/</link><pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate><content:encoded>Product body</content:encoded><wp:post_date>2024-01-01 12:00:00</wp:post_date><wp:post_id>99</wp:post_id><wp:post_name>product</wp:post_name><wp:status>publish</wp:status><wp:post_type>product</wp:post_type></item></channel>')
  const input = join(root,'export.xml'); await writeFile(input, xml)
  const output = join(root,'site'); const result = await migrateSite({input,output,theme:'scaffold'})
  const report = JSON.parse(await readFile(join(output,'migration-report.json'),'utf8'))
  expect(report.schemaVersion).toBe(1)
  expect(report.items.find((i:any) => i.id === 99).status).toBe('unsupported')
  expect(report.items.filter((i:any) => i.sourceStatus === 'publish' && ['post','page'].includes(i.type)).every((i:any) => i.status === 'migrated')).toBe(true)
  expect(result.qualityPassed).toBe(false)
  expect((await checkMigrationReport(output)).passed).toBe(false)
  expect((await checkAuthors(output)).passed).toBe(false)
  expect((await checkSeoMeta(output)).passed).toBe(false)
  expect((await checkRedirects(output)).passed).toBe(false)
},30_000)
it('missing source manifest never passes even when Markdown says zero drops', async () => {
  await mkdir('.tmp',{recursive:true}); const root=await mkdtemp(resolve('.tmp/report-check-')); roots.push(root)
  await writeFile(join(root,'migration-report.md'),'0 silent drops')
  expect((await checkMigrationReport(root)).passed).toBe(false)
  expect((await checkSeoMeta(root)).passed).toBe(false)
})
