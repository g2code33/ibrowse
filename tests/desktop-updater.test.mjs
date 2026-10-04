import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerDesktopUpdateHandlers, verifyDownloadedPayload, UPDATE_EVENT_CHANNEL } = require('../electron/desktopUpdater.cjs');

/**
 * Real desktop update pipeline (electron/desktopUpdater.cjs): download to
 * the staging dir with progress events, verify byte length + sha256 BEFORE
 * reporting staged, delete tampered files, and hand verified installers to
 * the OS. All dependencies are injected - no Electron, no network.
 */

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-desktop-updater-'));
}

function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function streamResponseFor(buffer, { ok = true, status = 200, chunkSize = 16 } = {}) {
  let offset = 0;
  return {
    ok,
    status,
    headers: { get: (name) => (name === 'content-length' ? String(buffer.byteLength) : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= buffer.byteLength) return { done: true, value: undefined };
          const value = new Uint8Array(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.byteLength)));
          offset += value.byteLength;
          return { done: false, value };
        }
      })
    }
  };
}

function makeHarness({ artifact = Buffer.from('yayra new release payload: '.repeat(8)), fetchImpl = null } = {}) {
  const userData = makeTempDir();
  const handlers = new Map();
  const ipcMainImpl = { handle: (channel, fn) => handlers.set(channel, fn) };
  const sentEvents = [];
  const fakeSender = {
    isDestroyed: () => false,
    send: (channel, payload) => sentEvents.push({ channel, payload })
  };
  const opened = [];
  const revealed = [];
  const shellImpl = {
    openPath: async (p) => { opened.push(p); return ''; },
    showItemInFolder: (p) => revealed.push(p)
  };
  const netImpl = {
    fetch: fetchImpl || (async () => streamResponseFor(artifact))
  };
  registerDesktopUpdateHandlers({
    getWindow: () => null,
    logger: () => {},
    appImpl: { getPath: () => userData },
    netImpl,
    shellImpl,
    fsImpl: fs,
    ipcMainImpl
  });
  return { artifact, userData, handlers, sentEvents, fakeSender, opened, revealed };
}

test('desktop updater: downloads, streams progress events, verifies sha256+bytes, and reports the staged file path', async () => {
  const { artifact, handlers, sentEvents, fakeSender, userData } = makeHarness();
  const result = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://github.com/g2code33/yayra/releases/download/v9.9.9/yayra-9.9.9.deb',
    version: '9.9.9',
    target: 'linux',
    sha256: sha256Of(artifact),
    bytes: artifact.byteLength
  });

  assert.equal(result.status, 'staged');
  assert.ok(fs.existsSync(result.path), 'verified artifact is on disk');
  assert.ok(result.path.startsWith(path.join(userData, 'updates', 'linux-9.9.9')), 'staged under userData/updates/<target>-<version>');
  assert.deepEqual(fs.readFileSync(result.path), artifact, 'bytes arrive intact');

  const types = sentEvents.map((e) => e.payload.type);
  assert.ok(types.includes('download-started'));
  assert.ok(types.includes('download-progress'), 'live progress feedback is emitted');
  assert.equal(types.at(-1), 'download-staged');
  assert.ok(sentEvents.every((e) => e.channel === UPDATE_EVENT_CHANNEL));
  const lastProgress = sentEvents.filter((e) => e.payload.type === 'download-progress').at(-1);
  assert.ok(lastProgress.payload.percent >= 90, 'progress reaches the end of the file');
});

test('desktop updater: a tampered download (sha256 mismatch) is DELETED and reported as an error - never staged', async () => {
  const artifact = Buffer.from('legit artifact bytes');
  const { handlers, fakeSender, sentEvents, userData } = makeHarness({ artifact });
  const result = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://example.com/yayra.deb',
    version: '1.2.3',
    target: 'linux',
    sha256: sha256Of(Buffer.from('what the manifest promised')), // attacker swapped the file
    bytes: artifact.byteLength
  });

  assert.equal(result.status, 'error');
  assert.match(result.reason, /sha256-mismatch/);
  const stagingDir = path.join(userData, 'updates', 'linux-1.2.3');
  const leftovers = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
  assert.deepEqual(leftovers, [], 'tampered file does not survive on disk');
  assert.equal(sentEvents.at(-1).payload.type, 'download-failed');
});

test('desktop updater: truncated download (byte-length mismatch) also fails closed', async () => {
  const artifact = Buffer.from('only half the promised bytes');
  const { handlers, fakeSender } = makeHarness({ artifact });
  const result = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://example.com/yayra.AppImage',
    version: '1.2.3',
    target: 'linux',
    sha256: sha256Of(artifact),
    bytes: artifact.byteLength * 2
  });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /bytes-mismatch/);
});

test('desktop updater: refuses non-HTTPS download URLs outright', async () => {
  const { handlers, fakeSender } = makeHarness();
  const result = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'http://evil.example/yayra.deb',
    version: '1.0.0',
    sha256: 'x',
    bytes: 1
  });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'download-url-must-be-https');
});

test('desktop updater: HTTP failure is an error with the status code, not a staged file', async () => {
  const { handlers, fakeSender } = makeHarness({
    fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null } })
  });
  const result = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://example.com/yayra.deb', version: '1.0.0', target: 'linux', sha256: 'x', bytes: 1
  });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /HTTP 503/);
});

test('desktop updater: install hands a verified .deb to the OS installer (shell.openPath)', async () => {
  const { artifact, handlers, fakeSender, opened } = makeHarness();
  const staged = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://example.com/yayra-9.9.9.deb', version: '9.9.9', target: 'linux',
    sha256: sha256Of(artifact), bytes: artifact.byteLength
  });
  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'os-installer');
  assert.deepEqual(opened, [staged.path]);
});

test('desktop updater: install reveals an AppImage in the file manager (no silent self-swap pretense)', async () => {
  const { artifact, handlers, fakeSender, revealed } = makeHarness();
  const staged = await handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: 'https://example.com/yayra-9.9.9.AppImage', version: '9.9.9', target: 'linux',
    sha256: sha256Of(artifact), bytes: artifact.byteLength
  });
  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'reveal');
  assert.deepEqual(revealed, [staged.path]);
});

test('desktop updater: install without a staged file is an honest error (no fake "install_started")', async () => {
  const { handlers, fakeSender } = makeHarness();
  const missing = await handlers.get('yayra:updates-install')({ sender: fakeSender }, {});
  assert.equal(missing.status, 'error');
  assert.equal(missing.reason, 'nothing-staged');
  const gone = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: '/nonexistent/file.deb' });
  assert.equal(gone.status, 'error');
  assert.equal(gone.reason, 'staged-file-missing');
});

test('verifyDownloadedPayload: accepts a pristine file and rejects both corruption classes', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'artifact.bin');
  const payload = Buffer.from('payload-bytes-for-verify');
  fs.writeFileSync(file, payload);

  const okay = verifyDownloadedPayload(file, { bytes: payload.byteLength, sha256: sha256Of(payload) });
  assert.equal(okay.bytes, payload.byteLength);

  assert.throws(() => verifyDownloadedPayload(file, { bytes: payload.byteLength + 1, sha256: sha256Of(payload) }), /bytes-mismatch/);
  assert.throws(() => verifyDownloadedPayload(file, { bytes: payload.byteLength, sha256: 'deadbeef' }), /sha256-mismatch/);
});
