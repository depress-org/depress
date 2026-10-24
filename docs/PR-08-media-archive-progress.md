# PR-08 / #22: independent extractor checkpoint (NOT integrated)

This is partial implementation, not completion or production approval. Neither web
nor bot accepts this archive yet. Integration C `t_d63a429f` must independently
review and merge the report/bot prerequisites before adapter integration resumes.

Development stack only: report PR34 b5ebf3bfc0add6af103ef0537e36f96d19db6f01,
bot PR14 bcdb0cd435cb4928f47dc3e300052a9a746c8b69, main #23
692704a0595032037e960769888ff381ad9d27a3. Parents were CI-green but NOT
independently approved/merged when this checkpoint was written. No main merge,
parent approval, full root verification, remote CI or archive E2E claimed.

## Implemented independent internal module

`packages/job-core/src/media-archive.ts` accepts a bounded ZIP buffer and a
server-owned upload directory. It returns a freshly owned WordPress root suitable
for JobInput.mediaDir (contains wp-content/uploads) and idempotent cleanup.
Callers MUST use their own authenticated upload scope, never client-selected paths,
and retain ownership until jobs/downloads settle. No public index export yet.

Accepted ZIP layout is exactly `wp-content/uploads/<relative media path>` with
optional directory entries. No extra parent WordPress/project directory; no bare
uploads/ or root files. ASCII letters, digits, spaces, underscore, hyphen,
parentheses and dots in components; no trailing dots/spaces or Windows device
names. Supported suffixes: jpg/jpeg/png/gif/webp/avif/mp4/webm/ogv/mp3/ogg/wav/pdf.
SVG, executables, SQL/XML in ZIP and other file types are explicitly rejected, not
reported as migrated. This is filename/type admission, NOT malware/content scanning.

Defaults: 20 MiB compressed, 100 MiB expanded total, 20 MiB/file, 2000 entries
(including directories), 10 path components, 30 seconds. Trusted operator options
may override positive integer limits. Stored and raw-deflate ZIP entries only.
All central paths, counts, declared sizes, regular-file modes, duplicate names,
case-conflicting implicit parents, file/directory collisions and supported types
are checked before any filesystem writes. Extraction separately bounds observed
bytes, validates declared sizes and CRC32, checks elapsed monotonic time and
cancels the reader on timer expiry. Paths are contained under a newly created
private directory; no external filenames are passed as arbitrary destinations.
Failure removes only that newly created directory. Files use exclusive mode 0600;
parent directories 0700. Extraction has no subprocess/network/environment API.
Filesystem IO that cannot return and process crashes are not solved by an in-process
deadline; durable cleanup/isolated workers remain #25. No host sandbox claim.

Dependencies pinned: yauzl 3.4.0 and buffer-crc32 1.0.0. Initial 3.2.0 was rejected
after actual npm audit reported GHSA-gmq8-994r-jv83; 3.4.0 has no matching archive
package advisory in the captured audit. Existing unrelated audit findings remain;
no broad security-green claim. Existing lock graph preserved (including zod).

## Executed independent evidence

RED: new module test initially fails collection because media-archive.js is absent.
GREEN: Node 20.20.2, build + typecheck of job-core, 61 job-core tests and unchanged
job-core coverage gate pass. The suite includes hostile ZIP generation without
external ZIP utilities/network: traversal/absolute/Windows/null/encoded paths,
unsupported layout/suffix/compression, symlink/device/FIFO, duplicate/case-conflict
and parent-file conflict, truncated/non-ZIP, bad deflate/CRC, compressed/expanded/
per-file/count/depth limits, elapsed monotonic deadline, encryption and forged
expansion, directory/stored/multi-chunk successful extraction and cleanup.
Raw logs in `.tmp/evidence/archive-{red,green}.txt`; audit JSON alongside them.

## Resume checklist (remaining original acceptance)

1. Read Integration C exact reviewed outcomes and actual merged main; consume that
   baseline, not these unreviewed parent candidates. Cherry-pick ONLY the extractor
   checkpoint commit onto reviewed main; preserve current #24 source fixes and
   authenticated Telegram owner-scoped JobStore API. Coordinate package-lock hotspot.
2. Export shared ingestion API; use it from web multipart media field and explicit
   bot awaiting_media + /skip stage; keep SQL/WXR/media role validation separate.
3. Cleanup failure/abandon/start/generation/job ownership and pass validated mediaDir
   into shared migration, without duplicated converters. Honor #18 per-item alt QA.
4. WXR+SQL+archive with original source offline, actual installed/built Astro output,
   referenced byte/name/alt checks plus truthful JSON/Markdown report and missing-file
   report; real adapter tests; no external services or production secrets.
5. Full cold CI-Node root build/typecheck/lint/all tests/unchanged gates/security,
   generated consumer build, issue22/PR-08 commit+PR, exact-head required CI.
6. Independent review through existing downstream graph; no self merge/deploy.
