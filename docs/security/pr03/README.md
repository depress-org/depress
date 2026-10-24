# PR-03 security gate (#17)

Verdict: NO-GO for public/credentialed hosted operation and generated-site release. This PR is a triage and one compatibility-preserving patch, NOT security approval. No service, cloud deployment, npm publication, secret access/rotation or production configuration was exercised.

## Reproducible evidence

Baseline: main `19f239e507bb9b4beaa8ff9273560ba6f2aa5360`, 2026-10-24. Registry audit snapshot captured with npm 11.19.1; validation uses CI's Node 20 (20.20.2), not the shell's Node 26. Node/platform matters: default `npm ci` output omits some optional packages, so its 17-before/16-after installed-tree totals are NOT the full lockfile totals. The reproducible full lock audit is 19 before (1 critical/11 high/7 moderate), 18 after (1 critical/10 high/7 moderate). There are 53 distinct direct advisories before, 52 after; propagated package findings are not distinct advisories.

```
npm ci --legacy-peer-deps
npm audit --package-lock-only --json > .tmp/security/current-audit.json
# audit exits 1 when findings remain; do not turn that into a clean verdict.
git show 19f239e:package-lock.json > .tmp/security/baseline-lock.json
node scripts/security-audit.mjs docs/security/pr03/audit-before.json .tmp/security/baseline-lock.json
node --test scripts/security-audit.test.mjs
npm run build
npm run typecheck
npm test
```

Create `.tmp/security` first. The renderer is offline and fails on missing lock entries or inconsistent counts. `audit-before.json`, `audit-after.json` and [advisories.md](advisories.md) enumerate every advisory URL, affected range, exact locked node/version, and propagated package. Registry data changes over time; snapshots are evidence, not a permanent vulnerability oracle. No npm audit force, root overrides or unrelated lock regeneration was used.

## Focused patch and compatibility evidence

Only lock entry `node_modules/nanoid` changes 5.1.11 -> 5.1.16 (including registry integrity). Parent `@toeverything/y-indexeddb@0.10.0-canary.9` requests `^5.0.1`; PostCSS's separate nanoid 3.3.20 is untouched. GHSA-28wg-ghj8-5hjv affects non-secure generators with negative size. This is an example/generated Keystatic browser dependency, not an application-requested CLI job ID generator; no demonstrated externally controlled negative size. Patch is still safe defense-in-depth. A regression invokes the patched generator with a synthetic negative size and checks ordinary output length. No major API upgrade is smuggled in.

Cold root install, Node 20 build/typecheck and all existing tests passed: CLI 24, job-core 8, web 7, wp-migrate 36. Five additional Node tests pass. Root example Astro hybrid build passes but has empty articles/pages, so it is NOT generated-content acceptance.

Actual fixture conversion was exercised:

```
node packages/cli/dist/index.js migrate --input packages/wp-migrate/src/__fixtures__/sample-export.xml --output .tmp/security/generated-site --theme scaffold
npm --prefix .tmp/security/generated-site install --legacy-peer-deps
npm --prefix .tmp/security/generated-site run build
```

Conversion returns 3 articles, 0 pages, 3 categories, 6 redirect entries; one fixture image reports Invalid URL and 0 media copied. The cold generated-site build FAILS: Cloudflare/Vite cannot bundle `node:path` imported by `@keystatic/core/dist/keystatic-core-reader.worker.js`. This is a real baseline compatibility blocker, not patched or hidden here; tracked in #26 and handed to #19 QA. Generated dependencies remain vulnerable. No successful deploy or generated-site acceptance is claimed.

## Reachability by surface

| Surface | What actually runs | Security interpretation |
| --- | --- | --- |
| Published CLI/library | CLI -> wp-migrate -> fast-xml-parser 4.5.7, wordpress-export-to-markdown 3.0.4, Markdown/SQL/filesystem tooling | Astro is NOT a CLI runtime import. XMLBuilder advisory is not invoked by our XMLParser use. Converter downloads and path writes ARE reachable from untrusted export input. This is not a clean CLI security bill. |
| Hosted API/job runtime | Hono API -> in-process CLI/pipeline -> converter; optional build/deploy | API has direct unauthenticated/unbounded routes. Astro executes in generated builds, not as Hono request framework. Credentials gate current deployment path, not upload/conversion. |
| Repository dev/build | Example Astro 4.16.19 + Cloudflare 10.4.2 / Wrangler 3.114.17 / Miniflare 3.20250718.3 / Vite 5.4.21, Vitest's separate Vite 8.3.5 | Many advisories require serving development/emulator endpoints or particular Windows editor paths. A lockfile hit alone is not proof of deployed exploitation. Never publicly expose dev/preview/emulator servers. |
| Generated sites | Scaffold, bundled themes and downloaded themes bring their OWN manifests/ranges/locks | Root lock patch does not fix freshly installed generated sites. Scaffold and example use hybrid Cloudflare output, Keystatic routes, not static-only HTML. Native image processing can also be build-time exposure. Inspect each output/adapter before any release. |

