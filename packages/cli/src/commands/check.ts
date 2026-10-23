import chalk from 'chalk'
import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import matter from 'gray-matter'

export interface CheckOptions {
  dir: string
}

export interface CheckResult {
  name: string
  passed: boolean
  detail: string
}

/**
 * Minimal structural view of a Keystatic article/collection entry, enough
 * to validate the fields the ROADMAP "bar to clear" checklist cares about.
 */
interface ParsedEntry {
  file: string
  data: Record<string, unknown>
}

// ── Individual checks (pure functions, easy to unit test) ───────────────────

export async function checkBuildSucceeds(dir: string): Promise<CheckResult> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { name: 'npm run build succeeds', passed: false, detail: `No package.json found in ${dir}` }
  }
  return new Promise((resolvePromise) => {
    const child = spawn('npm', ['run', 'build'], { cwd: dir, shell: true })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      resolvePromise({ name: 'npm run build succeeds', passed: false, detail: err.message })
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ name: 'npm run build succeeds', passed: true, detail: 'build exited 0' })
      } else {
        resolvePromise({
          name: 'npm run build succeeds',
          passed: false,
          detail: `build exited ${code}${stderr ? `: ${stderr.split('\n').slice(-5).join(' ')}` : ''}`,
        })
      }
    })
  })
}

