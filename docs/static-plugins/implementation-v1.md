# #30 bounded implementation (pending independent integration acceptance)

This documents the implementation on this PR branch, not a general WordPress plugin support claim. The historical matrix and audit in [README](README.md) remain pinned to their original source revision. PR31's design was independently accepted; #16 and #18 are integrated. Default plugins remain empty. Independent P12/theme acceptance belongs to #19 and QA card `t_e75fe122`; hosted isolation remains #24/#25 and toolchain/package blockers #26/#36 have separate owners. No product/release GO is implied.

## Use

Strict JSON config, no environment expansion, module paths, downloads or package discovery:

```json
{
  "api": "depress.static-plugin/v1",
  "plugins": [{ "id": "core.static-gallery", "version": "1", "options": {} }]
}
```

```sh
node packages/cli/dist/index.js migrate --input export.xml --wp-dir local-wordpress --output output --theme scaffold --static-plugins plugins.json
```

The shared noninteractive `migrateSite` accepts the same object as `staticPlugins`. Omit it for `{api: "depress.static-plugin/v1", plugins: []}`. Invalid config fails before conversion output, retaining safe canonical JSON/Markdown diagnostics for valid WXR. Invalid WXR or unsafe path preflight remains no-write per #24. CLI returns nonzero for errors **and needs-review**; service callers receive `qualityPassed: false` for review (errors reject). Web/bot expose no plugin-setting upload/UI; their default remains empty. Existing job pipeline's quality gate still prevents build/deployment after review failures.

## Boundary

Only the reviewed in-tree registry contains `core.static-gallery@1`. `inspectSource` returns diagnostics; `transformItem` returns only owned token replacements and diagnostics. Safe JSON projections are deeply frozen; original identities/status/paths/frontmatter are host-owned. No hook sees filesystem handles, environment, store/deploy capabilities or raw metadata values. Host conversion retains collision-resistant opaque tokens before shortcode attributes disappear. The quote-aware conservative lexer inventories opening/closing/self-closing and malformed candidates; HTML attributes/comments and escaped `[[...]]` are not executable shortcode boundaries. Ordinary safe inner text is converted by the existing safe renderer. Unknown/malformed boundaries retain private offset/ID evidence and explicit review findings. The private source manifest is never public content.

Gallery accepts only a unique comma-separated list of positive safe-integer attachment IDs. It emits an ordered plain Markdown image list with manifest-issued `/media/<safe-basename>` URLs and host-validated literal alts. Syntax-bearing alts that cannot roundtrip exactly are review, not lossy green. Missing/failed/nonpublic assets or unsupported attrs/paired galleries produce no partial image replacement. Referenced local images are copied by the core media host, never the hook. A shortcode alone never initiates a remote media fetch; without `--wp-dir`, only assets already resolved by ordinary host media handling can be used. Explicit private/draft attachments are excluded even when a published post references them; canonical replay rejects forged public bytes. Privacy policy and the local byte reader share one validated resource identity: resolved origin plus nonempty, decode-once/NFC-normalized path segments. Original path traversal is rejected before URL normalization; query/fragment, encoded filename/directory and Unicode aliases cannot bypass the exclusion. Filtering occurs before collision checks and any copy. A public gallery attachment alias cannot promote an excluded private resource. Ordinary inherit-status media eligibility is not source-media ownership provenance.

All item replacements commit atomically. Unknown ownership conflicts are config errors, not last-writer-wins. Broken hooks are not silently disabled. Rejections, async deadline expiry, synchronous hooks returning late, malformed results, invalid URLs/Markdoc and oversize data fail closed. Fixed defensive limits: input/projection/result JSON 1 MiB, 10,000 source items, 4,096 shortcode boundaries, 256 diagnostics per run, 1,000 ms per hook. These are implementation caps, not hosted SLA/resource/security guarantees. Exhaustion records an explicit `PLUGIN_BUDGET_EXCEEDED` failure instead of green clipping. Full canonical raw inventory/per-item evidence remains distinct from bounded hook diagnostics. Synchronous CPU cannot be preempted with a Promise timer: privileged in-tree Node code is **not sandboxed**. OS limits/denied egress/credential separation still require #24/#25 verification.

## Canonical #18 schema integration

No second report: existing schemaVersion1 gains required `compatibility` (API/matrix/plugin pins, explicit not-assessed surfaces, template diagnostics, source feature refs and occurrence outcomes). Existing source-manifest schema1 gains optional `staticPlugins`, safe `pluginFailure`, metadata key names. Existing item/media statuses/findings are retained. Metadata/comment/block observations are not preservation claims; detected dynamic form/cart/account blocks/shortcodes block readiness. This is conservative feature recognition, not exhaustive plugin installation detection or PHP/SQL-table assessment. Built-in SEO/navigation/redirect logic remains core.

Canonical replay reruns the deterministic reviewed hook with only byte-checked local raster references. It compares rendered static Markdoc image sequence/alts per item and visible prose; comments, code literals, frontmatter/excerpts and another item cannot prove preservation. A replacement is `verified` only after final item output evidence passes. Missing output/unsupported renderer cannot become successful because a hook returned images. JSON and Markdown render the same records; check rejects missing/malformed/tampered compatibility, altered Markdown and changed artifact bytes. Older reports without compatibility must be regenerated; blank compatibility never implies support. These snapshots are not signed source provenance or a manual-finding-acknowledgement API. No automatic acknowledgement/override is added.

## Executed engineering controls

- P03/P04: raw pre-filter items/types/statuses and unique identity; duplicate ID fail before content, duplicate slug path preflight retained; nested/quoted/non-ASCII attributes, escaped/malformed syntax and literal fixed-marker collision regression controls.
- P05/P06: opt-in ordered gallery, plugin-off review, missing/invalid/duplicate IDs, missing local images, attrs and paired-gallery rejection, no partial replacement.
- P07: dynamic shortcode/block recognition and explicit not-assessed plugin tables/PHP/omitted exports; no fake form/cart behavior.
- P08/P11: unknown/duplicate/version/API/options/config rejection, exclusive ownership conflict, frozen projections, deterministic bytes/reports and actual built CLI/service parity.
- P09/P10: throw/rejection/async timeout/oversize hook results, real service/CLI input and diagnostic exhaustion, whole-item rollback, template diagnostics, foreign/duplicate token, HTML/MDX/JS/import/URL/path/alt rejection.
- Real generated scaffold gallery: required existing generated fixture script now invokes `generated-static-plugin-evidence.mjs`. It builds actual HTML, asserts ordered rendered `<img>` nodes/alts and exact copied bytes, builds hidden-comment/code-image negative controls and restores a positive build. This reuses root locked dependencies; it is **not independent cold P12 theme acceptance**.

Cold Node20 baseline and local build/typecheck/lint/five unchanged coverage gates pass. Independent precommit review found and third-context correction fixed private/draft attachment publication, dynamic-cart-block false green and retained legacy marker/literal corruption; regression controls were executed. Final exact-head CI URLs and independent integration verdict are recorded in the PR/Kanban handoff, not inferred here. No workflow/lock/package/toolchain churn, PHP/arbitrary module loading, secrets, deploy/publish/spending or selfmerge.
