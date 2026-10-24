# depress — Evidence-gated Quality Roadmap

> Goal, not current guarantee: preserve published content, SEO and media, provide a usable editorial workflow, and deliver a verified site without silently dropping data.

## Verified checkpoint — PR-06 / #20 (2026-10-24)

Canonical planning: [milestone 1](https://github.com/depress-org/depress/milestone/1), [issue #20](https://github.com/depress-org/depress/issues/20). See [PR-05 measured acceptance](docs/PR-05-cold-acceptance.md) and [PR-06 integration/queue evidence](docs/PR-06-production-queue.md). Historical implementation plans are not acceptance evidence.

**Overall NO-GO for an OSS release or public/credentialed paid web/Telegram product.** Green repository CI is necessary but does not establish installed-package, sandbox, billing or deployment readiness. OSS engine/CLI features stay free forever; paid service packages reuse the same engine.

### Original quality priorities reconciled against merged source

| Priority | Current bounded state | Remaining proof / owner |
|---|---|---|
| 1 — author + featured images | Implemented in parser/native conversion and metadata bridge | Per-theme consumer/CMS behavior and unsupported combinations remain acceptance gates (#26/#36) |
| 2 — redirects | Redirect generation implemented | Actual hosting cutover/status/complete legacy URL coverage is not proven (#38); generated entries alone are not SEO continuity |
| 3 — image alt | Per-occurrence inline alt plus attachment fallback implemented and report-validated | Nine real renderer controls and archive bytes/ordered alts measured; arbitrary media/formats/provenance not guaranteed |
| 4 — SEO metadata | Raw-source inventory and metadata bridge implemented | Per-theme mapping/CMS/consumer gates; arbitrary custom fields are not silently treated as preserved |
| 5 — migration report | Versioned source-manifest.json and migration-report.json/.md emitted; per-item fail-closed validation and job quality gate | Canonical static grammar only; reports are not signed source provenance or arbitrary-template proof |
| 6 — SQL import | Optional dump reader and CLI/service input exist | Not complete database/PHP/plugin migration; hosted isolation and original-feature acceptance still required |
| 7 — shortcode handling | Conservative unsupported-feature findings preserve review needs | General builder/plugin compatibility NOT implemented; bounded static-gallery implementation is #30 |
| 8 — video fallback | URL fallback behavior exists | Not a promise of functional dynamic embeds or every provider; inspect actual rendered output |

`check` and `deploy` are **not literal stubs**. CLI service implementations exist, with typed failures, bounded shell-free subprocess execution and trusted opt-in deployment. Actual installed default migration nevertheless fails in the current packed artifact (#36). No live deployment was performed or inferred from mocked URLs.

### Integrated foundations (bounded acceptance, not product GO)

| Scope | PR | Verified merge |
|---|---|---|
| Required coverage + generated-site CI | #8 | fbdfd3d03ef7e0e35f92eeae0193d7226da7cba8 |
| Security inventory / targeted nanoid patch | #27 | e72e58ab9086780316c8ebe0d53db03e022d8b57 |
| Typed shared migration/process/deploy services | #28 | d0865b0b657848aafe2e4c2276ad9ec400999d91 |
| Authenticated immutable owner-scoped admission | #32 | 692704a0595032037e960769888ff381ad9d27a3 |
| Static-plugin design/matrix (docs only) | #31 | b4f5008c6a6cde2885abc131762a8ac954038e67 |
| Safe Telegram upload/session adapter | #14 | fb9f4a654a5c562ca4c643f111ff3500838ad5e0 |
| Truthful per-item reports / privacy / visible-body checks | #34 | 95bab42089c0093e8b6faf2c4aac8f1166da3014 |
| Native bounded WXR/source/filesystem/media boundaries | #33 | c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0 |
| Shared safe ZIP admission, web + Telegram | #35 | 52821c41fa6664e95fc0533a5d19f27ce597c212 |
| Cold acceptance script + explicit NO-GO evidence | #39 | 86a495040e3a670c17276a96fdc253e31dc545f1 |

### Next bounded sprint

1. **#36 packaging** — supported asset/license allowlist, compatible public package ranges, real clean tarball-installed default/scaffold CLI + library acceptance. Existing author and independent QA cards; no publication.
2. **#26 compatible patched toolchain** — root/default/scaffold cold consumers, runtime/CMS/media/privacy matrix, independent audits; Workers artifacts must fail closed at the old Pages adapter. Staged work is not merged readiness.
3. **#30 static-plugin v1** — reviewed in-tree data-only contract, default empty plugin list, bounded local gallery and canonical compatibility report; independent rendered-output acceptance. No PHP/marketplace/general WP compatibility.
4. **#25 private durable workers** — actual isolation, bounded durable queue, cancellation/crash recovery, owned retention/redaction/preview. Currently incomplete and human-gated on disposable OCI/Postgres test authorization; local profile tests are not runtime enforcement.
5. **#37 entitlement requirements** — service-only versioned quota/reservation/idempotency policy and deterministic fake-event scenarios, reconcile revenue claims. No real payments or OSS gating.
6. **#38 offline deployment/rollback/ops** — immutable owner+artifact binding, trusted capability, offline adapter fixtures and recovery runbook. A future explicitly authorized sandbox deployment remains a separate gate.

Do not duplicate existing implementation lanes. Independent QA reviews exact published heads before guarded integration. Package lock, native migration/report/scaffold, and deploy service are coordination hotspots.

## Release bar

- Real clean installed default and scaffold consumers migrate, validate and build; supported assets/licenses and compatible dependency ranges are present.
- Raw published inventory reconciles with actual rendered bodies, routes, metadata, media bytes/alts; drafts/private data never enter public artifacts. Unsupported features fail visibly.
- Actual CMS readers/editor flows and URL/redirect behavior meet the documented support matrix; static output does not prove live backend functionality.
- Exact-head required CI succeeds without lowering any coverage/quality gate; independent review and retained evidence precede integration.
- Consumer/root dependency findings and reachable runtime risks are resolved or explicitly enforced by an independently reviewed policy, not waived by green unit tests.
- Public hosting additionally needs measured worker isolation, durable ownership/lifecycle, entitlement semantics and artifact-bound deploy/rollback/operations acceptance.
- Real credentials, production resources, spending, deployment, npm publication/releases and destructive actions require explicit owner authorization. No such authorization is implied here.
