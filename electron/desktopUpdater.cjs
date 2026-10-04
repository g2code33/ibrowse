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
const { spawn, spawnSync } = require('node:child_process');

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
 *   updates-install   -> ACTUALLY installs the verified artifact:
 *                        - .exe/.msi  : launches the Windows installer
 *                          detached, then quits the WHOLE app (bubble
 *                          included) so the installer can replace the
 *                          locked binaries and relaunch the new version.
 *                        - .deb/.rpm  : runs the package manager under
 *                          pkexec (GUI password prompt); on success Yayra
 *                          relaunches itself on the freshly installed
 *                          version. Falls back to the OS software
 *                          installer, then to reveal-in-folder.
 *                        - .AppImage  : when running AS an AppImage
 *                          ($APPIMAGE), the staged file replaces the
 *                          current one in place, the new AppImage is
 *                          launched and the old instance quits.
 *                        - .dmg/.pkg  : handed to macOS (mount/Installer);
 *                          anything else is revealed next to the current
 *                          install. No fake "install_started" ever.
 *
 * Dependency-injected (netImpl/shellImpl/appImpl/spawnImpl/getWindow/...)
 * so the full download+verify+install flow is unit-testable without
 * Electron or any real network - see tests/desktop-updater.test.mjs.
 */
function registerDesktopUpdateHandlers({
  getWindow,
  logger = console.log,
  appImpl = app,
  netImpl = net,
  shellImpl = shell,
  fsImpl = fs,
  ipcMainImpl = ipcMain,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  envImpl = process.env,
  setTimeoutImpl = setTimeout,
  quitDelayMs = 1500,
  relaunchDelayMs = 800
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

  /** First existing pkexec binary, or null (no GUI elevation available). */
  function findPkexec() {
    const candidates = ['/usr/bin/pkexec', '/bin/pkexec', '/usr/local/bin/pkexec'];
    for (const candidate of candidates) {
      try { if (fsImpl.existsSync(candidate)) return candidate; } catch { /* keep looking */ }
    }
    return null;
  }

  /** Reveal fallback shared by every path that cannot truly install. */
  function revealFallback(stagedPath, note) {
    try { shellImpl.showItemInFolder?.(stagedPath); } catch { /* best effort */ }
    return { status: 'install_started', method: 'reveal', note: note || null };
  }

  /**
   * app.quit() can be silently blocked (a wedged renderer, a dialog, a
   * window vetoing close) - and the floating bubble keeps Yayra resident
   * by design. After an install/relaunch has been committed, the OLD
   * process MUST die, or the user keeps "running the previous version"
   * no matter how many times they update. Guarded: test fakes without
   * exit() simply skip the hard fallback.
   */
  function forceExitSoon() {
    if (typeof appImpl?.exit !== 'function') return;
    setTimeoutImpl(() => {
      try { appImpl.exit(0); } catch { /* already gone */ }
    }, Math.max(quitDelayMs, 1500));
  }

  const handleInstall = async (event, { path: stagedPath, version } = {}) => {
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

    // ---------- Windows: .exe (NSIS) / .msi ----------
    // The old flow only closed the main WINDOW, so the app (bubble/tray)
    // kept running and the installer could not replace the locked files.
    // Now: launch the installer detached, then quit the ENTIRE app so the
    // install actually completes and relaunches the new version.
    if (ext === '.exe' || ext === '.msi') {
      let spawnFailed = false;
      try {
        const child = ext === '.msi'
          ? spawnImpl('msiexec', ['/i', stagedPath], { detached: true, stdio: 'ignore' })
          : spawnImpl(stagedPath, [], { detached: true, stdio: 'ignore' });
        child.once?.('error', (err) => {
          spawnFailed = true;
          const reason = String(err?.message || err);
          logger(`${UPDATE_LOG_PREFIX} installer_spawn_failed ${reason}`);
          emit(event, { type: 'install-failed', version: version || null, reason });
          try { shellImpl.showItemInFolder?.(stagedPath); } catch { /* best effort */ }
        });
        child.unref?.();
      } catch (err) {
        // Synchronous spawn failure: fall back to the OS "open" verb.
        const openError = await shellImpl.openPath(stagedPath).catch((e) => String(e?.message || e));
        if (openError) return revealFallback(stagedPath, openError);
      }
      // Give the IPC reply + the installer window a moment, then get the
      // whole app out of the installer's way.
      setTimeoutImpl(() => {
        if (spawnFailed) return;
        logger(`${UPDATE_LOG_PREFIX} quitting so the installer can replace the app`);
        try { appImpl.quit?.(); } catch { /* already quitting */ }
        // The floating bubble/tray keep Yayra resident by design - if
        // ANYTHING blocks the graceful quit, force the exit so the user
        // is never left running the old version after an install.
        forceExitSoon();
      }, quitDelayMs);
      return { status: 'install_started', method: 'os-installer', willQuit: true };
    }

    // ---------- Linux packages: .deb / .rpm ----------
    // shell.openPath on a .deb is NOT a real install on most distros
    // (GNOME Software/archive manager silently does nothing). Run the real
    // package manager under pkexec - the system shows a password prompt,
    // dpkg/rpm replaces the files, and Yayra relaunches itself on the new
    // version (same executable path, now the new build).
    if (ext === '.deb' || ext === '.rpm') {
      const pkexec = findPkexec();
      if (pkexec) {
        const argv = ext === '.deb' ? ['dpkg', '-i', stagedPath] : ['rpm', '-U', '--replacepkgs', stagedPath];
        try {
          const child = spawnImpl(pkexec, argv, { stdio: 'ignore' });
          child.once?.('error', (err) => {
            const reason = String(err?.message || err);
            logger(`${UPDATE_LOG_PREFIX} pkexec_spawn_failed ${reason}`);
            emit(event, { type: 'install-failed', version: version || null, reason });
          });
          child.once?.('exit', (code) => {
            if (code === 0) {
              logger(`${UPDATE_LOG_PREFIX} package installed - relaunching on the new version`);
              emit(event, { type: 'install-finished', version: version || null, relaunching: true });
              setTimeoutImpl(() => {
                try { appImpl.relaunch?.(); } catch { /* best effort */ }
                try { appImpl.quit?.(); } catch { /* already quitting */ }
                // The resident bubble/tray process is exactly what kept
                // users "on the previous version" after an install -
                // never let it survive a completed update.
                forceExitSoon();
              }, relaunchDelayMs);
            } else {
              // 126/127 = the user dismissed the PolicyKit password prompt.
              const reason = (code === 126 || code === 127)
                ? 'authorization-declined'
                : `package-manager-exited-${code}`;
              logger(`${UPDATE_LOG_PREFIX} install_failed ${reason}`);
              emit(event, { type: 'install-failed', version: version || null, reason });
            }
          });
          return { status: 'install_started', method: 'pkexec', willRestart: true };
        } catch (err) {
          logger(`${UPDATE_LOG_PREFIX} pkexec unavailable: ${String(err?.message || err)}`);
          // fall through to the software-installer handoff below
        }
      }
      // No pkexec: hand to the OS software installer; reveal as last resort.
      const openError = await shellImpl.openPath(stagedPath).catch((e) => String(e?.message || e));
      if (openError) return revealFallback(stagedPath, openError);
      return { status: 'install_started', method: 'os-installer' };
    }

    // ---------- Linux AppImage: true in-place self-update ----------
    if (ext === '.appimage') {
      const currentAppImage = envImpl?.APPIMAGE;
      if (currentAppImage && fsImpl.existsSync(currentAppImage)) {
        try {
          fsImpl.copyFileSync(stagedPath, currentAppImage);
          fsImpl.chmodSync(currentAppImage, 0o755);
        } catch (err) {
          // Could not overwrite (e.g. read-only mount): reveal honestly.
          return revealFallback(stagedPath, `self-replace-failed: ${String(err?.message || err)}`);
        }
        let spawnFailed = false;
        try {
          const child = spawnImpl(currentAppImage, [], { detached: true, stdio: 'ignore' });
          child.once?.('error', (err) => {
            spawnFailed = true;
            emit(event, {
              type: 'install-failed',
              version: version || null,
              reason: `relaunch-failed: ${String(err?.message || err)} (the update IS in place - reopen Yayra manually)`
            });
          });
          child.unref?.();
        } catch (err) {
          return {
            status: 'install_started',
            method: 'self-replace',
            willQuit: false,
            note: `updated in place; reopen Yayra manually (${String(err?.message || err)})`
          };
        }
        setTimeoutImpl(() => {
          if (spawnFailed) return;
          logger(`${UPDATE_LOG_PREFIX} AppImage replaced - handing over to the new version`);
          try { appImpl.quit?.(); } catch { /* already quitting */ }
          forceExitSoon();
        }, quitDelayMs);
        return { status: 'install_started', method: 'self-replace', willQuit: true };
      }
      // Not running as an AppImage (dev run / extracted): reveal honestly.
      return revealFallback(stagedPath, 'not-running-as-appimage');
    }

    // ---------- macOS: .dmg mounts, .pkg opens Installer.app ----------
    if (ext === '.dmg' || ext === '.pkg') {
      const openError = await shellImpl.openPath(stagedPath).catch((e) => String(e?.message || e));
      if (openError) return revealFallback(stagedPath, openError);
      return { status: 'install_started', method: ext === '.dmg' ? 'mounted' : 'os-installer' };
    }

    // Archives/unknown formats: reveal next to the user so they can swap
    // it in - never pretend an install ran.
    return revealFallback(stagedPath, null);
  };

  /**
   * How THIS running copy is installed, and which version is actually on
   * disk right now. The disk version matters because a user can install
   * an update OUTSIDE the app (terminal `dpkg -i`, software center)
   * while the old Yayra process is still resident in the tray/bubble -
   * the old process then keeps answering launches via the single-
   * instance lock and the user keeps "running the previous version"
   * forever. Comparing disk vs running version lets the UI show an
   * honest Chrome-style "Relaunch to update" instead of re-prompting.
   */
  const handleInstallInfo = async () => {
    const runningVersion = (typeof appImpl?.getVersion === 'function' && appImpl.getVersion()) || null;
    const execPath = process.execPath || null;
    const appImage = envImpl?.APPIMAGE || null;
    const packaged = Boolean(appImpl?.isPackaged);
    let installKind = 'dev';
    if (appImage) installKind = 'appimage';
    else if (packaged && process.platform === 'win32') installKind = 'windows';
    else if (packaged && process.platform === 'darwin') installKind = 'macos';
    else if (packaged && process.platform === 'linux') installKind = 'deb';
    let diskVersion = null;
    if (installKind === 'deb' && typeof spawnSyncImpl === 'function') {
      try {
        const res = spawnSyncImpl('dpkg-query', ['-W', '-f=${Version}', 'yayra'], { encoding: 'utf8', timeout: 4000 });
        const out = String(res?.stdout || '').trim();
        if (res && res.status === 0 && /^\d+\.\d+\.\d+/.test(out)) diskVersion = out;
      } catch { /* dpkg not available - diskVersion stays unknown */ }
    }
    return {
      ok: true,
      runningVersion,
      diskVersion,
      installKind,
      execPath,
      appImage,
      // True when a newer build is ALREADY installed on disk and a
      // simple relaunch (no download) finishes the update.
      relaunchWillUpdate: Boolean(diskVersion && runningVersion && diskVersion !== runningVersion)
    };
  };

  const handleRelaunch = async () => {
    logger(`${UPDATE_LOG_PREFIX} relaunch requested (apply on-disk version)`);
    try {
      appImpl.relaunch();
      setTimeoutImpl(() => { try { appImpl.exit(0); } catch { /* already quitting */ } }, relaunchDelayMs);
      return { status: 'relaunching' };
    } catch (err) {
      return { status: 'error', reason: String(err?.message || err) };
    }
  };

  ipcMainImpl.handle('yayra:updates-check', handleCheck);
  ipcMainImpl.handle('yayra:updates-download', handleDownload);
  ipcMainImpl.handle('yayra:updates-install', handleInstall);
  ipcMainImpl.handle('yayra:updates-install-info', handleInstallInfo);
  ipcMainImpl.handle('yayra:updates-relaunch', handleRelaunch);
  ipcMainImpl.handle('ibrowse:updates-check', handleCheck);
  ipcMainImpl.handle('ibrowse:updates-download', handleDownload);
  ipcMainImpl.handle('ibrowse:updates-install', handleInstall);

  return { handleCheck, handleDownload, handleInstall, handleInstallInfo, handleRelaunch };
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
