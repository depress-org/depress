import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { scaffoldAstroProject } from '../scaffold.js'

describe('generated consumer build compatibility #16 / PR-02', () => {
  it('keeps the Astro/React/Keystatic cycle in one chunk for nested consumer installs', async () => {
    const root = resolve('../../.tmp')
    await mkdir(root, { recursive: true })
    const site = await mkdtemp(join(root, 'scaffold-cycle-'))
    try {
      await scaffoldAstroProject({
        siteTitle: 'Synthetic fixture', siteDescription: 'Test',
        siteUrl: 'https://fixture.invalid', authorName: 'Fixture',
        navItems: [], hasCategories: false, hasTags: false,
      }, site)
      const config = await readFile(join(site, 'astro.config.mjs'), 'utf8')
      expect(config).toContain("'@keystatic/core'")
      expect(config).toContain("'@keystatic/astro'")
    } finally {
      await rm(site, { recursive: true, force: true })
    }
  })
})
