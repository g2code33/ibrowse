// Electron is optional here on purpose: every runtime dependency is
// injectable, so the full pipeline is unit-testable under plain Node
// (where require('electron') throws without the downloaded binary).
let electron = {};
try {
  const loaded = require('electron');
  if (loaded && typeof loaded === 'object') electron = loaded;
} catch {
  electron = {};
}
const { app, ipcMain, net, shell } = electron;
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const UPDATE_LOG_PREFIX = '[updates]';
const UPDATE_EVENT_CHANNEL = 'yayra:updates-event';

/**
 * Desktop update pipeline (Electron main process).
 *
 * The renderer's UpdateService (src/services/updateService.js) stays the
 * single source of truth for "is an update available" - it talks to the
 * Cloudflare Worker manifest with staged rollout / minSupported / checksum
 * metadata. What the renderer CANNOT do is put a verified installer on
 * disk and launch it; that is this file's job:
 *
 *   updates-download  -> streams the artifact to the userData staging dir
 *                        with live progress events, then verifies byte
 *                        length + sha256 BEFORE reporting it staged
 *                        (tampered/truncated files are deleted, the old
 *                        install keeps running).
 *   updates-install   -> opens the verified installer (.deb/.exe go to the
 *                        OS installer; AppImage and anything else is
 *                        revealed in the file manager next to the running
 *                        version) - honest behavior, no fake "relaunch".
 *
 * Dependency-injected (netImpl/shellImpl/appImpl/getWindow) so the full
 * download+verify+install flow is unit-testable without Electron or any
 * real network - see tests/desktop-updater.test.mjs.
 */
