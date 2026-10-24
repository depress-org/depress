import { createHash } from 'node:crypto'

/** #38 / PR-06: offline contract only. No filesystem, env, fetch, spawn or live default. */
export const STATIC_KIND = 'cloudflare-pages-static.v1' as const
export interface Authority {
  /** Must come from authenticated server admission, never request-body identity. */
  readonly ownerId: string
  readonly jobId: string
}
export interface PagesTarget {
  readonly provider: 'cloudflare-pages'
  readonly accountId: string
  readonly projectName: string
}
export interface StaticFile {
  readonly path: string
  readonly bytes: Uint8Array
}
export interface VerifiedArtifact extends Authority {
  readonly kind: typeof STATIC_KIND
  /** SHA256 of canonical sorted [path, byteLength, fileSHA256] manifest. */
  readonly sha256: string
  readonly files: readonly StaticFile[]
}
export type ErrorCode = 'INVALID_REQUEST' | 'ARTIFACT_REJECTED' | 'IDEMPOTENCY_CONFLICT'
  | 'ROLLBACK_REJECTED' | 'PROVIDER_REJECTED' | 'PROVIDER_UNCERTAIN' | 'TIMEOUT'
export class DeploymentContractError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code) // Never copy untrusted provider/registry errors, paths or token text.
    this.name = 'DeploymentContractError'
  }
}
function reject(code: ErrorCode): never { throw new DeploymentContractError(code) }
function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
function authority(value: Authority): void {
  if (!value || !identity(value.ownerId) || !identity(value.jobId)) reject('INVALID_REQUEST')
}
function target(value: PagesTarget): PagesTarget {
  if (!value || value.provider !== 'cloudflare-pages' ||
    typeof value.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(value.accountId) ||
    typeof value.projectName !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value.projectName))
    reject('INVALID_REQUEST')
  return Object.freeze({ provider: 'cloudflare-pages', accountId: value.accountId, projectName: value.projectName })
}

/** Narrow static shape, not a privacy, safe-HTML, provenance or OS-isolation verifier. */
function snapshot(files: readonly StaticFile[]): readonly StaticFile[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > 10_000) reject('ARTIFACT_REJECTED')
  for (let index = 0; index < files.length; index++)
    if (!Object.hasOwn(files, index)) reject('ARTIFACT_REJECTED')
  const seen = new Set<string>()
  let size = 0
  const copy = files.map((file: StaticFile) => {
    if (!file || typeof file.path !== 'string' || file.path.length > 512 ||
      !/^[a-zA-Z0-9_@()+.,/-]+$/.test(file.path) ||
      file.path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
      !(file.bytes instanceof Uint8Array)) reject('ARTIFACT_REJECTED')
    const lower = file.path.toLowerCase()
    const parts = lower.split('/')
    // CF14 Workers/client-server, Pages Functions and config/source/credential surfaces fail closed.
    if (parts.some(part => ['server', 'client', 'functions', '_worker.js', '_routes.json',
      'node_modules', 'package.json', 'package-lock.json', 'wrangler.json', 'wrangler.jsonc',
      'wrangler.toml', 'deployment.v1.json', 'migration-report.json'].includes(part)) ||
      !/\.(?:html|css|js|mjs|json|txt|xml|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf)$/.test(lower) ||
      seen.has(lower) || file.bytes.byteLength > 25 * 1024 * 1024) reject('ARTIFACT_REJECTED')
    seen.add(lower)
    size += file.bytes.byteLength
    if (size > 64 * 1024 * 1024) reject('ARTIFACT_REJECTED')
    return Object.freeze({ path: file.path, bytes: new Uint8Array(file.bytes) })
  })
  if (!copy.some(file => file.path === 'index.html')) reject('ARTIFACT_REJECTED')
  return Object.freeze(copy.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
function artifactDigest(files: readonly StaticFile[]): string {
  return hash(JSON.stringify([STATIC_KIND, files.map(file => [file.path, file.bytes.byteLength, hash(file.bytes)])]))
}
/** Trusted ingestion helper; calling it is NOT proof of #25 storage or source privacy. */
export function sealStaticArtifact(context: Authority, files: readonly StaticFile[]): VerifiedArtifact {
  authority(context)
  const copy = snapshot(files)
  return Object.freeze({ ownerId: context.ownerId, jobId: context.jobId,
    kind: STATIC_KIND, sha256: artifactDigest(copy), files: copy })
}

export interface DeploymentRecord extends Authority {
  readonly schema: 'deployment.v1'
  readonly id: string
  readonly artifact: { readonly kind: typeof STATIC_KIND; readonly sha256: string }
  readonly target: PagesTarget
  readonly idempotencyKey: string
  readonly operation: 'deploy' | 'rollback'
  readonly status: 'pending' | 'succeeded' | 'rejected' | 'unknown'
  /** For rollback, the existing immutable version selected, never a local path. */
  readonly previousDeploymentId?: string
  readonly providerDeploymentId?: string
  readonly url?: string
  readonly error?: { readonly code: ErrorCode }
}
export interface DeployRequest { readonly idempotencyKey: string; readonly artifactSha256: string }
export interface RollbackRequest extends DeployRequest { readonly previousDeploymentId: string }
export interface ProviderVersion extends Authority {
  readonly verified: true
  readonly artifactKind: typeof STATIC_KIND
  readonly artifactSha256: string
  readonly target: PagesTarget
  readonly providerDeploymentId: string
  readonly url: string
}
/** Trusted immutable registry capability; #25 owns durable storage, verification and retention. */
export interface ArtifactRegistry {
  getArtifact(sha256: string): Promise<VerifiedArtifact | undefined>
  getVersion(id: string): Promise<ProviderVersion | undefined>
}
export interface PagesCommand {
  readonly kind: 'deploy' | 'rollback' | 'lookup'
  readonly authority: Authority
  readonly target: PagesTarget
  readonly idempotencyKey: string
  readonly operationId: string
  readonly artifactSha256: string
  readonly previousDeploymentId?: string
  /** A detached byte snapshot, only for deploy; never source paths/build env. */
  readonly files?: readonly StaticFile[]
}
export interface PagesResponse { readonly status: number; readonly body: string }
/**
 * Inject ONLY a trusted deploy-only capability. Credentials stay inside its closure.
 * This is an internal broker/adapter seam, NOT a Cloudflare upload protocol implementation.
 * lookup must reconcile operationId against durable provider receipts; absence is uncertain.
 * No production transport is supplied, no HTTP route/CLI calls this module.
 */
export type PagesTransport = (command: PagesCommand, signal: AbortSignal) => Promise<PagesResponse>
export interface Deadline {
  /** Returns a cancellation function. Injection makes timeout tests deterministic. */
  schedule(callback: () => void, timeoutMs: number): () => void
}
const defaultDeadline: Deadline = {
  schedule(callback, timeoutMs) {
    const timer = setTimeout(callback, timeoutMs)
    return () => clearTimeout(timer)
  },
}
const providerId = (id: unknown): id is string => typeof id === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)
function immutableUrl(value: unknown, project: string): string | undefined {
  if (typeof value !== 'string' || value.length > 256) return undefined
  try {
    const url = new URL(value)
    const suffix = `.${project}.pages.dev`
    const alias = url.hostname.slice(0, -suffix.length)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash || !url.hostname.endsWith(suffix) ||
      !/^[a-f0-9]{8}$/.test(alias) || // Conservative deployment-hash shape, never arbitrary branch aliases.
      value !== url.origin && value !== `${url.origin}/`) return undefined
    return url.origin
  } catch { return undefined }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
