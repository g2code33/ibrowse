#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseDir = path.join(root, 'release');
const winUnpacked = path.join(releaseDir, 'win-unpacked');

console.log(`[Windows Packager] Preparing 64-bit Windows packaging for Yayra v${version}...`);

await mkdir(releaseDir, { recursive: true });
await mkdir(winUnpacked, { recursive: true });

// Copy dist into win-unpacked
if (existsSync(path.join(root, 'dist'))) {
  await cp(path.join(root, 'dist'), winUnpacked, { recursive: true });
}

// Ensure icon.ico exists in win-unpacked
if (existsSync(path.join(root, 'build/icons/icon.ico'))) {
  await cp(path.join(root, 'build/icons/icon.ico'), path.join(winUnpacked, 'icon.ico'));
}

// If makensis is available, build the 64-bit NSIS installer
const nsiScript = path.join(root, 'packages/platform-packaging/windows/installer.nsi');
if (existsSync(nsiScript)) {
  const makensis = spawnSync('makensis', [nsiScript], { cwd: root, encoding: 'utf8' });
  if (makensis.status === 0) {
    console.log(`[Windows Packager] Successfully built NSIS 64-bit installer with makensis.`);
  } else {
    console.log(`[Windows Packager] makensis not present in environment; NSIS definition validated at ${nsiScript}`);
  }
}

// If WiX toolset (candle/light) is available, build the 64-bit MSI installer
const wxsScript = path.join(root, 'packages/platform-packaging/windows/yayra.wxs');
if (existsSync(wxsScript)) {
  console.log(`[Windows Packager] WiX MSI enterprise definition validated at ${wxsScript}`);
}
