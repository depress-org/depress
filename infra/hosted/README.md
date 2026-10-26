# Private bounded hosted runtime — #25

Canonical: <https://github.com/depress-org/depress/issues/25>. **Public/credentialed production remains NO-GO.** This is source configuration and a disposable-runner implementation, not a deployed service or production approval. The existing web/bot entrypoints remain explicitly local scaffolds; do not run them as the hosted worker boundary.

Preserved initial checkpoint `b8e5712`, normally reconciled with reviewed main `b3a8e65`. Operator authorization covers source/PR/workflow and disposable GitHub-hosted OCI + fake-only PostgreSQL tests within existing quotas. It does not authorize shared Rocky Docker/cgroups, host security changes, production listeners/configuration, credentials, provider deployment, publishing images/packages, or spending.

## Architecture and trust

- `http.mjs` / `server.mjs`: dedicated authenticated admission/read/cancel/preview adapter. Imports the existing #23 streaming multipart/auth/admission modules, NOT the CLI/job pipeline. No Docker socket or provider credential belongs in this process. `server.mjs` binds only where explicitly called; the integration uses loopback. No production TLS/proxy deployment is supplied.
- `queue.mjs` / `schema.sql`: dedicated PostgreSQL bounded queue with immutable owner identity, transactional global/owner/byte admission, one running slot, lease fencing, cancellation, expiring artifacts/metadata and durable cleanup attempts. `forOwner(serverDerivedOwnerId)` is the only request-facing capability; it cannot patch ownership/status/path fields. The root queue is trusted controller authority. It does not replace the existing #23 JobStore used by `runJob` inside a workload.
- `runtime.mjs` / `controller.mjs`: trusted socket-owning broker and **independent reaper process**. Claim and deterministic job+lease name precede creation. Per-job DB advisory locks serialize create/start/removal across controllers; immutable container IDs and verified job/lease/image/labels scope removal. A removed ID cannot be restarted by a delayed attach. Capacity and inputs are released only after confirmed removal. Removal failure retains the running slot and increments a durable retry counter.
- `control.mjs`: CI-only executable guard, separate broker/reaper roles. During DB outage the reaper discovers only its configured image's owned workloads and removes them; new claims/start require DB availability. On restoration, expired/fenced rows reconcile. No raw DB/runtime errors are logged. Image replacement while jobs exist is not supported: retain the configured image and reaper through terminal reconciliation; a production upgrade/runbook requires a separate gate.
- `workload.mjs`: one private credential-free disposable workload. Reuses #22 archive ingestion, #24 native safe conversion and existing owner-scoped `runJob`; builds through #16 `buildSite`/`defaultSpawn`. The only process-helper extension is bounded optional stdin, with no shell or argv interpolation. SQL is parsed, never executed.
- Inputs and artifacts are bounded owned DB bytes. Workloads receive JSON on stdin and return one bounded structured artifact envelope. There is no host mount, host upload/output tree, `docker cp`, or host extraction of workload output. Workload-controlled ancestors cannot race controller deletion because no such filesystem is shared. Public artifacts never interpret paths on the host.

## Fixed initial limits

| Boundary | Source policy |
|---|---|
| Durable queue | 32 retained rows globally, 4 per owner (including terminal metadata), 16MiB total serialized input+artifact bytes; serialized admission/claim/finish/sweep |
| Upload | #23 bounded streaming multipart, 1.5MB actual body, 1MiB combined decoded files, 10s; four global durable upload reservations / one per owner, plus process-local request/rate caps |
| Execution | one running/stopping job across controllers; nonroot65532, readonly root, no mounts/devices/socket/ports, network none; private PID/IPC/cgroup namespaces, init, cap-dropALL, no-new-privileges, default seccomp and AppArmor required |
| CPU/process/memory | 1 CPU quota, 120 CPU seconds per process, PID64, memory2GiB and no additional swap, FD128, file160MiB, core0. Pinned public workerd is140383608 bytes; original128MiB failed real offline npm ci with EFBIG. Exact-size positive and above160MiB negative controls retain the file boundary; no other budget increased. |
| Writable filesystem | work tmpfs1GiB/65536 inodes; tmp16MiB/128 inodes; shm16MiB. Work permits execution because esbuild/native build tools require it; noexec is not an interpreter sandbox. Writable memory counts against the cgroup. No host persistent writable workload layer. |
| Time/logs | 180s whole-job deadline enforced by separate reaper; #16 attached capture bounded. Docker log-driver none: raw workload logs are never persisted/exported; observers/API expose fixed statuses only. |
| Lifecycle | queued abandon10min; all input/XML/SQL/ZIP/intermediate data removed from live DB after terminal removal; artifact15min, metadata1h. Reaper runs every250ms; deletion retries retain capacity. |
| Preview | separate-site origin (not a sibling bullwinkle.space subdomain), distinct preview credentials; owner+job+digest+expiry on every read. No URL/cookie tokens/CORS, no-store/nosniff/no-referrer, CSP HTTP sandbox without scripts/same-origin/forms/objects/connect, no service workers. Browser-native Basic auth (`preview` / preview credential) or bearer authentication. No iframe embedding. |

