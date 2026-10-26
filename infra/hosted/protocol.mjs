import { createHash, randomUUID } from 'node:crypto'

// Conservative service limits; changing them requires new runtime evidence.
export const POLICY = Object.freeze({ rows: 32, ownerRows: 4, queuedMs: 600000,
  inputBytes: 1048576, artifactBytes: 1048576, totalBytes: 16777216,
  artifactMs: 900000, metadataMs: 3600000, running: 1, bodyBytes: 1500000, requestMs: 10000 })
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const identifier = () => randomUUID()
export function owner(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('Invalid owner')
  return value // immutable server-derived string, never a path or caller-selected field
}
export function exact(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).length !== keys.length || Object.keys(object).some(k => !keys.includes(k))) throw new Error('Invalid schema')
}
export function decode(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw new Error('Invalid bytes')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > limit || bytes.toString('base64') !== value) throw new Error('Invalid bytes')
  return bytes
}
export function inputBytes(input) {
  exact(input, ['theme', 'wxr', 'sql', 'media'])
  if (input.theme !== 'scaffold') throw new Error('Unsupported hosted theme')
  let total = 0
  for (const key of ['wxr', 'sql', 'media']) total += decode(input[key], POLICY.inputBytes).length
  if (!input.wxr || total > POLICY.inputBytes) throw new Error('Input limit')
  return total
}
const mimes = Object.freeze({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon' })
export function mime(path) { return mimes[path.split('.').at(-1)] }
export function artifactBytes(artifact) {
  exact(artifact, ['kind', 'files'])
  // Current CF14 generates Workers: this service NEVER reclassifies client-only
  // files as a deployable static site. #38 owns the future provider contract.
  if (artifact.kind !== 'preview-only' || !Array.isArray(artifact.files) || !artifact.files.length || artifact.files.length > 128) throw new Error('Invalid artifact')
  let total = 0; const seen = new Set()
  for (let i = 0; i < artifact.files.length; i++) {
    const file = artifact.files[i]; exact(file, ['path', 'data'])
    if (typeof file.path !== 'string' || file.path.length > 256 || !/^[A-Za-z0-9_./-]+$/.test(file.path) || file.path.split('/').some(p => !p || p.startsWith('.') || p === '..') || !mime(file.path) || /(?:^|\/)(?:server|node_modules|sources|reports|migration-report)(?:[./-]|$)/i.test(file.path)) throw new Error('Invalid artifact path')
    const key = file.path.toLowerCase(); if (seen.has(key)) throw new Error('Duplicate artifact path'); seen.add(key)
    total += decode(file.data, POLICY.artifactBytes).length
    if (total > POLICY.artifactBytes) throw new Error('Artifact limit')
  }
  return total
}
export function result(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * POLICY.artifactBytes) throw new Error('Invalid result')
  const parsed = JSON.parse(text); exact(parsed, ['ok', 'artifact'])
  if (parsed.ok !== true) throw new Error('Worker failed')
  artifactBytes(parsed.artifact)
  return Buffer.from(JSON.stringify(parsed.artifact))
}
export function publicJob(row) {
  return { id: row.id, status: row.state, createdAt: Number(row.created_ms),
    expiresAt: Number(row.expires_ms), error: row.state === 'failed' ? 'Job failed' : undefined,
    artifact: row.artifact_digest ? { digest: row.artifact_digest, expiresAt: Number(row.artifact_expires_ms), kind: 'preview-only' } : undefined }
}
