# Hosted admission boundary (#23)

Public/credentialed hosting remains NO-GO. Authentication is not source containment, disposable worker isolation, retention, or a patched generated-site toolchain. Outstanding gates: #21 bot, #22 archives, #24 source/SSRF/generated code, #25 worker/lifecycle, #26 toolchain, #19 end-to-end acceptance. No live credentials, cloud calls, deploys or public listener were used here.

## Local contract

`createApp({ identities, limits?, store?, uploadRoot? })` takes trusted operator configuration. An identity is `{ token: string, ownerId: string }`; tokens are 32–256 URL-safe alphanumeric/underscore/hyphen characters. At most 1024 entries, unique tokens, nonblank owner strings <=128 characters. Multiple credentials may map to the same owner (shared quotas). Configuration is copied/hashed at startup. Never use a request's owner, filename, token field or project name as an identity/path.

All `/api/*` endpoints, including themes/read/list, require `Authorization: Bearer <credential>`. Empty/unconfigured auth returns 503, unknown/missing auth 401; neither enters request parsing, filesystem, store or runner. Invalid configuration fails startup. No anonymous/demo fallback, cookies, CORS opt-in, browser credential persistence or credential-bearing HTML.

The local server reads operator-supplied `DEPRESS_API_IDENTITIES_JSON`, defaults to disabled auth, binds only `127.0.0.1`, and uses `PORT` (default 3000). Invalid JSON errors never echo configuration contents. Do not expose the listener through a proxy/tunnel. No real credential is included in this repository. The previous anonymous demo form is intentionally replaced by a static boundary notice.

## Storage and pipeline integration

`new InMemoryJobStore().forOwner(serverDerivedOwnerId)` returns a stable frozen `JobStore` capability with `ownerId`, `create(input)`, `get(id)`, `list()`, `update(id, patch)`. The root has NO unscoped CRUD methods. Every persisted record contains a readonly top-level `ownerId`; create derives it from the capability, never input. Every read/list/update filters by that owner; missing and foreign IDs are indistinguishable. Updates accept only status/output/deploy URL/repo path/error, rejecting immutable identities/input/timestamps even from JS callers. All inputs/results are detached copies. Future persistent adapters must implement these same isolation semantics, not introduce an unscoped fallback. The scaffold is still in-memory, not restart durable.

`runJob(store, jobId, options)` is unchanged: callers supply an authenticated owner-scoped capability. #16's terminal-job, duplicate-run, detached async observer, trusted deployment preflight and process semantics are preserved. No changes to CLI/source conversion or bot code are part of #23; unmerged bot consumers must acquire their own authenticated owner capabilities in #21.

## Accepted upload schema

POST `/api/jobs` accepts multipart/form-data only:

- Exactly one nonempty `wxr` file; optionally one `sql` file. Client filenames are discarded.
- Required string `theme` from the existing theme registry (or `scaffold`).
- Optional `mode`: `migrate-only` or `deploy`. HTTP `deploy` returns 403 before file/job IO. There is NO deployment credential/capability in this API. Accepted jobs always persist `mode: migrate-only`.
- Optional `deployTarget`: exactly `cloudflare-pages`, `netlify`, `vercel`. This is validated metadata, NOT permission or a promise that the provider is supported. Optional `projectName`: lowercase alphanumeric first character, then lowercase alphanumeric/hyphen, total 1–63 characters. Neither field authorizes deployment.
- Duplicate/unknown/wrong-kind parts fail closed; caller `ownerId`, credentials, filesystem paths, extra fields and extra files are rejected.

Busboy 1.6.0 is a new pinned direct runtime dependency (not the separate vulnerable emulator `@fastify/busboy` package). Streaming counters enforce bounds before aggregation: total actual request bytes, each file's bytes, file/field/part counts, scalar bytes and absolute upload deadline. Actual bytes are counted regardless of missing/forged Content-Length, and a declared length must also match completed bytes. A deadline/abort cancels the reader without awaiting an uncooperative source. Multipart errors are normalized. Max 2 files, 4 scalar fields, 6 total parts, 128 bytes per scalar; parser multipart-header bound is 16 KiB per part. A sentinel count accommodates Busboy's reached-not-exceeded partsLimit event; exact six-part and exact-byte boundary tests prevent off-by-one rejection. Filenames/header bytes are also inside the total request budget.

Default configurable budgets (all finite positive integers): 10 MiB request, 8 MiB/file, 30 seconds/upload, 4 active globally, 1 active/owner, 100 admitted POSTs/global fixed 60-second window and 10/owner/window. Each active permit covers upload through runner settlement and upload cleanup. No waiting queue: saturated/rate-limited admission returns 429 + Retry-After before reading the body. Invalid admitted attempts consume rate quota, but release active permits. Quotas are per app process, not a distributed or restart-persistent security boundary; global deployment must remain disabled until #25 supplies the actual worker/queue boundary. A hung runner retains its slot, failing closed rather than over-admitting.

Only validated bounded uploads allocate a private directory under the operator root (`.tmp/uploads` default), with server-named 0600 files and private directory permissions. Uploads are removed after runner settlement/admission failure (best effort). Crash recovery, deletion retry, all output/log/artifact expiry and durable bounded storage remain #25. Public jobs omit input paths, repo paths and raw errors; no raw filesystem/provider errors are logged by this API.

## Verification

Use Node 20.20.2 and npm 10.8.2 (matching integrated CI). Cold install: `npm ci --legacy-peer-deps`; build: `npm run build`; gates: `npm run typecheck`, `npm run lint`, `npm test`, `node --test scripts/security-audit.test.mjs`, `npm run test:gate`. CI also runs real linked and cold generated-site builds with unchanged-lock reinstall/rebuild.

Regressions in web cover unauthenticated no-body-pull/no-files/no-store/no-work, fail-closed configuration, owner-separated HTTP get/list, strict schema, actual fragmented/missing/lying-length bodies, byte/count boundaries, timeout/abort, quota state transitions and runner rejection cleanup. `http-host.test.ts` exercises the actual built artifact through a real ephemeral loopback HTTP listener with fake credentials: unauthorized no-IO, chunked overflow, forged oversized length, stalled-body timeout and empty owner store. Job-core tests exercise cross-owner update denial, immutable identities, detached records and preserve #16's real pipeline/host-survival tests. No mocked cloud success is release evidence.

Lockfile additions are limited to busboy, streamsearch, @types/busboy and the web workspace manifest. All baseline entries (including the integrated Zod, nanoid and coverage versions) are preserved. npm 11 installation experimentally removed the existing peer-only Zod entry and broke the root example build; that incidental removal was restored and verified with a cold npm 10 install. This is not an upgrade/waiver of #26's toolchain gate. Existing vulnerability findings remain unresolved.
