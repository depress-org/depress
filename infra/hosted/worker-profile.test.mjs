import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createWorkerArgs as render, workerName, verifyImageConfig, WORKER_ENVIRONMENT, WORKER_LIMITS } from './worker-profile.mjs'

const options = {
  jobId: '00000000-0000-4000-8000-000000000001',
  leaseId: '00000000-0000-4000-8000-000000000002',
  imageId: `sha256:${'a'.repeat(64)}`,
}
const image = { Id: options.imageId, Config: {} }
const createWorkerArgs = opts => render(opts, image)
function values(args, flag) { return args.flatMap((v, i) => v === flag ? [args[i + 1]] : []) }
function value(args, flag) { const found = values(args, flag); assert.equal(found.length, 1, flag); return found[0] }
const args = createWorkerArgs(options)

test('profile emits create-only arguments and a locally pinned image, never a shell or a launch', () => {
  assert.equal(args[0], 'create')
  assert.equal(args.at(-1), options.imageId)
  assert.equal(value(args, '--pull'), 'never')
  assert.equal(value(args, '--name'), workerName(options.jobId, options.leaseId))
  assert.ok(!args.includes('start'))
  assert.ok(!args.includes('run'))
  assert.equal(value(args, '--hostname'), 'worker')
  assert.ok(args.includes('--no-healthcheck'))
  assert.equal(value(args, '--restart'), 'no')
  assert.equal(value(args, '--stop-timeout'), '5')
  assert.equal(value(args, '--stop-signal'), 'SIGTERM')
  assert.equal(value(args, '--shm-size'), '16777216')
  assert.throws(() => render(options), /mismatch/)
})

test('filesystem, UID, namespace and capability policy has no host mounts or sockets', () => {
  assert.equal(value(args, '--user'), '65532:65532')
  assert.equal(value(args, '--workdir'), '/work')
  assert.ok(args.includes('--read-only'))
  assert.ok(args.includes('--init'))
  assert.equal(value(args, '--network'), 'none')
  assert.equal(value(args, '--ipc'), 'private')
  assert.equal(value(args, '--cgroupns'), 'private')
  assert.equal(value(args, '--cap-drop'), 'ALL')
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges=true','apparmor=docker-default'])
  for (const forbidden of ['--mount', '--volume', '-v', '--volumes-from', '--device', '--privileged', '--use-api-socket', '--publish', '-p', '--publish-all', '--pid', '--userns', '--cap-add', '--env-file', '--runtime'])
    assert.ok(!args.includes(forbidden), forbidden)
  assert.deepEqual(values(args, '--tmpfs'), [
    '/work:rw,nosuid,nodev,uid=65532,gid=65532,mode=0700,nr_inodes=65536,size=1073741824',
    '/tmp:rw,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700,nr_inodes=128,size=16777216',
  ])
})

test('profile requests finite CPU/RAM/swap/PID/file/FD limits without disabling the OOM killer', () => {
  assert.equal(value(args, '--cpus'), '1')
  assert.equal(value(args, '--pids-limit'), '64')
  assert.equal(value(args, '--memory'), '2147483648')
  assert.equal(value(args, '--memory-swap'), value(args, '--memory'))
  assert.deepEqual(values(args, '--ulimit'), ['cpu=120:120', 'nofile=128:128', 'fsize=134217728:134217728', 'core=0:0'])
  assert.ok(!args.includes('--oom-kill-disable'))
  assert.ok(!args.includes('--oom-score-adj'))
  for (const v of Object.values(WORKER_LIMITS)) assert.ok(Number.isSafeInteger(v) && v > 0)
  assert.equal(WORKER_LIMITS.wallTimeMs, 180000) // broker duty; NOT enforced by this renderer
})

test('no raw runtime log is persisted; attached capture is a separate bound', () => {
  assert.equal(value(args, '--log-driver'), 'none')
  assert.deepEqual(values(args, '--log-opt'), [])
})

