const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const UPDATE_LOG_PREFIX = '[updates]';

function registerDesktopUpdateHandlers({ getWindow, logger = console.log }) {
  const handleCheck = async () => {
    logger(`${UPDATE_LOG_PREFIX} desktop manual check requested`);
    return { status: 'checking', autoDownload: false };
  };
  const handleInstall = async () => {
    const win = getWindow();
    if (win && win.webContents && win.webContents.isLoading()) {
      logger(`${UPDATE_LOG_PREFIX} install delayed because renderer is busy`);
      return { status: 'blocked', reason: 'dirty-or-busy-state' };
    }
    logger(`${UPDATE_LOG_PREFIX} install_started desktop relaunch requested`);
    return { status: 'install_started' };
  };

  ipcMain.handle('yayra:updates-check', handleCheck);
  ipcMain.handle('yayra:updates-install', handleInstall);
  ipcMain.handle('ibrowse:updates-check', handleCheck);
  ipcMain.handle('ibrowse:updates-install', handleInstall);
}

function getStagingPath(version, target) {
  return path.join(app.getPath('userData'), 'updates', `${target}-${version}`);
}

function verifyDownloadedPayload(file, expected) {
  const bytes = fs.statSync(file).size;
  if (Number(expected.bytes) !== bytes) throw new Error(`checksum:bytes-mismatch expected=${expected.bytes} actual=${bytes}`);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (expected.sha256 !== sha256) throw new Error(`checksum:sha256-mismatch expected=${expected.sha256} actual=${sha256}`);
  return { bytes, sha256 };
}

module.exports = { UPDATE_LOG_PREFIX, getStagingPath, registerDesktopUpdateHandlers, verifyDownloadedPayload };
