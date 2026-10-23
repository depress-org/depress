/**
 * Orchestration pipeline: queued -> migrating -> building -> deploying -> done/failed.
 *
 * This module is the ONLY place that calls into @depress-org/wp-migrate and the
 * depress CLI's check/deploy logic. packages/web and packages/telegram-bot both
 * import `runJob` from here — neither re-implements migration or deploy logic,
 * and neither shells out to the `depress` binary.
 */
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { listThemes, getThemeAdapter } from '@depress-org/wp-migrate'
import { runMigrate } from '@depress-org/depress/commands/migrate'
import { runDeploy, type DeployTarget } from '@depress-org/depress/commands/deploy'
import type { Job, JobInput, JobStore } from './types.js'

export { listThemes, getThemeAdapter }
export { InMemoryJobStore } from './types.js'
export type { Job, JobInput, JobStatus, JobStore, DeployTargetId } from './types.js'

export interface RunJobOptions {
  /** Called whenever the job's status changes, for progress reporting (web SSE, bot chat edits, etc). */
  onProgress?: (job: Job) => void
}

/**
 * Validate a theme id against the shared registry before a job is queued.
 * Both web and bot front-ends call this so the "pick a theme" UI stays
 * backed by the same source of truth as the CLI.
 */
export function isValidTheme(themeId: string): boolean {
  if (themeId === 'scaffold') return true
  return getThemeAdapter(themeId) !== undefined
}

async function setStatus(store: JobStore, id: string, status: Job['status'], extra?: Partial<Job>, onProgress?: (job: Job) => void) {
  const job = await store.update(id, { status, ...extra })
  onProgress?.(job)
  return job
}

/**
 * Run the full upload -> migrate -> deploy pipeline for a queued job.
 * Mutates job status in the given store as it progresses; never throws —
 * failures are recorded on the job as status 'failed' + error message.
 */
export async function runJob(store: JobStore, jobId: string, opts: RunJobOptions = {}): Promise<Job> {
  const job = await store.get(jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  const { input } = job
  const { onProgress } = opts

  let outputDir: string | undefined
  try {
    outputDir = await mkdtemp(join(tmpdir(), 'depress-job-'))
    await setStatus(store, jobId, 'migrating', { outputDir }, onProgress)

    await runMigrate({
      input: input.wxrPath,
      db: input.sqlDumpPath,
      wpDir: input.mediaDir,
      output: outputDir ?? '',
      theme: input.themeId,
    })

    await setStatus(store, jobId, 'building', undefined, onProgress)
    // runMigrate already builds taxonomy/content; `npm run build` + deploy happen
    // together inside runDeploy (buildSite -> deployToX), matching the CLI's flow.

    await setStatus(store, jobId, 'deploying', undefined, onProgress)
    const target: DeployTarget = input.deployTarget ?? 'cloudflare-pages'
    await runDeploy({
      dir: outputDir,
      target,
      projectName: input.projectName,
    })

    // runDeploy logs its own output rather than returning a structured result;
    // this scaffold captures the repo path (git-init'd by runMigrate) and
    // leaves deployUrl for a follow-up iteration that threads runDeploy's
    // return value through (tracked separately — deploy.ts currently only
    // console.logs the URL, see ROADMAP follow-up).
    return await setStatus(
      store,
      jobId,
      'done',
      { repoPath: outputDir },
      onProgress,
    )
  } catch (err) {
    return await setStatus(
      store,
      jobId,
      'failed',
      { error: err instanceof Error ? err.message : String(err) },
      onProgress,
    )
  }
}

/** Clean up a job's working directory (call after the result has been consumed/deployed). */
export async function cleanupJob(job: Job): Promise<void> {
  if (job.outputDir) {
    await rm(job.outputDir, { recursive: true, force: true }).catch(() => {})
  }
}
