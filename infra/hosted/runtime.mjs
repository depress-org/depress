import { defaultSpawn } from '../../packages/cli/dist/services/process.js'
import { createWorkerArgs, workerName, verifyImageConfig, WORKER_LIMITS, WORKER_ENVIRONMENT } from './worker-profile.mjs'
import { uuid } from './protocol.mjs'

// Trusted controller only. Never imported by an HTTP/API or workload process.
export class Runtime {
  constructor(imageId, docker = '/usr/bin/docker') {
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId) || !docker.startsWith('/')) throw new Error('Invalid runtime config')
    this.imageId = imageId; this.docker = docker
  }
  async call(args, options = {}) {
    return defaultSpawn(this.docker, args, { cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C.UTF-8' }, timeoutMs: 10000, maxOutputBytes: 1048576, ...options })
  }
  async checked(args, options) {
    const r = await this.call(args, options); if (r.code !== 0) throw new Error('Runtime operation failed'); return r.stdout.trim()
  }
  async image() {
    const info = JSON.parse(await this.checked(['info','--format','{{json .}}']))
    if (info.CgroupVersion !== '2' || !info.MemoryLimit || !info.SwapLimit || !info.CpuCfsQuota || !info.PidsLimit ||
        !info.SecurityOptions?.includes('name=apparmor') || !info.SecurityOptions?.some(s => s.startsWith('name=seccomp,profile=builtin'))) throw new Error('Runtime enforcement unavailable')
    const image = JSON.parse(await this.checked(['image','inspect',this.imageId]))[0]
    verifyImageConfig(image, this.imageId); return image
  }
  async inspect(id) {
    if (!/^[a-f0-9]{64}$/.test(id) && !/^depress25-/.test(id)) throw new Error('Invalid runtime identity')
    const r = await this.call(['container','inspect',id])
    if (r.code === 0) return JSON.parse(r.stdout)[0]
    // A failed inspect is NOT proof of absence if the daemon is unavailable.
    await this.checked(['info','--format','{{.ID}}'])
    const filter = /^[a-f0-9]{64}$/.test(id) ? `id=${id}` : `name=^/${id}$`
    const ids = await this.checked(['ps','-aq','--no-trunc','--filter',filter])
    if (ids) throw new Error('Uncertain runtime state')
    return undefined
  }
  owned(c, job) {
    const labels = c?.Config?.Labels
    if (!c || !/^[a-f0-9]{64}$/.test(c.Id) || !uuid.test(job.id) || !uuid.test(job.lease_id) ||
        c.Name !== '/' + workerName(job.id,job.lease_id) || c.Image !== this.imageId ||
        labels?.['org.depress.boundary'] !== 'issue25' || labels['org.depress.job'] !== job.id || labels['org.depress.lease'] !== job.lease_id) throw new Error('Unowned runtime')
    return c.Id
  }
  verify(c, job) {
    this.owned(c,job)
    const h = c.HostConfig, env = c.Config.Env
    const expected = Object.entries(WORKER_ENVIRONMENT).map(([k,v]) => `${k}=${v}`).sort()
    const ulimits = {cpu:WORKER_LIMITS.cpuSeconds,nofile:WORKER_LIMITS.openFiles,fsize:WORKER_LIMITS.fileBytes,core:0}
    if (c.Config.User !== '65532:65532' || c.Config.WorkingDir !== '/work' ||
        JSON.stringify([...env].sort()) !== JSON.stringify(expected) ||
        !h.ReadonlyRootfs || h.Privileged || h.NetworkMode !== 'none' || h.PidMode ||
        h.IpcMode !== 'private' || h.CgroupnsMode !== 'private' || !h.Init ||
        JSON.stringify(h.CapDrop) !== '["ALL"]' || h.CapAdd?.length ||
        !h.SecurityOpt?.includes('no-new-privileges=true') || h.SecurityOpt?.some(s => /unconfined/i.test(s)) ||
        !c.AppArmorProfile || c.AppArmorProfile === 'unconfined' ||
        c.Mounts?.length || h.Binds?.length || h.Devices?.length || h.DeviceRequests?.length || Object.keys(h.PortBindings ?? {}).length ||
        h.PidsLimit !== WORKER_LIMITS.pids || h.Memory !== WORKER_LIMITS.memoryBytes || h.MemorySwap !== h.Memory ||
        h.NanoCpus !== WORKER_LIMITS.cpu * 1e9 || h.ShmSize !== 16777216 ||
        !Array.isArray(h.Ulimits) || h.Ulimits.length !== Object.keys(ulimits).length ||
        !Object.entries(ulimits).every(([name,value]) => h.Ulimits.some(u => u?.Name === name && u.Soft === value && u.Hard === value)) ||
        h.LogConfig.Type !== 'none' || h.RestartPolicy.Name !== 'no') throw new Error('Runtime boundary unavailable')
    const requested = createWorkerArgs({jobId:job.id,leaseId:job.lease_id,imageId:this.imageId},{Id:this.imageId,Config:{}})
    const tmpfs = requested.flatMap((v,i) => v === '--tmpfs' ? [requested[i+1]] : [])
    if (JSON.stringify(Object.entries(h.Tmpfs ?? {}).map(([k,v]) => `${k}:${v}`).sort()) !== JSON.stringify(tmpfs.sort())) throw new Error('Runtime storage boundary unavailable')
    return true
  }
  async create(job) {
    const image = await this.image()
    const args = createWorkerArgs({ jobId: job.id, leaseId: job.lease_id, imageId: this.imageId }, image)
    const id = await this.checked(args)
    const c = await this.inspect(id); this.verify(c,job); return id
  }
  async remove(job) {
    const c = await this.inspect(workerName(job.id,job.lease_id))
    if (!c) return true
    const id = this.owned(c,job)
    await this.checked(['rm','--force','--volumes',id])
    // Read exact immutable target back; a successful rm response is not enough.
    const after = await this.inspect(id)
    if (after) throw new Error('Runtime removal unconfirmed')
    return true
  }
  async ownedContainers() {
    const ids = (await this.checked(['ps','-aq','--no-trunc','--filter','label=org.depress.boundary=issue25'])).split(/\s+/).filter(Boolean)
    const found = []
    for (const id of ids) {
      const c = await this.inspect(id); if (!c) continue
      if (c.Image !== this.imageId) continue // other controller/image is not our deletion capability
      const job = { id:c.Config.Labels['org.depress.job'],lease_id:c.Config.Labels['org.depress.lease'] }
      this.owned(c,job); found.push({job,container:c})
    }
    return found
  }
}
