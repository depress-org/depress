# Contributing to depress

Thanks for your interest in contributing! This document covers how to get the
repo running locally, how pull requests get reviewed, and the open-core
boundary so you know what belongs where.

## Project snapshot

`depress` is a TypeScript ESM npm-workspaces monorepo that migrates WordPress
exports to Astro + Keystatic + Cloudflare Pages. Packages are layered:

`@depress/core` (types) -> `@depress/wp-migrate` (engine) -> `depress`
(`packages/cli`, the command entrypoint).

See `AGENTS.md` for the deeper architecture notes.

## Running the repo locally

```bash
# Install once at the root
npm install

# Build all packages (required before cross-package usage)
npm run build

# Or build just one package
npm run build -w packages/core      # or wp-migrate, cli

# Watch mode for a package
npm run dev -w packages/cli

# Type check (there is no test suite in core/cli yet; wp-migrate has unit tests)
npm run typecheck

# Run the CLI after building
node packages/cli/dist/index.js migrate --input export.xml --output ./output
```

Notes:
- `packages/cli`'s `lint` script is TypeScript-only (`tsc --noEmit`), not ESLint.
- Clean all `dist/` output with `npm run clean`.
- Workspaces resolve each other's built `dist/` artifacts, not source — build
  order matters when testing cross-package changes.
- Never write scratch/temp files to `/tmp`; use `./.tmp/` at the project root
  (see AGENTS.md).

Validate changes with `npm run build` and `npm run typecheck` at minimum, then
exercise the CLI against a real WXR sample (e.g.
`examples/mamas-blog/sources/insight.WordPress.2026-05-02.xml`).

## The bar a migration must clear

Before you open a PR that touches the migration pipeline, check it against
`ROADMAP.md`'s "The bar to clear" section — a migration passes review when:

1. `npm run build` succeeds with zero errors
2. `redirects.json` has an entry for every published post
3. Every post has a non-empty `author` field
4. Zero posts have blank `description`/`excerpt` if Yoast meta was present
5. The migration report shows 0 silent drops (shortcodes preserved as
   comments, never deleted)
6. Keystatic admin shows all posts; every post opens without a validation
   error

Bug reports and PRs should reference which of these checks is affected.

## How to contribute

1. Fork the repo and create a branch from `main`.
2. Make your change, following the conventions in `AGENTS.md`.
3. Run `npm run build` and `npm run typecheck` (and `wp-migrate`'s test suite
   if you touched the engine).
4. Open a pull request describing what changed and why, and which "bar to
   clear" checks you validated against.

## How PRs get reviewed

- A maintainer reviews every PR before merge; CI (`.github/workflows/ci.yml`)
  must pass.
- Small, focused PRs get reviewed faster than large ones — prefer splitting
  unrelated changes into separate PRs.
- Changes to `@depress/wp-migrate`'s transformation logic should keep the
  generated `keystatic.config.ts` assumptions in sync (see AGENTS.md).
- Maintainers may ask for a test or a manual run against a sample WXR export
  before merging.
- Protected-branch merges and releases are handled by maintainers only.

## Open-core boundary: what stays free

`depress` is open core. The following packages are, and will remain, free and
open source under this repo:

- `@depress/core` — shared contract types
- `@depress/wp-migrate` — the migration engine
- `depress` (`packages/cli`) — the command-line entrypoint

Paid/premium features (for example advanced enterprise migration capabilities,
hosted services, or managed deployment tooling) live in **separate packages**,
not inside `@depress/core` or `@depress/wp-migrate`. If you're proposing a
feature that feels like it belongs behind a paywall, please say so in the
issue/PR — it likely belongs in a separate package rather than core, and a
maintainer will help route it correctly. This boundary is intentional and
contributions that blur it will be asked to split.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.
