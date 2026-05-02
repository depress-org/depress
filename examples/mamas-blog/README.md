# mamas-blog 🧠

> The example that started it all.

This is a real-world example of a psychology blog migrated from WordPress to Astro + Keystatic using `depress`.

## The story

My mom is a psychologist. She's had a WordPress blog for years — full of articles, categorized content, pages. She was paying $30/month for hosting.

After migrating with `depress`:
- **Hosting cost: $0/month** (Cloudflare Pages)
- **CMS: Keystatic** — visual editor, she doesn't need to know what Git is
- **Performance: 95+ PageSpeed** — static HTML, global CDN
- **Content: Fully preserved** — all articles, categories, images

## Stack

- **Framework:** Astro 4
- **CMS:** Keystatic (git-based, free)
- **Hosting:** Cloudflare Pages (free)
- **Storage:** GitHub (free)

## Content structure

```
src/content/
├── articles/       # Psychology articles (from WP posts)
├── categories/     # Content categories
├── tags/           # Article tags
├── pages/          # Static pages (About, Contact, etc.)
└── config/         # Site settings & navigation
```

## Getting started

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Open Keystatic admin
open http://localhost:4321/keystatic
```

## Deployment

This example is deployed at Cloudflare Pages, connected to this GitHub repository. Every time content is published in Keystatic, it commits to GitHub, which triggers a rebuild.

## What this example demonstrates

- ✅ Full WordPress migration (posts, pages, categories, tags)
- ✅ Keystatic visual editor for non-technical users
- ✅ SEO-friendly URLs matching original WordPress structure
- ✅ 301 redirects from old WordPress URLs
- ✅ Image optimization with Astro
- ✅ Responsive design
- ✅ Zero ongoing costs
