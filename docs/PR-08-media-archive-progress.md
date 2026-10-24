# PR-08 / #22: shared media ZIP ingestion — implementation checkpoint

**Not feature acceptance, not production approval.** Both adapters now call the
same bounded extractor and pass its validated WordPress root as `JobInput.mediaDir`.
Native-converter + real generated-site verification is still gated on independently
reviewed Integration D (`t_df50d5f5` / PR33 #24). Do not exercise the archive E2E
against the obsolete loopback/upstream converter or call an author-only head approved.

## Reviewed prerequisites and scope

C actually merged bot PR14 reviewed `525b04c` as `fb9f4a6`, report PR34 reviewed
`08fda090` as `95bab420`, retaining docs31. This branch starts at main
`95bab42089c0093e8b6faf2c4aac8f1166da3014` and cherry-picks only independent
extractor checkpoint `f00b5ff` as `b96cdba`; no obsolete parent stacks replayed.
Parent PR reviews/checks freshly read in this task. No changes to migration,
serialization, canonical report or privacy-proof hotspots; D owns reconciliation.
No self-merge, deployment, production secret access, npm publication or protection changes.

## Upload contract

- **Web:** authenticated `POST /api/jobs` multipart file fields `wxr` (required),
  `sql` (optional), **`media`** (optional ZIP); required text field `theme`.
  Omit `media` to skip. Empty/malformed media is an error, never a skip/success.
  Up to three files + four existing metadata fields, seven parts, no duplicates.
  Existing streamed byte/deadline, admission and owner-scoped authorization remain.
  Shared admission validates WXR/SQL bytes independently of supplied filenames/MIME;
  an archive cannot silently become SQL or XML. HTTP default file/request bounds
  (8/10 MiB) apply before the extractor's higher standalone compressed limit.
- **Bot:** private allowlisted sender only: WXR -> SQL or `/skip` -> explicit
  **media ZIP or `/skip`** -> generation-bound theme keyboard -> migrate-only job.
  A ZIP sent at the SQL stage is rejected before download, not interpreted as SQL.
  Sender-derived `telegram:<id>` selects the exact owner capability passed through
  async job execution. Upload/download/extraction claims stages before awaiting;
  stale work cleans only its old owned directory, never resets a new session.
- Both flows retain the entire owned upload directory until the actual job settles;
  cleanup covers extracted files as well as source WXR/SQL. Rejected admission,
  abandoned sessions, expiry and `/start` have scoped cleanup paths. Existing #25
  owns crash-durable retries, hostile concurrent ancestor swaps and worker isolation.

## Accepted archive layout and limits

ZIP only, exact `wp-content/uploads/<relative media path>`, optional directory
entries. No outer project folder, bare `uploads/`, or root files. ASCII letters,
digits, spaces, underscores, hyphens, parentheses and dots in components; no
trailing dot/space or Windows reserved device name. Supported suffixes:
`jpg jpeg png gif webp avif mp4 webm ogv mp3 ogg wav pdf`.
SVG/executables/SQL/XML and other types are rejected. Suffix admission is NOT
malware/MIME/signature/decode/source-provenance verification. Native #24 may safely
support fewer media types; unsupported report findings must still fail quality.
Remote theme archives remain disabled; no second tar/theme extractor introduced.

Shared defaults: 20 MiB compressed, 100 MiB expanded, 20 MiB per file, 2000 entries
(including directories), ten path components, 30 seconds. Standalone trusted
operator options accept positive integer overrides. Bot additionally uses its
configured download byte/time bounds; HTTP uses its existing streamed bounds.

All central paths, counts, declared sizes, regular-file modes, duplicate paths,
case-conflicting implicit parents, file/directory collisions and supported types
are checked **before writes**. Static symlink upload roots/ancestors are rejected.
Observed inflated bytes, exact sizes, CRC32 and monotonic deadline are checked
again during extraction. Timer destroys the active reader; cleanup is awaited,
not an abandoned Promise.race writer. Private fresh directories, exclusive 0600
files and 0700 parents. Extractor uses no subprocess, network or environment API.
Unreturning kernel IO and process crashes are not solved by an in-process timer.

Dependencies: pinned yauzl3.4.0 and buffer-crc32 1.0.0; @types/yauzl2.10.3;
existing fast-xml-parser4 graph reused by shared role validator. Every pre-existing
lock node is byte-for-JSON identical except job-core workspace metadata. npm's
unrelated optional/libc/zod lock churn was detected and discarded. Existing audit
advisories (17 including one critical) remain; this is not a clean-audit claim.

## Executed evidence in this checkpoint

- TDD extractor RED from first attempt retained; resumed web RED: unsupported media
  field and archive-as-WXR/SQL admission failures (three failures); bot RED: missing
  explicit media stage (three failures); static symlink-root RED reproduced write
  outside intended lexical scope before the fix.
- Cold Node20.20.2/npm10.8.2 `npm ci --legacy-peer-deps`, full build/typecheck/lint,
  full tests and all **five unchanged** coverage gates pass, with pinned Rocket
  submodule. Tests: CLI71, job-core78, bot51, web70, engine114. Five audit regression
  tests pass. Negative statements99 gate actually rejects and restores config.
- Hostile ZIP suite covers traversal/absolute/Windows/null/encoded paths, unsupported
  layout/type/compression, symlink/device/FIFO modes, duplicate/case/implicit-parent
  conflicts, truncated/non-ZIP, bad deflate/CRC, compressed/expanded/file/count/depth
  bounds, elapsed deadline, actual timer destroying a stalled reader, encryption,
  forged expansion, stored/multichunk success and idempotent cleanup. Both adapters
  have offline IO tests; added stale media `/start` and explicit-media expiry checks.
- Advisory independent diff review found no actionable security/logic defects;
  suggested media-specific timer/stale cases were added and run. This is not the
  downstream independent feature acceptance or merge authorization.
- Logs retained in `.tmp/evidence/`. Synthetic fixture PNG generated with stdlib
  zlib and verified IHDR/IDAT/IEND CRCs; archive preserves that exact byte stream.

## Remaining acceptance (do not claim done)

1. Consume actual D independently reviewed/merged native-converter reconciliation;
   preserve raw manifest/schema1, exact per-occurrence alt and canonical privacy.
2. Execute `scripts/media-archive-site.mjs`: actual BUILT authenticated web and
   grammy adapters + real runJob/migrate, original source origin offline, WXR+SQL+
   ZIP; generated Astro builds, exact referenced media bytes, per-occurrence inline
   alt + unambiguous attachment fallback, machine/human reports and absent-media
   failure. The harness denies host-process network/listeners and allowlists build
   environment, but **has not yet been exercised**; it may require corrections.
3. Wire that exercised harness into existing required generated-site CI lane after
   its prerequisite exists; rerun cold root/consumer installation/build/unchanged
   lock rebuild and current report negative/restored build matrix.
4. Final issue22/PR-08 PR, exact-head required app15368 CI plus security, independent
   review through existing downstream `t_4c838050`; no self merge. Public/credentialed
   operation remains NO-GO #19/#25/#26.