test('job environment is explicit, offline and does not inherit fake broker credentials', () => {
  const env = values(args, '--env')
  assert.deepEqual(env, Object.entries(WORKER_ENVIRONMENT).map(([k, v]) => `${k}=${v}`))
  assert.ok(env.includes('npm_config_offline=true'))
  // This subprocess receives ONLY fabricated values, never the live host environment.
  const code = `import {createWorkerArgs} from ${JSON.stringify(new URL('./worker-profile.mjs', import.meta.url).href)}; console.log(JSON.stringify(createWorkerArgs(${JSON.stringify(options)}, ${JSON.stringify(image)})))`
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { FAKE_BROKER_SECRET: 'FAKE_TOKEN_SENTINEL_25', npm_config_registry: 'https://fake.invalid' },
    timeout: 5000, maxBuffer: 32768,
  })
  assert.deepEqual(JSON.parse(output), args)
  assert.ok(!output.includes('FAKE_TOKEN_SENTINEL_25'))
  assert.ok(!output.includes('fake.invalid'))
})

test('lease identity is fenced and does not contain owner/source strings', () => {
  const other = createWorkerArgs({ ...options, leaseId: '00000000-0000-4000-8000-000000000003' })
  assert.notEqual(value(other, '--name'), value(args, '--name'))
  assert.equal(values(args, '--label').length, 3)
  assert.ok(values(args, '--label').every(v => !v.includes('owner')))
})

for (const bad of ['', null, undefined, 'latest', 'ubuntu:latest', `repo@${options.imageId}`, `sha256:${'a'.repeat(63)}`, `sha256:${'A'.repeat(64)}`, `sha256:${'a'.repeat(64)};id`, '--privileged']) {
  test(`reject noncanonical image ID: ${String(bad)}`, () => {
    assert.throws(() => createWorkerArgs({ ...options, imageId: bad }), /Immutable local image ID required/)
  })
}
for (const bad of ['', null, undefined, '../victim', 'a;id', options.jobId.toUpperCase().replace('4000', 'F000'), `${options.jobId}\n`, '--network=host']) {
  test(`reject malformed runtime identity: ${String(bad)}`, () => {
    assert.throws(() => createWorkerArgs({ ...options, jobId: bad }), /Invalid worker identity/)
    assert.throws(() => createWorkerArgs({ ...options, leaseId: bad }), /Invalid worker identity/)
  })
}
for (const extra of ['ownerId', 'env', 'mounts', 'command', 'network', 'token', 'args']) {
  test(`reject caller override: ${extra}`, () => {
    assert.throws(() => createWorkerArgs({ ...options, [extra]: 'FAKE_OVERRIDE' }), /Invalid worker options/)
  })
}

test('reject missing, array or primitive options', () => {
  for (const input of [null, undefined, [], 'options', 25, {}, { jobId: options.jobId }])
    assert.throws(() => createWorkerArgs(input), /Invalid worker options/)
})

test('trusted image metadata rejects image-default environment secrets and anonymous volumes', () => {
  assert.equal(verifyImageConfig({ Id: options.imageId, Config: {} }, options.imageId), true)
  assert.equal(verifyImageConfig({ Id: options.imageId, Config: { Env: ['PATH=/usr/local/bin:/usr/bin:/bin'], Volumes: {} } }, options.imageId), true)
  for (const Config of [
    { Env: ['FAKE_PROVIDER_TOKEN=FAKE_TOKEN_SENTINEL_25'] },
    { Env: ['PATH=/unsafe/bin'] },
    { Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'PATH=/usr/local/bin:/usr/bin:/bin'] },
    { Env: ['MALFORMED'] }, { Env: [null] }, { Env: 'malformed' },
    { Volumes: { '/unbounded': {} } }, { Volumes: 'malformed' },
  ]) assert.throws(() => verifyImageConfig({ Id: options.imageId, Config }, options.imageId), /forbidden/)
  assert.throws(() => verifyImageConfig({ Id: `sha256:${'b'.repeat(64)}`, Config: {} }, options.imageId), /mismatch/)
  assert.throws(() => verifyImageConfig({ Id: options.imageId }, options.imageId), /mismatch/)
})

test('policy constants cannot be weakened by mutation and every render is detached', () => {
  assert.throws(() => { WORKER_LIMITS.pids = -1 }, TypeError)
  assert.throws(() => { WORKER_ENVIRONMENT.PATH = '/unsafe' }, TypeError)
  const changed = createWorkerArgs(options)
  changed.push('--privileged')
  assert.ok(!createWorkerArgs(options).includes('--privileged'))
})
