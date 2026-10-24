import chalk from 'chalk'
import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import matter from 'gray-matter'
import { validateMigrationReport } from '@depress-org/wp-migrate'

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

export async function checkRedirects(dir: string, _publishedPostCount?: number): Promise<CheckResult> {
  return { name: 'redirect targets match every source item', ...await validateMigrationReport(dir) }
}

async function findContentFiles(dir: string): Promise<string[]> {
  const candidates = [
    join(dir, 'src', 'content', 'articles'),
    join(dir, 'src', 'data', 'post'),
    join(dir, 'src', 'content', 'pages'),
    join(dir, 'src', 'content', 'blog'),
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
    } else if (/\.(md|mdx|mdoc)$/.test(item.name)) {
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
  return { name: 'authors match every source item', ...await validateMigrationReport(dir) }
}

export async function checkSeoMeta(dir: string): Promise<CheckResult> {
  return { name: 'source Yoast metadata preserved per item', ...await validateMigrationReport(dir) }
}

export async function checkMigrationReport(dir: string): Promise<CheckResult> {
  return { name: 'migration report matches source inventory and output', ...await validateMigrationReport(dir) }
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
