# AGENTS.md

## Project Snapshot
- `depress` is a TypeScript ESM npm-workspaces monorepo for migrating WordPress exports to Astro + Keystatic + Cloudflare Pages.
- Packages are layered: `@depress/core` (types) -> `@depress/wp-migrate` (engine) -> `depress` (`packages/cli`, command entrypoint).
- `packages/astro-integration` exists but is currently a placeholder (no source yet).

## Architecture That Matters
- Shared contract types live in `packages/core/src/index.ts` (`WPExport`, `WPPost`, `MigrationReport`, Keystatic config types).
- Migration engine public API is re-exported from `packages/wp-migrate/src/index.ts`.
- Pipeline pieces (implemented unless marked):
  - ✅ Parse WXR XML: `parseWPExport` in `packages/wp-migrate/src/parser.ts`
  - ✅ Transform posts/pages to `index.mdoc`: `transformPosts` in `packages/wp-migrate/src/transform.ts` — only `publish`-status posts migrate
  - 🚧 Media migration: `packages/wp-migrate/src/media.ts` — **stub/TODO**, returns empty map
  - ✅ Keystatic config codegen: `packages/wp-migrate/src/generate-config.ts`
  - ✅ Rollback output dirs: `packages/wp-migrate/src/rollback.ts` — accepts scope `'all' | 'articles' | 'pages' | 'media'`
- Current CLI commands in `packages/cli/src/commands/*` are mostly scaffolds; `migrate`, `init`, `deploy`, `check` are not fully wired to engine yet.

## Dev Workflows (Important in this repo)
- Install once at root: `npm install`
- Build all packages before cross-package usage: `npm run build`
- Build one package: `npm run build -w packages/core` (or `wp-migrate`, `cli`)
- Watch mode (per package): `npm run dev -w packages/cli`
- Type check (no tests currently): `npm run typecheck`
- Run CLI after build: `node packages/cli/dist/index.js migrate --input export.xml --output ./output`
- `packages/cli` `lint` is TypeScript-only (`tsc --noEmit`), not ESLint.
- Clean all `dist/` dirs: `npm run clean` (root script, `find … | xargs rm -rf`)

## Repo-Specific Conventions
- Workspaces use dependency version `"*"`; consuming packages resolve built `dist/` artifacts, not source. Build order matters.
- ESM import style uses explicit `.js` extensions inside TypeScript (example: `packages/cli/src/index.ts`, `packages/wp-migrate/src/index.ts`).
- CLI pattern: each command module exports `run<Command>` and is lazy-imported from `packages/cli/src/index.ts`.
- Migration output layout is expected to be:
  - `src/content/articles/<slug>/index.mdoc`
  - `src/content/pages/<slug>/index.mdoc`
  - `src/content/categories`, `src/content/tags`
  - `public/media`
  - `keystatic.config.ts`

## Integration Points & External Libraries
- XML ingestion: `fast-xml-parser` (`parser.ts`).
- HTML → Markdown: `turndown` with shortcode cleanup (`transform.ts`).
- Slug generation: `slugify` (`@depress/wp-migrate` dep, used alongside `gray-matter`).
- Frontmatter/config generation is string-based codegen (no AST) in `transform.ts` and `generate-config.ts`.
- CLI UX stack: `commander` + `inquirer` + `ora` + `chalk` in `packages/cli`.
- Keystatic config generation assumes GitHub storage and injects provided `repo` string directly (`generate-config.ts`).
- ⚠️ **Known issue**: `rollback.ts` (inside `@depress/wp-migrate`) imports `chalk`, which is only declared as a dep of `packages/cli` — if chalk is not hoisted by npm it will fail at runtime; add `chalk` to `packages/wp-migrate/package.json` when implementing media migration.

## TypeScript Config
- All packages extend root `tsconfig.base.json`: `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true`.
- Each package compiles to its own `dist/` with declarations (`declarationMap: true`) and source maps.
- Use `isolatedModules: true` — avoid `const enum` and type-only namespace imports.

## Practical Guidance For Agent Changes
- If adding features to CLI commands, wire them to engine functions in `@depress/wp-migrate` rather than duplicating logic in `packages/cli`.
- Keep new cross-package types in `@depress/core`; avoid importing engine internals directly across package boundaries.
- For migration behavior changes, update both transformation logic and generated `keystatic.config.ts` assumptions together.
- Because there is no test suite yet, validate via `npm run build` and `npm run typecheck` at minimum, then run CLI against a real WXR sample (for example `examples/mamas-blog/sources/insight.WordPress.2026-05-02.xml`).
