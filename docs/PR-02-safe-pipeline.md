# PR-02 / issue #16 — safe shared pipeline

## API and behavior

The compatibility library entry points `@depress-org/depress/commands/migrate`
and `/commands/deploy` now re-export services in `packages/cli/src/services/`.
Neither service prompts, exits the process, sets `process.exitCode`, nor logs
provider output. Errors use `ServiceError.code`; successful migration returns
`{ outputDir, posts, pages }`, deployment returns `{ deployUrl, target }`.
Interactive overwrite/input prompts, environment-token lookup and exit handling
are CLI-entry-point concerns only.

`runJob` defaults to migrate-only (including existing web/bot callers).
A deployment requires BOTH `JobInput.mode = 'deploy'` and trusted server-side
`RunJobOptions.deployment`. Do not construct that option from request JSON.
Configuration/token/target/theme failures are checked before migration.
Failed/done jobs are terminal, duplicate in-process runners share a promise,
progress observers cannot turn a successful operation into failure, and only
successful validated deployment supplies a URL.

Dependency lifecycle: retain an existing package lock, or explicitly generate
one first; run `npm ci --ignore-scripts --legacy-peer-deps`; then run the build.
The generated lock must be retained with the output for reproducible subsequent
installs. Initial resolution of an unlocked theme is NOT reproducible across
time. Operator-installed npm is resolved before running generated code.

Children use argument vectors and `shell: false`, closed stdin, limited output
(default 1 MiB), deadlines (120 seconds default, 300 seconds install/build),
process-group termination on Linux and a maximum of two active children per
process. Build/conversion environments are allowlisted with isolated temporary
HOME/npm config/cache; ambient provider/npm/git credentials are not inherited.
Build Node heap is capped at 1024 MiB (install/conversion remain 512 MiB).
The real cold Keystatic build exhausts the old 512 MiB build cap. Neither cap
bounds native memory. No raw provider stderr/stdout enters jobs.

Cloudflare's installed Wrangler is invoked via its absolute JS entry, never
`npx` from generated content. Only static `dist` artifacts (no symlinks) are
copied to a separate scratch cwd; the token is added only for this adapter.
Netlify/Vercel fail closed pending trusted static-artifact adapters. Non-bundled
remote themes fail closed pending replacement of the old unbounded shell
fetch/extract helper. Bundled themes and scaffold remain supported.

## Executable evidence

- `packages/cli/src/__tests__/safe-pipeline.test.ts`: original RED on main
  19f239e: four failed assertions covering missing-token false success/global
  exitCode, unsafe project input, shell-interpreted argv, hostile URL suffix;
  missing-input attempted process.exit. All five pass after service extraction.
- `deploy.test.ts`: local mocked install/build/provider failure matrix,
  missing URL, sanitized env, trusted cwd/token boundary; real process timeout,
  output limit, executable failure and concurrency cap. No provider is called.
- `migrate-service.test.ts`: real wp2md/scaffold conversion, simultaneous
  separate outputs, malformed XML/SQL, unknown theme, nonempty-output rejection;
  detects wp2md's upstream error handler that otherwise exits zero.
- `packages/job-core/src/__tests__/pipeline.test.ts`: mode/preflight, success
  URL/stages, failed-stays-failed, duplicate runner, observers, concurrent jobs.
- `integration.test.ts`: real success alongside malformed XML/SQL through the
  shared host API, without process termination or global exit-code changes.
- `scripts/cold-consumer.mjs`: fresh nested generated site, real registry lock
  generation, `npm ci --ignore-scripts --legacy-peer-deps`, actual Astro build,
  rendered titles/bodies and draft exclusion, then another clean install/build
  with byte-identical retained lock. No symlinked root dependency tree. Run with
  Node 20.20.2 / npm 10.8.2 after building migration packages. The existing
  `Generated fixture site` required CI job now runs this in addition to its
  linked fixture. Generated `posts` counts editable source drafts too, not only
  public articles; public draft leakage is checked in HTML/routes separately.
- `scaffold.test.ts`: extends PR8's Astro/React grouping to include Keystatic;
  the nested dependency graph otherwise fails `_renderer0` initialization despite
  the linked fixture passing. Existing PR8 worker/scaffold fixes are preserved.
- `tests/fixtures/service-export.xml` is explicitly synthetic local test data,
  not user/market evidence; it has no remote media.

## Boundaries / NO-GO for production

This is process hygiene, NOT an OS security sandbox. Generated build scripts
still execute as the host user and must not receive untrusted tenant code in
production without filesystem/network/CPU/memory isolation. The heap cap does
not bound all native memory. The semaphore and duplicate-run lock are
in-process only, not durable/distributed admission control. Full SQL grammar,
per-item migration manifest/loss checks, remote media SSRF/archive hardening,
provider rollback and durable worker ownership remain separate work.
No live deployment, token access, release, npm publication or production change
is part of these checks. Mock deploy success is not evidence of a real deploy.
