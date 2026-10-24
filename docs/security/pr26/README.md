# PR-03 / #26 — staged patched generated-site toolchain

## Verdict and scope

**NO-GO for release/public or credentialed hosting.** This is a compatibility and
patching stage, not permission to publish, deploy, merge, or close #26. Pending
risks have named ownership, expiry, and executable mitigations in
[`release-risks.json`](./release-risks.json). An expiry is not a waiver: unresolved
or expired entries still block Release. Existing report and job quality checks
are unchanged and remain authoritative.

Starting point: independently integrated D, `c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0`.
Resumed author delta is reconciled onto accepted main `86a495040e3a670c17276a96fdc253e31dc545f1`, preserving #22 archive dependencies and tests plus #19 consumer evidence.
The historical PR-03 `node:path` / `reader.worker.js` failure remains documented
in `../pr03`; D already fixed that source boundary. It was not reintroduced or
claimed as a new fix. This task reran the independent cold baseline scaffold:
install, build and unchanged-lock rebuild passed before upgrades. The complete
baseline DEFAULT AstroWind cold build was also actually rerun: installation
succeeded, posts prerendered, then `homes/personal` failed with
`RemoteImageNotAllowed` for Unsplash. The baseline default audit had 22 package
findings (6 moderate, 15 high, 1 critical), versus 19 in the independently queried
root lock (7 moderate, 11 high, 1 critical). Different surfaces are not conflated.

## Explicit stages and contracts

1. **Runtime/compiler/CMS contract**: Node 22.23.4 + npm 10.8.2 and Node 24.22.1 +
   npm 11.21.1. Astro 7.4.2, Vite 8.3.5, Cloudflare 14.4.2, Markdoc integration
   2.1.1, React integration 7.1.1, Keystatic Astro 6.0.0 / core 0.6.9, React and
   React DOM 18.3.1. Renderer 7 is NOT React 7. Keystatic's Markdoc 0.4 and Astro's
   Markdoc 0.5 remain independently resolved; no forced cross-major unification.
   Scaffold uses Content Layer `glob`, entry `id`, and `render(entry)`, with
   `src/content.config.ts`. Remove Astro4 chunk workaround and duplicate CMS
   route; the Keystatic integration owns its routes. Settings stay build-time
   YAML data, never a filesystem reader imported into worker routes.
2. **Styles/native/transitives**: Tailwind 4.3.3's Vite integration replaces
   the obsolete Tailwind/Astro peer contract. Custom theme classes migrate to
   `@utility`. sharp 0.35.5 actually processes bundled assets. Sitemap 3.7.4,
   Wrangler 4.152.0 and the current registry's Vite/PostCSS/ws/Zod paths resolve
   without the prior toolchain findings. Miniflare 5.20261019.2-beta pins undici
   7.29.1, which the current audit still rejects; a **version-scoped same-major**
   override selects 7.30.1. No `audit fix --force`, blind downgrade, or blanket
   cross-major override was used.
3. **Complete default theme**: AstroWind uses Node adapter 11.1.9 (as before,
   it is not a Cloudflare theme). Upgrade MDX/Partytown and astro-embed 0.14.0.
   Remove the optional astro-compress integration: its latest release still pins
   vulnerable sharp/SVGO and unpatched DeepmergeTS; Astro/Vite's normal build
   minification remains. No demos are removed and no report check is disabled.
   The current typography plugin pins selector-parser 6.0.10. Its one explicitly
   scoped compatibility substitution is
   `@tailwindcss/typography@0.5.20 -> postcss-selector-parser@7.1.6`; actual full
   theme builds, including prose/styles, exercise that contract. It is not a
   blanket parser override. Any future parent/version change requires retesting.
4. **Consumer and release gates**: build independently from emitted manifests,
   not only a root symlink/lock. Keep all previous coverage thresholds and
   vitest/coverage-v8 4.1.12 plus nanoid 5.1.16. Reject Workers/Node `dist/server`
   and generated Workers deployment config before legacy Pages credential child
   creation. Release uses canonical `npm test`, an unresolved-risk gate and a
   production audit; no release workflow was dispatched.

Canonical generator pins are in `packages/wp-migrate/src/toolchain.ts`; root,
example and bundled template carry corresponding explicit manifests. Root lock
changes are dependency migration/hoisting, not a claim that every root package
was patched. The root **still reports one moderate fast-xml-parser4 XMLBuilder
advisory** (current `root-audit.json`); no exception is approved. Native WXR/source
controls and all existing tests remain in place. Release is blocked, not waived.

## Reproductions and regression coverage

- Installing the new toolchain against old scaffold files actually failed at the
  removed `output: 'hybrid'` contract. Migrated actual nested consumers render
  post/page bodies and exclude `_drafts` on the new toolchain. The former test
  grepped Astro4 chunk source; its replacement builds and inspects real routes.
- Full default cold baseline reproduces Unsplash failure. Explicit dimensions
  now supply proportional heights instead of requesting remote `inferSize`.
  Dimensionless inputs retain guarded inference. The remote allowlist is
  unchanged; there is no new wildcard, fetch proxy, or noop image-service bypass.
- **Draft loader regression, red then green**: Astro7's glob honors a frontmatter
  `slug` as entry id; filtering only ids beginning `_drafts/` leaked editor bodies
  into public article routes/listings (actual red build retained). The loader now
  excludes `**/_drafts/**` before parsing for both articles and pages. Actual
  ordinary routes, editor slug overrides, page privacy and listings are tested.
  The canonical-byte report proof includes this loader. Integration deliberately
  removes its exclusion, rejects the report, actually builds the leaked route and
  listing, then restores it and verifies absence; old public-copy negatives remain.
