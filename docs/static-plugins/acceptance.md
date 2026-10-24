# Fixture acceptance and audit evidence

This file separates **executed current-main observations** from **proposed implementation acceptance**. Source baseline: `19f239e507bb9b4beaa8ff9273560ba6f2aa5360`; Node `20.20.2`, npm `10.9.9`; execution date 2026-10-24 UTC. The PR is docs-only. Nothing here claims that the proposed plugin hooks exist.

## Executed in this task

Fresh isolated clone and pinned Rocket submodule initialized. Commands:

```sh
# Run at repository root; Node/npm pinned to CI's Node major.
npx --yes --package=node@20 --package=npm@10 -c 'node --version && npm --version && npm ci --legacy-peer-deps --ignore-scripts && npm run build && npm run typecheck && npm test'
```

Results: install/build/typecheck/test all exited `0`. Local install deliberately disabled dependency lifecycle scripts; remote repository CI is a separate exact-head check, not inferred from this run. Test suites: CLI 24, job-core 8, web 7, wp-migrate 49 = **88 passing tests**. Root example build warned its articles/pages collections were empty, image service was noop, and chunks were large. It is **not** a cold generated-site build or evidence of plugin support; #19/#26 own those gates. No converter media requests, deployment or PHP execution were made by the audit probes below.

A local, gitignored `.tmp/plugin-audit.mjs` called real built engine functions against the existing WXR plus explicitly synthetic fixtures (ID 901, title/author sentinels, `customFields.fixture_field`, gallery IDs 11/12, unknown widget attr 42). It checked output files with `node:assert/strict`. Synthetic IDs/values are test inputs, not users, plugin demand or migrated customer data. Actual observations:

```json
{
  "sourceSummary": {
    "rawItems": 6,
    "types": {"post": 3, "nav_menu_item": 1, "attachment": 2},
    "parsedPosts": 3,
    "parsedMedia": 2,
    "seoTitles": 1,
    "seoDescriptions": 2
  },
  "direct": {
    "seoPreserved": true,
    "customFieldsEmitted": false,
    "galleryIdsRetained": false,
    "unknownInnerRetained": true,
    "unknownAttributesRetained": false
  },
  "stage2": {"articleCustomFieldsEmitted": false, "pageSeoTitleEmitted": false},
  "themes": {
    "astrowind": {"pagesDir": null, "pagesInjected": 0, "seoMapped": "Synthetic SEO"},
    "rocket": {"pagesDir": null, "pagesInjected": 0, "seoMapped": "Synthetic SEO"}
  }
}
```

The direct probe input body was `<p>Before</p>[gallery ids="11,12"] [unknown_widget id="42"]Keep me[/unknown_widget]`. It verified the gallery review comment survives but `11,12` and the unknown `id` attr do not; ordinary inner text and supplied SEO survive. The stage-2 probe **supplied** SEO/custom values in Markdown frontmatter to isolate its behavior: it did not prove wp2md populates them. Theme injection ran against temporary directories **without** provisioning/downloading/building themes. Therefore the observed zero pages and mapped title concern adapter/injector logic only, not complete theme rendering.

### Reproduce the key direct-loss observation without wp2md/network

After building, this creates only a new fixture directory under the repo's ignored `.tmp`:

```sh
node --input-type=module <<'JS'
import { transformPosts } from './packages/wp-migrate/dist/index.js';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.tmp', { recursive: true });
const { mkdtemp } = await import('node:fs/promises');
const output = await mkdtemp('.tmp/plugin-evidence-');
await transformPosts([{
  id: 901, title: 'Synthetic', slug: 'synthetic', status: 'publish', type: 'post',
  date: '2024-01-01', author: 'Fixture', categories: [], tags: [], excerpt: '',
  seoTitle: 'SEO SENTINEL', customFields: { field: 'CUSTOM SENTINEL' },
  content: '[gallery ids="11,12"] [unknown_widget id="42"]Keep me[/unknown_widget]'
}], output);
const text = await readFile(`${output}/src/content/articles/synthetic/index.mdoc`, 'utf8');
assert(text.includes('SEO SENTINEL'));
assert(text.includes('gallery: review manually'));
assert(text.includes('Keep me'));
assert(!text.includes('11,12'));
assert(!text.includes('id="42"'));
assert(!text.includes('CUSTOM SENTINEL'));
console.log('Observed SEO preservation and custom-field/shortcode-attribute loss:', output);
JS
```