Only scaffold is admitted until other themes have separately proven offline graphs/budgets. Trusted public dependency preparation occurs during CI image build, never in a credential-bearing job. The image has no inherited base Env/volumes, and is addressed by locally inspected immutable image ID. `prepare-cache.mjs` prepares the exact scaffold lock/cache; builds must match that dependency graph and run offline. Missing cache/content fails closed; remote media is not granted network access. The production image supply-chain review and digest selection remain human-gated, not implied by a digest alone.

CF14 output is Workers. A full-output-aware trusted workload returns **preview-only** client files, never relabels stripped client output as a deployable static artifact. Strict envelope/path/count/byte/MIME validation, content digest and ownership are server-selected. Reports/source manifests/inputs/host paths/raw logs are not exported. The current 1MiB artifact budget intentionally fails large sites rather than returning truncated success.

`deploy-capability.mjs` is a fake-tested, single-use owner/job/digest/exact-target/expiry capability seam, not a provider implementation or an HTTP mint endpoint. Credentials can exist only inside an injected deploy-only closure. Preview-only artifacts are rejected. #38 owns durable provider protocol/idempotency/rollback; its unreviewed branch is not consumed. No real provider transport is wired or invoked.

## Storage and deletion meaning

The CI database sits on its own 512MiB loop-backed ext4 filesystem, mounted only on the disposable runner. PGDATA is an empty child directory, not ext4's lost+found root. This supplies an independently exercised physical disk ceiling in addition to logical queue bounds and survives container restart. **Never mount or format a shared-host volume using this workflow.** A future production database requires its own dedicated quota, access control, encryption/backups/retention and operational acceptance; the source queue is not a proof of a provider's physical erasure guarantees.

Expiry deletes live owned rows/bytea, not forensic WAL/dead-tuple/backups erasure. No source content is put into public error/audit records; database logging must remain statement/content-free. The runner's destruction ends test volume/log lifetime. No claims about secure erase, host-kernel isolation from a hostile kernel exploit, microVM equivalence or production readiness are made.

## Executable evidence and remaining gate

Local Node22.23.4/npm10.8.2: cold root installation; build/typecheck/lint; canonical494 workspace tests with five unchanged coverage gates; security5; initial43 source-policy tests PASS. Preliminary independent source review found a deployment-capability race/expiry flaw and ext4 PGDATA initialization issue; fixes and concurrent/late-expiry/effective-ulimit tests bring the source suite to47 PASS. This is not runtime proof.

`.github/workflows/private-worker.yml` builds local worker/probe images without publishing, provisions only a fake Postgres instance and runs `integration/runtime.test.mjs`: actual FS/network/cgroup/CPU/memory/process/FD/disk/log probes; queue bounds/fencing/restart; broker SIGKILL/independent reaper/DB outage/cancel/retry; unrelated container preservation; real authenticated HTTP to runJob+offline build, private artifact expiry and browser active-content isolation. Raw fake-only results and screenshot have three-day CI retention. Tests hard-fail outside the explicitly authorized GitHub disposable/fake fixture.

Until actual CI logs, negative-control evidence and the same-card independent QA review are accepted, #25 is **incomplete**. Do not substitute profile/config tests for OS proof. No merge or deployment is authorized by this source checkpoint.