- The example CMS also failed an actual populated reader test; its directory,
  content format and imported metadata schema now match generated content. Both
  configs read article and page bodies in the cold consumer test. Its independent
  manifest carries its own scoped undici patch, not an inherited root override.
- A new actual Keystatic reader test initially could not enumerate scaffold
  directory content, then rejected undeclared emitted `slug`. Generated CMS
  collections now declare `*/`, content field/format and imported metadata.
  Reader gates enumerate posts, parse article/page metadata and read actual body
  text. This filesystem reader runs only in Node test tooling, not Worker code.
- `scripts/cold-consumer.mjs`: registry lock/install with install lifecycle
  scripts disabled by the real build service; rendered posts/pages, draft
  exclusion, real CMS reader, local built Worker CMS/UI, full and production
  audits, and byte-identical-lock reinstall/rebuild.
- `scripts/default-consumer.mjs`: complete default migration with original-origin
  local raster media, full untouched theme cold build, body routes, media bytes
  and alt, historical demo retained, CMS reader and built Node UI, full and
  production audits, then same-lock reinstall/rebuild. **Its existing quality
  result is deliberately false**, including unproven Markdown/body/media grammar
  and unsupported imported pages. No false `done`/deploy result is substituted.
- `scripts/local-runtime.mjs` binds loopback only, uses a stripped credential-free
  environment and bounded teardown. It invokes Wrangler `dev --local`, not a
  deployment. No provider, GitHub-storage CMS, OAuth, live token, or real hosting
  operation was exercised or approved.
- Existing generated integration retains actual body8/image9, private/draft
  publication negatives, canonical-byte privacy proof, hostile metadata/footer
  and native ordered-alt/fallback builds. Only new `dist/client` paths and valid
  HTML serialization of an empty `alt` attribute changed in evidence readers;
  missing `alt` still differs from empty `alt`. No threshold was lowered.

The prior attempt's Node22/24 logs are historical, not final resumed-head proof.
Resumed root, archive adapter, loader/privacy and cold-consumer executions are
recorded in the handoff with raw evidence; exact-head remote CI is required too.
Five original coverage thresholds, security5 and pinned Rocket are retained.

## Audit boundaries

`scripts/audit-install-surfaces.mjs` separately packs/installs the CLI and installs
an isolated example manifest. Its strict result stays nonzero on findings;
`--evidence-only` changes process exit only, never the recorded NO-GO. **The CLI
still resolves Wrangler's pinned vulnerable emulator dependency**: npm ignores an
upstream package's root overrides. There is no claim the generated consumer's
scoped mitigation ships with an installed CLI. The real packed CLI full and
production audit both report **6 findings (5 moderate, 1 high)**; the standalone
example full/production audit reports **0**. These are vulnerability nodes, not
proof of exploit reachability. This is an unresolved #26 release
blocker with owner/expiry and enforced Release risk/audit gates, not an exception.

Audit snapshots are live registry results from 2026-10-24, not claims that the
versions are perpetually secure. `root-audit.json` is separate from actual
consumer installation audits. Both full and production (`--omit=dev`) generated
consumer audits are required to report zero; tool errors and nonzero audit exits
fail the scripts. Scanner counts do not prove exploit reachability, and a clean
scanner does not prove runtime/source safety. NO-GO #19/#25/#26 persists.

## Supported theme policy

| Surface | Compatibility status | Enforced boundary |
|---|---|---|
| `scaffold` | Patched toolchain, cold build/CMS/media/runtime exercised | Canonical source/privacy proof and report/job quality gate |
| bundled `astrowind` (default) | Patched full build/CMS/media/audits; NOT complete migration acceptance | Imported page/report findings stay non-green; done/deploy blocked |
| bundled pinned `rocket` | NOT certified by this upgrade | MDX-only adapter denied for untrusted content; submodule unchanged; tests retained |
| nonbundled `brook`, `daisyui`, `mainline`, `small-biz` | NOT certified; do not silently rewrite upstream manifests | Existing bounded-downloader requirement rejects remote theme provisioning |

CF14 outputs a **Workers** application (`dist/client`, `dist/server/wrangler.json`),
not a Pages artifact. AstroWind outputs a **Node** application. Neither may be
uploaded through the static Pages adapter. No supported deployment adapter was
invented. Resolving this and the report/hosting gates requires independent
reviewed follow-up under the existing issues, not a check bypass here.

## Re-run and rollback

Use the CI runtime and a fresh isolated clone. Initialize pinned submodules;
`npm ci --legacy-peer-deps`; `npm run build`; `npm run typecheck`; `npm run lint`;
`npm test`; `node --test scripts/security-audit.test.mjs`;
`npm run test:integration`; then both cold consumer scripts above. CI also runs
the independent consumer matrix on both supported Node/npm pairs. Consumers have
no symlinked root node_modules and reuse their generated lock on the second
build. Do not interpret an empty example build as consumer acceptance.

Rollback is reverting this focused PR before any publication/deployment (neither
was authorized). Do not force-resolve lock conflicts: reapply intended manifests
on the accepted main lock and recheck coverage/nanoid plus #22's four archive
nodes if that sibling is integrated first. Package-lock, scaffold/privacy and
CLI deployment artifact classification are declared integration hotspots.

## Primary references

- https://docs.astro.build/en/guides/upgrade-to/v5/
- https://docs.astro.build/en/guides/upgrade-to/v6/
- https://docs.astro.build/en/guides/upgrade-to/v7/
- https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- https://docs.astro.build/en/guides/content-collections/
- https://docs.astro.build/en/guides/integrations-guide/markdoc/
- https://keystatic.com/docs/collections
- Exact npm package metadata and the generated consumer lockfiles, not snapshot
  advisory floors, determine the concrete pins in this stage.