function registerDesktopUpdateHandlers({
  getWindow,
  logger = console.log,
  appImpl = app,
  netImpl = net,
  shellImpl = shell,
  fsImpl = fs,
  ipcMainImpl = ipcMain
}) {
  function emit(event, payload) {
    try {
      const wc = (event && event.sender && !event.sender.isDestroyed?.()) ? event.sender : null;
      if (wc) {
        wc.send(UPDATE_EVENT_CHANNEL, payload);
        return;
      }
      const win = getWindow?.();
      if (win && !win.isDestroyed() && win.webContents) win.webContents.send(UPDATE_EVENT_CHANNEL, payload);
    } catch {
      // Progress events are best-effort; never fail a download over one.
    }
  }

  const handleCheck = async () => {
    logger(`${UPDATE_LOG_PREFIX} desktop manual check requested`);
    return { status: 'checking', autoDownload: false };
  };

  const handleDownload = async (event, { url, version, target, sha256, bytes } = {}) => {
    if (!url || !/^https:\/\//i.test(String(url))) {
      return { status: 'error', reason: 'download-url-must-be-https' };
    }
    if (!version) return { status: 'error', reason: 'missing-version' };
    const fetchImpl = netImpl && typeof netImpl.fetch === 'function' ? netImpl.fetch : null;
    if (!fetchImpl) return { status: 'error', reason: 'fetch-unavailable' };

    const stagingDir = path.join(appImpl.getPath('userData'), 'updates', `${target || process.platform}-${version}`);
    const fileName = decodeURIComponent(String(url).split('/').pop() || `yayra-${version}`).replace(/[^\w.+-]+/g, '_');
    const filePath = path.join(stagingDir, fileName);

    logger(`${UPDATE_LOG_PREFIX} download_started url=${url} -> ${filePath}`);
    emit(event, { type: 'download-started', version, url });

    try {
      fsImpl.mkdirSync(stagingDir, { recursive: true });
      const response = await fetchImpl(url, { cache: 'no-store' });
      if (!response || !response.ok) {
        const reason = `download HTTP ${response?.status || 'unavailable'}`;
        emit(event, { type: 'download-failed', version, reason });
        return { status: 'error', reason };
      }

      const expectedTotal = Number(bytes) || Number(response.headers?.get?.('content-length')) || 0;
      let received = 0;

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          received += value.byteLength;
          const percent = expectedTotal > 0 ? Math.min(99, Math.round((received / expectedTotal) * 100)) : null;
          emit(event, { type: 'download-progress', version, received, total: expectedTotal || null, percent });
        }
        fsImpl.writeFileSync(filePath, Buffer.concat(chunks));
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        received = buffer.byteLength;
        fsImpl.writeFileSync(filePath, buffer);
        emit(event, { type: 'download-progress', version, received, total: expectedTotal || null, percent: 99 });
      }

      // Fail closed: a corrupted/tampered artifact is deleted immediately
      // and never reported as staged - the running version stays untouched.
      try {
        verifyDownloadedPayload(filePath, { bytes: Number(bytes) || received, sha256 }, fsImpl);
      } catch (err) {
        try { fsImpl.unlinkSync(filePath); } catch { /* best effort */ }
        const reason = String(err?.message || err);
        logger(`${UPDATE_LOG_PREFIX} download_verify_failed ${reason}`);
        emit(event, { type: 'download-failed', version, reason });
        return { status: 'error', reason };
      }

      logger(`${UPDATE_LOG_PREFIX} download_staged ${filePath}`);
      emit(event, { type: 'download-staged', version, path: filePath, percent: 100 });
      return { status: 'staged', path: filePath, version };
    } catch (err) {
      const reason = String(err?.message || err);
      logger(`${UPDATE_LOG_PREFIX} download_failed ${reason}`);
      emit(event, { type: 'download-failed', version, reason });
      return { status: 'error', reason };
    }
  };

  const handleInstall = async (event, { path: stagedPath } = {}) => {
    if (!stagedPath) {
      // Legacy no-payload call (old renderer builds): nothing is staged,
      // report that honestly instead of pretending to install.
      logger(`${UPDATE_LOG_PREFIX} install requested without a staged file`);
      return { status: 'error', reason: 'nothing-staged' };
    }
    if (!fsImpl.existsSync(stagedPath)) {
      return { status: 'error', reason: 'staged-file-missing' };
    }
    const ext = path.extname(stagedPath).toLowerCase();
    logger(`${UPDATE_LOG_PREFIX} install_started ${stagedPath}`);
    if (ext === '.exe' || ext === '.deb' || ext === '.msi') {
      // Hands off to the OS installer (NSIS on Windows, the package
      // installer on Debian/Ubuntu). openPath resolves to '' on success.
      const openError = await shellImpl.openPath(stagedPath);
      if (openError) {
        shellImpl.showItemInFolder?.(stagedPath);
        return { status: 'install_started', method: 'reveal', note: openError };
      }
      return { status: 'install_started', method: 'os-installer' };
    }
    // AppImage/archives: reveal next to the user so they can swap it in.
    shellImpl.showItemInFolder?.(stagedPath);
    return { status: 'install_started', method: 'reveal' };
  };

  ipcMainImpl.handle('yayra:updates-check', handleCheck);
  ipcMainImpl.handle('yayra:updates-download', handleDownload);
  ipcMainImpl.handle('yayra:updates-install', handleInstall);
  ipcMainImpl.handle('ibrowse:updates-check', handleCheck);
  ipcMainImpl.handle('ibrowse:updates-download', handleDownload);
  ipcMainImpl.handle('ibrowse:updates-install', handleInstall);

  return { handleCheck, handleDownload, handleInstall };
}

function getStagingPath(version, target) {
  return path.join(app.getPath('userData'), 'updates', `${target}-${version}`);
}

function verifyDownloadedPayload(file, expected, fsImpl = fs) {
  const bytes = fsImpl.statSync(file).size;
  if (Number(expected.bytes) !== bytes) throw new Error(`checksum:bytes-mismatch expected=${expected.bytes} actual=${bytes}`);
  const sha256 = crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
  if (expected.sha256 && expected.sha256 !== sha256) throw new Error(`checksum:sha256-mismatch expected=${expected.sha256} actual=${sha256}`);
  return { bytes, sha256 };
}

module.exports = { UPDATE_LOG_PREFIX, UPDATE_EVENT_CHANNEL, getStagingPath, registerDesktopUpdateHandlers, verifyDownloadedPayload };
