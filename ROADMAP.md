# depress — Quality Roadmap

> Goal: every migrated site should be production-ready on day one — SEO preserved, all content transferred, editorial team unblocked.

---

## What "high quality" means, measurably

| Metric | Target |
|---|---|
| Content completeness | 100% of published posts and pages transferred, zero silent drops |
| SEO continuity | Every old URL has a 301 redirect entry; Yoast title/description preserved |
| Media integrity | All images present; alt text preserved from WordPress |
| Editor readiness | Keystatic admin shows all posts, every post opens without errors |
| Build success | `npm run build` passes on first attempt after migration |

---

## Priority 1 — Author + featured image extraction (parser.ts)

**Current state:** `dc:creator` (author) and `_thumbnail_id` (featured image) are never read. Author defaults to the site name; featured images are blank.

**Fix: extend `parseWPExport`**

```typescript
// In the item loop, after extracting categories/tags:
const author = item['dc:creator'] ?? ''

// Read postmeta array for _thumbnail_id
const postmeta: any[] = Array.isArray(item['wp:postmeta'])
  ? item['wp:postmeta']
  : item['wp:postmeta'] ? [item['wp:postmeta']] : []

let featuredImageId: string | undefined
let seoTitle = ''
let seoDescription = ''

for (const meta of postmeta) {
  const key = meta['wp:meta_key']
  const val = meta['wp:meta_value']
  if (key === '_thumbnail_id') featuredImageId = String(val)
  if (key === '_yoast_wpseo_title') seoTitle = val ?? ''
  if (key === '_yoast_wpseo_metadesc') seoDescription = val ?? ''
}

posts.push({
  ...,
  author,
  featuredImageId,
  seoTitle,
  seoDescription,
})
```

Also build an `attachmentsById` map so `featuredImageId` can be resolved to a URL at transform time.

**Impact:** author name in every post frontmatter; featured images propagate to theme adapters that support them.

---

## Priority 2 — Redirect map generation (migrate.ts)

**Current state:** The migrate command has no redirect map output. Old WordPress URLs break silently.

**Fix:** After parsing, generate `redirects.json` in the output directory:

```typescript
// Build redirects from old slug → new Astro path
const redirects: Record<string, string> = {}
for (const post of wpExport.posts) {
  if (post.status !== 'publish') continue
  // WordPress canonical: /<year>/<month>/<slug>/ or /?p=<id>
  const date = new Date(post.date)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  
  const newPath = post.type === 'page' ? `/${post.slug}/` : `/blog/${post.slug}/`
  redirects[`/${y}/${m}/${post.slug}/`] = newPath
  redirects[`/?p=${post.id}`] = newPath
}
await writeFile(join(outputDir, 'redirects.json'), JSON.stringify(redirects, null, 2))
```

Also write a `_redirects` file (Netlify/Cloudflare format) and inject the redirect map into `astro.config.ts` under `redirects:`.

**Impact:** zero SEO cliff on cutover. This is the #1 enterprise objection answered automatically.

---

## Priority 3 — Image alt text from postmeta (media.ts / parser.ts)

**Current state:** Alt text comes from `item.title` (the filename). The actual alt text lives in `wp:postmeta` under key `_wp_attachment_image_alt`.

**Fix:** In the attachment parsing loop:

```typescript
if (postType === 'attachment') {
  const postmeta = ...  // same loop as above
  const altText = postmeta.find(m => m['wp:meta_key'] === '_wp_attachment_image_alt')?.['wp:meta_value'] ?? item.title ?? ''
  media.push({ ..., altText })
}
```

Then `injectContent` / `transformWp2mdOutput` can apply the correct alt text when writing `![alt](url)` in Markdown.

**Impact:** accessibility compliance; alt text is a ranking signal Google audits.

---

## Priority 4 — SEO metadata from WXR (parser.ts + theme adapters)

