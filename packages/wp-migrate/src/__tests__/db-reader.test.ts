import { describe, it, expect } from 'vitest'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWPDatabase } from '../db-reader.js'

async function withFixture(sql: string, fn: (path: string) => Promise<void>) {
  const path = join(tmpdir(), `depress-db-test-${Date.now()}.sql`)
  await writeFile(path, sql, 'utf-8')
  try {
    await fn(path)
  } finally {
    await unlink(path).catch(() => {})
  }
}

const SAMPLE_SQL = `
-- WordPress MySQL dump

INSERT INTO \`wp_users\` VALUES (1,'admin','$P$hash','admin','admin@example.com','https://example.com','2024-01-01 00:00:00','',0,'Dr. Jane Smith');

INSERT INTO \`wp_postmeta\` VALUES
(1,101,'_thumbnail_id','201'),
(2,101,'_yoast_wpseo_title','SEO Title for Post 101'),
(3,101,'_yoast_wpseo_metadesc','SEO description for post 101.'),
(4,101,'acf_mood','contemplative'),
(5,102,'_thumbnail_id','202'),
(6,102,'custom_field','custom value');

INSERT INTO \`wp_options\` VALUES
(1,'siteurl','https://example.com','yes'),
(2,'blogname','My Psychology Blog','yes'),
(3,'blogdescription','Insights on the mind','yes');
`

describe('readWPDatabase', () => {
  it('parses site options', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.options.siteurl).toBe('https://example.com')
      expect(db.options.blogname).toBe('My Psychology Blog')
      expect(db.options.blogdescription).toBe('Insights on the mind')
    })
  })

  it('parses users with display name', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      const user = db.users.get(1)
      expect(user).toBeDefined()
      expect(user!.login).toBe('admin')
      expect(user!.displayName).toBe('Dr. Jane Smith')
      expect(user!.email).toBe('admin@example.com')
    })
  })

  it('extracts postmeta for each post', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.has(101)).toBe(true)
      expect(db.postMeta.has(102)).toBe(true)
    })
  })

  it('extracts _thumbnail_id from postmeta', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(101)?.['_thumbnail_id']).toBe('201')
      expect(db.postMeta.get(102)?.['_thumbnail_id']).toBe('202')
    })
  })

  it('extracts Yoast SEO meta', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(101)?.['_yoast_wpseo_title']).toBe('SEO Title for Post 101')
      expect(db.postMeta.get(101)?.['_yoast_wpseo_metadesc']).toBe('SEO description for post 101.')
    })
  })

  it('extracts ACF / public custom fields', async () => {
    await withFixture(SAMPLE_SQL, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(101)?.['acf_mood']).toBe('contemplative')
      expect(db.postMeta.get(102)?.['custom_field']).toBe('custom value')
    })
  })

  it('handles multi-row INSERT statements', async () => {
    const multiRow = `
INSERT INTO \`wp_postmeta\` VALUES (1,10,'key_a','val_a'),(2,10,'key_b','val_b'),(3,11,'key_c','val_c');
INSERT INTO \`wp_options\` VALUES (1,'blogname','Test Blog','yes'),(2,'siteurl','https://test.com','yes');
`
    await withFixture(multiRow, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(10)?.['key_a']).toBe('val_a')
      expect(db.postMeta.get(10)?.['key_b']).toBe('val_b')
      expect(db.postMeta.get(11)?.['key_c']).toBe('val_c')
      expect(db.options.blogname).toBe('Test Blog')
    })
  })

  it('handles escaped single quotes in values', async () => {
    const sqlWithQuotes = `
INSERT INTO \`wp_postmeta\` VALUES (1,200,'_yoast_wpseo_title','It\\'s a great blog');
INSERT INTO \`wp_options\` VALUES (1,'blogname','O\\'Reilly Blog','yes');
`
    await withFixture(sqlWithQuotes, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(200)?.['_yoast_wpseo_title']).toBe("It's a great blog")
      expect(db.options.blogname).toBe("O'Reilly Blog")
    })
  })

  it('handles custom table prefix', async () => {
    const customPrefix = `
INSERT INTO \`myblog_postmeta\` VALUES (1,50,'_yoast_wpseo_title','Custom prefix post');
INSERT INTO \`myblog_options\` VALUES (1,'blogname','Custom Prefix Blog','yes');
`
    await withFixture(customPrefix, async (path) => {
      const db = await readWPDatabase(path)
      expect(db.postMeta.get(50)?.['_yoast_wpseo_title']).toBe('Custom prefix post')
      expect(db.options.blogname).toBe('Custom Prefix Blog')
    })
  })
})
