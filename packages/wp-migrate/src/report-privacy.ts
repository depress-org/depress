import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { scaffoldFiles } from './scaffold.js'

/** Narrow compatibility exception, NOT a proof for arbitrary user-authored Astro programs.
 * All executable source/config must be byte-identical to the canonical scaffold whose
 * route, home, blog and category readers exclude _drafts. Unknown readers fail closed.
 * Safe reader/listing is supplied by report.ts so symlink containment is retained.
 */
export async function proveScaffoldDraftExclusion(
  read: (path: string) => Promise<Buffer>,
  directory: (path: string) => Promise<string>,
): Promise<Record<string, Buffer>> {
  const yaml = (await read('site-config.yaml')).toString('utf8')
  const settings = matter(`---\n${yaml}\n---`, { engines: { javascript: () => { throw new Error('Executable settings') } } }).data
  const config = (await read('astro.config.mjs')).toString('utf8')
  const siteUrl = config.match(/^  site: '([^'\r\n]*)',$/m)?.[1]
  const { siteTitle, siteDescription } = settings
  // Scaffold interpolates these literals: do not allow interpolation to smuggle code
  // into what is being treated as a known, nonpublic reader. #24 owns escaping.
  if ([siteTitle, siteDescription, siteUrl].some(v => typeof v !== 'string' || /['"`$<>{}\\\r\n]/.test(v))) throw new Error('Unproven scaffold literals')
  const actual = new Map<string, Buffer>()
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(await directory(path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`
      if (child === 'src/content' || child === 'src/data/navigation.json') continue
      if (entry.isSymbolicLink()) throw new Error('Unproven source symlink')
      if (entry.isDirectory()) await walk(child)
      else actual.set(child, await read(child))
    }
  }
  await walk('src')
  for (const entry of await readdir(await directory(''), { withFileTypes: true })) {
    if (!entry.isDirectory() && /\.(?:[cm]?[jt]sx?|astro|mdx)$/.test(entry.name)) actual.set(entry.name, await read(entry.name))
  }
  actual.set('src/content/config.ts', await read('src/content/config.ts'))
  for (const path of ['astro.config.mjs', 'keystatic.config.ts', 'package.json', 'tsconfig.json', 'tailwind.config.mjs']) actual.set(path, await read(path))
  for (const hasCategories of [false, true]) for (const hasTags of [false, true]) {
    const expected = new Map(scaffoldFiles({ siteTitle, siteDescription, siteUrl: siteUrl!, authorName: '', navItems: [], hasCategories, hasTags })
      .filter(([path]) => actual.has(path)))
    if (actual.size === expected.size && [...actual].every(([path, bytes]) => expected.get(path) === bytes.toString('utf8'))) return Object.fromEntries(actual)
  }
  throw new Error('Public source/config differs from canonical draft-excluding scaffold')
}
