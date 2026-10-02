import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSecurityPolicy, DESKTOP_CUSTOM_SCHEME } from '../src/security/csp.js';
import { isJavaScriptMime, mimeTypeFor, normalizeAssetPath } from '../src/security/localAssets.js';

test('CSP is pinned to self, exact hosts, and desktop custom scheme', () => {
  const csp = buildContentSecurityPolicy();
  assert.match(csp, /default-src 'self' ibrowse:/);
  assert.match(csp, /script-src 'self' ibrowse:/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' ibrowse:/);
  assert.match(csp, /img-src 'self' data: blob: ibrowse: https:\/\/ibrowse\.pages\.dev/);
  assert.match(csp, /connect-src 'self' ibrowse: https:\/\/updates\.ibrowse\.app/);
  assert.equal(DESKTOP_CUSTOM_SCHEME, 'ibrowse');
});

test('local asset serving refuses traversal and preserves JS MIME type', () => {
  assert.equal(normalizeAssetPath('/../secret'), null);
  assert.equal(normalizeAssetPath('/%2e%2e/secret'), null);
  assert.equal(normalizeAssetPath('/..%5csecret'), null);
  assert.equal(normalizeAssetPath('/'), '/index.html');
  assert.equal(mimeTypeFor('/src/browser/main.js'), 'text/javascript; charset=utf-8');
  assert.equal(isJavaScriptMime(mimeTypeFor('/src/browser/main.js')), true);
});
