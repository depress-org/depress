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
  readonly id: string
  readonly ownerId: string
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

export type JobPatch = Partial<Pick<Job, 'status' | 'outputDir' | 'deployUrl' | 'repoPath' | 'error'>>

/** A tenant capability, acquired only after server-side authentication. */
export interface JobStore {
  readonly ownerId: string
  create(input: JobInput): Promise<Job>
  get(id: string): Promise<Job | undefined>
  update(id: string, patch: JobPatch): Promise<Job>
  list(): Promise<Job[]>
}

let counter = 0
function nextId(): string {
  counter += 1
  return `job_${Date.now().toString(36)}_${counter}`
}

/** Single-process scaffold repository. Never expose the root to request handlers. */
export class InMemoryJobStore {
  #jobs = new Map<string, Job>()
  #scopes = new Map<string, JobStore>()

  forOwner(ownerId: string): JobStore {
    if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 128)
      throw new Error('Invalid owner')
    const cached = this.#scopes.get(ownerId)
    if (cached) return cached
    const find = (id: string) => {
      const job = this.#jobs.get(id)
      return job?.ownerId === ownerId ? job : undefined
    }
    const scope: JobStore = Object.freeze({
      ownerId,
      create: async (input: JobInput) => {
        const now = Date.now()
        const job: Job = { id: nextId(), ownerId, status: 'queued', input: structuredClone(input), createdAt: now, updatedAt: now }
        this.#jobs.set(job.id, job)
        return structuredClone(job)
      },
      get: async (id: string) => {
        const job = find(id)
        return job ? structuredClone(job) : undefined
      },
      update: async (id: string, patch: JobPatch) => {
        const existing = find(id)
        if (!existing) throw new Error(`Job not found: ${id}`)
        const allowed = ['status', 'outputDir', 'deployUrl', 'repoPath', 'error']
        if (Object.keys(patch).some((key) => !allowed.includes(key)))
          throw new Error('Immutable job field')
        const updated: Job = { ...existing, ...structuredClone(patch), updatedAt: Date.now() }
        this.#jobs.set(id, updated)
        return structuredClone(updated)
      },
      list: async () => structuredClone([...this.#jobs.values()].filter((job) => job.ownerId === ownerId)),
    })
    this.#scopes.set(ownerId, scope)
    return scope
  }
}
