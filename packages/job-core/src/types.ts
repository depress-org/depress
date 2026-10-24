/**
 * Shared job orchestration used by packages/web and packages/telegram-bot.
 *
 * Per the architecture decision (t_d850a35e): a Postgres-backed `jobs` table
 * is the eventual store. For this scaffold we ship an in-memory JobStore
 * behind the same interface so either frontend can run standalone in local/
 * staging mode without a DB. Swapping in a Postgres-backed implementation
 * later means implementing JobStore — no caller code changes.
 */

export type JobStatus = 'queued' | 'migrating' | 'building' | 'deploying' | 'done' | 'failed'

export type DeployTargetId = 'cloudflare-pages' | 'netlify' | 'vercel'

export interface JobInput {
  /** Absolute path to the uploaded WXR export XML. Required. */
  wxrPath: string
  /** Absolute path to an optional WordPress MySQL dump (.sql). */
  sqlDumpPath?: string
  /** Absolute path to optional extracted media directory. */
  mediaDir?: string
  /** Theme adapter id from @depress-org/wp-migrate's theme registry. */
  themeId: string
  /** Deployment is opt-in via mode AND server-side RunJobOptions.deployment. */
  mode?: 'migrate-only' | 'deploy'
  /** Optional target must match server-side deployment config. */
  deployTarget?: DeployTargetId
  /** Deploy project name, if the user wants one. */
  projectName?: string
}

export interface Job {
  id: string
  status: JobStatus
  input: JobInput
  createdAt: number
  updatedAt: number
  /** Working directory where migration output is written. */
  outputDir?: string
  /** Live URL once deployed. */
  deployUrl?: string
  /** Link to the generated git repo (local path until pushed upstream). */
  repoPath?: string
  error?: string
}

export interface JobStore {
  create(input: JobInput): Promise<Job>
  get(id: string): Promise<Job | undefined>
  update(id: string, patch: Partial<Job>): Promise<Job>
  list(): Promise<Job[]>
}

let counter = 0
function nextId(): string {
  counter += 1
  return `job_${Date.now().toString(36)}_${counter}`
}

/** In-memory JobStore. Good enough for local/staging; not for multi-process prod. */
export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>()

  async create(input: JobInput): Promise<Job> {
    const now = Date.now()
    const job: Job = { id: nextId(), status: 'queued', input, createdAt: now, updatedAt: now }
    this.jobs.set(job.id, job)
    return job
  }

  async get(id: string): Promise<Job | undefined> {
    return this.jobs.get(id)
  }

  async update(id: string, patch: Partial<Job>): Promise<Job> {
    const existing = this.jobs.get(id)
    if (!existing) throw new Error(`Job not found: ${id}`)
    const updated: Job = { ...existing, ...patch, updatedAt: Date.now() }
    this.jobs.set(id, updated)
    return updated
  }

  async list(): Promise<Job[]> {
    return Array.from(this.jobs.values())
  }
}