**Current state:** Yoast SEO meta (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`) is ignored even though it's present in the WXR postmeta.

**Fix:** Parse it in Priority 1 above. Then thread it through:

1. Add `seoTitle?: string` and `seoDescription?: string` to `WPPost` in `@depress/core`
2. `mapFrontmatter` in each theme adapter should prefer `fm.seoTitle` / `fm.seoDescription` over computed values
3. AstroWind: map to `metadata.title` and `metadata.description` (already has these fields in the page component, just not populated)
4. Rocket: map to `description` frontmatter field

**Impact:** pages rank under their existing Yoast-optimized titles — no SEO regression.

---

## Priority 5 — Post-migration quality report

**Current state:** The CLI prints a count but no actionable report.

**Fix:** Generate `migration-report.md` in the output directory:

```markdown
# Migration Report — My Blog
Generated: 2026-05-04

## Summary
- 124 pages, 14 posts transferred
- 138/138 redirects generated
- 12 images missing alt text (see below)
- 3 posts had unrecognised shortcodes (content preserved as HTML comment)

## Missing alt text
- /wp-content/uploads/2022/photo.jpg — used in: "Post title A"
- ...

## Unrecognised shortcodes
- Post "Custom page builder example" — [et_pb_section] shortcode preserved as comment
- ...

## Next steps
- Run `npm run build` to verify the site compiles
- Visit /keystatic to review your content in the CMS
- Deploy: `npm run build && npx wrangler pages deploy dist`
```

**Impact:** turns a black box into a transparent handoff document. Required for enterprise and agency tiers.

---

## Priority 6 — DB import module (`--db` flag)

The WXR file is limited: no ACF field data, no user profiles beyond `dc:creator`, no full Yoast meta for all post types, no WooCommerce data. The SQL dump has everything.

**New file: `packages/wp-migrate/src/db-reader.ts`**

Parse a MySQL dump (plain text, no live DB connection needed):

```typescript
export interface WPDBData {
  postMeta: Map<number, Record<string, string>>  // post_id → {key: value}
  users: Map<number, { name: string; email: string; bio: string }>
  options: Record<string, string>  // blogname, blogdescription, etc.
}

export async function readWPDatabase(sqlPath: string): Promise<WPDBData> {
  // Parse INSERT INTO `wp_postmeta` ... VALUES lines
  // Parse INSERT INTO `wp_users` ... VALUES lines  
  // Parse INSERT INTO `wp_options` ... VALUES lines
}
```

**CLI flag:**
```
depress migrate --input export.xml --db wp-database.sql --output ./output
```

When `--db` is supplied, db data augments the WXR parse:
- Yoast meta for every post type (including pages, custom post types)
- ACF field values as extra frontmatter
- Full author profiles (bio, avatar URL)
- Site options (`blogname`, `blogdescription`, `siteurl`) as fallbacks

**Impact:** unlocks ACF-heavy sites (the hardest category), populates author bios, makes the Enterprise tier pitch credible.

---

## Priority 7 — Page builder shortcode handling (transform.ts)

**Current state:** `[et_pb_section]`, `[vc_row]`, `[fusion_builder_container]` and all other shortcodes are silently deleted. Content from Elementor/Divi/WPBakery vanishes.

**Approach:** Replace silent deletion with a tiered strategy:

```typescript
function handleShortcodes(html: string): { content: string; warnings: string[] } {
  const warnings: string[] = []
  
  // Known recoverable: caption, gallery, embed
  let out = html
    .replace(/\[caption[^\]]*\](.*?)\[\/caption\]/gs, '$1')
    .replace(/\[gallery[^\]]*\]/g, '<!-- gallery: review manually -->')
    .replace(/\[embed\](.*?)\[\/embed\]/gs, '$1')  // keep the URL
  
  // Page builders: extract inner text content, warn
  const builderRe = /\[(et_pb_text|vc_column_text|fusion_text)[^\]]*\]([\s\S]*?)\[\/\1\]/g
  out = out.replace(builderRe, (_m, _tag, inner) => inner)
  
  // Structural page builder tags: strip the wrapper, keep children
  out = out.replace(/\[(et_pb_[a-z_]+|vc_[a-z_]+|fusion_[a-z_]+)[^\]]*\]([\s\S]*?)\[\/\1\]/g, '$2')
  out = out.replace(/\[(et_pb_[a-z_]+|vc_[a-z_]+|fusion_[a-z_]+)[^\]]*\/?\]/g, '')
  
  // Remaining unknown shortcodes: preserve as HTML comment for manual review
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\]([\s\S]*?)\[\/\1\]/g, (_m, tag, inner) => {
    warnings.push(`Unrecognised shortcode: [${tag}]`)
    return `<!-- shortcode: [${tag}] -->\n${inner}`
  })
  out = out.replace(/\[([a-z][a-z0-9_-]*)[^\]]*\/?\]/g, (_m, tag) => {
    warnings.push(`Unrecognised self-closing shortcode: [${tag}]`)
    return `<!-- shortcode: [${tag}] -->`
  })
  
  return { content: out, warnings }
}
```

**Impact:** Elementor/Divi content is no longer silently lost. Recoverable text is preserved; structural wrappers are stripped; anything truly unknown becomes a visible HTML comment reviewable in Keystatic.

---

## Priority 8 — Embedded video fallback (transform.ts)

**Current state:** YouTube/Vimeo iframes are converted to nothing by Turndown.

**Fix:** Add a Turndown rule before conversion:

```typescript
turndown.addRule('iframe-video', {
  filter: 'iframe',
  replacement: (_content, node) => {
    const src = (node as Element).getAttribute('src') ?? ''
    if (src.includes('youtube.com') || src.includes('youtu.be')) {
      const id = src.match(/(?:embed\/|v=|youtu\.be\/)([A-Za-z0-9_-]+)/)?.[1]
      return id ? `\nhttps://www.youtube.com/watch?v=${id}\n` : ''
    }
    if (src.includes('vimeo.com')) {
      return `\n${src}\n`
    }
    return `<!-- iframe: ${src} -->`
  },
})
```

Astro MDX will auto-embed YouTube links if an embed component is configured. At minimum the URL survives the migration.

---

## 12-week delivery schedule

| Week | Work |
|---|---|
| 1 | Priority 1: author + featured image extraction |
| 1 | Priority 3: image alt text |
| 2 | Priority 2: redirect map generation |
| 2–3 | Priority 4: Yoast SEO meta threading |
| 3 | Priority 8: embedded video fallback |
| 4 | Priority 7: page builder shortcode handling |
| 4 | Priority 5: quality report |
| 5–7 | Priority 6: DB import module (`--db` flag) |
| 8+ | Enterprise: custom post types, ACF, WooCommerce products |

---

## The bar to clear

A migration passes quality review when:

1. `npm run build` succeeds with zero errors
2. `redirects.json` has an entry for every published post
3. Every post has a non-empty `author` field
4. Zero posts have blank `description`/`excerpt` if Yoast meta was present in the source
5. Migration report shows 0 silent drops (shortcodes preserved as comments, not deleted)
6. Keystatic admin shows all posts; every post opens without a validation error
