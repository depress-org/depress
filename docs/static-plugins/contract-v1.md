# Proposed static-plugin API v1

**Design recommendation, not implemented or approved product policy.** Capability matrix version `1`; API discriminator `depress.static-plugin/v1`. No production API/type/package changes in this PR. [Audit and alternatives](README.md) · [Acceptance](acceptance.md).

## Boundary and smallest useful hooks

A static plugin is reviewed, in-tree TypeScript executed **during migration**, producing data-only changes to normalized content. Readers receive static output, not plugin code, PHP, scripts, remote calls or new endpoints. Theme adapters stay a separate privileged core mechanism. The host retains ownership of rendering, paths, media copying, redirects, config, report writing, build and deployment.

Proposed sequencing (shared service, then CLI/web/bot adapters):

1. Validate config completely before output. Unknown/duplicate ID, incompatible API/version, unknown option or invalid option value fails the run with a report diagnostic. No implicit download, auto-discovery, environment expansion, arbitrary module path or install scripts.
2. Core inventory enumerates **raw WXR items before parser filtering**, records stable source IDs/types/statuses and source feature occurrences. Inventory also records ignored custom post types, shortcodes, comment/block markers and unhandled metadata names. It must not claim exhaustive detection: PHP behavior, omitted SQL plugin tables and missing exports remain `unknown/not-assessed`. Do not infer plugin installation from one key/taxonomy.
3. Core creates immutable safe projections and stable opaque tokens for shortcode occurrences **before** a converter strips attributes. A token points to host-held tag/attrs/source span; it is not executable markup. Preserve original input privately for bounded review, never concatenate raw attributes into generated MDX/JS/config.
4. `inspectSource` receives this bounded source inventory projection and options; returns diagnostics only. No filesystem access or mutations. This is how an extension can explain unsupported source behavior without hiding it inside an item count.
5. After core conversion and successful media resolution, `transformItem` receives one normalized published post/page, its host-assigned tokens and resolved media references. Returns token replacements + diagnostics; no mutation of source item, source identity, publication status, routes or frontmatter. v1 only replaces tokens owned by that plugin. A token has at most one configured owner; ambiguous ownership is a config error.
6. Host validates all results, applies a whole item's replacements atomically, maps through the selected theme, verifies emitted content/paths and appends actual outcomes to #18's canonical report. Build/check gates use that report. No plugin performs builds or deployment itself.

This proposal deliberately offers **two hooks**, not a free-form before/after filesystem lifecycle, AST framework or package marketplace. Unsupported private/draft/plugin items stay out of public artifacts even when inventoried. If a normalized item never reaches a theme output, mark it skipped/unsupported/failed as appropriate; a successful plugin hook cannot override that outcome.

## Conceptual shape (illustration, not importable types)

```text
StaticPluginConfig = {
  api: "depress.static-plugin/v1",
  plugins: [{ id: "core.static-gallery", version: "1", options: {} }]
}

RegisteredStaticPlugin = {
  id, version, api,
  optionSchema,                 // strict JSON object validation
  ownsTokens: ["gallery"],
  inspectSource(sourceView, options) -> Diagnostic[],
  transformItem(itemView, options) -> {
    replacements: [{ tokenId, markdown }],
    diagnostics: Diagnostic[]
  }
}

sourceView = {
  items: [{ sourceId, sourceType, sourceStatus, featureRefs }],
  coverage: { wxr: "scanned", pluginTables: "not-assessed" }
}
itemView = {
  sourceId, destinationKind, normalizedMarkdown,
  tokens: [{ tokenId, tag, attrs }],
  mediaBySourceId: { id: { publicUrl, alt, copyStatus } }
}
Diagnostic = {
  code, severity: "info" | "warning" | "error",
  sourceId?, tokenId?, metadataKey?,
  classification: "preserved-data" | "static-replacement" |
                  "manual-review" | "unsupported-dynamic",
  message, action
}
```

All maps/arrays above are immutable JSON-safe projections. `sourceId` is source-scoped and preserved; duplicate IDs are input errors, not silently renumbered. Slugs are not identity (duplicates must remain distinguishable). `publicUrl` is host-issued to a successfully copied local asset, not an arbitrary user URL. Diagnostic messages/actions are bounded plain text from reviewed templates; source evidence uses identifiers/offsets, not raw HTML, SQL, passwords, email, absolute paths or query strings. Raw inventory values are not automatically included in plugin projections: pass only registered/allowlisted fields required by the plugin.

No hooks expose process/environment/credentials, job-store access, arbitrary paths, raw SQL, user profiles or plugin secrets. No `afterBuild`, route registration, config rewriting or custom frontmatter in v1. A later API for additional fields requires its own Keystatic/theme/schema acceptance, not an untyped escape hatch.

## Config, ordering and deterministic results

