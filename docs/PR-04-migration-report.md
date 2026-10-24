# PR-04 / #18 — versioned migration evidence

Schema version 1 is exported from @depress-org/core. The engine's report module is the canonical owner; plugins must add findings here rather than emit a competing report.

## Files and semantics

- source-manifest.json inventories every raw WXR item before the post/page parser filter, including original ID, ordinal-qualified key, source status/type, source metadata, source content and attachments. Source SHA-256 identifies the input bytes. This LOCAL file can contain private/draft source material: do not publish it or put it in public/.
- migration-report.json lists each item as migrated, skipped (nonpublished or separately accounted attachment), unsupported (published custom type), or failed. It records ID-linked shortcode/custom-field, author, exact Yoast, complete normalized prose, media/alt and redirect findings. It snapshots content/media/redirect bytes with SHA-256. qualityPassed is false for loss or unverified preservation, not just thrown exceptions.
- migration-report.md is a human projection, not an independently trusted QA input. A zero-drop sentence is never evidence.

The shared CLI/service emits reports after final theme injection. Valid sources that fail conversion get best-effort failed-item reports before the original typed error is rethrown. Invalid XML cannot produce a trustworthy inventory and rejects without claiming one.

All quality CLI checks require the manifest and report, recompute every item's evidence from current output, compare the complete report, and fail closed on missing/malformed/schema-mismatched/changed evidence. Per-item checks never accept unrelated redirect counts or arbitrary populated authors/descriptions. The job pipeline refuses done/deployment when qualityPassed is false, preserving report artifacts for inspection.

## Preservation and conservative limits

Existing wp2md/stage2 conversion remains the converter. Source post/page author and Yoast fields are bridged into its output (type-specific slug matching, no ambiguous metadata assignment). Unique attachment alt fills empty Markdown image alt; nonempty inline alt is not overwritten. Unused/unrepresentable alt, ambiguous media basenames, unavailable attachment bytes and source references are explicitly failed/unsupported, not success. Unsupported shortcode attributes and custom fields are retained in source-linked findings; no general plugin support is implied.

Duplicate IDs and same-collection case-folded duplicate slugs cannot claim one destination twice. Pages in scaffold are directory entries; theme pages are flat and themes without pagesDir fail visibly. Report reads reject unsafe paths and escaped symlink targets; this is not a replacement for #24 converter security or #25 worker isolation. Full normalized prose comparison is conservative: changed formatting that changes normalized text can need review rather than false-green migration.

Redirects retain existing generation logic and root compatibility files, and now additionally ship in public/_redirects and public/redirects.json so generated builds include the checked evidence. Destination mappings are verified per source ID; a generated route build remains a separate gate.

## Executed verification

Node 20.20.2/npm 10.8.2 cold npm ci --legacy-peer-deps, root build/typecheck/lint, workspace mandatory coverage tests and security regressions were exercised locally. The actual generated scaffold fixture verifies all three published items against the report, explicitly skips its draft, builds Astro and inspects rendered post/page bodies and draft exclusion. Source-manifest omission, byte tamper, incorrect Yoast/author/redirects, duplicate slug/ID, source images/attachment alt, executable frontmatter, unsafe paths and symlink escape have regression tests. TDD logs are retained in this task's .tmp evidence.

Independent exact-head CI/review is required before merge. No real deploy, token access, npm publish or self-merge was performed. Public hosting/release remains NO-GO under #19/#24–26; these reports are not security approval or general WordPress/plugin compatibility.
