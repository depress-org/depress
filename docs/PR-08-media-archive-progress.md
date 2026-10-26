# PR-08 / #22: shared WordPress media archive ingestion

Both authenticated web and private allowlisted bot call the **same** ZIP
validator/extractor and pass its validated WordPress root as `JobInput.mediaDir`
to the existing owner-scoped pipeline/native converter. Source export + files is
original product scope, not a paid-only feature. Independent final QA is requested
through existing `t_4c838050`; this document is not production or merge approval.

## Reviewed prerequisites

Bot14 reviewed `525b04c` merged `fb9f4a6`; report34 reviewed `08fda090` merged
`95bab420`; docs31 retained. The independent extractor checkpoint `f00b5ff` was
cherry-picked as `b96cdba` on that reviewed C baseline; obsolete parent stacks were
not replayed. Resumed PR35 consumes D's independently accepted PR33 `0fb093c`
merged as `c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0` via normal integration merge.
Parent reviews, merged state and all three D main checks freshly read from GitHub.
No native conversion, serialization, manifest/report/privacy implementation changed
by #22. No parent self-merge, deployment, real credentials, publication or protection
changes. Preserve source/owner semantics when integrating other branches.

## User-facing contract

- **Web:** authenticated `POST /api/jobs`, required multipart file `wxr`, optional
  files `sql` and **`media`** (ZIP), required text `theme`. Omit `media` to skip;
  empty/malformed media is an error. Three files plus four existing metadata
  fields, seven parts, no duplicates. Existing streamed request/file/deadline and
  owner admission limits remain (default 8 MiB/file, 10 MiB/request).
- **Bot:** private allowlisted actor: WXR -> SQL or `/skip` -> explicit media ZIP
  or `/skip` -> generation-bound theme keyboard -> migrate-only job. ZIP in SQL
  stage is rejected before download. Shared content-role validation rejects binary
  archives disguised as XML/SQL irrespective of filenames/MIME.
- The server-derived `telegram:<senderId>` capability remains identical through
  create/runJob; no anonymous fallback. Each async stage claims its state before
  awaiting and checks generation/job identity afterward. Stale work owns only its
  prior directory and cannot reset or clean another session.
- The full owned upload directory (including extracted files) is retained until
  migration settles. Rejection, expiry, abandon, `/start` and terminal paths clean
  their own scope. #25 still owns crash-durable cleanup/hostile concurrent FS and
  OS process isolation; this library is not a sandbox.

## ZIP layout and limits

Exact `wp-content/uploads/<relative-media-path>` with optional directory entries.
No outer project folder, bare `uploads/`, root files, traversal, absolute or Windows
paths. Components use ASCII letters/digits/spaces/underscores/hyphens/parentheses/
dots; trailing dot/space and Windows reserved devices are rejected. Allowed suffixes:
`jpg jpeg png gif webp avif mp4 webm ogv mp3 ogg wav pdf`.
SVG/executables/SQL/XML/other suffixes are rejected. Suffix admission is NOT malware,
MIME, decode or provenance proof. Native #24 supports referenced raster media only;
a safe ZIP containing a referenced unsupported PDF fails job/report quality rather
than being called a successful migration. Remote theme archives remain disabled;
no competing tar/theme extractor was added.

Shared defaults: 20 MiB compressed, 100 MiB expanded, 20 MiB/file, 2000 entries
(including directories), ten components, 30 seconds. Trusted operator overrides
must be positive safe integers. Bot and HTTP limits apply first.

All central paths, modes, counts, declared sizes, duplicate/case-conflicting
implicit parents and file/directory collisions are checked before extraction writes.
Static symlink upload roots/ancestors are rejected. Actual inflated bytes, CRC32,
exact declared sizes and monotonic deadline are rechecked. Timeout destroys the
active reader and awaits cleanup, not a Promise.race leaving writes alive. Fresh
private 0700 owned directories, exclusive 0600 files. No subprocess/network/env API
in the extractor. Unreturning kernel IO and process crash are not solved by timers.