- Default plugin list is empty. A feature owner may opt into a reviewed ID; web/bot cannot accept an arbitrary uploaded module. Example config above is a future shape, **not a CLI flag available now**.
- API `v1` is a compatibility boundary; plugin implementation `version` pins behavior separately. Record both and matrix version in the report. Reject other API versions; do not silently coerce them.
- Fixed configured order for `inspectSource`; fixed source inventory order for items. For token transforms ownership is exclusive, so config order cannot resolve conflicts. One plugin cannot observe another plugin's partially applied output. Same input/config/media manifest yields identical content and ordered diagnostics; core report timing fields may differ.
- Unknown attributes/options are findings, not silently ignored. Example gallery v1 accepts only `ids` as comma-separated positive attachment IDs (optional surrounding whitespace); absent/invalid/duplicate IDs or any other gallery attribute triggers manual review and no partial replacement. This narrow rule is a proposal, not a claim about all WordPress gallery syntax.
- Host enforces existing job-policy resource budgets (input/output bytes, item count, diagnostic count, wall time/memory). Exact limits belong to #24/#25, not invented product promises here. Oversize data/result or exhausted diagnostic quota emits one explicit truncation/budget error and fails, never false-green clipping.

## Isolation and failure rules

A TypeScript interface, frozen object or `try/catch` **is not a security sandbox**. Only reviewed first-party implementations may register in v1. Their code still executes with Node privileges; hosted use requires OS/process isolation, denied egress and no platform credentials in the migration/build environment (#24/#25), plus separately credentialed deploy. Plugin code must not be loaded from uploads, SQL/PHP, generated site packages or remote npm. A malicious input may exercise converter/build code too; this proposal does not close those security issues.

| Situation | Proposed result |
|---|---|
| Valid replacement and all referenced media present | Validate safe Markdown, apply atomically, then record `static-replacement` with final artifact evidence only after output verification |
| Unknown shortcode / unsupported dynamic feature / missing gallery asset or unrecognized gallery attrs | Keep host-owned review marker and private evidence reference; record `manual-review` or `unsupported-dynamic`. Preserve ordinary safe inner text where possible, not executable raw shortcode HTML. Mark migration needs-review; automated readiness/check is non-green until explicitly resolved |
| Throw/rejection, timeout, malformed result, forbidden output or budget exhaustion | Item/run failure diagnostic; discard plugin delta. Keep diagnostic/report artifact even on failure; nonzero CLI result and failed service result; do not deploy |
| Unknown API/plugin/config, competing token claims | Fail before conversion output, with machine + human explanation |
| Draft/private content encountered | Record skipped/non-public disposition without public body output. Plugins cannot promote it to published |

Host validation rejects replacement Markdown containing raw HTML/MDX, imports/exports, scripts, expressions, unresolved/foreign token IDs or URLs other than the media manifest's host-issued public paths. Gallery output uses escaped alt text and plain Markdown image nodes only. Host serializer must reject control characters and prevent Markdown/MDX injection; it cannot rely on a plugin promising to escape correctly. No output path is plugin-selected. The first plugin emits no JS/CSS, no remote URLs, no files and no dependencies.

Do not silently disable a broken plugin and report success, or silently publish partially transformed content. A local reviewer may resolve documented manual findings through the canonical report/check workflow; that acknowledgment is not a converter-generated success and must not erase the original evidence. #18 determines the precise representation of review resolution; automated hosted deployment remains gated.

## Attach to canonical report #18, do not fork it

[#18](https://github.com/depress-org/depress/issues/18) owns machine-readable versioned truth plus a human-readable migration report and quality checks. The following is an **additive semantic proposal**, to be mapped onto its actual merged schema after #16/#18 integration:

- Run: matrix/API versions, configured plugin IDs/versions, assessed source surfaces and explicit `not-assessed` coverage, bounded diagnostic/truncation status.
- Item: original source ID/type/status, eventual output reference, core disposition, feature findings and stable diagnostic codes. Each finding identifies token/metadata key and plugin (or core), preservation/replacement/review/dynamic classification, actual outcome, safe evidence ref and required action.
- Outcome must distinguish `observed/parsed`, `emitted`, `verified` and `not-preserved`. Finding metadata in WXR is not proof of output/rendered preservation. Plugin success does not mean migrated-item success, and warnings do not increment source-item totals.
- Unknown custom post types/shortcodes are accounted for **before** filtered `WPExport.posts` counts are computed. Disabled plugins do not disable core inventory; unresolved gallery still appears in the report.
- Markdown report renders the same records as JSON. `check` validates each expected source item, final route/content/media and unresolved finding, not counts alone. Unknown dynamic dependencies block unattended readiness. No blank or missing compatibility section may imply “all plugins supported.”

Suggested diagnostic codes: `WP_TYPE_UNSUPPORTED`, `WP_SHORTCODE_UNRESOLVED`, `WP_METADATA_UNMAPPED`, `PLUGIN_CONFIG_INVALID`, `PLUGIN_EXECUTION_FAILED`, `PLUGIN_OUTPUT_REJECTED`, `PLUGIN_BUDGET_EXCEEDED`, `GALLERY_MEDIA_UNRESOLVED`, `GALLERY_ATTRIBUTES_UNSUPPORTED`. These are proposed stable codes, not fields/codes already exported by current main.

## Bounded gallery demonstration, if accepted

Resolve `[gallery ids="11,12"]` only when both IDs refer to successful local-media entries with safe alt strings. Preserve ID order and render a simple static image list. Do not retrieve missing media, execute a WP function, implement a lightbox, parse serialized PHP, reproduce theme-specific layout or install anything. Unsupported attrs/IDs produce a finding, not guessed output. This requires a synthetic fixture because the current sample has no galleries. Broader actual demand must be established separately; do not present a demo fixture as customer evidence.
