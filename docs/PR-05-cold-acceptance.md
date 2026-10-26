# PR-05 / #19: cold acceptance evidence — NO-GO

This is an acceptance result, **not a product release approval**. No npm publication, real Telegram traffic, provider token, cloud deployment, paid account, worker runtime provisioning or spending was used. A successful mocked provider URL is not deployment evidence.

## Source and integration identity

Independent scratch clone; CI toolchain Node20.20.2/npm10.8.2. Candidate reviewed: PR35 `c06a39ce93ba6806f2327b82488f39c74a173ea0`, based on independently reviewed main `c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0`. Earlier parent head hashes in Kanban are historical, not final accepted commits. Fresh GitHub readback and local ancestry establish:

| Requirement | PR | Actual integrated commit before PR35 review |
|---|---|---|
| Coverage/actual generated checks | #8 | fbdfd3d03ef7e0e35f92eeae0193d7226da7cba8 |
| Dependency inventory/nanoid | #27 | e72e58ab9086780316c8ebe0d53db03e022d8b57 |
| Shared safe service | #28 | d0865b0b657848aafe2e4c2276ad9ec400999d91 |
| Owner-scoped authenticated admission | #32 | 692704a0595032037e960769888ff381ad9d27a3 |
| Bot private/allowlist/session correctness | #14 | fb9f4a654a5c562ca4c643f111ff3500838ad5e0 |
| Static-plugin design, NOT implementation | #31 | b4f5008c6a6cde2885abc131762a8ac954038e67 |
| Canonical fail-closed item/report QA | #34 | 95bab42089c0093e8b6faf2c4aac8f1166da3014 |
| Native converter/serialization containment | #33 | c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0 |

PR14 is actually merged, not omitted or assumed approved. All parent handoffs and current PR metadata/comments/reviews were retrieved. PR35 has separate substantive archive review in this acceptance run. Its implementation files were not changed by the verifier.

## Executed cold checks

```sh
git clone https://github.com/depress-org/depress.git review
cd review
git fetch origin pull/35/head
git checkout --detach FETCH_HEAD
git submodule update --init --recursive
# Node20.20.2 / npm10.8.2, TMPDIR inside this workspace
npm ci --legacy-peer-deps
npm run build
npm run typecheck
npm run lint
npm test
node --test scripts/security-audit.test.mjs
npm run test:gate
npm run test:integration
npm run test:media-archive
node scripts/cold-consumer.mjs
node scripts/acceptance-oss-consumer.mjs
```

Root cold install/build/typecheck/lint PASS. First test discovery occurred before submodule initialization completed (461 tests); it was **not** silently counted as complete. A full rerun with pinned Rocket `a4db5335b1978391526f4e22557586267f7752df` initialized passed **474 tests**: CLI103/job-core78/bot51/web70/engine172. Five coverage gates unchanged; raised CLI statements99 demonstrably rejects and restores original configuration; targeted security5 PASS. Lint is the repository's existing TypeScript-only lint, not an independent static security scanner.

Actual generated controls, archive adapter executions and cold registry builds are recorded in the completion/readback section below. No synthetic command output is used. Fixture source/media bytes are real repository files. Network-disabled migration host tests are not an OS/descendant network sandbox; generated npm dependency installation intentionally uses the registry.

## Clean OSS consumer: release blocker reproduced

Three actual `npm pack` tarballs were installed together in an independent nonworkspace consumer, not symlinked to monorepo packages. Installed CLI help, explicit scaffold WXR migration, `check` (which actually builds Astro and validates three Keystatic entries) PASS. Installed library malformed XML rejection followed by valid WXR+SQL+local media conversion in the **same process** PASS; report validation, three inline/attachment-fallback alts and exact copied PNG bytes PASS. Unknown archive-limit keys reject; private extracted directory/file permissions are0700/0600; cleanup is idempotent.

**Default installed CLI migration exits1.** Direct installed-engine provisioning confirms `Bundled theme "astrowind" not found`. Engine tarball has105 entries and **zero bundled-theme files** despite source AstroWind and initialized Rocket. CLI tarball has42 entries, including four compiled test-related entries; core has5. Internal runtime dependency ranges are still `*`. Local consumer installation provides all three tarballs deliberately; it does not prove any package exists on the public registry.

Reproduction: `node scripts/acceptance-oss-consumer.mjs`. This performs fresh pack/install, default CLI, installed-library malformed-then-valid/media checks, real generated builds/checks and unchanged-consumer-lock reinstall. It writes raw logs and `result.json` under a unique `.tmp/oss-consumer-*`. Default exit1 records **NO-GO** while #36 remains. `--evidence-only` changes process status only, never findings/releaseGate, and MUST NOT be interpreted as acceptance. This script is not silently added as a passing required CI gate.

Tracked remediation: **#36**, bounded packaging and clean installed consumer regression. Preserve #24 MDX/remote-download restrictions. Missing assets are separate from default-theme full-toolchain support #26; packaging alone does not prove that theme builds.

## Original feature-to-proof matrix

