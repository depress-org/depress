# entitlement.v1 — hosted-service requirements and fake-event oracle

PR-06 / #37 · **Design contract for independent review; NOT implemented or paid-service ready.**

## 1. Decision status and evidence

**Accepted task constraints (not commercial approval):** OSS core, CLI and
`wp-migrate`, including SQL import, media conversion and theme adapters, stay
free forever. No license checks, payment lookup, account, seat or network call
may gate local OSS use. Only an optional operated service may meter hosted
work. Prices, plan names, quotas and SLAs are proposals/configuration, not
approved commercial terms. No provider SDK, checkout, account, registered
webhook, credential, charge, deployment or spending is authorized here.[1]

**Proposed v1 behavior:** every normative rule below and the JSON oracle are a
reviewable implementation target, not evidence of a running billing service.
Independent QA must accept the exact revision before implementation handoff.
The existing authenticated owner boundary is an implemented dependency, not a
new account/team API: trusted credentials resolve to `ownerId`, jobs contain
that immutable owner, and `forOwner(ownerId)` filters all access.[2][5]

PR-05 records in-memory orchestration, no billing implementation and NO-GO for
public/credentialed paid hosting. Its bounded conversion results are not proof
of arbitrary WordPress fidelity, successful deployment or commercial readiness.[4]
Durable transaction/queue/recovery implementation belongs to #25; this document
only specifies its required atomic interface and failure outcomes.[3]

### Stories

- As an OSS user, I can run SQL/media/theme migrations without any entitlement.
- As an authenticated hosted owner, I can see a bounded allowance and submit
  work without retries or duplicate callbacks consuming it twice.
- As an operator, I can reject stale/cancelled grants, cross-owner access and
  concurrent over-admission without charging or provisioning anything.
- As QA, I can feed fake commands/events into a later implementation and compare
  exact observable state after every step, without provider access.

No customer demand, willingness-to-pay, sales, margin or SLA evidence is claimed.

## 2. Scope and compatibility

Meter **one successfully delivered hosted migration artifact**, not posts,
SQL/media/theme features, downloads, worker attempts, retries or currency.
`job.succeeded` is emitted only after the required migration/build/report checks
and private artifact commitment; deployment is not a success prerequisite and
is not authorized by an entitlement. Validation failure before reservation
costs nothing. This does not add fields to today's public job/upload API or
pretend today's `done` status proves private delivery. The future #25 adapter
maps its committed outcomes to the contract events below.

Authentication, upload bounds, rate limits, global/owner execution limits and
source/deployment safety remain independent hard ceilings. Entitlement approval
never overrides them. Check authentication and coarse admission before body IO;
after bounded upload validation, commit job admission plus reservation before
dispatch. If validation or a security/resource ceiling rejects, create no
reservation/dispatch; clean temporary uploads through the existing lifecycle.
Future cross-component transaction failure must not leave a runnable unreserved
job. No rewrite of #23 ownership, multipart schema or bot authentication here.

## 3. Canonical records (JSON shapes, not a database prescription)

All records use `schemaVersion: "entitlement.v1"`; reject unknown schema,
unknown fields, unknown plan/policy, invalid dates, unsafe integers and unbounded
configuration. Owner IDs are the exact nonblank strings of length <=128 from
the existing server capability; do not trim, case-fold, infer from email or take
an owner from an upload/provider metadata. Plan/policy/grant/period/job/group
IDs are nonempty operator/server-issued opaque strings <=128 characters.

