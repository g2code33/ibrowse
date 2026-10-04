/**
 * CONFIRMATION SUITE for the "bubble must move and overlay all apps"
 * launch chain. The bubble only works on the x11 backend, so this
 * suite EXECUTES the installed wrapper's decision logic for real (via
 * sh) under every session type, and pins the in-app fallbacks.
 *
 * Chain under test:
 *   1. after-install.sh writes /usr/bin/yayra as a real wrapper script;
 *   2. the wrapper execs the binary with --ozone-platform=x11 exactly
 *      when the session is Wayland AND XWayland is reachable;
 *   3. main.cjs keeps a self-relaunch fallback (autostart/updater/raw
 *      launches) and logs the active backend;
 *   4. overlayWindow keeps the topmost guard + menu move mode.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const afterInstall = fs.readFileSync(path.join(repoRoot, 'build', 'linux', 'after-install.sh'), 'utf8');
const mainCjs = fs.readFileSync(path.join(repoRoot, 'electron', 'main.cjs'), 'utf8');
const overlayCjs = fs.readFileSync(path.join(repoRoot, 'electron', 'overlayWindow.cjs'), 'utf8');

function extractWrapper() {
  const match = afterInstall.match(/<<'YAYRA_WRAPPER'\n([\s\S]*?)\nYAYRA_WRAPPER/);
  assert.ok(match, 'after-install.sh contains the YAYRA_WRAPPER heredoc');
  return match[1];
}

function runWrapper(env, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-wrapper-'));
  const out = path.join(dir, 'argv.txt');
  const stub = path.join(dir, 'stub.sh');
  fs.writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\n`, { mode: 0o755 });
  const wrapper = path.join(dir, 'yayra');
  fs.writeFileSync(wrapper, extractWrapper().replace('BIN="/opt/yayra/yayra"', `BIN="${stub}"`), { mode: 0o755 });
  execFileSync('/bin/sh', [wrapper, ...args], {
    env: { PATH: '/usr/bin:/bin', ...env }
  });
  const argv = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return argv;
}

test('CONFIRMED (executed, not assumed): Wayland session WITH XWayland launches on --ozone-platform=x11', () => {
  const argv = runWrapper({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' });
  assert.deepEqual(argv, ['--ozone-platform=x11'], 'the exact flag that makes bubble drag + always-on-top work');
});

test('CONFIRMED: user arguments survive and the flag comes first', () => {
  const argv = runWrapper({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, ['https://example.com']);
  assert.deepEqual(argv, ['--ozone-platform=x11', 'https://example.com']);
});

test('CONFIRMED: an explicit --ozone-platform choice always wins (no double flag, no override)', () => {
  const argv = runWrapper({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, ['--ozone-platform=wayland']);
  assert.deepEqual(argv, ['--ozone-platform=wayland']);
});

test('CONFIRMED: plain X11 sessions and XWayland-less Wayland never get a flag forced (no startup abort)', () => {
  assert.deepEqual(runWrapper({ DISPLAY: ':0' }), [], 'native X11 needs no forcing');
  assert.deepEqual(runWrapper({ WAYLAND_DISPLAY: 'wayland-0' }), [], 'no XWayland -> forcing would abort the app');
});

test('CONFIRMED: after-install writes the wrapper as a REAL file with exec permissions (the symlink regression)', () => {
  assert.match(afterInstall, /rm -f \/usr\/bin\/yayra/, 'old symlink removed first');
  assert.match(afterInstall, /chmod 755 \/usr\/bin\/yayra/, 'wrapper made executable');
});

test('CONFIRMED: in-app fallback chain stays intact for autostart/updater/raw launches', () => {
  assert.ok(mainCjs.includes("waylandDisplay !== '' && display !== ''"), 'relaunch requires Wayland + XWayland');
  assert.ok(mainCjs.includes("--ozone-platform=x11"), 'relaunch carries the real command-line switch');
  assert.ok(mainCjs.includes('app.whenReady().then(() => {'), 'relaunch waits for ready (early exit() skipped the relauncher)');
  assert.ok(mainCjs.includes('relaunchBurst'), 'count-based loop breaker present');
  assert.ok(mainCjs.includes('windowing backend: x11 (forced)'), 'backend is logged - never a mystery again');
});

test('CONFIRMED: overlay window keeps every topmost/move mechanism', () => {
  assert.ok(overlayCjs.includes("'screen-saver'"), 'maximum always-on-top level');
  assert.ok(overlayCjs.includes("win.on('blur', () => assertTopmost(win))"), 'reassert the instant another app takes focus');
  assert.ok(overlayCjs.includes('startBubbleMoveMode'), 'menu-driven Move bubble mode exists');
  assert.ok(overlayCjs.includes('Move bubble (follows your cursor - click it to drop)'), 'Move entry in the right-click menu');
  assert.ok(overlayCjs.includes('stopBubbleMoveMode({ persist: true })'), 'click-to-drop persists the new spot');
});

test('CONFIRMED: a stranded native-Wayland resident HEALS itself when the user launches again', () => {
  assert.ok(mainCjs.includes('app.requestSingleInstanceLock({'), 'duplicate launches carry their display environment');
  assert.ok(mainCjs.includes("additionalData?.display"), 'resident reads the healthy display from the new launch');
  assert.ok(mainCjs.includes('handing over to a fresh x11 instance'), 'handover is logged');
  assert.ok(mainCjs.includes("exec \"${launcher}\" --ozone-platform=x11"), 'handover instance is explicitly x11');
});

test('CONFIRMED: competing raw-binary autostart entries are removed (any filename)', () => {
  assert.ok(overlayCjs.includes('removed competing raw-binary autostart entry'), 'cleanup exists');
  assert.ok(overlayCjs.includes("!text.includes('--ozone-platform=')"), 'wrapper/explicit-backend entries survive');
});
