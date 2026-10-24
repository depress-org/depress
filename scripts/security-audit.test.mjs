import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventory, markdown } from './security-audit.mjs';

const advisory = { name: 'example', severity: 'high', title: 'Example', url: 'https://github.com/advisories/example', range: '<1.2.3' };
const fixture = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
  example: { severity: 'high', nodes: ['node_modules/example'], via: [advisory], fixAvailable: true },
  consumer: { severity: 'high', nodes: ['node_modules/consumer'], via: ['example'], fixAvailable: false },
} });
const lock = { packages: { 'node_modules/example': { version: '1.2.2' }, 'node_modules/consumer': { version: '2.0.0' } } };

test('distinguishes propagated package findings from distinct advisories', () => {
  const result = inventory(fixture(), lock);
  assert.equal(result.packages.length, 2);
  assert.equal(result.advisories.length, 1);
  assert.match(markdown(result), /distinct direct advisories: 1/);
});
test('deduplicates the same advisory reported through multiple nodes', () => {
  const audit = fixture();
  audit.vulnerabilities.consumer.via.push(advisory);
  assert.equal(inventory(audit, lock).advisories.length, 1);
});
test('fails closed on missing lock entries and inconsistent totals', () => {
  assert.throws(() => inventory(fixture(), { packages: {} }), /Missing lock/);
  const audit = fixture(); audit.metadata.vulnerabilities.total = 5;
  assert.throws(() => inventory(audit, lock), /total/);
});
test('snapshots differ only by the remediated nanoid package finding', () => {
  const before = JSON.parse(readFileSync(new URL('../docs/security/pr03/audit-before.json', import.meta.url)));
  const after = JSON.parse(readFileSync(new URL('../docs/security/pr03/audit-after.json', import.meta.url)));
  assert.deepEqual(Object.keys(before.vulnerabilities).filter(n => !after.vulnerabilities[n]), ['nanoid']);
  assert.equal(Object.keys(after.vulnerabilities).length, after.metadata.vulnerabilities.total);
});
test('patched nanoid non-secure generator safely handles negative size', async () => {
  // Synthetic size only; no network or hostile archive/media processing.
  const { nanoid } = await import('nanoid/non-secure');
  assert.equal(nanoid(-1), '');
  assert.equal(nanoid(21).length, 21);
});
