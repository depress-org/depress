# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all packages
npm run build

# Build a single package
npm run build -w packages/core
npm run build -w packages/wp-migrate
npm run build -w packages/cli

# Watch mode (per package)
npm run dev -w packages/cli

# Type check (no emit)
npm run typecheck

# Run the CLI locally (after building)
node packages/cli/dist/index.js migrate --input export.xml --output ./output
```

There are no tests yet. The `lint` script in `packages/cli` is aliased to `tsc --noEmit`.

## Architecture

This is a TypeScript ESM monorepo (npm workspaces). Packages must be built before they can reference each other — the workspace `*` version range points at `dist/`, not source.

**Package dependency graph:**

```
@depress/core          ← shared types only, no runtime deps
    ↑
@depress/wp-migrate    ← migration engine (fast-xml-parser, turndown, gray-matter)
    ↑
depress (cli)          ← commander + inquirer CLI, imports wp-migrate and core
```

`@depress/astro` (`packages/astro-integration`) is a placeholder — the directory exists but has no source files yet.

### Migration pipeline

`@depress/wp-migrate` implements a five-step pipeline (steps 1, 2, 4, 5 are implemented; step 3 is a stub/TODO):

1. **`parseWPExport`** (`parser.ts`) — reads a WordPress WXR (XML) export via `fast-xml-parser`, extracts posts, pages, categories, tags, and attachments into `WPExport`
2. **`transformPosts`** (`transform.ts`) — converts HTML content to Markdown via `turndown`, strips WP shortcodes, writes `.mdoc` files to `src/content/articles/<slug>/index.mdoc` or `src/content/pages/<slug>/index.mdoc`; only `publish`-status posts are migrated
3. **`migrateMedia`** (`media.ts`) — **stub, not yet implemented**; should scan `wp-content/uploads/`, copy files to `public/media/`, and return an old-URL → new-path map
4. **`generateKeystaticConfig`** (`generate-config.ts`) — inspects the parsed `WPExport` to decide which Keystatic collections to emit (articles always; categories/tags/pages conditionally), then code-generates a `keystatic.config.ts` string
5. **`rollback`** (`rollback.ts`) — removes migrated output dirs for targeted rollback; accepts scope `'all' | 'articles' | 'pages' | 'media'`

### CLI commands

All commands in `packages/cli/src/commands/` follow the same pattern: a named export `run<Command>(options)`. Commands are lazy-imported in `index.ts` to keep startup fast.

- `init` — scaffolds a new Astro + Keystatic project (interactive prompts via inquirer); scaffolding logic is TODO
- `migrate` — full WP migration pipeline; main logic is TODO (calls stubs)
- `deploy` — Cloudflare Pages deploy; stub
- `check` — QA checks on migrated output; stub

### Output structure

The migration writes into an output directory with this layout:
```
output/
  src/content/
    articles/<slug>/index.mdoc
    pages/<slug>/index.mdoc
    categories/
    tags/
  public/media/
  keystatic.config.ts   ← generated
```

### TypeScript config

All packages extend the root `tsconfig.base.json`: `ES2022` target, `ESNext` modules, `bundler` module resolution, strict mode. Each package compiles to its own `dist/` with declarations and source maps.