| Record | Required data and invariant |
|---|---|
| Entitlement | `ownerId`, `entitlementId` (immutable grant epoch), `planId`, `policyVersion`, monotonically increasing `revision`, `status`, `periodId`, `graceUntil` (UTC timestamp or null), `cancelledAt` (UTC timestamp or null), `lastSourceSequence`, `cancelScheduled` (boolean), `expiryReason: null | period_end | grace_deadline`, `seatLimit`, `concurrencyLimit`, `assignedPrincipalIds` |
| Period ledger | `ownerId`, `entitlementId`, `periodId`, `start`, `end`, `limit`, `consumed`, `reserved`; start inclusive/end exclusive UTC RFC3339 milliseconds (`Z`); start < end; nonoverlapping periods; unit always `hosted_migration` |
| Reservation | Immutable tuple `(ownerId, jobId, attemptGroup)`, plus `entitlementId`, `periodId`, `policyVersion`, `units: 1`, `requestFingerprint`, `state: reserved | consumed | released`, `terminalReason: null | succeeded | failed | cancelled`, `cancelRequested` (boolean) |
| Job/group binding | Server-created `jobId -> ownerId, attemptGroup, requestFingerprint`; exactly one stable group for this logical job; retries cannot mint another group/owner or change source/theme configuration |
| Event receipt | `(sourceNamespace, eventId)`, canonical payload fingerprint, committed result, grant/sequence if applicable; no credentials, source contents or raw provider errors |

The owner is immutable on all records. One current entitlement per owner in v1;
no stacking plans, transferring grants or pooling unrelated owners. Historical
periods/reservations and cancelled-grant tombstones are retained for replay and
audit, independently of private source/artifact retention. Persistence and safe
retention/deletion implementation are #25, not a claim of this PR.

`limit`, `seatLimit` and `concurrencyLimit` are finite positive safe integers;
all counters are nonnegative safe integers. A reviewed policy supplies finite
upper bounds for each (no `Infinity`, `-1`, `null` or string `unlimited`). No
production defaults are selected here. Fixture values (limit 2, seats 2,
concurrency 2) are deliberately tiny **test data, not plan terms**.
`consumed + reserved <= limit` always. Available = limit - consumed - reserved.
Active reservations across *all* periods of the owner cannot exceed the current
concurrency limit. Ended-period unused allowance never rolls over.

`planId` identifies a configured hosted-service offer, not an OSS feature set.
`policyVersion` names an immutable reviewed snapshot of quota/seat/concurrency/
grace rules; price currency/amount/tax/renewal/refund terms live in separately
approved configuration, never in this entitlement or a fake event. A policy
change takes effect only with a new nonoverlapping period; no in-place shrinking
below committed usage, mid-period upgrades or retroactive repricing in v1.
Unsupported changes return `POLICY_CHANGE_REQUIRES_NEW_PERIOD` unchanged.

## 4. Authentication, seats and ownership

Use the #23 authenticated owner-scoped capability before entitlement/job lookup.
Missing authentication returns `UNAUTHENTICATED` without lookup or mutation.
A principal ID, if seats are later implemented, comes from a trusted membership
mapping and must be in `assignedPrincipalIds`. Today's multiple credentials for
one owner share a quota; credential count is **not** team membership or seat
count. No account linking between `telegram:*` and web owner IDs is inferred.
A future membership system must be separately reviewed; fixtures use fake
server-assigned principals only. Until it exists, no team-seat product claim.

The proposed owner principal occupies one seat. Membership changes require a
trusted owner-authorized command, no duplicate principals, and cannot exceed
`seatLimit`; `SEAT_LIMIT` rejects without mutation. An unassigned/revoked
principal gets `SEAT_DENIED` for new work; already-reserved work can settle
under its pinned owner. Removing a member never transfers jobs or resets usage.
Foreign or missing owner/job queries both return `NOT_FOUND`; never disclose
another owner's plan, usage or existence. Client-selected owners, plans, quota,
period, group and receipt identifiers cannot grant rights.

## 5. Admission, retries and terminal outcomes

1. An authenticated member requests an existing server-owned job/group binding.
   Enforce immutable binding/fingerprint first. An identical existing
   reservation returns `REPLAY` with the stored reservation, even if no new
   rights remain; this is not permission to re-dispatch a terminal job. A
   conflicting payload/group returns `IDEMPOTENCY_CONFLICT` with no mutation.
