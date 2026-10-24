import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { listThemes, getThemeAdapter } from '@depress-org/wp-migrate'
import { runMigrate } from '@depress-org/depress/commands/migrate'
import {
  runDeploy,
  validateDeployOptions,
  ServiceError,
  type DeployOptions,
} from '@depress-org/depress/commands/deploy'
import type { Job, JobInput, JobStore } from './types.js'
export { listThemes, getThemeAdapter }
export { InMemoryJobStore } from './types.js'
export type {
  Job,
  JobInput,
  JobStatus,
  JobStore,
  DeployTargetId,
} from './types.js'

/** Detached, presentation-only view; nested input is readonly too. */
export type JobSnapshot = Readonly<Omit<Job, 'input'>> & {
  readonly input: Readonly<JobInput>
}
export interface RunJobOptions {
  /** Best-effort observation, never awaited by the pipeline. */
  onProgress?: (job: JobSnapshot) => void | Promise<void>
  /** Trusted server-side opt-in, never copied from an upload/request body. */
  deployment?: Omit<DeployOptions, 'dir' | 'onStage'>
}
export function isValidTheme(themeId: string): boolean {
  return themeId === 'scaffold' || getThemeAdapter(themeId) !== undefined
}

const running = new WeakMap<JobStore, Map<string, Promise<Job>>>()
/** Duplicate runs share one promise; terminal jobs never re-enter the pipeline. */
export function runJob(
  store: JobStore,
  jobId: string,
  opts: RunJobOptions = {},
): Promise<Job> {
  let jobs = running.get(store)
  if (!jobs) {
    jobs = new Map()
    running.set(store, jobs)
  }
  const existing = jobs.get(jobId)
  if (existing) return existing
  const promise = execute(store, jobId, opts).finally(() => jobs!.delete(jobId))
  jobs.set(jobId, promise)
  return promise
}
async function execute(
  store: JobStore,
  jobId: string,
  opts: RunJobOptions,
): Promise<Job> {
  const job = await store.get(jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (job.status !== 'queued') return job
  const input = { ...job.input }
  async function update(status: Job['status'], extra: Partial<Job> = {}) {
    const updated = await store.update(jobId, { ...extra, status })
    // Do not expose the store's object (including input), or wait for UI/network IO.
    // Promise.resolve also consumes asynchronous rejection after runJob returns.
    try {
      if (opts.onProgress)
        void Promise.resolve(opts.onProgress(structuredClone(updated))).catch(() => {})
    } catch {
      /* observer only */
    }
    return updated
  }
  try {
    if (!isValidTheme(input.themeId))
      throw new ServiceError('INVALID_THEME', 'Unknown theme')
    if (input.mode && !['migrate-only', 'deploy'].includes(input.mode))
      throw new ServiceError('INVALID_MODE', 'Unknown job mode')
    let deployment: DeployOptions | undefined
    if (input.mode === 'deploy') {
      if (!opts.deployment)
        throw new ServiceError(
          'DEPLOY_DISABLED',
          'Deployment is disabled; use migrate-only mode',
        )
      deployment = { ...opts.deployment }
      if (input.deployTarget && input.deployTarget !== deployment.target)
        throw new ServiceError(
          'INVALID_TARGET',
          'Target does not match server deployment configuration',
        )
      validateDeployOptions(deployment)
    }
    const root = resolve('.tmp')
    await mkdir(root, { recursive: true })
    const outputDir = await mkdtemp(join(root, 'depress-job-'))
    await update('migrating', { outputDir })
    const migration = await runMigrate({
      input: input.wxrPath,
      db: input.sqlDumpPath,
      wpDir: input.mediaDir,
      output: outputDir,
      theme: input.themeId,
    })
    if (migration?.qualityPassed === false)
      throw new ServiceError('MIGRATION_QUALITY_FAILED', 'Migration report contains failed or unsupported source items')
    let deployUrl: string | undefined
    if (deployment) {
      const result = await runDeploy({
        ...deployment,
        dir: outputDir,
        onStage: async (stage) => {
          await update(stage)
        },
      })
      // Adapter must return a URL; resolving undefined is not success.
      if (!result?.deployUrl)
        throw new ServiceError(
          'MISSING_DEPLOY_URL',
          'Deployment did not return a valid URL',
        )
      deployUrl = result.deployUrl
    }
    return await update('done', { repoPath: outputDir, deployUrl })
  } catch (err) {
    // Never persist raw child/provider errors or credentials in shared job state.
    const error =
      err instanceof ServiceError
        ? `${err.code}: ${err.message}`
        : 'PIPELINE_FAILED: Migration or deployment failed'
    return await update('failed', { error, deployUrl: undefined })
  }
}
export async function cleanupJob(job: Job): Promise<void> {
  if (job.outputDir) await rm(job.outputDir, { recursive: true, force: true })
}
