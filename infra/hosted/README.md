# #25 checkpoint — NOT a completed worker boundary

Baseline: merged Integration D `c70ad9a23b57f4d012e2e3a10ef5c88800b3e7f0`.
Canonical acceptance: <https://github.com/depress-org/depress/issues/25>.

**Public/credentialed hosted operation remains NO-GO.** This directory contains a tested, source-level OCI profile renderer and image-default metadata validator only. No launcher, queue, image, daemon configuration, service, public listener or deployment has been created. It is not wired into API/bot execution. Do not treat passing profile tests or this checkpoint as #25 acceptance.

## Actual verified work

- Read canonical #25, PR-03 audit, integrated #16 process helpers, #23 owner capabilities, #24 converter/report boundaries, and original architecture decision `t_d850a35e`.
- Fresh isolated clone and branch `security/25-private-workers`; main and upstream implementations unchanged. Pinned Rocket submodule initialized at its existing committed revision.
- Cold install with Node 20.20.2/npm 10.8.2: `npm ci --legacy-peer-deps` PASS. Existing dependency advisories are not waived or fixed.
- Existing `npm run build`, `npm run typecheck`, `npm run lint`, security audit regressions 5/5 PASS.
- Existing canonical `npm test` with submodules: 418 passed across CLI103/job-core33/bot47/web63/engine172, five existing coverage gates PASS. An earlier run without the Rocket submodule had 405 tests; it is superseded by the submodule-complete run, not misrepresented as 418.
- `node --test infra/hosted/worker-profile.test.mjs`: 34/34 PASS under Node20. This is a separate explicit contract suite, not yet added to root test/CI scripts.
- Mutation proof: copy the current profile and tests into `.tmp/profile-mutation`; change network `none` to `host`. Same suite exits1 with the filesystem/network boundary test failing. Original source remains unchanged and green.
- Independent short reasoning/source review found no blocking defect in the limited renderer scope; this is NOT the board's final independent implementation review or runtime attestation.

## What the profile requests (not runtime-proven enforcement)

`createWorkerArgs({jobId, leaseId, imageId}, inspectedImage)` returns `docker create` arguments; it never invokes Docker. All options and IDs are validated; the broker must obtain the inspection metadata itself for its explicitly approved image, not trust request data.

- Locally pinned immutable image ID, pull never; exact allowed image environment and no declared anonymous volumes. A digest and metadata checks do not audit image provenance or image files for secrets.
- Nonroot65532, readonly root, no host paths/volumes/devices/socket/ports, no network, private IPC/cgroup/default PID namespaces, init reaping, all capabilities dropped, no-new-privileges; default runtime seccomp/LSM still must be verified.
- One CPU quota, 2GiB RAM with equal memory+swap setting, PID64; 120-second **per-process** RLIMIT_CPU, FD128, individual file32MiB, no core dumps.
- Work tmpfs512MiB/4096 inodes; `/tmp`16MiB/128 inodes; shared memory16MiB. `TMPDIR=/work/tmp` consumes the work budget, not the separate `/tmp` budget. Aggregate RAM/disk/CPU still need real runtime checks and admission budgets.
- Local driver rotation1MiB/max-file1/compression off, not an exact total host-disk bound. It is neither public redaction nor lifecycle expiry.
- The proposed 180-second wall clock is a policy constant only: the durable broker/reaper must enforce it. No pretend timeout enforcement.
- Fixed credential-free/offline workload environment. CLI argument additions do not erase image-baked Env, hence the mandatory metadata validation. Image entrypoint/rootfs remain trusted-image review responsibilities.

## Established architecture, not a new decision request

Preserve the existing Postgres jobs-table/single-worker recommendation and `forOwner(serverDerivedOwnerId)` semantics. Retain #16 `defaultSpawn`/typed process contracts and #24 conversion/report behavior; do not introduce a second extractor or weaken the converter. A runtime socket belongs only to a narrow trusted broker, never the credential-bearing API/bot or job. Each workload has a private disposable tree; no hostile job can rename controller ancestors if it cannot mount them.

Deny-default network is the initial boundary. Current `buildSite` creates a lock and installs dependencies, so builds need a separately prepared trusted offline cache/image. Remote media or uncached installs must not silently get unrestricted network. Validate that conservative cache/resource budgets actually support the chosen themes; do not turn resource failure into success or mislabel a skipped build as accepted. No deployment capability is authorized by this checkpoint.

## Genuine remaining authorization gate

Read-only discovery found a shared rootful Docker29.8.1 daemon (`/var/lib/docker`, builtin seccomp/AppArmor, cgroupv2, no rootless SecurityOptions). Bubblewrap0.11.1 namespace launch succeeded, while a separate user-namespace `uid_map` probe failed EPERM. The current gateway service's own cgroup is writable; the cgroup root is not. This is **not** proof that no rootless implementation is possible. It is also not permission to change gateway cgroups or use the shared daemon for adversarial resource tests. No images/containers were inspected for secrets, and none were created or started.

Ask Bullwinkle for one narrow permission, not a queue redesign:

1. **Recommended:** authorize ephemeral OCI + fake-credential Postgres integration tests on disposable GitHub-hosted runners, including adding the source workflow; no shared-host Docker use, live secrets, cloud deploys, public listeners or spending commitments.
2. Alternatively, provide/authorize a dedicated disposable VM/rootless runtime for those tests. No host-service/security configuration changes without separate approval.

Until that permission is explicit, do not infer it from a request for a PR/exact-head CI or repurpose the shared daemon. Source coding is possible; the unresolved issue is permission to exercise and prove the complete boundary, not a fabricated technical inability to write a queue. This card is incomplete and must not be completed or handed off as reviewed implementation.

## Acceptance still NOT implemented/verified

| #25 requirement | Remaining work |
| --- | --- |
| Durable bounded queue | Postgres implementation, transactional global/per-owner admission, immutable owner capabilities, bounded rows/bytes, atomic claim, fencing/leases and idempotency; real DB concurrency/restart tests |
| Disposable workers | Trusted secret-free image and broker; actual cgroup/namespaces/FS/network/process/CPU/memory/disk/log/time probes; real migration/build through existing runJob/process API |
| Cancellation/crash/abandon | Durable cancellation and reaper; kill exact fenced worker before releasing capacity; broker/worker/DB failure and restart probes |
| Private lifecycle | Owned XML/SQL/media/intermediate/artifact/log storage, success/failure/abandon expiry, contained deletion with durable retries; unrelated-path and ancestor-swap tests |
| Redaction/public output | Minimal typed public statuses, bounded redacted logs, verified public artifact allowlist; fake-token/raw-path/stdout/stderr negative tests |
| Preview | Separate authenticated active-content origin and owner-bound artifact reads, restrictive CSP/cookie/CORS/service-worker isolation; real two-owner HTTP/browser tests |
| Deploy-only capability | Bind approved owner/artifact digest/target/project/expiry, trusted static-artifact-only deploy adapter, audit trail; no live provider calls or approval implied |
| Delivery | Focused PR refs#25, exact-head CI and independent board review; no selfmerge or production rollout |

Raw local logs are under `.tmp/`: install25.log, baseline-gates25.log, baseline-tests25-with-submodules.log, worker-profile-tests.log and profile-negative25.log. No token values or live secret data belong in durable handoffs.

## References

- <https://docs.docker.com/engine/security/rootless/>
- <https://docs.docker.com/engine/containers/resource_constraints/>
- <https://docs.docker.com/engine/logging/drivers/local/>