2. New reservation requires status `active` or `cancel_scheduled`, current
   `start <= now < end`, assigned seat, quota and all independent security and
   capacity gates. Denials are `ENTITLEMENT_INACTIVE`, `PERIOD_CLOSED`,
   `SEAT_DENIED`, `QUOTA_EXCEEDED`, `CONCURRENCY_LIMIT` or `RESOURCE_LIMIT`.
   Check quota before entitlement concurrency if both fail; no reservation,
   queue entry or paid work on denial. No automatic overage/charge or paid tier
   escalation. Owner may wait, use free OSS or seek a separately approved offer.
3. Reservation atomically adds one reserved unit and binds the job for dispatch.
   Repeated worker starts/nonterminal `job.retry` preserve this same tuple and
   counters. Changing a process execution attempt ID is not a new migration.
4. First trusted terminal event wins **per reservation**, via compare-and-set.
   `job.succeeded`: reserved -=1; consumed +=1; state consumed/succeeded.
   `job.failed` or `job.cancelled`: reserved -=1; consumed unchanged; state
   released with that reason. A second/contradictory terminal event returns
   `TERMINAL_IGNORED`; no negative counters, double consumption or reopening.
5. A client cancellation request is not terminal: stop new dispatch/retries,
   set `cancelRequested: true` (`CANCEL_REQUESTED`), reject subsequent retries as
   `CANCELLATION_PENDING`, request worker cancellation, retain the reservation until #25 proves worker
   quiescence/fencing and emits `job.cancelled`. Cancellation acknowledged before
   success wins; success committed first remains consumed. Terminal failed or
   cancelled jobs cannot be restarted under the same tuple (`REPLAY` returns
   final state, no execution). An explicit new migration has a new server job
   ID; a process retry must not masquerade as one. There is no cash refund in
   these rules: release means quota restoration only.
6. Crash/timeout is not an automatic release while an old worker may still
   execute. #25 fences the old attempt, establishes one terminal result and
   replays the atomic transition after restart. Recovery never consumes twice.

## 6. Subscription/grant lifecycle and ordering

Provider operations in the fixture are **fake normalized events**, not webhooks
or proof that a provider offers ordered delivery. A future approved adapter must
verify provenance and obtain an authoritative monotonic `sourceSequence` for
each grant through reconciliation; client timestamps/delivery order do not
establish ordering. Missing/untrusted sequencing fails closed (`INVALID_EVENT`)
and quarantines the event rather than inventing a grant. Ties with a changed
payload are `SEQUENCE_CONFLICT`. Lower sequence is `STALE_EVENT`. Receipts are
checked before sequence, so an identical event ID always replays its recorded
result; same ID + changed payload is `IDEMPOTENCY_CONFLICT`.

| Input (trusted fake source) | Proposed effect |
|---|---|
| `provider.payment_failed` | Current active/scheduled grant enters `grace`; explicit bounded `graceUntil` must be > now and <= period end; no new reservations even during grace. Existing reservations may finish. Never extend grace by redelivery. |
| `provider.recovered` | If newer, before `graceUntil` and period end, and not cancelled/expired: back to `active` (or `cancel_scheduled` if scheduled); no reset of period counters. |
| `clock.advance` | Trusted server clock is monotonic. At grace deadline mark `expired`; at period end mark `expired` (or `cancelled` if cancellation scheduled), without releasing pinned reservations. No client clock. |
| `provider.cancel_scheduled` | Set `cancelScheduled: true`; status becomes `cancel_scheduled` unless already `grace`, in which case preserve grace status/deadline and block admission. At boundary rights become permanently cancelled for this grant. |
| `provider.cancel_now` | Immediately set `cancelled`, tombstone epoch, no new work; prior reservations may settle. Does not itself cancel jobs, refund consumption or authorize artifact access. |
| `provider.renewed` | Only from ordinary period expiration (`expired`, `expiryReason: period_end`), with no scheduled cancellation/outstanding grace, greater sequence and next period starting exactly at previous end; now must be within the new period. Set active, clear expiryReason, preserve old ledger and add new bounded counters at zero. Old reserved work remains pinned and occupies concurrency. Early renewal, skipped/overlapping periods and renewal after grace expiry fail closed. |
| `provider.activate` on cancelled/expired epoch | `GRANT_TERMINAL`, even with a higher sequence; cannot resurrect rights or reset quota. Reinstatement after cancellation/grace expiry requires a separate explicitly authorized new epoch and audited issuance, outside this PR's oracle; ordinary period renewal is the sole expired-period exception above. |

