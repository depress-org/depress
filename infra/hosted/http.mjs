import { authenticator, Admission, resolveLimits } from '../../packages/web/dist/security.js'
import { readUpload, UploadError } from '../../packages/web/dist/upload.js'
import { QueueFull } from './queue.mjs'
import { POLICY, mime, decode } from './protocol.mjs'

const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'Cross-Origin-Resource-Policy':'same-origin',
  'Cross-Origin-Opener-Policy':'same-origin', 'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" }
const json = (value,status=200,extra={}) => new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json',...extra}})
export function origins(api,preview) {
  const a = new URL(api), p = new URL(preview)
  const site = u => u.hostname.split('.').slice(-2).join('.')
  // Conservative separate-site rule: rejects same registrable suffix even on
  // multi-label public suffixes. No sibling bullwinkle.space origin permitted.
  for (const u of [a,p]) if (u.origin !== u.href.replace(/\/$/,'') || u.username || u.password || !['https:','http:'].includes(u.protocol) || u.hostname.split('.').length < 2) throw new Error('Invalid origin')
  if (site(a) === site(p)) throw new Error('Preview must be a separate site')
  return {api:a.origin,preview:p.origin}
}
export function createHostedHandler({queue,identities,previewIdentities,apiOrigin,previewOrigin}) {
  const configured = origins(apiOrigin,previewOrigin)
  if (identities?.some(a => previewIdentities?.some(p => a.token === p.token))) throw new Error('Separate preview credentials required')
  const apiAuth = authenticator(identities), previewAuth = authenticator(previewIdentities)
  const limits = resolveLimits({requestBytes:POLICY.bodyBytes,fileBytes:POLICY.inputBytes,uploadMs:POLICY.requestMs,active:4,activePerOwner:1})
  const admission = new Admission(limits)
  return async request => {
    let release, reservation, scope
    try {
      const url = new URL(request.url), preview = url.origin === configured.preview
      if (url.origin !== configured.api && !preview) return json({error:'Unknown origin'},421)
      if (url.search) return json({error:'Query credentials are forbidden'},400)
      const auth = preview ? previewAuth : apiAuth
      if (!auth.configured) return json({error:'Service unavailable'},503)
      let authorization = request.headers.get('authorization') ?? undefined
      if (preview && authorization?.startsWith('Basic ')) {
        const raw = Buffer.from(authorization.slice(6),'base64').toString()
        if (raw.startsWith('preview:')) authorization = 'Bearer ' + raw.slice(8)
      }
      const ownerId = auth.owner(authorization)
      if (!ownerId) return json({error:'Unauthorized'},401,{'WWW-Authenticate':preview?'Basic realm="Private preview", charset="UTF-8"':'Bearer'})
      release = admission.acquire(ownerId)
      if (!release) return json({error:'Admission limit reached'},429)
      scope = queue.forOwner(ownerId)
      if (preview) {
        if (request.method !== 'GET' || request.headers.has('service-worker') || request.headers.get('sec-fetch-dest') === 'serviceworker') return json({error:'Not found'},404)
        const match = /^\/preview\/([a-f0-9-]{36})\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname)
        if (!match || match[3].includes('%')) return json({error:'Not found'},404)
        const bytes = await scope.artifact(match[1],match[2])
        if (!bytes) return json({error:'Not found'},404)
        const artifact = JSON.parse(bytes), file = artifact.files.find(f => f.path === match[3])
        if (!file) return json({error:'Not found'},404)
        return new Response(decode(file.data,POLICY.artifactBytes),{headers:{...headers,'Content-Type':mime(file.path)}})
      }
      if (request.method === 'GET' && url.pathname === '/api/jobs') return json({jobs:await scope.list()})
      const jobId = /^\/api\/jobs\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1]
      if (jobId && request.method === 'GET') { const job=await scope.get(jobId); return job?json({job}):json({error:'Not found'},404) }
      if (jobId && request.method === 'DELETE') return await scope.cancel(jobId)?json({accepted:true},202):json({error:'Not found'},404)
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        reservation = await scope.reserve()
        const {fields,files} = await readUpload(request,limits)
        if (fields.mode && fields.mode !== 'migrate-only' || fields.deployTarget || fields.projectName) return json({error:'Hosted deployment is disabled'},403)
        const input = {theme:fields.theme,wxr:files.get('wxr')?.toString('base64') ?? '',sql:files.get('sql')?.toString('base64') ?? '',media:files.get('media')?.toString('base64') ?? ''}
        const job = await scope.submit(input,reservation); reservation=undefined
        return json({job},202)
      }
      return json({error:'Not found'},404)
    } catch (e) {
      if (e instanceof QueueFull) return json({error:'Admission limit reached'},429)
      if (e instanceof UploadError) return json({error:'Upload rejected'},e.status)
      return json({error:'Request failed'},400)
    } finally {
      if (reservation) await scope.release(reservation).catch(() => {})
      release?.()
    }
  }
}
