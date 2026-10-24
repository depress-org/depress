# PR-06 / #20 — verified integration and executable next queue

Checkpoint 2026-10-24. This is evidence/coordination, **not a release or production GO**. Canonical issue [#20](https://github.com/depress-org/depress/issues/20), [milestone 1](https://github.com/depress-org/depress/milestone/1).

## What this run actually integrated

Fresh GitHub readback found all earlier parent implementation PRs already merged (#8/#27/#28/#32/#31/#14/#34/#33/#35). PR14 is MERGED, not a pending scaffold. Their retained independent evidence is referenced in #20 and [PR-05](PR-05-cold-acceptance.md); no new full-suite execution is falsely attributed to this lead run.

PR39 was still OPEN. Its author was the same lead profile in an earlier run, so a **separate isolated execution reviewer** was required rather than self-approval. Reviewer cloned the exact candidate independently and read the complete two-file diff, copied attached acceptance evidence, and actually executed the unchanged OSS script.

- Reviewed head: `b0fa23b49846dd846919c1240ea2304577156caf`, base `52821c41fa6664e95fc0533a5d19f27ce597c212`.
- Independent verdict: accept docs/script as truthful **NO-GO evidence only**, not release approval. GitHub executor review [5637921355](https://github.com/depress-org/depress/pull/39#pullrequestreview-5637921355) is COMMENT because the available GitHub account is also the PR author; no account-level independent APPROVE is claimed.
- Fresh exact-head check-runs: Build & type-check, Generated fixture site, Audit inventory and targeted regression all completed SUCCESS, app15368. Required check pair remains strict/app-pinned; admin and conversation protections retained.
- Normal `gh pr merge 39 --merge --match-head-commit b0fa23b49846dd846919c1240ea2304577156caf`; no admin bypass or branch deletion.
- MERGED readback at `2026-10-24T10:26:17Z`, merge `86a495040e3a670c17276a96fdc253e31dc545f1`; first parent previous main52821c4, second reviewed candidateb0fa23b. Reviewed and merge trees identical `ccc2c1ace07924df72ec215a5785df709aa7a1ad`.
- Postmerge CI is separately observed, not inferred from head CI. Final handoff records its actual state; this committed checkpoint does not claim checks that were still running when written.

## Independent execution results

Node20.20.2/npm10.8.2; recursive pinned Rocket initialized before artifact review. Cold root install/build/typecheck and security5 PASS. Independent optional lint hit an outer timeout; no fresh lint PASS claimed. Full 474-suite/five coverage gates/negative99 proof was inspected in retained parent evidence, not rerun by this independent reviewer.

Unchanged `scripts/acceptance-oss-consumer.mjs` completed **exit1 / releaseGate NO-GO**. Exactly15 child command records;14 exit0, installed default migration exit1. Engine tgz105 files, **zero bundled-theme assets**, plus three unconstrained internal public dependency edges; five findings. All three fresh packed hashes matched retained parent evidence. Installed library malformed-then-valid recovery, real local media bytes/report, scaffold migration and generated check/build controls, same-lock reinstall and reinstalled CLI passed. Direct installed-engine theme provision independently rejected missing AstroWind directory.

An initial outer300s timeout retained only partial logs; reviewer retried unchanged script to completion and used that definitive result. Source remained clean. No synthetic success or substituted live URL.

Raw reviewer report and real result/logs are attached to board card `t_1bb310e6`; original acceptance archive remains on `t_4c838050`. `--evidence-only` never changes the NO-GO verdict and is not a production gate waiver.

## Executable next queue — board depress

All new cards pin `gpt-6.1-sol` / `openai-codex`; every worker uses its own clone and preserves security/quality controls. Dependencies, not prose promises, gate execution.

| Issue | Implementation / scope | Independent next action |
|---|---|---|
| #25 | Existing `t_af424220` / devops, BLOCKED pending human disposable OCI + fake-credential Postgres integration-test authorization | No duplicate card or permission inference; renderer34 tests are partial, no queue/runtime proof/PR |
| #26 | Existing `t_27cacc99` / default, resumed run74 RUNNING after previous iteration budget exhausted; staged upgrades, no published PR at readback | `t_38e6b515` / qa after implementation + PR-06, cold consumers/CMS/draft privacy/Workers rejection and exact-head integration |
| #30 | Existing `t_2fda1b74` / fullstack-dev RUNNING, token/gallery work not shipped | `t_e75fe122` / qa after implementation + PR-06, P03–P12 actual generated-output acceptance |
| #36 | Existing `t_423a327c` / fullstack-dev RUNNING, packaging work not shipped | `t_32b38c97` / qa after implementation + PR-06, installed real tgz acceptance; separate packaging from #26 default build boundary |
| #37 | New `t_60897111` / biz-analyst after PR-06, versioned service-only entitlement requirements + JSON event scenarios, revenue reconciliation | Same-card independent qa review required; subsequent runtime implementation must be separately bounded after accepted contract, no live Stripe |
| #38 | New `t_36ffda23` / devops after PR-06, offline owner/artifact-bound static Pages contract/tests/runbook | Same-card independent qa review required; rejects Workers artifact shape, no live deployment |

Worker statuses are a point-in-time snapshot, not a guarantee of continuous execution. No merged feature claim for current authored work. #25 remains a real human blocker even when independent work progresses.

### Design ownership / scope decisions

- #37 schema `entitlement.v1`: immutable server-derived ownerId, planId, policyVersion, period/quota; reservations key ownerId/jobId/attemptGroup, retry does not double-consume, success once, failure/cancellation release once, duplicate/out-of-order fake events deterministic. Atomic durable persistence belongs #25, not a new store. Pricing/config proposals are not approved commercial terms. CLI/core/engine remain free, including SQL/media/theme features.
- #38 schema `deployment.v1`: immutable owner/job/artifact sha256/kind/provider/idempotency/status/previous-version/error records; trusted deploy-only capability, never build/job credentials. Static Pages only; upgraded Workers output is rejected, not deployed by accident. Offline mocks do not prove URL/repo handoff, provider rollback or live operations.
- #30 and #36 already have active owners; no duplicate implementation tasks. Package-lock/scaffold/report/migrate/deploy overlap must be explicitly coordinated with #26.

## Automation and canonical issue hygiene

Read existing profile-scoped cron list before considering new automation: existing enabled `1e8d11857583`, “depress weekly review”, Monday09:00 (`0 9 * * 1`), next2026-10-26, pinned same model/provider, Telegram delivery. No new/edited/resumed cron, profile or scheduler configuration. Its workdir still names shared checkout: future supervised runs must obey own-clone/no-shared-mutation task rules; this run did not change it without authorization.

Read remote workflow list and source: CI, Security evidence and existing Release are active. Release triggers v* tags or manual publish confirmation and references npm-publish environment. **No tag, dispatch, environment/secrets edit, npm publication or release was performed; environment protection was not verified, so the source comment is not proof of an enforced approval gate.** Do not create competing automation.

Reconcile scoped issues only where original acceptance is met (#15 CI and #22 bounded ZIP) with explicit evidence comments. #23/#24 broader hostile runtime boundaries and #17/#19/#20 cross-cutting gates stay open unless their full criteria are independently satisfied. Add remaining security/plugin issues to milestone1 rather than hiding them outside the readiness tracker.

## No-go blockers

#36 installed default packaging failure; #26 vulnerable supported toolchain/default/CMS/privacy compatibility; #25 actual isolation/durability/lifecycle authorization and implementation; #30 bounded plugin implementation/acceptance; #37 service entitlement semantics; #38 artifact-bound provider/rollback/ops proof. Historical root audit19 includes1critical; installed OSS audit11 and generated audit19 are retained snapshots, not a new clean audit. A local successful static scaffold is not the paid service.

No secrets inspected or changed, deployment/provider account/resources/spending, production config, npm publication, tags/releases, branch deletion/force pushes/protection changes or other-profile changes. Final integration/release gates remain independent and explicit.