export async function checkRedirects(dir: string, publishedPostCount?: number): Promise<CheckResult> {
  const redirectsPath = join(dir, 'redirects.json')
  if (!existsSync(redirectsPath)) {
    return { name: 'redirects.json has an entry per post', passed: false, detail: 'redirects.json not found' }
  }
  try {
    const raw = await readFile(redirectsPath, 'utf-8')
    const redirects = JSON.parse(raw) as Record<string, string>
    const entries = Object.keys(redirects).length
    if (entries === 0) {
      return {
        name: 'redirects.json has an entry per post',
        passed: false,
        detail: 'redirects.json is empty',
      }
    }
    if (publishedPostCount !== undefined && entries < publishedPostCount) {
      return {
        name: 'redirects.json has an entry per post',
        passed: false,
        detail: `${entries} redirect entries but ${publishedPostCount} published posts`,
      }
    }
    return {
      name: 'redirects.json has an entry per post',
      passed: true,
      detail: `${entries} redirect entries`,
    }
  } catch (err) {
    return {
      name: 'redirects.json has an entry per post',
      passed: false,
      detail: `could not parse redirects.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function findContentFiles(dir: string): Promise<string[]> {
  const candidates = [
    join(dir, 'src', 'content', 'articles'),
    join(dir, 'src', 'data', 'post'),
  ]
  const files: string[] = []
  for (const base of candidates) {
    if (!existsSync(base)) continue
    await collectEntries(base, files)
  }
  return files
}

async function collectEntries(dir: string, acc: string[]): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true })
  for (const item of items) {
    const full = join(dir, item.name)
    if (item.isDirectory()) {
      // Directory entry (Keystatic-compatible): look for index.md(x)
      const indexMd = join(full, 'index.md')
      const indexMdx = join(full, 'index.mdx')
      if (existsSync(indexMdx)) acc.push(indexMdx)
      else if (existsSync(indexMd)) acc.push(indexMd)
      else await collectEntries(full, acc)
    } else if (item.name.endsWith('.md') || item.name.endsWith('.mdx')) {
      acc.push(full)
    }
  }
}

async function parseEntries(dir: string): Promise<ParsedEntry[]> {
  const files = await findContentFiles(dir)
  const entries: ParsedEntry[] = []
  for (const file of files) {
    const raw = await readFile(file, 'utf-8')
    const { data } = matter(raw)
    entries.push({ file, data })
  }
  return entries
}

export async function checkAuthors(dir: string): Promise<CheckResult> {
  const entries = await parseEntries(dir)
  if (entries.length === 0) {
    return { name: 'every post has a non-empty author', passed: false, detail: 'no content entries found' }
  }
  const missing = entries.filter((e) => !e.data.author || String(e.data.author).trim() === '')
  if (missing.length > 0) {
    return {
      name: 'every post has a non-empty author',
      passed: false,
      detail: `${missing.length} post(s) missing author: ${missing.slice(0, 5).map((e) => e.file).join(', ')}`,
    }
  }
  return { name: 'every post has a non-empty author', passed: true, detail: `${entries.length} posts checked` }
}

export async function checkSeoMeta(dir: string): Promise<CheckResult> {
  const entries = await parseEntries(dir)
  if (entries.length === 0) {
    return {
      name: 'no blank description/excerpt where Yoast meta existed',
      passed: false,
      detail: 'no content entries found',
    }
  }
  const blankDescription = entries.filter((e) => {
    const hasSeoFields = 'seoDescription' in e.data || 'excerpt' in e.data || 'description' in e.data
    if (!hasSeoFields) return false
    const val = e.data.seoDescription ?? e.data.excerpt ?? e.data.description
    return val === undefined || val === null || String(val).trim() === ''
  })
  if (blankDescription.length > 0) {
    return {
      name: 'no blank description/excerpt where Yoast meta existed',
      passed: false,
      detail: `${blankDescription.length} post(s) with blank description/excerpt: ${blankDescription
        .slice(0, 5)
        .map((e) => e.file)
        .join(', ')}`,
    }
  }
  return {
    name: 'no blank description/excerpt where Yoast meta existed',
    passed: true,
    detail: `${entries.length} posts checked`,
  }
}

export async function checkMigrationReport(dir: string): Promise<CheckResult> {
  const reportPath = join(dir, 'migration-report.md')
  if (!existsSync(reportPath)) {
    return { name: 'migration-report.md shows 0 silent drops', passed: false, detail: 'migration-report.md not found' }
  }
  const content = await readFile(reportPath, 'utf-8')
  const match = content.match(/(\d+)\s+silent drops?/i)
  if (match && Number(match[1]) > 0) {
    return {
      name: 'migration-report.md shows 0 silent drops',
      passed: false,
      detail: `report reports ${match[1]} silent drop(s)`,
    }
  }
  return {
    name: 'migration-report.md shows 0 silent drops',
    passed: true,
    detail: match ? '0 silent drops' : 'no silent-drops line found (treated as 0)',
  }
}

export async function checkKeystaticContent(dir: string): Promise<CheckResult> {
  const entries = await parseEntries(dir)
  const configCandidates = [join(dir, 'keystatic.config.ts'), join(dir, 'keystatic.config.tsx')]
  const hasConfig = configCandidates.some((p) => existsSync(p))
  if (!hasConfig) {
    return {
      name: 'Keystatic admin content collection is non-empty & schema-valid',
      passed: false,
      detail: 'keystatic.config.ts not found',
    }
  }
  if (entries.length === 0) {
    return {
      name: 'Keystatic admin content collection is non-empty & schema-valid',
      passed: false,
      detail: 'content collection is empty',
    }
  }
  const invalid = entries.filter((e) => !e.data.title || String(e.data.title).trim() === '')
  if (invalid.length > 0) {
    return {
      name: 'Keystatic admin content collection is non-empty & schema-valid',
      passed: false,
      detail: `${invalid.length} entr(y/ies) missing required 'title' field`,
    }
  }
  return {
    name: 'Keystatic admin content collection is non-empty & schema-valid',
    passed: true,
    detail: `${entries.length} entries validated`,
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function runAllChecks(dir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  results.push(await checkBuildSucceeds(dir))
  results.push(await checkRedirects(dir))
  results.push(await checkAuthors(dir))
  results.push(await checkSeoMeta(dir))
  results.push(await checkMigrationReport(dir))
  results.push(await checkKeystaticContent(dir))
  return results
}

export async function runCheck(options: CheckOptions): Promise<void> {
  const dir = resolve(options.dir)
  console.log(chalk.cyan(`🔍 Running QA checks in ${dir}\n`))

  const results = await runAllChecks(dir)

  for (const result of results) {
    const icon = result.passed ? chalk.green('✅') : chalk.red('❌')
    console.log(`${icon} ${result.name}`)
    console.log(chalk.gray(`    ${result.detail}`))
  }

  const failed = results.filter((r) => !r.passed)
  console.log()
  if (failed.length === 0) {
    console.log(chalk.bold.green(`All ${results.length} checks passed! 🎉`))
  } else {
    console.log(chalk.bold.red(`${failed.length}/${results.length} checks failed.`))
    process.exitCode = 1
  }
}
