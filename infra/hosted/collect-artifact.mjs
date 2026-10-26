import { readFile, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { POLICY, artifactBytes, mime } from './protocol.mjs'

export async function collectArtifact(root) {
  const files = []
  let bytes = 0
  async function collect(path, relative = '') {
    for (const name of await readdir(path)) {
      const target = join(path, name), key = relative + name, info = await lstat(target)
      if (info.isSymbolicLink()) throw new Error('Invalid artifact')
      if (info.isDirectory()) await collect(target, key + '/')
      else if (!info.isFile() || info.nlink > 1) throw new Error('Invalid artifact')
      else if (mime(key)) {
        bytes += info.size; if (bytes > POLICY.artifactBytes || files.length >= 128) throw new Error('Artifact limit')
        files.push({ path: key, data: (await readFile(target)).toString('base64') })
      }
    }
  }
  await collect(root)
  // Full output remains Workers; collecting client files does not make it static.
  const artifact = { kind: 'preview-only', files }; artifactBytes(artifact)
  return artifact
}
