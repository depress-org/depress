import { describe, it, expect } from 'vitest'
import { InMemoryJobStore } from '../types.js'
const input = { wxrPath: 'fixture.xml', themeId: 'scaffold' }
describe('owner-scoped storage #23', () => {
  it('isolates create/read/list/update and persists server-derived owner', async () => {
    const root = new InMemoryJobStore()
    const alice = root.forOwner('alice'), bob = root.forOwner('bob')
    const job = await alice.create(input)
    expect(job.ownerId).toBe('alice')
    expect(await bob.get(job.id)).toBeUndefined()
    expect(await bob.list()).toEqual([])
    await expect(bob.update(job.id, { status: 'done' })).rejects.toThrow('Job not found')
    expect((await alice.get(job.id))?.status).toBe('queued')
    expect(root.forOwner('alice')).toBe(alice)
  })
  it('detaches all records and blocks identity/input mutation by JS callers', async () => {
    const alice = new InMemoryJobStore().forOwner('alice')
    const source = { ...input }
    const job = await alice.create(source)
    source.themeId = 'changed'
    ;(job as any).ownerId = 'bob'
    job.input.themeId = 'changed'
    const fetched = (await alice.get(job.id))!
    expect(fetched.ownerId).toBe('alice')
    expect(fetched.input.themeId).toBe('scaffold')
    await expect(alice.update(job.id, { ownerId: 'bob' } as any)).rejects.toThrow('Immutable')
    await expect(alice.update(job.id, { id: 'other' } as any)).rejects.toThrow('Immutable')
    await expect(alice.update(job.id, { input: source } as any)).rejects.toThrow('Immutable')
    const listed = await alice.list()
    listed[0].input.themeId = 'changed'
    expect((await alice.get(job.id))?.input.themeId).toBe('scaffold')
    const updated = await alice.update(job.id, { status: 'done' })
    updated.status = 'failed'
    expect((await alice.get(job.id))?.status).toBe('done')
  })
  it.each([undefined, '', ' ', 123, 'x'.repeat(129)])('rejects invalid owner %s', (owner) => {
    expect(() => new InMemoryJobStore().forOwner(owner as string)).toThrow('Invalid owner')
  })
})
