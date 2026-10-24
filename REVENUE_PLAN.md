# depress — service-only revenue hypotheses

**Status: unvalidated proposals, not an approved offer or paid-service readiness
claim.** PR-06 / #37 replaces the earlier feature-gating/price-sheet framing.
No customer interviews, willingness-to-pay data, sales, signed commitments or
unit-economics measurements are supplied by this document.

## Accepted boundary: OSS stays free forever

Core, CLI and `wp-migrate`, including SQL import, media migration and all bundled
or contributed theme adapters, remain free OSS. No single-site restriction,
license server, paid feature flag, account, seat check or billing dependency may
restrict local use. Optional operated services may charge for hosted compute,
private artifact delivery, support or separately contracted human work — not
for unlocking the migration engine.[1]

Free availability is not a claim that every feature is production-ready. PR-05
records bounded conversion evidence and explicit release/hosting blockers; it
does not prove arbitrary WordPress fidelity, editor workflow preservation, SEO
rankings, private delivery, durable isolated workers or actual deployment.[4]

## Offer hypotheses — none approved or launched

| Working label | Optional service hypothesis | Still requires evidence/decision |
|---|---|---|
| Hosted migration (formerly Pro) | Operated migration/build capacity plus private artifact delivery; bounded per-owner successful-migration allowance | Measured cost per success/retry, supported inputs, isolation/delivery proof, demand and approved terms |
| Agency service | Shared owner allowance and, if separately implemented, bounded seats for authenticated members; integration assistance | Real agency workflow evidence, membership authorization, finite capacity/seat policy and support cost |
| Assisted/enterprise service | Explicitly scoped human migration/QA/customization engagements | Actual delivery capability, staffing/cost, legal scope, support terms and owner-approved quote |

All plan IDs, amounts, currencies, periods, finite quotas, concurrency limits,
seat limits and grace durations must be versioned configuration reviewed before
use. No price/limit is selected here. The historical $299, $149/mo, $990/yr,
$4,000/yr and $3k–$15k figures were unsupported proposals, **not approved or
available terms**; this revision does not preserve them as offers. The previous
"unlimited migrations" claim is withdrawn: hosted admission must be finitely
bounded, and over-limit requests never trigger an automatic overage charge.
Fixture allowances in the [entitlement.v1 contract](docs/billing/entitlements-v1.md)
are tiny synthetic test values, not commercial terms.

SQL/SEO metadata import, media conversion, white-label output/customization,
CMS scaffolding and theme adapters are not paid engine unlocks. Existing
third-party asset licenses remain their own constraints; this document creates
no marketplace, resale rights, referral relationship or paid adapter tier.
No guaranteed response time, managed-migration margin, SEO result, migration
duration, downtime promise, revenue forecast or customer target is accepted as
fact. Previous buyer-volume/project-price/infra-savings claims lacked supplied
evidence and are withdrawn rather than silently reused.

## Need → offer → smallest build → measure → decision

1. **Need evidence (not collected here):** obtain owner authorization before
   contacting real people; record dated attributable observations about migration
   tasks, existing alternatives and paid operational pain. Do not invent quotes,
   customers or willingness to pay.
2. **Offer test (proposal only):** compare a bounded operated-service concept
   against free self-hosted OSS. Record interest separately from purchases; no
   public price/checkout or contractual promise without human approval.
3. **Smallest technical prerequisite:** independently review the proposed
   [entitlement contract and fake-event scenarios](docs/billing/entitlements-v1.md)
   while preserving #23 server-derived owner capabilities. This is requirements
   work, not payment implementation or a new account API.[1][2][5]
4. **Build/deliver prerequisites:** #25 must prove durable reservation/queue
   atomicity, worker fencing/isolation, private artifacts and cleanup. A model,
   mocked URL or successful local conversion does not satisfy those gates.[3][4]
5. **Measure before commercial decision (metric definitions, not results):**
   count unique logical hosted jobs attempted/succeeded/failed/cancelled;
   reservations/consumption/releases per owner-period; retry and duplicate-event
   counts; actual compute/storage/support cost; private-delivery failure and
   cleanup latency. Keep source contents, tokens and raw paths out of telemetry.
   No benchmark, margin or target has been measured/approved here.
6. **Iterate or kill:** present evidence, costs, readiness gaps and exact proposed
   terms to the owner. A positive model review is not permission to spend,
   publish, charge, contact prospects or deploy. Missing evidence stays missing.

## Delivery and approval status

`docs/billing/entitlements-v1.md` and its JSON fixtures define a **proposed**
provider-neutral service contract. They do not run billing, sell seats, connect
webhooks or establish durable persistence. Independent QA and later executable
adapter tests are required. Provider selection/integration is deferred.

No Stripe SDK/account/key/webhook, checkout, charge, live bot/provider call,
pricing rollout, resource provisioning or production deployment is authorized.
Human approval is required for spending, real-person outreach, public offers
under the owner's name, legal/pricing commitments and protected-branch merges.
The last cited acceptance remains NO-GO; removing misleading revenue text is
not a release or paid-service GO decision.[4]

## Sources

[1] https://github.com/depress-org/depress/issues/37
[2] https://github.com/depress-org/depress/issues/23
[3] https://github.com/depress-org/depress/issues/25
[4] https://github.com/depress-org/depress/blob/86a495040e3a670c17276a96fdc253e31dc545f1/docs/PR-05-cold-acceptance.md
[5] https://github.com/depress-org/depress/blob/86a495040e3a670c17276a96fdc253e31dc545f1/docs/security/issue23-admission.md
