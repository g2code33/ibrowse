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

function makeFakeChild() {
  const listeners = new Map();
  return {
    unrefed: false,
    once(evt, fn) { listeners.set(evt, fn); },
    unref() { this.unrefed = true; },
    trigger(evt, ...args) { const fn = listeners.get(evt); if (fn) fn(...args); }
  };
}

function makeHarness({
  artifact = Buffer.from('yayra new release payload: '.repeat(8)),
  fetchImpl = null,
  env = {},
  pkexecPresent = false
} = {}) {
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
  // pkexec detection goes through fsImpl.existsSync - intercept just the
  // pkexec probe paths and defer everything else to the real fs.
  const fsImpl = Object.create(fs);
  fsImpl.existsSync = (p) => (String(p).endsWith('/pkexec') ? pkexecPresent : fs.existsSync(p));
  const spawned = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = makeFakeChild();
    spawned.push({ cmd, args, opts, child });
    return child;
  };
  const scheduled = [];
  const setTimeoutImpl = (fn, ms) => { scheduled.push({ fn, ms }); };
  const appCalls = [];
  const appImpl = {
    getPath: () => userData,
    quit: () => appCalls.push('quit'),
    relaunch: () => appCalls.push('relaunch')
  };
  registerDesktopUpdateHandlers({
    getWindow: () => null,
    logger: () => {},
    appImpl,
    netImpl,
    shellImpl,
    fsImpl,
    ipcMainImpl,
    spawnImpl,
    envImpl: env,
    setTimeoutImpl,
    quitDelayMs: 0,
    relaunchDelayMs: 0
  });
  return { artifact, userData, handlers, sentEvents, fakeSender, opened, revealed, spawned, scheduled, appCalls };
}

/** Run every quit/relaunch callback the handler scheduled so far. */
function runScheduled(scheduled) {
  while (scheduled.length) scheduled.shift().fn();
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

async function stageArtifact(harness, fileName) {
  const { artifact, handlers, fakeSender } = harness;
  return handlers.get('yayra:updates-download')({ sender: fakeSender }, {
    url: `https://example.com/${fileName}`, version: '9.9.9', target: 'linux',
    sha256: sha256Of(artifact), bytes: artifact.byteLength
  });
}

test('desktop updater: .deb install runs the REAL package manager under pkexec, then relaunches on success', async () => {
  const harness = makeHarness({ pkexecPresent: true });
  const { handlers, fakeSender, opened, spawned, scheduled, appCalls, sentEvents } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.deb');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path, version: '9.9.9' });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'pkexec');
  assert.equal(result.willRestart, true);
  assert.deepEqual(opened, [], 'openPath is NOT a .deb install - never used when pkexec exists');
  assert.equal(spawned.length, 1);
  assert.match(spawned[0].cmd, /pkexec$/);
  assert.deepEqual(spawned[0].args, ['dpkg', '-i', staged.path]);

  // dpkg succeeds -> install-finished event + relaunch on the new version.
  spawned[0].child.trigger('exit', 0);
  const finished = sentEvents.filter((e) => e.payload.type === 'install-finished');
  assert.equal(finished.length, 1, 'install-finished is reported to the renderer');
  runScheduled(scheduled);
  assert.deepEqual(appCalls, ['relaunch', 'quit'], 'app relaunches so reopening shows the NEW version');
});

test('desktop updater: cancelled pkexec password prompt is an HONEST install-failed (nothing quits)', async () => {
  const harness = makeHarness({ pkexecPresent: true });
  const { handlers, fakeSender, spawned, scheduled, appCalls, sentEvents } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.deb');

  await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path, version: '9.9.9' });
  spawned[0].child.trigger('exit', 126); // user dismissed the PolicyKit dialog
  const failed = sentEvents.filter((e) => e.payload.type === 'install-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].payload.reason, 'authorization-declined');
  runScheduled(scheduled);
  assert.deepEqual(appCalls, [], 'the running app NEVER quits when nothing was installed');
});

test('desktop updater: .deb without pkexec falls back to the OS software installer', async () => {
  const harness = makeHarness({ pkexecPresent: false });
  const { handlers, fakeSender, opened, spawned } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.deb');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'os-installer');
  assert.deepEqual(opened, [staged.path]);
  assert.equal(spawned.length, 0);
});

test('desktop updater: .exe install launches the installer detached and quits the WHOLE app (not just a window)', async () => {
  const harness = makeHarness();
  const { handlers, fakeSender, spawned, scheduled, appCalls } = harness;
  const staged = await stageArtifact(harness, 'yayra-setup-9.9.9.exe');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'os-installer');
  assert.equal(result.willQuit, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, staged.path, 'the installer binary itself is launched');
  assert.equal(spawned[0].opts.detached, true, 'detached so it survives the app quitting');
  assert.equal(spawned[0].child.unrefed, true);
  runScheduled(scheduled);
  assert.deepEqual(appCalls, ['quit'], 'full app.quit() so the installer can replace locked files');
});

test('desktop updater: .msi goes through msiexec /i', async () => {
  const harness = makeHarness();
  const { handlers, fakeSender, spawned } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.msi');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.method, 'os-installer');
  assert.equal(spawned[0].cmd, 'msiexec');
  assert.deepEqual(spawned[0].args, ['/i', staged.path]);
});

test('desktop updater: AppImage self-replaces $APPIMAGE in place, launches the new build, and quits', async () => {
  const currentDir = makeTempDir();
  const currentAppImage = path.join(currentDir, 'Yayra.AppImage');
  fs.writeFileSync(currentAppImage, Buffer.from('OLD build bytes'));
  const harness = makeHarness({ env: { APPIMAGE: currentAppImage } });
  const { artifact, handlers, fakeSender, spawned, scheduled, appCalls, revealed } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.AppImage');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'self-replace');
  assert.equal(result.willQuit, true);
  assert.deepEqual(fs.readFileSync(currentAppImage), artifact, 'the running AppImage file now CONTAINS the new build');
  assert.ok((fs.statSync(currentAppImage).mode & 0o111) !== 0, 'replacement stays executable');
  assert.equal(spawned[0].cmd, currentAppImage, 'the new build is launched');
  assert.deepEqual(revealed, [], 'no reveal-in-folder cop-out when a real self-update is possible');
  runScheduled(scheduled);
  assert.deepEqual(appCalls, ['quit'], 'old instance hands over to the new one');
});

test('desktop updater: AppImage staged while NOT running as an AppImage is revealed honestly', async () => {
  const harness = makeHarness({ env: {} });
  const { handlers, fakeSender, revealed, appCalls, scheduled } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.AppImage');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.method, 'reveal');
  assert.equal(result.note, 'not-running-as-appimage');
  assert.deepEqual(revealed, [staged.path]);
  runScheduled(scheduled);
  assert.deepEqual(appCalls, [], 'never quits when nothing installed');
});

test('desktop updater: macOS .dmg is mounted via openPath (drag-to-Applications guidance)', async () => {
  const harness = makeHarness();
  const { handlers, fakeSender, opened } = harness;
  const staged = await stageArtifact(harness, 'yayra-9.9.9.dmg');

  const result = await handlers.get('yayra:updates-install')({ sender: fakeSender }, { path: staged.path });
  assert.equal(result.status, 'install_started');
  assert.equal(result.method, 'mounted');
  assert.deepEqual(opened, [staged.path]);
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