`npm audit --omit=dev` at the monorepo root still includes the example's production dependencies; do not label that the published CLI dependency tree. Per-consumer packaging/audit is independently required by #19.

## Advisory remediation map

Exact IDs and affected ranges for ALL rows are in advisories.md. Floors below are registry snapshot candidates, NOT verified compatible upgrades. No unresolved advisory is granted an exception.

| Package family / exact baseline | Reachability and prerequisites | Patch path / disposition |
| --- | --- | --- |
| Astro 4.16.19 (19 direct advisories) | Header/path/auth/server-island/error-page issues require relevant SSR endpoints/features. XSS compiler/source issues can affect output; AVIF/native optimization critical needs image processing. Cloudflare currently warns and selects noop image service, reducing that particular endpoint path, NOT all advisory reachability. Generic scaffold imports sharp; untrusted uploads/builds still not isolated. No live exploit attempted. | For all currently listed Astro advisories >=7.3.2; audit recommends 7.4.2. Explicit Astro 4->7 migration with adapter/Keystatic/Markdoc/content collection and consumer-build tests, #26. No blanket override. |
| Cloudflare 10.4.2 | Its GHSA-88gm-j2wx-58h6 requires image-binding transform redirect path. Noop configuration may avoid it; inspect deployed output, not assumed static. Also inherits Astro/emulator findings. | Own advisory >=13.1.10; audit recommends 14.4.2. Major adapter migration #26. |
| Markdoc 0.11.5 | Inherits Astro/esbuild; build/dev surface, not CLI XML parser. | Audit recommends 2.1.1; coordinate Astro upgrade #26. |
| esbuild 0.17.19 / 0.19.12 / 0.21.5 | GHSA-67mh-4wv8-2f99 requires vulnerable dev HTTP server reachable by browser. No application esbuild serve call identified. | >0.24.2 through compatible upstream updates. Vitest/tsx's 0.28.2 is not the affected node. #26. |
| Vite 5.4.21 | Eight direct advisories cover dev filesystem/editor/custom middleware. Windows-specific editor advisories are not demonstrated on Linux CI. Root example/dev and generated-site dev surface; Vitest's Vite 8.3.5 distinct. | >6.4.3 candidate; audit via Astro 7.4.2. #26. |
| sharp 0.33.5 | Three native dependency advisories; image processing (including build-time) prerequisite. Noop generated configuration lowers but does not erase risk for other themes/imports. | >=0.35.5, native/platform and image fixture tests; breaking minor in pre-1.0, no override #26. |
| Wrangler 3.114.17 / Miniflare 3.20250718.3 | Propagated emulator/native dependencies; local tooling and generated deploy installation. CLI uses npx provider command, so generated/provider version can differ from root lock. | Audit recommends Wrangler 4.152.0 and Cloudflare 14.4.2; lock compatible Miniflare and validate offline deploy contract #26. No live deploy. |
| undici 5.29.0 | Thirteen direct advisories affect client response/cookie/WebSocket/interceptor capabilities; Miniflare path, not automatically Node's built-in fetch. Feature reachability not exhaustively proven. | >=6.28.1 clears snapshot direct advisories; upgrade through supported emulator dependency graph #26, not a cross-major transitive override. |
| @fastify/busboy 2.1.1 | Two direct multipart advisories inherited through emulator undici; NOT proof Hono parseBody uses this implementation. | >=3.2.2 through supported emulator upgrade #26. |
| ws 8.18.0 | Memory disclosure/fragment exhaustion requires WebSocket input; emulator path, not a direct web API WebSocket route. | >=8.21.0 via compatible parent upgrade #26; pinned parent not force-overridden. |
| Zod 3.22.3 / 3.25.76 / 4.4.2; zod-to-ts 1.2.0 | Oversized constrained collections require attacker-controlled validation data; used by Astro/emulator and Keystatic tree, no direct Hono body Zod schema here. | >=4.6.6; v3 consumers require migration, not major override. zod-to-ts propagated; #26. |
| postcss-selector-parser 6.1.5; postcss-nested 6.2.0; Tailwind 3.4.19; @astrojs/tailwind 5.1.5 | Selector quadratic CPU work is build-time with crafted CSS. Propagated packages are not four distinct direct advisories. Fixed trusted theme CSS reduces likelihood, not a sandbox. | Parser >=7.1.6; npm reports no supported automatic fix through current Tailwind tree. Stage toolchain/CSS migration #26, preserve generated styling. |
| fast-xml-parser 4.5.7 | GHSA-gh4j-gqv2-49f6 is XMLBuilder comment/CDATA injection. Repository parser.ts uses XMLParser, not XMLBuilder. Other parsing resource risks remain independently. | Builder fix >=5.7.0; audit recommends 5.11.2. No reachable builder call identified; defer tested major migration #26, not false clean waiver. |
| nanoid 5.1.11 | Non-secure negative-size path; example/browser dependency; no attacker-controlled size identified. | Patched 5.1.16 and tested in this PR. |