type Parsed = { id: string; url: string } | 'rejected' | 'uncertain'
/** Never return raw JSON, provider messages, extra fields, stdout or error causes. */
function parse(response: PagesResponse, project: string): Parsed {
  if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string' ||
    Buffer.byteLength(response.body) > 65_536) return 'uncertain'
  let body: unknown
  try { body = JSON.parse(response.body) } catch { return 'uncertain' }
  if (!object(body) || typeof body.success !== 'boolean' || !Array.isArray(body.errors)) return 'uncertain'
  if (!body.success) {
    if (body.result !== null || body.errors.length === 0 || !body.errors.every(error =>
      object(error) && Number.isInteger(error.code) && typeof error.message === 'string')) return 'uncertain'
    // Only definitive 4xx rejections are terminal. Rate limits/5xx/404 lookup remain uncertain.
    return response.status >= 400 && response.status < 500 && ![404, 408, 409, 429].includes(response.status)
      ? 'rejected' : 'uncertain'
  }
  if (![200, 201].includes(response.status) || body.errors.length || !object(body.result)) return 'uncertain'
  const result = body.result
  const url = immutableUrl(result.url, project)
  if (!providerId(result.id) || result.project_name !== project || !url ||
    !object(result.latest_stage) || result.latest_stage.name !== 'deploy' ||
    result.latest_stage.status !== 'success') return 'uncertain'
  return { id: result.id, url }
}

