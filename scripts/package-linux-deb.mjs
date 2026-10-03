#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.join(root, 'release');
const expectedName = `yayra_${pkg.version}_amd64.deb`;
const expectedPath = path.join(releaseDir, expectedName);
const localElectronBuilder = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const electronBuilder = existsSync(localElectronBuilder)
  ? { command: localElectronBuilder, args: [] }
  : { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', 'electron-builder'] };

await mkdir(releaseDir, { recursive: true });
console.log(`[Linux DEB Packager] Building the self-contained Electron Debian application for Yayra v${pkg.version}...`);

const result = spawnSync(electronBuilder.command, [...electronBuilder.args, '--linux', 'deb', '--publish', 'never'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (result.error) {
  console.error(`[Linux DEB Packager] Could not start electron-builder: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const debFiles = (await Promise.all((await readdir(releaseDir))
  .filter((name) => name.endsWith('.deb'))
  .map(async (name) => ({ name, info: await stat(path.join(releaseDir, name)) }))))
  .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
const built = debFiles[0];
if (!built) {
  console.error('[Linux DEB Packager] electron-builder did not produce a .deb file.');
  process.exit(1);
}

const builtPath = path.join(releaseDir, built.name);
if (built.name !== expectedName) await copyFile(builtPath, expectedPath);

const contents = spawnSync('dpkg-deb', ['--contents', expectedPath], { encoding: 'utf8' });
const hasElectronExecutable = /\/opt\/yayra\/yayra(?:\s|$)/.test(contents.stdout);
const hasBundledApp = contents.stdout.includes('/opt/yayra/resources/app.asar');
if (contents.status !== 0 || !hasElectronExecutable || !hasBundledApp) {
  console.error('[Linux DEB Packager] Refusing to publish a web-only package; the Debian archive must contain the Electron executable and resources/app.asar.');
  process.exit(1);
}

console.log(`[Linux DEB Packager] Successfully built self-contained ${path.join('release', expectedName)}`);