## Hosted boundary source audit

1. Admission/auth/tenant: `web/src/app.ts:23-86` has no auth middleware, global job listing and unrestricted creation. `job-core/src/types.ts:30-83` lacks owners. `web/src/server.ts:10` omits an explicit hostname; logging localhost is not proof of loopback binding. Real network exposure is not inspected/authorized. Fix #23; bot local-scaffold blockers remain #21 / PR #14 unmerged.
2. Body/resources: multipart `parseBody()` at app.ts:45 precedes quotas, then full `arrayBuffer()`/Buffer duplication at 59-66. XML and SQL parsers read whole files (`wp-migrate/src/parser.ts:11-20`, `db-reader.ts:18-32`). Every accepted request starts work immediately. No finite CPU/memory/disk/process/time/output budget, durable queue or cancellation. Admission #23, execution #25; lower-level process semantics stay #16.
3. Paths: export taxonomy slugs are decoded and joined into filenames (`parser.ts:75-76,128,191-195`, CLI migrate writeTaxonomy). `transform.ts:60-62` has a separate library slug sink; current hosted pipeline uses transformWp2mdOutput, not that function. Installed converter 3.0.4 additionally decodes post slug (`src/parser.js:99`) before `src/shared.js:19-71` path joins; filename decoding follows character replacement (`shared.js:74-90`). Must contain BEFORE converter writes, not only validate generated output. Optional local-media server prefix check lacks realpath containment, but web does not currently supply mediaDir. #24.
4. SSRF/TLS: CLI passes uploaded XML to image downloader with `--save-images=all` and `--strict-ssl=false`. Installed converter `src/writer.js:150-170` calls Axios on export-derived URLs, buffering response without explicit request deadline/byte cap and installs TLS agents with verification disabled. No private-address/DNS/redirect egress policy identified. Exact rebinding/redirect exploit was not probed. #24 with network-layer worker boundary #25.
5. Archives: web currently accepts XML/SQL, NOT ZIP upload. Local `migrateMedia` skips Dirent symlinks but lacks bounds and allows SVG/PDF/ZIP. External themes are fixed registry choices, not arbitrary upload URLs, but `theme-inject.ts:43-57` pipes mutable branch archives to tar without app entry/link/expansion validation/digest. Archive upload/extraction is #22; same containment primitive should be reused for theme archives, with pinned digests rather than a second extractor.
6. Generated-code trust: uploaded siteTitle reaches `themes/astrowind.ts:90-113` generated TS template and `rocket.ts:53-65` quoted values, plus scaffold Astro/TS source (`scaffold.ts:224,253,1166`). A source injection sink is identified, not a demonstrated successful RCE. Body conversion into MDX requires an explicit trust policy. Auth alone does not make uploaded source safe. #24.
7. Execution: generated project scripts/themes run under shared service identity; deploy.ts builds with process.env and shell-backed arguments, exposing credentials and uploaded project names. Process exits/results/shell/timeouts are #16-owned; that refactor alone is NOT disposable isolation. #25 covers process/FS/network/credential capability separation. Build currently follows token check, so no token means no build/deploy in this baseline; migration still runs.
8. Retention/redaction: uploads have no cleanup; cleanupJob only offers optional output removal. Job store has no expiry/deletion. SQL dumps retain full source including potentially sensitive data although SQL is parsed as text, not executed. Public jobs return repoPath and raw error; logs include converter output and deploy stderr; Vercel token goes in argv. Need owned cleanup, expiry, redaction and minimal public errors #25, coordinating #16. No real secrets were inspected. `PUBLIC_SITE=false` robots metadata is NOT preview authentication.

## Ownership, expiry, release gates

No risk acceptance/exception is authorized. Pending blockers are assigned to the fullstack-dev implementation lane via #23/#24/#25/#26; #16 owns shared CLI/process API, #21 bot safety, #22 media archives. Review deadline for unresolved audit disposition: 2026-10-31; expiry means continue NO-GO, not automatic approval. Integration must preserve PR #8/main coverage/devDependency changes and apply only the nanoid lock-entry delta if the root lock has advanced (hotspot: package-lock.json). Re-audit exact integrated lock and each generated consumer. Independent phase-A reviewer must review this PR and exact-head CI; author does not merge it. #19 owns cold acceptance, not scanner-count inference.