/** Process-local fake ledger/coalescing only; not durable/distributed idempotency or a queue. */
export function createOfflinePagesAdapter(deps: {
  authority: Authority
  target: PagesTarget
  registry: ArtifactRegistry
  transport: PagesTransport
  deadline?: Deadline
  timeoutMs?: number
}) {
  authority(deps.authority)
  const context = Object.freeze({ ownerId: deps.authority.ownerId, jobId: deps.authority.jobId })
  const destination = target(deps.target)
  const timeoutMs = deps.timeoutMs ?? 30_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) reject('INVALID_REQUEST')
  const deadline = deps.deadline ?? defaultDeadline
  const transport = deps.transport
  const registry = deps.registry
  const records = new Map<string, DeploymentRecord>()
  const inFlight = new Map<string, Promise<DeploymentRecord>>()
  const fingerprints = new Map<string, string>()

  function record(value: DeploymentRecord): DeploymentRecord {
    const copy = Object.freeze({ ...value, artifact: Object.freeze({ ...value.artifact }),
      ...(value.error ? { error: Object.freeze({ ...value.error }) } : {}) })
    records.set(value.idempotencyKey, copy)
    return copy
  }
  async function verified(sha256: string): Promise<VerifiedArtifact> {
    let found: VerifiedArtifact | undefined
    try { found = await registry.getArtifact(sha256) } catch { reject('ARTIFACT_REJECTED') }
    if (!found || found.ownerId !== context.ownerId || found.jobId !== context.jobId ||
      found.kind !== STATIC_KIND || found.sha256 !== sha256) reject('ARTIFACT_REJECTED')
    const copy = sealStaticArtifact(context, found.files)
    if (copy.sha256 !== sha256) reject('ARTIFACT_REJECTED')
    return copy
  }
  async function version(id: string, sha256: string): Promise<string> {
    let found: ProviderVersion | undefined
    try { found = await registry.getVersion(id) } catch { reject('ROLLBACK_REJECTED') }
    // Previous version may be from a prior job, but must be same owner + exact target/digest.
    if (!found || found.verified !== true || found.artifactKind !== STATIC_KIND || found.ownerId !== context.ownerId ||
      !identity(found.jobId) || found.artifactSha256 !== sha256 || found.providerDeploymentId !== id ||
      !found.target || JSON.stringify(target(found.target)) !== JSON.stringify(destination) ||
      !immutableUrl(found.url, destination.projectName)) reject('ROLLBACK_REJECTED')
    return immutableUrl(found.url, destination.projectName)!
  }
  async function call(command: PagesCommand): Promise<PagesResponse | 'timeout' | 'exception'> {
    const controller = new AbortController()
    let cancel = () => {}
    const expired = new Promise<'timeout'>(resolve => {
      cancel = deadline.schedule(() => { resolve('timeout'); controller.abort() }, timeoutMs)
    })
    try {
      // Handle late rejection after timeout too: never an unhandled promise or late ledger write.
      const result = Promise.resolve().then(() => transport(command, controller.signal)).catch(() => 'exception' as const)
      return await Promise.race([result, expired])
    } finally { cancel() }
  }
  async function execute(request: DeployRequest, previousDeploymentId?: string): Promise<DeploymentRecord> {
    if (!request || !identity(request.idempotencyKey) || !digest(request.artifactSha256) ||
      previousDeploymentId !== undefined && !providerId(previousDeploymentId)) reject('INVALID_REQUEST')
    const operation = previousDeploymentId === undefined ? 'deploy' : 'rollback'
    const key = request.idempotencyKey
    const sha256 = request.artifactSha256 // Capture before any async boundary; caller may mutate request.
    const fingerprint = JSON.stringify([operation, sha256, previousDeploymentId])
    if (fingerprints.has(key) && fingerprints.get(key) !== fingerprint) reject('IDEMPOTENCY_CONFLICT')
    if (inFlight.has(key)) return inFlight.get(key)!
    const existing = records.get(key)
    if (existing?.status === 'succeeded' || existing?.status === 'rejected') return existing
    fingerprints.set(key, fingerprint)
    const run = async (): Promise<DeploymentRecord> => {
      // Lookup/retry rechecks trust; no foreign bytes/version may reach credential capability.
      let artifact: VerifiedArtifact | undefined
      let rollbackUrl: string | undefined
      if (operation === 'deploy') artifact = await verified(sha256)
      else rollbackUrl = await version(previousDeploymentId!, sha256)
      const base: DeploymentRecord = existing ?? record({ schema: 'deployment.v1',
        ...context, id: hash(JSON.stringify([context, destination, key])),
        artifact: { kind: STATIC_KIND, sha256 }, target: destination,
        idempotencyKey: key, operation, status: 'pending',
        ...(previousDeploymentId ? { previousDeploymentId } : {}) })
      const response = await call(Object.freeze({ kind: existing ? 'lookup' : operation,
        authority: context, target: destination, idempotencyKey: key, operationId: base.id,
        artifactSha256: sha256,
        ...(previousDeploymentId ? { previousDeploymentId } : {}),
        ...(!existing && artifact ? { files: artifact.files } : {}) }))
      const parsed = typeof response === 'string' ? 'uncertain' : parse(response, destination.projectName)
      if (typeof parsed === 'object' && (!previousDeploymentId || parsed.id === previousDeploymentId && parsed.url === rollbackUrl))
        return record({ ...base, status: 'succeeded', error: undefined, providerDeploymentId: parsed.id, url: parsed.url })
      if (parsed === 'rejected' && !existing)
        return record({ ...base, status: 'rejected', error: { code: 'PROVIDER_REJECTED' } })
      return record({ ...base, status: 'unknown', error: { code: response === 'timeout' ? 'TIMEOUT' : 'PROVIDER_UNCERTAIN' } })
    }
    const pending = run()
    inFlight.set(key, pending)
    try { return await pending } finally { inFlight.delete(key) }
  }
  return Object.freeze({
    deploy: (request: DeployRequest) => execute(request),
    rollback: (request: RollbackRequest) => {
      if (!request || !providerId(request.previousDeploymentId)) return Promise.reject(new DeploymentContractError('INVALID_REQUEST'))
      return execute(request, request.previousDeploymentId)
    },
    get: (idempotencyKey: string): DeploymentRecord | undefined => records.get(idempotencyKey),
  })
}
