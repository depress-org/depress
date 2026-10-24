import { open } from 'node:fs/promises'
import { constants } from 'node:fs'

/** Bounded reads even if a local file grows after stat; no symlinks/hardlinks/devices. */
export async function readRasterFile(path: string, limit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid byte budget')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('Local media byte/type limit')
    const data = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset <= limit) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, null)
      if (!bytesRead) return data.subarray(0, offset)
      offset += bytesRead
    }
    throw new Error('Local media byte limit')
  } finally { await file.close() }
}
