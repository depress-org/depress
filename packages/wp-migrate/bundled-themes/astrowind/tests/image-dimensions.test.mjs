import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual optimizer with Astro's build-only API replaced by a recorder.
const source = await readFile(new URL('../src/utils/images-optimization.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export const astroAssetsOptimizer:'), source.indexOf('export const isUnpicCompatible'))
  .replace('export const astroAssetsOptimizer: ImagesOptimizer', 'const astroAssetsOptimizer')
  .replace('async (w: number)', 'async (w)');
const calls = [];
const optimize = new Function('getImage', 'computeHeight', `${body}; return astroAssetsOptimizer;`)(async (options) => {
  calls.push(options);
  return { src: options.src, attributes: options };
}, (width, ratio) => Math.floor(width / ratio));

test('explicit demo dimensions never request remote size inference', async () => {
  calls.length = 0;
  await optimize('https://plus.unsplash.com/demo', [400, 800], 800, 600);
  assert.deepEqual(calls.map(({ width, height, inferSize }) => ({ width, height, inferSize })), [
    { width: 400, height: 300, inferSize: undefined },
    { width: 800, height: 600, inferSize: undefined },
  ]);
});
test('dimensionless remote images retain Astro inference/security checks', async () => {
  calls.length = 0;
  await optimize('https://untrusted.invalid/demo', [400]);
  assert.equal(calls[0].inferSize, true);
});