An event requesting a past period or retroactive usage reset is `INVALID_EVENT`
unchanged. Terminal-grant protection precedes staleness for new provider event
IDs; an already-known event ID still replays without changing state. Rejected
provider events do not advance sequence/revision. A successful nonduplicate
provider event advances sequence and revision once; clock changes status but
never provider sequence. No renewal while cancellation is scheduled or grace
is outstanding. No automatic reconciliation/reinstatement implementation here.

Trusted clock processing always precedes each operation: apply all due deadlines
before evaluating its input (grace deadline wins over ordinary period expiry;
scheduled cancellation wins at period end). `clock.advance` is the only fixture
clock control; provider inputs never supply time. At ordinary period end set
`expiryReason: period_end`; at grace deadline set `grace_deadline`. A renewal at
the boundary therefore sees ordinary expiration regardless of timer delivery
order. Increment revision once per actual deadline status transition and once
per applied provider/membership mutation; duplicate clock ticks do not increment.
Reservation/terminal changes do not change grant revision.

Other status/event pairs: `recovered` is valid only from grace strictly before
its deadline; `payment_failed` only from active/cancel_scheduled. A newer failure
while already in grace returns `GRACE_ALREADY_SET` without extending it.
`cancel_scheduled` from active/cancel_scheduled/grace applies once per newer
sequence and preserves any grace deadline. `cancel_now` from any noncancelled
status applies and clears grace/expiry reason. `activate` on an existing grant
is `INVALID_TRANSITION` except cancelled/expired => `GRANT_TERMINAL`. Other
unsupported pairs are `INVALID_TRANSITION`. Cancelled is terminal for every
provider operation; expired by grace is terminal except an explicit cancel_now
may add a cancellation tombstone. Provider-rejected transitions do not advance
sequence/revision. Equal sequence with identical semantic content returns
`SEQUENCE_REPLAY` unchanged; equal sequence with different content is
`SEQUENCE_CONFLICT`. Sequence content excludes eventId/sourceNamespace (the
receipt identity), but includes type, owner, grant, sequence and policy/period
payload. A different eventId alone does not make different sequence content.

Expiration/cancellation revokes **new admission**, not legitimate settlement of
already-reserved work. That work retains its original policy/ledger; success
consumes there even after a new period starts, failure/cancellation releases
there only. Delayed success after *job* cancellation never revives that job.
Artifact availability/expiry/cleanup remains #25 and is not a perpetual billing
right or an entitlement-based extension of source retention.

## 7. Idempotency and atomicity contract (implementation owned by #25)

Keys are typed tuples, encoded using canonical JSON arrays, never ambiguous
string concatenation. Hash canonical payload bytes with SHA-256 for comparison;
Use RFC 8785 canonical JSON (UTF-8) for payload bytes; reject data not
representable by this bounded JSON contract. IDs alone are not authorization. Scope command receipts by authenticated owner
and operation: `["command.v1", ownerId, operation, requestId]`; scope normalized
provider receipts by trusted source: `["provider.v1", sourceNamespace, eventId]`.
Reservation uniqueness: `["reservation.v1", ownerId, jobId, attemptGroup]`;
terminal uniqueness: that reservation key (not callback ID). Internal job-event
receipt key: `["job-event.v1", "trusted-job-runner", ownerId, eventId]`; include
operation and job tuple in its fingerprint, so reusing an ID for another job or
terminal kind conflicts before terminal-state evaluation. Fixtures' `payloadRef`
is an opaque fake trusted payload identity, not a real digest or source path.