Dependencies: pinned yauzl3.4.0, buffer-crc32 1.0.0, @types/yauzl2.10.3, pend;
existing fast-xml-parser reused. Programmatic lock comparison preserves every
pre-existing node except `packages/job-core` metadata and adds only those four nodes.
Five coverage configurations/thresholds unchanged. Root install still reports 17
advisories including one critical; five security tests do not imply clean audit.

## Reproducible verification

Use CI Node20 (`.nvmrc`), npm10.8.2 and recursive pinned submodules:

```sh
npm ci --legacy-peer-deps
npm run build
npm run typecheck
npm run lint
npm test
node --test scripts/security-audit.test.mjs
npm run test:gate
npm run test:integration
npm run test:media-archive
node scripts/cold-consumer.mjs
```

Fresh Node20/npm10 cold build/typecheck/lint, **474 tests** (CLI103, job-core78,
bot51, web70, engine172 including pinned Rocket), five unchanged gates, security5
and actual negative statements99 rejection/restoration passed. Historical TDD RED
logs retained: missing extractor, web unsupported media/archive-as-WXR/SQL3,
bot missing stage3, symlink-root1 before fixes. Hostile tests include traversal,
absolute/Windows/null/encoded paths, symlink/device/FIFO modes, duplicates/case/
implicit-parent/file-directory conflicts, truncation/non-ZIP/bad deflate/CRC,
compressed/expanded/file/count/depth/time bounds, forged expansion/encryption,
real stalled-reader cancellation/no late writes, valid stored/multichunk CRC,
stale media `/start`, expiry and scoped cleanup. No external services needed.

`scripts/media-archive-site.mjs` exercises actual BUILT Hono + grammy adapters,
real scoped runJob and native conversion, synthetic WXR+SQL+uploads ZIP with original
origin `https://original-source.invalid`. It disables host-process HTTP/HTTPS/fetch/
connect/listen during migration; Telegram transport is synthetic, NOT mocked
runJob. No origin server or fallback HTTP service is started. Web generated output
gets real fresh registry install/build and same-lock npm-ci/rebuild; bot generated
output uses installed root-locked dependencies. It checks exact built media bytes,
three ordered rendered inline/attachment-fallback alt occurrences, source URL
replacement, schema1 JSON/human report/validator, reports outside public `dist`,
owned cleanup and truthful no-live-URL response. Missing archive and admitted ZIP
with unsupported referenced PDF must fail real item/report/job quality.

A synthetic secret canary is set **before migration**; artifacts are checked for
its absence and each child receives only an explicit allowlisted environment.
Build children are NOT OS-network-sandboxed: registry network for installation is
expected; the original-origin offline claim applies to adapter/migration IO, not
all descendant networking. This is not #25 worker-isolation acceptance.

The existing required `Generated fixture site` CI lane now builds both adapters
in dependency order and runs the exercised archive harness, retaining original
body/image/privacy/native controls and independent cold consumer lane. Original
`Build & type-check` and security lanes remain. Remote exact-head status and final
raw evidence are recorded in the PR and task handoff, never inferred from old
checkpoint lanes that did not execute archives.

Independent advisory diff review found no blocking security/logic error; its
canary timing, unsupported-source negative and networking-claim suggestions were
addressed. This is not the final downstream feature review. PR35 stays unmerged
until independent QA accepts the exact CI-green head. Public/credentialed hosting,
full default AstroWind/toolchain, plugin compatibility and broad product acceptance
remain NO-GO under #25/#26/#19 and their existing owners.

Local raw logs are retained in `.tmp/evidence`. An npm11 installation experiment
failed the root build with missing zod; canonical npm10 cold reinstall/build passed.
An extended harness tool invocation timed out during final cleanup after printed
assertion passes; that invocation is not counted as an exit-zero acceptance run.
Final acceptance uses completed runner exit codes and exact-head remote checks.
