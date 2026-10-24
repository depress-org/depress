# PR-01 / #15 — trustworthy CI repair

PR #8 remains the only implementation PR; independent review/merge belongs to
Integration A (Kanban t_39ed4b32). This is not production/service acceptance.

## Required workflow

Both `Build & type-check` and `Generated fixture site` are non-optional CI jobs.
No continue-on-error, token-dependent uploader or workspace --if-present coverage
escape remains. Branch-protection settings are not changed by this PR; maintainers
must require both check names in their ruleset if not already required.
Node is pinned to 20.20.2 in .nvmrc, matching local execution. npm 10.9.9 locally.

`npm test` discovers npm workspaces, runs all four runnable suites WITH coverage,
and rejects a new testable workspace lacking test:coverage. Only types-only core
and the built example have explicit no-test exemptions. Every suite includes
untested runtime source in its denominator (CLI entry index.ts is excluded).

Baseline (statements / branches / functions / lines), Node 20.20.2, Vitest and
coverage-v8 both pinned 4.1.12:

- CLI, 41 tests: 42.78 / 36.86 / 44.87 / 43.29; gates 37 / 23 / 34 / 37 unchanged.
- Engine, 36 tests: 36.87 / 26.04 / 24.80 / 38.67; gates 25 / 19 / 15 / 27 unchanged.
- job-core, 8 tests: 94.87 / 73.33 / 80 / 97.22; gates 94 / 73 / 80 / 97.
- web, 7 tests: 83.72 / 75 / 55.55 / 85.36; gates 83 / 75 / 55 / 85.

92 tests total. Engine coverage is measured in its own suite, NOT inflated by
CLI tests importing built dist. These low legacy gates are a regression floor,
not evidence of thorough engine coverage.

## Executed commands and negative proof

- `npm ci --legacy-peer-deps` (cold install from corrected lock, success).
- `npm run build` (includes real mamas-blog Astro build).
- `npm run typecheck` (all five TypeScript packages).
- `npm test` (all 92 tests and four applicable measured coverage gates).
- `npm run test:gate`: temporarily raises CLI statements to 99, invokes the
  SAME required root npm test, verifies exit 1 AND the threshold-specific error,
  then restores config in finally. Actual: 42.78 < 99; rejected with exit 1.
- `npm run test:integration`: real CLI migration of bounded synthetic WXR,
  actual Astro hybrid build, reads the three rendered HTML bodies, rejects
  draft route and draft listing leakage. No generated config is patched in test.

## Pinned integration scope / exclusions

The generated-site integration reuses the root npm-ci node_modules via symlink,
with root lock entries checked for every generated dependency. It does NOT claim
an independent generated consumer install or tarball acceptance (#19 owns that).
The fixture has two published posts, one page, one draft, no media/embeds. Each
post must retain its exact dc:creator (not a title fallback), title and distinct
body marker; the page marker and all six exact redirects are asserted. Draft
source remains editable but does not appear in generated public routes/listings.
No claim of shortcode, embed, media archive or Keystatic editing validation.

Conversion/build fixture makes no intended outbound requests. Dependency install
DOES use npm network; the entire suite is not sandboxed to prove zero network.
Deployment tests elsewhere mock the external provider; no real deploy, publish,
credential, live customer or production action was performed.

## Build defects exposed rather than bypassed

Restoring main dependency resolutions fixes the pinned PR's example _renderer0
failure (main already contains the renderer-colocation workaround). The newly
exercised scaffold ALSO needed that workaround, and its homepage filesystem
Keystatic reader was incompatible with Workers bundling. Settings now compile
from site-config.yaml?raw with yaml; changes take effect at rebuild as before.
Sitemap 3.7.2 assumes newer Astro build metadata (`pages.reduce` on undefined);
scaffold and root integration harness pin the compatible 3.2.1. Sitemap's own
transitives necessarily change. Existing unrelated main resolutions, including
Zod placements and platform libc metadata, are preserved; coverage-v8 5.0.5 is
necessarily replaced by the runner-aligned 4.1.12. No audit fix --force.

Remaining: site-wide production readiness, CMS schema/editor acceptance,
independent consumer packaging, durable jobs/auth/billing/deploy are NOT signed
off by this CI repair. Remote exact-head checks and review request are recorded
in PR #8 and the task handoff after execution.
