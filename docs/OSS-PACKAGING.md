# OSS package contract (#36 / PR-05)

This fixes the **artifact boundary**, not generated-site security/readiness (#26),
registry availability, deployment, or release approval. No npm publication is part
of this change. PR-05 acceptance at #39 remains the historical NO-GO measurement.

## What ships

The three public packages remain `0.1.0`. The CLI depends on core and engine, and
engine on core, using **`^0.1.0`**: compatible `>=0.1.0 <0.2.0` releases only.
Future incompatible public-contract changes must move to a new minor line and
update dependent ranges deliberately; publish core before engine before CLI only
through a separately authorized release. The local regression supplies all three
real tarballs explicitly. It makes **no claim** about public registry availability.
No `workspace:`, `file:`, or `link:` specifiers belong in their runtime manifests.
The lockfile change is exactly three existing workspace range fields; resolved
versions/integrities/archive dependencies are not refreshed here.

- Built runtime JavaScript/declarations/maps, package metadata and project MIT
  notices ship in all three packages. Compiled `__tests__`, `__fixtures__` and
  `*.test.*` outputs do not ship, even if left behind in `dist` by an earlier build.
- Engine additionally includes a bounded **AstroWind** allowlist: config/package
  files, `src` runtime/assets (excluding demo `src/data`), vendor integration,
  `public/robots.txt`, `public/_headers`, upstream README and unchanged MIT notice.
  No theme git metadata, CI config, node_modules, deployment presets or Decap CMS
  payload is included by this allowlist.
- **Rocket assets do not ship**, even when its pinned submodule is initialized.
  Its adapter requires executable MDX and is disabled under #24. The compiled
  adapter remains available to preserve the existing public API and truthful
  rejection. Remote downloads and untrusted MDX remain disabled; no policy has
  been relaxed to make a consumer test pass.

## Executable regression

Use Node20/npm10 (the existing CI `.nvmrc` matrix), initialize submodules, cold
install, then build the public packages:

```sh
npm ci --legacy-peer-deps
npm run build --workspace=@depress-org/core --workspace=@depress-org/wp-migrate --workspace=@depress-org/depress
npm run test:oss-packaging
npm run test:oss-consumer
```

`test:oss-packaging` is a **bounded packaging/scaffold** CI gate, not a renamed
release gate. It packs real tarballs, verifies manifests/file inventories and
byte-identical licenses, installs all three into an external nonworkspace consumer,
executes its real binary, tests default and scaffold CLI/library parity,
malformed-then-valid isolation and #24 negative controls, then performs real fresh
registry installs and installed `check` builds of scaffold and local-media sites.
It verifies generated posts/pages/body/draft omission, Yoast title+description,
three per-occurrence media alts, exact copied PNG bytes and private reports outside
`dist`. Consumer reinstall uses unchanged package-lock bytes and repeats installed
resolution/bin checks.

Evidence stays in a unique checkout `.tmp/oss-consumer-*` (`result.json`, raw
command logs, actual tarballs and their SHA-256 inventories). Installed consumer
and its HOME/TMPDIR live in a unique **sibling** `.tmp/oss-installed-*`, outside the
checkout's `node_modules` ancestry. Inherited dependency-bin PATH entries are
removed; a root-only Vitest resolution must fail before install. Public package
exports and the bin must realpath inside this consumer before and after reinstall.
Registry installs are intentional; migration's in-process network denial is not
an OS/descendant security sandbox. Evidence contains only synthetic fixture data.

`test:oss-consumer` adds **strict default install/build/check acceptance**. It
exits nonzero if the actual default build/check does not pass. Both commands run
and record the same real default install/check; bounded mode does not rewrite
nonzero command results or default quality reports. `releaseGate` remains explicit
NO-GO while #26 is unresolved, even when packaging/scaffold passes. `--pack-only`
performs only artifact assertions and must not be called consumer acceptance.
CI uploads raw JSON/logs even on failure and leaves all five existing coverage
gates, hostile controls and required job definitions unchanged.

## Independent acceptance boundary

Missing assets previously caused installed default migration to fail before theme
provisioning. Restoring assets does not establish default theme feature parity:
the current adapter cannot preserve every source page, and its installed
toolchain/build/check may fail independently. Inspect `default-install.log`,
`default-check-build.log` and probe's unmodified canonical report validation.
Those failures belong to #26, not to a packaging assertion exception or a broad
lockfile/toolchain upgrade here. The independent #36 QA lane must verify the actual
PR/head, new bounded gate, strict NO-GO evidence and existing required CI before
integration. The author must not self-merge or publish.
