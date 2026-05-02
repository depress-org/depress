# depress 🔓

> *De-press yourself.* WordPress to Astro + Keystatic migration tool. **Free your blog.**

[![npm](https://img.shields.io/npm/v/depress)](https://npmjs.com/package/depress)
[![license](https://img.shields.io/github/license/depress-dev/depress)](LICENSE)

## What is depress?

Your WordPress bill is depressing. We fixed it.

`depress` is a CLI tool that migrates WordPress blogs to a fully static, free-forever stack:

- **[Astro](https://astro.build)** — blazing fast static site generator
- **[Keystatic](https://keystatic.com)** — git-based CMS with visual editor (free, open source)
- **[Cloudflare Pages](https://pages.cloudflare.com)** — global CDN hosting (free)
- **[GitHub](https://github.com)** — content & code storage (free)

**Total hosting cost: $0/month. Forever.**

## Quick Start

### New site from scratch

```bash
npx depress init
```

### Migrate from WordPress

```bash
npx depress migrate
```

### Add to existing Astro project

```bash
npx astro add @depress/astro
```

## How it works

```
WordPress (expensive)           Your new stack (free)
─────────────────────           ─────────────────────
MySQL database         →        Markdown files in Git
wp-content/uploads/    →        GitHub / Cloudflare CDN
PHP + Apache           →        Static HTML (Astro)
WP Admin               →        Keystatic visual editor
$20-50/month hosting   →        $0/month (Cloudflare Pages)
```

## Packages

| Package | Description |
|---------|-------------|
| [`depress`](packages/cli) | Main CLI — `npx depress init \| migrate \| deploy` |
| [`@depress/core`](packages/core) | Shared utilities and types |
| [`@depress/astro`](packages/astro-integration) | Astro integration |
| [`@depress/wp-migrate`](packages/wp-migrate) | WordPress migration engine |

## Examples

| Example | Description |
|---------|-------------|
| [`mamas-blog`](examples/mamas-blog) | A psychology blog — the project that started it all |

## Who is this for?

Everyone has a mom (or dad, or grandparent) with an old WordPress blog paying $20-50/month for hosting. This tool migrates it to a free static site in minutes, with a visual CMS that's easy enough for non-technical users.

## License

MIT © [depress-dev](https://github.com/depress-dev)