### What the real sample does and does not establish

Only `packages/wp-migrate/src/__fixtures__/sample-export.xml` was treated as the existing sample; no private live export or SQL dump was accessed. Its item inventory above comes from parsing the raw XML, **not** hand-counting. Shortcode scan of its `content:encoded` values found none. In particular it has no pages, gallery, form, membership or product items to validate those capabilities. Product taxonomies in channel-level terms are not product records.

Actual sample evidence:

- Yoast description keys at [1094–1095](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__fixtures__/sample-export.xml#L1094-L1095) and [1309–1310](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__fixtures__/sample-export.xml#L1309-L1310); title with literal `%%title%%` etc. at [1313–1314](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__fixtures__/sample-export.xml#L1313-L1314). Extraction is not template expansion or rendered SEO parity.
- Menu extension key `obfx_menu_icon` at [1486–1487](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__fixtures__/sample-export.xml#L1486-L1487); value is empty, so this proves an exported key exists, not a user need or installed-plugin version.
- Product taxonomy example at [279–283](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__fixtures__/sample-export.xml#L279-L283). No inference that checkout/products were migrated.
- Existing parser SEO test only checks optional values when present ([parser test:51–59](https://github.com/depress-org/depress/blob/19f239e507bb9b4beaa8ff9273560ba6f2aa5360/packages/wp-migrate/src/__tests__/parser.test.ts#L51-L59)). Green tests are not an end-to-end guarantee.

## Revalidation after main integrated PR #8

Main advanced to `fbdfd3d03ef7e0e35f92eeae0193d7226da7cba8` while this PR was awaiting CI. The docs branch was rebased onto it; **no upstream CI, coverage, lockfile or runtime change was edited or dropped**. The matrix/citations remain explicitly pinned to the original audited revision. Inspection of the intervening CLI/scaffold diff showed exported test helpers and scaffold dependency/bundling/settings fixes, not a static-plugin API or repairs to the audited metadata/theme losses. The same offline engine probe was rerun after rebase and returned the same observations above.

Executed again with Node 20.20.2/npm 10.9.9 and `TMPDIR=$PWD/.tmp`: cold `npm ci --legacy-peer-deps --ignore-scripts`, `npm run build`, `npm run typecheck`, required `npm test` (now includes mandatory coverage), `npm run test:integration`, and the offline plugin audit. All exited `0`. Test totals now **105**: CLI 41, job-core 8, web 7, engine 49. Measured coverage (statements/branches/functions/lines) was CLI 42.78/36.86/44.87/43.29, job-core 94.87/73.33/80/97.22, web 83.72/75/55.55/85.36, engine 36.87/26.04/24.80/38.67; required existing floors passed. Low floors are not broad coverage proof.

The newly inherited integration command actually migrated the bounded offline WXR fixture and built scaffold output, checked two post HTML bodies plus `/about/`, and rejected the draft route/listing. It passed. It **reuses the root locked node_modules via a symlink**, not a cold independent generated consumer install; fixture has no media/gallery. This improves evidence beyond the earlier empty root example but does **not** pass the proposed plugin fixture gates or general #19 acceptance. Both active required remote checks (`Build & type-check`, `Generated fixture site`) must pass at the final rebased PR head; their exact run URLs are recorded in the PR/Kanban handoff, not inferred from the prior head's green check.

## Proposed fixture gates (not implemented or passed by this docs PR)

Future implementation must add offline synthetic fixtures, not edit the real sample or invoke WordPress/PHP. Match assertions by original source ID and occurrence/token, not aggregate counts. Run through the actual shared service and CLI; adapter tests alone are insufficient. Test web/bot config forwarding where exposed, without live accounts.

| ID | Small fixture | Required assertion / canonical #18 evidence |
|---|---|---|
| P01 | Published post + page with literal Yoast strings, template-variable title, conflicting WXR/SQL values, long title/description | Explicit precedence (current WXR wins); ID-linked parsed/emitted/rendered comparisons. Template variables unresolved -> review, no raw template accepted as verified SEO. Adapter truncation and page omission diagnosed; don't claim plugin fixes built-ins |
| P02 | Public scalar ACF-like field, underscore schema ref, serialized/repeater-like string, unrecognized metadata | Parsed-only vs emitted tracked. No arbitrary metadata leakage to frontmatter/report; unhandled public value gets `WP_METADATA_UNMAPPED`; no PHP deserialization |
| P03 | Published custom type, draft, private item, ordinary post/page, duplicate slug and duplicate source ID | Inventory before filtering; custom type disposition explicit, private/draft not published, duplicate slug retains distinct source identity; duplicate source ID fails safely |
| P04 | Known wrappers, caption, nested unknown paired/self-closing shortcodes with attrs + non-ASCII text | Preserve safe text, stable evidence refs and attrs/tokens before conversion; every unresolved occurrence reported. No silent attr/body loss, marker collision or regex-only assumption of complete parsing |
| P05 | Gallery IDs 11/12 with two successful local image assets and explicit alts | Opt-in plugin preserves ID order and emits escaped static images. Plugin off leaves explicit review finding. Config/API/plugin versions recorded. Real generated output and rendered images checked, not just helper return |
| P06 | Gallery missing/invalid/duplicate IDs, missing/failed asset, unsupported attr | No partial “success”; stable diagnostic, per-item needs-review, readiness gate non-green; no media fetching by plugin |
| P07 | Unknown shortcode, plugin dynamic form/cart/login marker, SQL input without plugin-table coverage | Classify evidence as review/dynamic; source coverage shows not-assessed tables; no fake working submit/checkout/login. Absence of detection is not proof of compatibility |
| P08 | Unknown/duplicate plugin ID, wrong API/version, invalid/unknown options, competing token ownership | Validate once before output; deterministic config failure in CLI and service report, no auto-download/install |
| P09 | Hook throws/rejects, times out or exceeds input/result/diagnostic budget | Atomic rollback of plugin delta, bounded safe diagnostic, failed result/exit, no auto-deploy or false success; existing report remains readable |
| P10 | Token spoofing, raw HTML/MDX, JS expressions/imports, dangerous alt/URL/path strings | Host rejects unsafe/foreign replacements; no execution, path writes or credential exposure. Only host manifest URLs accepted. OS isolation/egress denial verified by #24/#25 owner, not inferred from TS types |
| P11 | Re-run identical input/config/manifest; two plugins claim same token | Byte-identical content and stable diagnostic ordering; conflicting claims fail config instead of last-writer-wins. No item/route duplication |
| P12 | Both bundled adapters + scaffold, pages, gallery + alt, adapter skipping page, malformed neighboring item | Cold generated install/build + final HTML/media/Keystatic checks per supported theme; unsupported route is reported, one item failure doesn't erase others' evidence. #18 JSON and Markdown have same findings; check uses actual outputs, no count-only green |

Report tests must also cover absent/malformed compatibility section, disabled plugin with unsupported source, unresolved findings and safe explicit review resolution. Fake/mocked deployment is not real deployment evidence. No public deployment is needed or authorized for these tests.

## Scoped handoff, no competing implementation

1. Reuse #18 for canonical report/source inventory integration and current data-loss accounting; reuse #16 for shared noninteractive service. Coordinate schemas after those merge; this document does not freeze field names on their active branches.
2. [Follow-up #30](https://github.com/depress-org/depress/issues/30) scopes the proposed runner/token preservation + optional gallery demonstrator and P03–P11; Kanban `t_2fda1b74` is assigned to fullstack-dev and gated behind this lane, #18 and independent acceptance #19. It must be independently reviewed before becoming a promised capability. No PHP/npm plugin loading, marketplace, backend feature or theme framework.
3. #19 owns P12 cold acceptance and original-feature evidence; #24/#25 own hosted isolation/security; #26 owns generated toolchain compatibility. Do not duplicate those fixes or treat this documentation as their completion.

Integration reviewer: verify docs-only diff, citation paths/ranges and exact-head required CI. If main integrates PR #8 or other pipeline work, rebase without editing/dropping CI checks, re-run checks at the new head and treat this audit as the explicitly pinned historical baseline. Re-audit changed behavior before changing any matrix entry to shipped. Release verdict here remains **no general WP plugin compatibility; proposed static-plugin API is not shipped**.