Create durable receipts only for committed successful commands/events and
committed terminal-ignored callbacks (not read-only queries, clock ticks,
admission/validation/transition denials or RETRYABLE_FAILURE). Thus a rejected
quota/seat/concurrency request may succeed with the same requestId when capacity
changes; invalid provider input may be corrected under that uncommitted ID.
Rejected stale/terminal/sequence-conflict provider events likewise leave no
receipt. Receipt-backed replays return `REPLAY` plus the stored original result
and resource identity without mutation (state reads show the current state,
not an obsolete snapshot). Canonical fingerprints exclude fault injection and
credentialAlias test controls; all actual semantic input and operation remain.
Authorization/owner isolation precedes receipt lookup to avoid leaks.

In one serializable transaction/CAS boundary commit authorization/revision,
quota/seat/concurrency checks, reservation+ledger, job/group admission and durable
outbox dispatch intent, receipt and sanitized audit record. No dispatch before
commit; outbox replay carries the same fenced tuple. Terminal job result,
private-artifact commitment (for success), ledger settlement, terminal state,
receipt and audit must have one observable commit point. A database/artifact
commit failure leaves all observable counters/job/receipt/outbox unchanged,
returning `RETRYABLE_FAILURE`; retry uses the identical key. Do not claim a
filesystem and SQL transaction magically commit together: #25 must supply a
staged artifact protocol plus recovery before emitting success.

Concurrent reserve requests serialize: with one remaining quota/slot exactly
one commits, others see the committed state and reject. Fixture `parallel`
steps prescribe one allowed deterministic linearization via `linearize`; a
future concurrency test must also exercise reversed order and prove the same
invariants with the other job winning. Owner-level concurrency spans periods;
shared credentials share all counters. Storage unavailable => fail closed, not
an in-memory fallback. Cross-tenant uniqueness/checks and durable receipt replay
must survive restart. Provider receipt retention/tombstone compaction may not
re-enable old rights; if durable evidence is unavailable, fail closed.

## 8. Machine-readable oracle and acceptance

[`entitlements-v1.scenarios.json`](entitlements-v1.scenarios.json) is data only:
`fixtureVersion`, synthetic `policies`, reusable `initialStates`, and independent
`scenarios`. Each scenario resets to the referenced state. `steps` have an
operation, explicit input, expected result(s), and **complete observable
projection** after the step: trusted clock, grant status/sequence, period
counters, membership, cancellation flag and reservation states. The projection
excludes receipt/audit internals; replay/conflict steps explicitly test their
behavior. Arrays for reservations/members are canonical sorted by ID. All fake
identities, IDs, dates and allowances are test vectors, not customers or offers.
No network/provider response is synthesized as execution evidence.

`reserve` uses the authenticated `actorOwnerId`/`principalId` and fake job binding;
`ownerId` denotes the lookup target only, never an authority override.
`job.retry`, terminal events and provider events are trusted internal inputs.
`fault: beforeCommit` means a persistence failure before any visible commit.
`resourceAllowed: false` exercises an independent security/capacity rejection.
`query` is read-only and owner-filtered. `member.add/remove` are trusted owner
membership commands. `parallel` inputs linearize in the stated order.
Fake provider `sequence` is the normalized `sourceSequence`; `eventId` receipts
include the whole input, excluding the step's fault injection control.
The fixture states assume a single seeded grant, not a payment/issuance API.
They are projections, not literal canonical seed records: period-map keys supply
periodId and inherit ownerId/entitlementId/unit from grant/policy; reservation
payloadRef stands for requestFingerprint. cancelRequested is explicit.
Distinct synthetic policy versions represent quota/concurrency-one cases; no
in-place policy overrides exist. Later consumers must expand these redundant
fields when creating canonical records, and compare the same projection.

