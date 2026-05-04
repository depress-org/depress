import { describe, it, expect } from 'vitest'

// Test the redirect map logic directly by replicating the exact algorithm
// from packages/cli/src/commands/migrate.ts
function buildRedirectMap(posts: Array<{ id: number; slug: string; type: string; status: string; date: string }>) {
  const redirectMap: Record<string, string> = {}
  for (const post of posts) {
    if (post.status !== 'publish') continue
    const newPath = post.type === 'page' ? `/${post.slug}/` : `/blog/${post.slug}/`
    const date = new Date(post.date)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const oldPaths = [
      `/${y}/${m}/${post.slug}/`,
      `/?p=${post.id}`,
    ]
    for (const old of oldPaths) {
      if (old !== newPath) redirectMap[old] = newPath
    }
  }
  return redirectMap
}

describe('redirect map generation', () => {
  it('generates date-based redirect for published posts', () => {
    const map = buildRedirectMap([
      { id: 101, slug: 'hello-world', type: 'post', status: 'publish', date: '2024-03-15 09:00:00' },
    ])
    expect(map['/2024/03/hello-world/']).toBe('/blog/hello-world/')
  })

  it('generates ?p= redirect for published posts', () => {
    const map = buildRedirectMap([
      { id: 101, slug: 'hello-world', type: 'post', status: 'publish', date: '2024-03-15 09:00:00' },
    ])
    expect(map['/?p=101']).toBe('/blog/hello-world/')
  })

  it('maps pages to /<slug>/ not /blog/<slug>/', () => {
    const map = buildRedirectMap([
      { id: 2, slug: 'about', type: 'page', status: 'publish', date: '2024-01-01 10:00:00' },
    ])
    expect(map['/?p=2']).toBe('/about/')
    expect(map['/2024/01/about/']).toBe('/about/')
  })

  it('skips draft posts', () => {
    const map = buildRedirectMap([
      { id: 99, slug: 'draft-post', type: 'post', status: 'draft', date: '2024-01-01 10:00:00' },
    ])
    expect(Object.keys(map)).toHaveLength(0)
  })

  it('handles multiple posts', () => {
    const map = buildRedirectMap([
      { id: 1, slug: 'post-one', type: 'post', status: 'publish', date: '2024-01-01 09:00:00' },
      { id: 2, slug: 'post-two', type: 'post', status: 'publish', date: '2024-02-01 09:00:00' },
      { id: 3, slug: 'about', type: 'page', status: 'publish', date: '2024-01-01 10:00:00' },
    ])
    // 2 entries per post (date path + ?p=), 2 per page = 6 total
    expect(Object.keys(map)).toHaveLength(6)
    expect(map['/2024/01/post-one/']).toBe('/blog/post-one/')
    expect(map['/2024/02/post-two/']).toBe('/blog/post-two/')
    expect(map['/2024/01/about/']).toBe('/about/')
  })

  it('pads month with leading zero', () => {
    const map = buildRedirectMap([
      { id: 1, slug: 'summer-post', type: 'post', status: 'publish', date: '2024-07-04 09:00:00' },
    ])
    expect(map['/2024/07/summer-post/']).toBe('/blog/summer-post/')
    expect(map['/2024/7/summer-post/']).toBeUndefined()
  })
})
