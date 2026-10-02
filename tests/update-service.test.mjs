import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_UPDATE_CONFIG, compareSemver } from '../src/config/updates.js';
import { MemoryStorage, PromptSession, UpdateService, stablePercent } from '../src/services/updateService.js';
import { resolvePackageAssetPath } from '../src/services/archivePath.js';

const manifest = {
  schema: 1,
  channel: 'stable',
  latest: { windows: '1.2.0', linux: '1.2.0', android: '1.2.0', ios: '1.2.0', pwa: '1.2.0' },
  minSupported: { windows: '1.0.0', linux: '1.0.0', android: '1.0.0', ios: '1.0.0', pwa: '1.0.0' },
  downloads: {},
  notes: { en: 'notes' },
  rollout: { percent: 100, allowlist: [] },
  publishedAt: '2026-10-02T00:00:00.000Z',
  ttlSeconds: 300
};

test('semver comparison handles v prefix, prerelease, and build metadata', () => {
  assert.equal(compareSemver('v1.2.3+build.1', '1.2.3'), 0);
  assert.equal(compareSemver('1.2.3', '1.2.3-rc.1'), 1);
  assert.equal(compareSemver('1.2.3-rc.2', '1.2.3-rc.10'), -1);
});

test('never offers a downgrade and reports ahead distinctly', async () => {
  const service = new UpdateService({
    target: 'windows',
    installedVersion: '2.0.0',
    fetchImpl: async () => jsonResponse(manifest),
    logger: () => {}
  });
  const state = await service.check({ manual: true });
  assert.equal(state.status, 'ahead');
  assert.equal(state.reason, 'installed-newer-than-release-channel');
});

test('offline state is unknown with lastSeenAt and not upToDate', async () => {
  let online = true;
  const storage = new MemoryStorage();
  const service = new UpdateService({
    target: 'linux',
    installedVersion: '1.1.0',
    storage,
    now: () => Date.parse('2026-10-02T12:00:00.000Z'),
    fetchImpl: async () => {
      if (!online) throw new Error('offline');
      return jsonResponse(manifest);
    },
    logger: () => {}
  });
  assert.equal((await service.check({ manual: true })).status, 'available');
  online = false;
  service.lastManualCheckAt = 0;
  const offline = await service.check({ manual: true });
  assert.equal(offline.status, 'unknown');
  assert.equal(offline.lastSeenAt, '2026-10-02T12:00:00.000Z');
  assert.equal(offline.reason, 'offline');
});

test('download verifies byte size and sha256 before staging', async () => {
  const payload = new TextEncoder().encode('good-payload');
  const badSha = createHash('sha256').update('different').digest('hex');
  const service = new UpdateService({
    target: 'pwa',
    installedVersion: '1.0.0',
    fetchImpl: async (url) => {
      if (String(url).includes('manifest')) return jsonResponse({ ...manifest, downloads: { pwa: { url: 'https://updates.ibrowse.app/payload', sha256: badSha, bytes: payload.byteLength } } });
      return bytesResponse(payload);
    },
    logger: () => {}
  });
  assert.equal((await service.check({ manual: true })).status, 'available');
  const result = await service.download();
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'checksum:sha256-mismatch');
  assert.equal(result.keptOldFile, true);
});

test('manual checks are throttled and one request is in flight', async () => {
  let count = 0;
  const service = new UpdateService({
    target: 'pwa',
    installedVersion: '1.0.0',
    now: () => 1000,
    fetchImpl: async () => { count += 1; return jsonResponse(manifest); },
    logger: () => {}
  });
  await Promise.all([service.check({ manual: true }), service.check({ manual: true })]);
  assert.equal(count, 1);
  const throttled = await service.check({ manual: true });
  assert.equal(count, 1);
  assert.ok(throttled.throttledUntil);
});

test('rollout hash is stable per device', () => {
  assert.equal(stablePercent('device-a'), stablePercent('device-a'));
  assert.notEqual(stablePercent('device-a'), stablePercent('device-b'));
});

test('snooze is persisted per version and prompt is shown once per open', () => {
  const storage = new MemoryStorage();
  const session = new PromptSession({ storage, platform: 'android', now: () => 1000 });
  const state = { status: 'available', version: '1.2.0' };
  assert.equal(session.shouldPrompt(state, DEFAULT_UPDATE_CONFIG), true);
  assert.equal(session.shouldPrompt(state, DEFAULT_UPDATE_CONFIG), false);
  const nextSession = new PromptSession({ storage, platform: 'android', now: () => 2000 });
  assert.equal(nextSession.shouldPrompt(state, DEFAULT_UPDATE_CONFIG), true);
  nextSession.dismiss('1.2.0', 'never-for-version');
  const afterDismiss = new PromptSession({ storage, platform: 'android', now: () => 3000 });
  assert.equal(afterDismiss.shouldPrompt(state, DEFAULT_UPDATE_CONFIG), false);
  assert.equal(afterDismiss.shouldPrompt({ status: 'available', version: '1.3.0' }, DEFAULT_UPDATE_CONFIG), true);
});

test('desktop header control is always mounted without manifest reachability', async () => {
  const index = await readFile('public/index.html', 'utf8');
  const main = await readFile('src/browser/main.js', 'utf8');
  const button = await readFile('src/browser/updateButton.js', 'utf8');
  assert.match(index, /id="top-header"/);
  assert.match(main, /mountUpdateButton/);
  assert.match(button, /dataset\.locked = 'persistent'/);
});

test('mobile and pwa targets ignore path-inside-archive desktop logic', () => {
  assert.equal(resolvePackageAssetPath('android', 'app.asar/dist/index.html'), null);
  assert.equal(resolvePackageAssetPath('ios', 'app.asar/dist/index.html'), null);
  assert.equal(resolvePackageAssetPath('pwa', 'app.asar/dist/index.html'), null);
  assert.equal(resolvePackageAssetPath('windows', 'app.asar/dist/index.html'), 'dist/index.html');
});

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}
function bytesResponse(bytes) {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
