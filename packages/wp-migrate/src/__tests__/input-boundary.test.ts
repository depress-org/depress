import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { safeSegment, assertUniqueSegments, assertSafeTree, safeWriteFile } from '../input-boundary.js'

describe('#24 filesystem input boundary', () => {
  it.each(['../x', '%2e%2e%2fx', '%252e%252e%252fx', 'a\\b', '.', '', 'a\nb', 'A.', 'con', 'x%00', 'a:b'])('rejects unsafe segment %s', value => {
    expect(() => safeSegment(value)).toThrow()
  })
  it('accepts decoded Unicode but rejects ambiguous residual encoding and collisions', () => {
    expect(safeSegment('%D0%BC%D0%B8%D1%80')).toBe('мир')
    expect(() => assertUniqueSegments(['Hello', 'hello'])).toThrow()
    expect(() => assertUniqueSegments(['é', 'e\u0301'])).toThrow()
    expect(() => safeSegment('%zz')).toThrow()
  })
  it('rejects symlink ancestors and existing trees, never overwrites a link target', async () => {
    await mkdir('.tmp', { recursive: true })
    const root = await mkdtemp(resolve('.tmp/boundary-'))
    const outside = join(root, 'outside'); await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'unchanged')
    const out = join(root, 'out'); await mkdir(out)
    await symlink(outside, join(out, 'link'))
    await expect(assertSafeTree(out)).rejects.toThrow()
    await expect(safeWriteFile(out, 'link/keep', 'changed')).rejects.toThrow()
    await expect(safeWriteFile(join(out, 'link'), 'keep', 'changed')).rejects.toThrow()
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('unchanged')
  })
})