| Acceptance criterion (future executable consumer) | Required scenario evidence |
|---|---|
| A01 OSS is never gated | `oss_without_entitlement`: SQL/media/themes work without lookup |
| A02 retries consume once; changed payload/group cannot bypass | `retry_success_once`, `binding_conflict`, `group_conflict` |
| A03 terminal release once; no late-success revival | `failure_releases_once`, `cancel_wins`, `success_wins` |
| A04 bounded quota and concurrency under races | `quota_serialization`, `concurrency_serialization`, `resource_denial` |
| A05 duplicate/stale/conflicting events cannot reset/revive | `duplicate_cancel`, `stale_provider`, `sequence_conflict`, `invalid_event`, `equal_sequence_same_content`, `callback_id_conflict`, `rejected_ids_not_committed` |
| A06 cancellation/grace/boundary semantics | `scheduled_cancel_boundary`, `grace_recovery`, `grace_expiry`, `immediate_cancel_inflight`, `grace_then_scheduled_cancel`, `recovery_at_deadline` |
| A07 owner isolation/seats/shared credentials | `foreign_owner`, `seat_capacity_and_revocation`, `shared_owner_quota`, `unauthenticated_no_lookup` |
| A08 period pinning and no carry/reset | `renewal_pins_old_reservation`, `period_boundary`, `midperiod_policy_rejected` |
| A09 atomic failure/restart replay | `reserve_rollback`, `settlement_rollback`; later #25 tests must kill/restart/fence real workers and prove durable replay |

This docs PR validates JSON parsing, IDs/references, oracle invariants and
scenario coverage locally; it does **not** execute a billing implementation.
Independent QA should challenge the proposed transitions and compare the JSON
to prose. Implementation acceptance later must run every step against a real
adapter, test both race orderings, restart/crash rollback, receipt persistence,
no-dispatch denial and no-lookup OSS paths; a self-contained model passing its
own fixtures alone is insufficient. Existing repository exact-head checks must
remain green; no gate/assertion is lowered or substituted.

## 9. Revenue reconciliation and approval gates

[REVENUE_PLAN.md](../../REVENUE_PLAN.md) is now an explicitly unvalidated
service-only hypothesis backlog, not a price sheet or feature-unlock contract.
The old paid SQL/media/themes and unlimited-migrations framing is superseded.
No support SLA, margin, SEO guarantee, buyer count or revenue forecast is
accepted evidence. Human approval remains required for commercial terms,
provider accounts/keys/webhooks, charges/spending, contacting customers,
public offers, production deploys and protected-branch merges.

Requirements were cross-checked against local company-os `planning/specs/`:
`features/policy-approvals.md` (exact approved payload/version, atomic effect and
replay), `features/product-validation.md` (evidence != completeness, revision-bound
GO, explicit simulation labels), and `features/durable-processes.md` (stable
request IDs, changed-input rejection, restart/cancel proof). These are design
alignment checks, **not** imported authorization or a requirement to use that
project's Temporal/PostgreSQL implementation. This PR grants no M7 approval,
M10 GO or hosted readiness.

## Sources

[1] https://github.com/depress-org/depress/issues/37
[2] https://github.com/depress-org/depress/issues/23
[3] https://github.com/depress-org/depress/issues/25
[4] https://github.com/depress-org/depress/blob/86a495040e3a670c17276a96fdc253e31dc545f1/docs/PR-05-cold-acceptance.md
[5] https://github.com/depress-org/depress/blob/86a495040e3a670c17276a96fdc253e31dc545f1/docs/security/issue23-admission.md
