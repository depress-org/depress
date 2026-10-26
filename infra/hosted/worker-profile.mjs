/**
 * Review-only OCI worker policy for #25. This module NEVER starts a container.
 * The trusted broker owns the runtime socket; API, bot and jobs must not get it.
 * No deployment approval, network exception, host path or environment inheritance.
 */
export const WORKER_LIMITS = Object.freeze({
  cpu: 1,
  memoryBytes: 2147483648,
  pids: 64,
  workBytes: 1073741824,
  tempBytes: 16777216,
  cpuSeconds: 120,
  wallTimeMs: 180000,
  // Pinned workerd is 140383608 bytes: 128MiB fails real offline npm ci (EFBIG).
  // 160MiB remains finite; aggregate work1GiB/memory2GiB/time limits unchanged.
  fileBytes: 167772160,
  openFiles: 128,
  logBytes: 1048576,
})

/** Fixed workload environment. Nothing from process.env enters a job. */
export const WORKER_ENVIRONMENT = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/work/home',
  TMPDIR: '/work/tmp',
  LANG: 'C.UTF-8',
  CI: 'true',
  NODE_OPTIONS: '--max-old-space-size=1024',
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_ignore_scripts: 'true',
  npm_config_userconfig: '/dev/null',
  npm_config_globalconfig: '/dev/null',
})

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const digest = /^sha256:[0-9a-f]{64}$/
const keys = ['jobId', 'leaseId', 'imageId']

/** Deterministic, lease-fenced runtime identity; no owner, token or source names. */
export function workerName(jobId, leaseId) {
  if (typeof jobId !== 'string' || !uuid.test(jobId) || typeof leaseId !== 'string' || !uuid.test(leaseId))
    throw new Error('Invalid worker identity')
  return `depress25-${jobId}-${leaseId}`
}

/** Validate metadata from `docker image inspect` for a broker-approved image.
 * This checks dangerous image defaults, NOT image provenance or its filesystem.
 * Callers must not mistake a digest or these checks for a secret-free image audit.
 */
export function verifyImageConfig(image, expectedImageId) {
  if (!image || typeof expectedImageId !== 'string' || !digest.test(expectedImageId) || image.Id !== expectedImageId ||
      !image.Config || typeof image.Config !== 'object' || Array.isArray(image.Config))
    throw new Error('Worker image mismatch')
  const config = image.Config
  if (config.Volumes && (typeof config.Volumes !== 'object' || Object.keys(config.Volumes).length))
    throw new Error('Worker image volumes forbidden')
  if (config.Env !== null && config.Env !== undefined && !Array.isArray(config.Env))
    throw new Error('Worker image environment forbidden')
  const seen = new Set()
  for (const item of config.Env ?? []) {
    if (typeof item !== 'string' || !item.includes('=')) throw new Error('Worker image environment forbidden')
    const split = item.indexOf('=')
    const key = item.slice(0, split), value = item.slice(split + 1)
    if (!Object.hasOwn(WORKER_ENVIRONMENT, key) || WORKER_ENVIRONMENT[key] !== value || seen.has(key))
      throw new Error('Worker image environment forbidden')
    seen.add(key)
  }
  return true
}

/**
 * Source-level profile only, not a complete runner or a sandbox attestation.
 * The image must be prebuilt/trusted and locally addressed by immutable image ID.
 * The image config must have no environment outside the exact allowlist, verified before
 * launch: `--env` is NOT an operation that clears image-baked environment values.
 * Entrypoint is supplied by that reviewed image, not by user input.
 *
 * Independent wall-clock reaping, durable lease recovery, image verification,
 * ownership, input transfer and artifact verification are mandatory broker duties;
 * `docker create` alone cannot satisfy them. Keep launch disabled until integrated.
 */
export function createWorkerArgs(options, inspectedImage) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Reflect.ownKeys(options).length !== keys.length || Reflect.ownKeys(options).some(k => !keys.includes(k)))
    throw new Error('Invalid worker options')
  const { jobId, leaseId, imageId } = options
  const name = workerName(jobId, leaseId)
  if (typeof imageId !== 'string' || !digest.test(imageId)) throw new Error('Immutable local image ID required')
  verifyImageConfig(inspectedImage, imageId)
  return [
    'create', '--name', name,
    '--pull', 'never',
    '--label', 'org.depress.boundary=issue25',
    '--label', `org.depress.job=${jobId}`,
    '--label', `org.depress.lease=${leaseId}`,
    '--hostname', 'worker',
    '--no-healthcheck',
    '--restart', 'no',
    '--stop-signal', 'SIGTERM',
    '--stop-timeout', '5',
    '--user', '65532:65532',
    '--workdir', '/work',
    '--read-only',
    '--network', 'none',
    '--ipc', 'private',
    '--shm-size', '16777216',
    // Docker's default PID namespace is private; --pid only overrides to host/container.
    '--init', '--interactive',
    '--cgroupns', 'private',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true',
    '--security-opt', 'apparmor=docker-default',
    '--pids-limit', String(WORKER_LIMITS.pids),
    '--cpus', String(WORKER_LIMITS.cpu),
    '--memory', String(WORKER_LIMITS.memoryBytes),
    '--memory-swap', String(WORKER_LIMITS.memoryBytes),
    '--ulimit', `cpu=${WORKER_LIMITS.cpuSeconds}:${WORKER_LIMITS.cpuSeconds}`,
    '--ulimit', `nofile=${WORKER_LIMITS.openFiles}:${WORKER_LIMITS.openFiles}`,
    '--ulimit', `fsize=${WORKER_LIMITS.fileBytes}:${WORKER_LIMITS.fileBytes}`,
    '--ulimit', 'core=0:0',
    '--tmpfs', `/work:rw,nosuid,nodev,uid=65532,gid=65532,mode=0700,nr_inodes=65536,size=${WORKER_LIMITS.workBytes}`,
    '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700,nr_inodes=128,size=${WORKER_LIMITS.tempBytes}`,
    // No persistent raw runtime log at all; attached output is capped in #16.
    '--log-driver', 'none',
    ...Object.entries(WORKER_ENVIRONMENT).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
    imageId,
  ]
}