| Original product feature | Executable evidence / actual boundary | Verdict / remaining issue |
|---|---|---|
| Free OSS CLI/core/engine | Real built tarballs, installed binary and library, default vs scaffold control | **FAIL #36**; CLI remains free, no license gate |
| WXR posts/pages/authors/taxonomy/Yoast/redirects |474-test suite; real fixture CLI; canonical per-source-item manifest/report validator; actual generated content and installed CLI check | PASS bounded fixture only; unsupported CPT/custom fields flagged, not general lossless WP claim |
| Local source files/media | Native contained local raster copy and exact built bytes/three ordered alts; missing source/PDF non-green | PASS bounded raster path; arbitrary media types not promised preserved |
| Web + Telegram media ZIP | Shared extractor hostile path/type/CRC/size/count/depth/cancellation tests; real built Hono + grammy through scoped runJob; actual Astro output | PASS bounded PR35 scope after independent integration; ASCII-only ZIP filename policy, suffix is not MIME/malware/provenance proof |
| Generated Astro + Keystatic | Cold real registry install/build/reinstall and generated HTML; check validates collections/schema; drafts absent and reports outside dist | PASS scaffold fixture. Full default/theme toolchain **NO-GO #26**. Browser editor save/publish and production OAuth not established |
| Migration quality/privacy | Raw inventory+ID outcomes; byte hashes; actual image/body/comment/escape/metadata controls; no public source manifest/report; fake env canary absent | PASS canonical scaffold proof; not arbitrary custom renderer/CSS or cryptographic source provenance |
| Static plugin compatibility | Docs contract/matrix accepted in #31; unsupported features fail/report | **NOT SHIPPED #30**. P03–P12 plugin acceptance cannot be claimed executed against nonexistent plugin API |
| Auth/tenant ownership | Actual web/bot negative tests; server-derived scoped immutable owner; no anonymous default; foreign get/list/update blocked | PASS local admission #23/#32, not hosted isolation or team/account product |
| Web service user flow | Authenticated API upload/migrate/progress isolation tested, local artifact only | Local scaffold, not finished paid browser UX/download/deployed URL. #25 artifact lifecycle and #38 delivery/ops remain |
| Telegram user flow | Built adapter fake transport, private+allowlist, role order, generation races, cleanup and truthful nondeployment | PASS local adapter; no live bot/provider proof, #25/#38 remain |
| Secure durable jobs | Current InMemoryJobStore and in-process jobs are visible in source | **NOT SHIPPED #25**: restart recovery, durable queue, isolated execution/retention/preview still blocking. Runtime-test authorization unanswered; this review grants none |
| Billing/entitlements | Source search found no implementation; REVENUE_PLAN commercial assertions are plans | **NOT SHIPPED #37**. Server-side contract first; real Stripe/payment integration requires separate approval; never gate OSS |
| Deploy/repo/live URL | Process/adapter validation and mocked provider formatting only; HTTP deploy disabled | **UNPROVEN #38**. No real deployment occurred. No repo/live-URL handoff acceptance |
| Rollback/recovery/operations | Local output deletion rollback is not provider rollback; no demonstrated deployment ledger/health/alert/restore | **UNPROVEN #38/#25**; no production readiness |
| Dependency/toolchain safety | Cold install warnings plus fresh root, OSS consumer and generated production audits, separated below | **FAIL #17/#26**; no exception/mitigation approval implied |

## Fresh audit boundaries

At this run, cold root `npm ci` reported17 vulnerabilities (6moderate/10high/1critical). A subsequent fresh registry `npm audit --json` reported19 (7moderate/11high/1critical); audit results can change with registry data and command graph. Installed OSS tarball consumer production audit reports11 (4moderate/7high/0critical); independently generated scaffold production audit reports19 (7moderate/11high/1critical). These are vulnerability-node counts, not reachability proof or unique advisories. Raw JSON is retained; do not reuse historical smaller counts or call security5 a clean audit. #26 owns explicit compatible remediation; no forced upgrades/blanket overrides performed here.

## Verdict

**NO-GO for OSS release and for public/credentialed paid hosted operation.** Packaging/default consumer failure and critical generated dependency findings alone prevent GO; durable isolation, plugins, billing and actual deployment/operations remain separately unproven. Passing bounded conversion/archive/CMS build tests does not clear those gates. New scoped issues36/37/38 complement existing25/26/30; no speculative large implementation was performed.

The evidence PR itself requires independent downstream review and exact-head CI. The verifier must not merge their own acceptance PR. The existing final integration card owns that review; plugin follow-up is released as a scoped implementation lane, not a product-GO signal.

## Completion/readback

PR35 independently accepted at `c06a39ce93ba6806f2327b82488f39c74a173ea0`, review [5637832849](https://github.com/depress-org/depress/pull/35#pullrequestreview-5637832849), then normally head-guarded merged as **52821c41fa6664e95fc0533a5d19f27ce597c212**. Git readback verifies reviewed head and merge have identical tree `9c71a357b9d5fce81d42c1c41a830beefc8986e7`; branch retained, no admin/protection changes. All three exact-reviewed-head app15368 checks SUCCESS (Build120836012331, Generated120836012453, security120836012462). Independent local actual generated image9/body8/privacy/metadata/footer/native controls and both archive adapter builds/cleanup/omission+unsupported failure controls PASS. Archive-backed fresh registry install/build and same-lock rebuild PASS. GitHub review is COMMENT, not a fabricated separate-account APPROVED: independent verifier used the existing account and current normal branch protections.

The new OSS consumer script was actually executed through all15 command records: all commands succeeded except the installed default migration (exit1). Both installed scaffold and local-media `check` commands built their actual generated Astro sites; collection/schema checks PASS. Same-lock consumer npm-ci and reinstalled binary PASS. Its final `result.json` truthfully records NO-GO with five packaging/range findings and default process exit1; no assertion was lowered to hide them.

Final local raw logs, baseline cold rebuild result, exact-head acceptance-PR CI and postmerge main CI are retained as downloadable task completion artifacts/readbacks. No pending check is a PASS until read back. These raw logs are not committed build noise. The acceptance PR remains unmerged for its existing independent downstream review.
