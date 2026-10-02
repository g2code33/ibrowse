import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dimensions } from '../scripts/lib/png.mjs';

test('generated hicolor and PWA icons have expected dimensions', async () => {
  assert.deepEqual(dimensions(await readFile('assets/brand/source.png')), { width: 1024, height: 1024 });
  assert.deepEqual(dimensions(await readFile('build/icons/hicolor/48x48/apps/ibrowse.png')), { width: 48, height: 48 });
  assert.deepEqual(dimensions(await readFile('public/icons/icon-512.png')), { width: 512, height: 512 });
});
