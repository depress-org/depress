# PR-07 / #21 — existing PR14 correction

Scope: repair existing https://github.com/depress-org/depress/pull/14, not a second
bot scaffold. Original head `1de46f4a20010d61a2a15416ca4b10ef1a726363`; blocking
review https://github.com/depress-org/depress/pull/14#pullrequestreview-5636146726.
Integrated shared #16 baseline `d0865b0b657848aafe2e4c2276ad9ec400999d91` by merging
main into PR14 in an isolated clone. No shared job-core/CLI/web/engine implementation
was edited by this correction. No self merge, bot registration, real Telegram API,
real token reads, publishing packages, cloud deployment or production changes.

## Findings -> executable evidence

- Authorization: `bot.ts` first middleware requires configured positive allowlisted
  sender, private chat, same chat/sender ID, non-bot identity. Adapter tests assert
  rejected messages/callbacks cause no API/fetch/file allocation.
- Filename containment: `uploads.ts` uses only owned random directories and generated
  `source.xml` / `database.sql` names. Adapter probes hostile absolute/traversal/
  unusual filenames and reads the contained actual output; incoming names never
  become destinations.
- Admission: extension/role plus UTF-8/content validation; XMLValidator + WXR version,
  no DTD/entities, recognizable SQL text. Metadata/HTTP Content-Length/stream byte
  caps, whole-operation timeout/abort, HTTP success, no redirects. Tests include
  unsupported media/wrong role, malformed/declaration/binary input, oversized streams
  and Content-Length, rejected/hung getFile/fetch and HTTP error.
- IO recovery: mocked mkdir/mkdtemp/writeFile rejection recovers; contained real
  workspace files verify lifecycle. Failed writes remove partial role files.
- Async delivery: sends and callback answers bounded and caught; job terminal truth
  is awaited `runJob` result, not a detached observer. Tests reject queued/progress/
  terminal notifications and callback answers, reject runJob, return typed failed
  jobs, verify cleanup and continued use. Raw provider/store/SQL errors not sent.
- Session races: actor key + generation, generation-bound keyboards, current object
  and jobId checks. Sync uploading/starting claims precede async IO/store creation.
  Tests interleave duplicate docs/themes, /start during download/create/running,
  old callbacks against new keyboards, stale job progress/completion vs new uploads.
- Cleanup: only adapter-owned inputs; terminal finally independent of delivery;
  abandoned SQL/theme sessions expire, active jobs retain inputs until settled.
  Transient cleanup rejection retried and tested for terminal/expiry. Persistent
  filesystem failure gives fixed operator diagnostic after bounded retries; no
  durable crash recovery is claimed (#25).
- Honest output: explicit migrate-only mode, local artifact distinguished from live
  URL and hosted repository. Tests assert no invented URL; synthetic returned URL
  test verifies formatting only, NOT real deployment evidence.
- Archives: explicitly rejected; #22 remains the shared implementation owner.

## Actual local executions (Node 20.20.2 / npm 10.8.2)

- RED: new real-grammy adapter suite against original implementation: exit 1,
  20 failures, including unauthorized IO and filename containment failures.
- GREEN: cold `npm ci --legacy-peer-deps`, build, typecheck and lint: exit 0.
  As already tracked in #26, install still reports vulnerabilities; this is NOT
  a security release approval or a claim strict npm-ci compatibility is fixed.
- `git submodule update --init --recursive`: pinned Rocket
  `a4db5335b1978391526f4e22557586267f7752df` included for final tests.
- Root `npm test`: 194 passing tests: CLI69, job-core24, bot44, web7, engine50.
  All four pre-existing coverage gates unchanged; added mandatory bot gate
  85/70/85/85. Bot measured statements90.24 / branches82.55 / functions88 /
  lines96.13. No skipped missing-submodule tests in final execution.
- `node --test scripts/security-audit.test.mjs`: 5 passing security regressions.
- `npm run test:integration`: actual generated Astro build and rendered body/draft
  checks pass. `npm run test:gate` correctly rejects CLI statements99 (exit1 inside
  verifier); config restored.
- Bot CLI override `--coverage.thresholds.statements=99`: exit1 against actual90.24,
  no config editing; proves new gate rejects insufficient coverage.
- `node scripts/cold-consumer.mjs`: actual independent registry install/build and
  unchanged-lock reinstall/rebuild PASS, lock SHA256
  `6503e2f05f962519fdb8f12e1c7963e5c2aebe9785cbc9a1bf92b6ebead27659`.
- Read-only advisory review found queue-creation notification invalidation and
  transient cleanup abandonment. Both corrected and regression-tested; downstream
  independent QA still owns integration review/merge.

Remote exact-head required CI and independent rereview are required before merge.
Final SHA/check URLs are in the Kanban handoff/PR comment (not pre-claimed here).

Hotspot: package-lock.json. Relative to the integrated PR14 baseline, the only lock
edit is direct `fast-xml-parser` metadata on the bot workspace, reusing the engine's
existing package. Incidental npm platform/Zod rewrites were discarded. Preserve
this plus the existing grammy graph and merged #15/#16/#17 graph downstream.

Remaining NO-GO: production/auth/owner persistence/source/sandbox/toolchain #23–26,
shared media #22 and broader consumer/product acceptance #19. No payment/billing,
cloud/prod readiness or crash-safe cleanup is asserted by this bounded local repair.
