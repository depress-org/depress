# #38 / PR-06 — Offline Pages artifact contract and operations runbook

## Status and hard boundary

**Contract tests only. NOT deployment, a live URL/repository handoff, credential isolation proof, production rollback or a GO decision.** Read [PR-05 cold acceptance](PR-05-cold-acceptance.md) first. Existing NO-GO gates (#25 worker/queue/lifecycle, #26 toolchain/Workers, #30 plugins, #36 packaging, #37 entitlements and real delivery acceptance) are not cleared by this module. Historical counts/results in PR-05 are snapshots, not this PR's fresh execution results.

Implementation: `packages/cli/src/services/deployment-contract.ts`; fake responses: `packages/cli/src/services/__tests__/deployment-contract.test.ts`. There is **no fetch/HTTP client, subprocess, filesystem read/deletion, environment lookup, provider SDK, default live transport, credential parameter, CLI wiring or HTTP deployment route**. Existing `services/deploy.ts` is intentionally untouched to avoid the #26 hotspot. This contract does not make its older stdout URL extraction equivalent to verified deployment receipts. The old engine `rollback.ts` removes local output; it is not the rollback below.

No Cloudflare requests/accounts/resources/tokens, DNS, runtime configuration, containers, Postgres, publication/deployment or spending are authorized here. Source changes use existing ordinary offline workspace tests; no new workflow, cron or runtime job. The static Pages adapter deliberately **rejects #26's Cloudflare Workers `dist/client` + `dist/server`, `.wrangler/deploy/config.json`, `_worker.js` and Functions**. Do not bypass this by pointing at `dist/client`: a Workers application stripped of its server is not a verified static site. A future trusted ingestion service must classify the *whole build output*, not just a caller-selected subtree. Workers authority is out of scope.

## Trust model and deployment.v1

`createOfflinePagesAdapter` receives server-authenticated `Authority { ownerId, jobId }` and a server-selected Pages target (`provider`, account ID, project name) once. These are copied/frozen. Deployment requests contain only idempotency key + content digest; rollback additionally selects a prior deployment ID. Extra client identity/target/token fields are ignored and never reach the transport. These primitives do not authenticate callers themselves: only trusted admission may construct the adapter. Do not give an untrusted build the registry/transport/adapter capability.

`deployment.v1` records contain:

| Field | Meaning |
|---|---|
| `schema` | Literal `deployment.v1` |
| `id` | SHA256 of JSON `[serverAuthority, normalizedTarget, idempotencyKey]` |
| `ownerId`, `jobId` | Immutable server-derived identity, not user-supplied claims |
| `artifact.kind` | Literal `cloudflare-pages-static.v1` |
| `artifact.sha256` | Content-addressed canonical manifest digest below |
| `target` | Pages only, exact account + project selected by server |
| `idempotencyKey` | 1–128 restricted ASCII chars; bound to operation + digest + rollback version within this scoped adapter |
| `operation` | `deploy` or `rollback` |
| `status` | `pending`, `succeeded`, `rejected` or `unknown` |
| `previousDeploymentId` | Rollback's selected *existing target version*, not a local path; absent for initial deploy. Not an alias for the current production head |
| `providerDeploymentId`, `url` | Only after strict completed-success response validation |
| `error.code` | Allowlisted redacted code only; never provider body, error message/cause, stdout/stderr, credential, input data or local path |

Records and nested metadata are frozen. Byte arrays cannot be made immutable by `Object.freeze`; ingestion copies source bytes, and every deploy/reconciliation re-hashes a fresh detached snapshot. A changed array under an old digest rejects before transport. Provider transport is trusted, not a sandbox for malicious injected code.

### Static artifact identity and shape

Artifact paths are relative to the full verified static output root, not absolute/local file paths. Require root `index.html`; ASCII safe path segments; no dot/empty/parent segments, case collisions, hidden files, symlinks/special-file representations, package/source/config/env/private report files, server/client/Functions/worker markers. Allowlist static suffixes (HTML/CSS/JS/JSON/XML/text/SVG/images/fonts/PDF); at most 10,000 files, 25 MiB per file, 64 MiB total. Conservative false rejections are intentional. No MIME, malware, secret scanner or safe-active-content claim follows from a suffix.

Canonical digest = lowercase SHA256 of UTF-8 `JSON.stringify(["cloudflare-pages-static.v1", entries])`, where entries sort by ASCII path and each is `[path, byteLength, lowercaseSHA256(fileBytes)]`. It is the complete path+content manifest digest, **not** an archive/blob digest. It excludes owner/job intentionally so identical content can be addressed consistently; authorization is a separate mandatory owner/job check. Trusted ingestion must enumerate all regular files from a read-only verified snapshot and reject symlinks/hardlinks/unsupported shape before building these byte entries. This module cannot inspect files that a caller omitted. `sealStaticArtifact` is not evidence of privacy/provenance or #25 storage isolation.

### Dependency-injected Pages seam (not a guessed wire protocol)

`ArtifactRegistry.getArtifact` is a trusted registry capability: exact digest + static kind + same owner **and job** are required; bytes are re-hashed before handing off. `getVersion` is a trusted immutable successful-provider-version registry: literal `verified: true`, static kind, same owner, exact target/account/project/digest/ID and immutable URL are mandatory. A previous version may come from a prior same-owner job. A boolean from an HTTP request is not a verified receipt.

`PagesTransport(command, AbortSignal)` is an **internal deploy-only broker seam**, not an implementation of Cloudflare's multipart manifest/upload API or a promise of Cloudflare-native idempotency. Its command binds server authority, exact target, operation ID/key, digest, optional prior version and detached static bytes (only on initial deploy). A future implementation must independently enforce this binding, keep credentials in its own trusted closure/process and associate provider receipts with the exact authorized operation/digest. Builds never receive the transport, tokens, env injection, response bodies or auth headers. No tokens in job records/build env/artifacts/public errors; don't serialize the closure or credential configuration.

Only HTTP200/201 + boolean `success: true` + empty `errors` + valid result UUID + exact project + `latest_stage: { name: "deploy", status: "success" }` + canonical HTTPS deployment-hash-shaped `<8-lowercase-hex>.<project>.pages.dev` origin constitutes contract success. This conservatively rejects ordinary branch aliases (for example `main`), but URL syntax alone cannot prove immutability: the trusted broker must verify the provider receipt URL is deployment-specific (even a hex-named branch could collide). No userinfo, explicit port, path, query, fragment, foreign project or production alias root. Parsed response body limit64 KiB; raw extra response fields are discarded, never persisted. Failed envelopes require `success:false`, nonempty typed `{code:integer,message:string}` errors and `result:null`. Definitive 4xx except404/408/409/429 become redacted `rejected`; malformed/contradictory/5xx/rate-limit/transport error/timeout become `unknown`. HTTP202/build-in-progress is **not success**. Future streaming transport must enforce the size/time bound *before allocating* the entire body. This parser is not an arbitrary JSON duplicate-key detector and not provider-authenticity verification.

A valid provider response does not itself attest artifact contents or ownership: that is the trusted broker + registry duty. A fake successful URL proves parser behavior only. URLs are not fetched here.

## State, retries and rollback

- First operation: verify authority/artifact/version → record `pending` → one transport call → `succeeded`, `rejected` or `unknown`.
- Concurrent identical calls coalesce. Reusing a key for a different digest/operation/version fails `IDEMPOTENCY_CONFLICT`. Terminal identical requests return the existing receipt without a second deploy. Request identity/digest are captured before async work so caller mutation cannot retarget it.
- Timeout races an injected deadline, aborts transport, cancels timer; late result/rejection cannot change the ledger or become an unhandled rejection. Default transport timeout30 seconds, permitted1–60,000 ms. This is not an OS process/network limit; registry I/O needs its own bounded implementation in #25.
- **Unknown is not failed and is not permission to redeploy.** A duplicate unknown request uses `lookup` with the *same* operation ID/key; no static payload is resent. Lookup404/absence/failure remains unknown. An eventually successful authorized receipt can settle the operation. An unresolved operation needs human/provider reconciliation; do not invent a new key to bypass ambiguity.
- Rollback selects an existing verified immutable same-owner/same-target/static digest version through `getVersion`; sends its provider ID, no build/files/path/delete operation. Success must return the *selected ID and immutable URL*, not a different version. Unknown rollback also uses lookup only. Foreign-owner/target/digest/Workers/unverified/missing versions fail before credential capability use.
- This ledger is **process-local fake coalescing only**: no persistence, distributed CAS, restart recovery, queue, current-production-head lock, durable audit or provider idempotency. #25 must supply those before live use. Reconstructing a new adapter loses its map; never use that fact as safe retry behavior. Deploy/rollback serialization and stale-head preconditions must be enforced by the future durable broker.

## Operational ownership and acceptance gates

| Boundary | Owner / gate |
|---|---|
| Pure artifact/deployment/parser/retry contract | #38, this offline module/tests |
| Durable owner-scoped registry/ledger/queue; distributed CAS; credentials; isolated workers; preview; expiry/deletion | #25, runtime authorization still separate |
| Supported generated toolchain and static-vs-Workers classification | #26; no Workers deployment authority granted |
| Paid delivery/public repo/live URL/product acceptance | Future separately authorized sandbox acceptance, not fake fixtures |
| Production deployment, account/resources, secrets, DNS, spending and protected merge | Explicit Bullwinkle gate, independent QA before merge; no self-merge |

### Proposed health and alerts (not configured/running)

Expose aggregate metrics from the future trusted broker, **not customer owner IDs, job IDs, raw keys, paths, URL query strings or tokens as labels**. Drill-down only via authorized redacted internal operation IDs.

| Signal | Initial response / proposed alert policy |
|---|---|
| Any operation `unknown` after its reconciliation budget (proposed5 min) | Alert operator, pause automated retries for that operation; reconcile exact receipt, never blindly resubmit |
| Pending age beyond broker timeout+grace; worker/ledger heartbeat missing | Stop admission to affected target, verify durable lease/recovery; do not assume failure |
| Provider400/401/403 definitive rejection | Record redacted category; investigate allowlisted config/permissions out of band; never print tokens/raw body |
| Provider429/5xx spike (proposed5 failures/5 min) | Pause new operations for target; bounded backoff/read-only reconciliation; no new deployment keys |
| Any owner/digest/target/kind mismatch | Immediate security alert and deny operation; preserve minimal internal evidence, no provider call |
| Immutable URL/receipt schema mismatch | Mark unknown and alert; do not expose guessed live URL |
| Retention overdue, cleanup retry backlog or missing immutable rollback version | Pause destructive expiry and admission if capacity unsafe; #25 contained deletion/recovery process |
| Future authorized URL content/availability probe fails | Separate health incident, NOT automatic rollback from unverified URL; verify exact version/bytes first |

Thresholds are proposed defaults for future sandbox measurement, not production SLOs or installed monitoring. No live URL probe or alert destination exists in this PR. Production needs approved owners/on-call, capacity and measured SLOs before these can be enabled.

### Retention and recovery (policy proposal, no deletions)

#25 must implement owner-scoped encrypted/private storage, bounded quotas, terminal-path cleanup, contained retries, crash/cancel recovery and authenticated isolated preview. Suggested starting sandbox retention: inputs/intermediates/logs24 hours after terminal outcome; verified static artifacts and receipts7 days; minimum two verified versions per target retained throughout a rollback window. These periods are not configured or legal/data-retention promises. Before enabling, approve a data policy and deletion handling with the operator.

Never expire artifacts/receipts referenced by pending/unknown operations, active deployment or a designated recovery version. A rollback must fail closed if its verified provider version expired/missing: do not substitute local output or a foreign record. Provider version retention is separate from local storage expiry; confirm both under authorized operations. Keep small redacted audit tombstones only under the approved policy. Do not store raw provider errors as "debug evidence".

On crash/restart: stop unsafe admission; restore durable authenticated ledger/leases; read back exact provider receipts and target current version; reconcile unknown by operation ID; validate stored digest/owner/target/kind; only then resume. This offline map cannot restore anything. If credentials may have leaked, pause deployment and ask the operator for a scoped revoke/rotate action; do not read host secrets or perform rotation here. If deletion fails, record contained retry without widening paths/permissions; do not `rm -rf` arbitrary user-supplied locations.

## Manual FUTURE sandbox acceptance checklist — not executed

All require separate explicit authorization. Do not run a command from this checklist merely because this document exists.

- [ ] Bullwinkle authorizes disposable sandbox/provider project, any account/resource/spending, scoped credentials and cleanup. Agree a test owner/operator and permitted effects. No production account/project, real customer input or host-secret inspection.
- [ ] #25 actual worker/queue/registry/credential/preview/retention gates independently pass; #26 static-vs-Workers policy independently passes. Real generated Workers builds must reject before token access, not be uploaded as static client files.
- [ ] Implement/review a trusted pinned Pages upload + receipt/reconciliation transport against current official Cloudflare API documentation; validate wire protocol/response samples in authorized sandbox. This PR supplies none of that transport.
- [ ] Build tiny static two-version fixture in an uncredentialed worker, enumerate full read-only output, independently recompute manifest digest and verify no secrets/reports/source/env are present. Do not treat suffix filtering as privacy proof.
- [ ] Persist authorized owner/job/target/idempotency binding and digest *before* deploy capability invocation. Verify limited credential capability cannot change owner/target, execute generated code or access other jobs. Fake canaries first, scoped sandbox token only in trusted broker.
- [ ] Perform one approved sandbox deploy. Read back exact provider ID/receipt, immutable URL and independent known fixture bytes; verify custom/public URL separately if approved. A fake response, parsed URL or process exit0 alone does not pass.
- [ ] Exercise same-key concurrent/repeated calls, network interruption after submit, timeout, crash/restart, duplicate queue delivery,429/5xx and lookup-not-found. Demonstrate no duplicate physical deployment or cross-owner access using actual durable audit/provider readback. Unknown must not auto-resubmit.
- [ ] Deploy second authorized fixture, then select first same-owner verified immutable version and perform provider rollback. Read back exact selected ID/current target, immutable bytes and health; prove foreign/missing/digest-changed/Workers rollback is denied. No local deletion masquerading as rollback.
- [ ] Verify metrics/alerts/redaction with fake error/token/path canaries, retention expiry and contained cleanup retry, cancel/crash/recovery and restore drill. Confirm no raw input or secrets in logs/public errors/artifacts.
- [ ] Independently review exact-head CI, actual provider evidence and cleanup plan. Operator separately approves cleanup of test resources and any later production action. Keep final result explicitly NO-GO until all required real gates pass.

## Offline reproduction

Use repository pinned Node/npm, initialize the pinned Rocket submodule for baseline test discovery, then:

```sh
npm ci --legacy-peer-deps
npm run build
npm run typecheck
npm run lint
npm exec --workspace=@depress-org/depress -- vitest run src/services/__tests__/deployment-contract.test.ts
npm test
node --test scripts/security-audit.test.mjs
npm run test:gate
```

Existing `npm test` automatically discovers the new tests and keeps all five coverage thresholds unchanged. No test uses live credentials, provider requests or fabricated command output. Downloadable task evidence and exact-head CI readback identify actual results; this runbook deliberately does not claim the future checklist was executed.
