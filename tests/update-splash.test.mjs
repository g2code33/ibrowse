/**
 * Post-update splash: the FIRST open after a new version was installed
 * plays a quick Yayra-orb animation that names the freshly installed
 * version. Honest rules: no stored previous version (fresh install) =
 * no "updated" claim; same version = nothing; the marker advances every
 * launch so the splash shows exactly once per new version.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

class MemoryLocalStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, val) { this.map.set(key, String(val)); }
  removeItem(key) { this.map.delete(key); }
}

function withLocalStorage() {
  const storage = new MemoryLocalStorage();
  globalThis.localStorage = storage;
  return { storage, cleanup: () => { delete globalThis.localStorage; } };
}

function makeShell(installedVersion) {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  shell.state.updateState = { ...shell.state.updateState, installedVersion };
  return shell;
}

function cleanupSplash() {
  document.querySelector('.fb-update-splash')?.remove();
}

test('first launch on a NEW version shows the orb splash with the installed version', () => {
  const { storage, cleanup } = withLocalStorage();
  try {
    storage.setItem('yayra:last-run-version', '1.0.6');
    const shell = makeShell('1.0.7');
    assert.equal(shell.maybeShowUpdateSplash(), true, 'splash fires');

    const splash = document.querySelector('.fb-update-splash');
    assert.ok(splash, 'splash overlay rendered');
    assert.ok(splash.querySelector('.fb-update-splash-orb'), 'the Yayra orb is the centerpiece');
    const version = splash.querySelector('.fb-update-splash-version');
    assert.equal(version.textContent, 'v1.0.7', 'the INSTALLED version is named');
    const from = splash.querySelector('.fb-update-splash-from');
    assert.equal(from.textContent, 'from v1.0.6', 'shows what it updated from');
    assert.equal(storage.getItem('yayra:last-run-version'), '1.0.7', 'marker advanced');
  } finally {
    cleanupSplash();
    cleanup();
  }
});

test('same version again = no splash (exactly once per new version)', () => {
  const { storage, cleanup } = withLocalStorage();
  try {
    storage.setItem('yayra:last-run-version', '1.0.7');
    const shell = makeShell('1.0.7');
    assert.equal(shell.maybeShowUpdateSplash(), false);
    assert.equal(document.querySelector('.fb-update-splash'), null);
  } finally {
    cleanupSplash();
    cleanup();
  }
});

test('fresh install (no previous version recorded) never fakes an "updated" celebration', () => {
  const { storage, cleanup } = withLocalStorage();
  try {
    const shell = makeShell('1.0.7');
    assert.equal(shell.maybeShowUpdateSplash(), false, 'no previous version - nothing to celebrate');
    assert.equal(document.querySelector('.fb-update-splash'), null);
    assert.equal(storage.getItem('yayra:last-run-version'), '1.0.7', 'marker recorded for next time');
  } finally {
    cleanupSplash();
    cleanup();
  }
});

test('unknown installed version (no build stamp) stays silent', () => {
  const { storage, cleanup } = withLocalStorage();
  try {
    storage.setItem('yayra:last-run-version', '1.0.6');
    const shell = makeShell(null);
    assert.equal(shell.maybeShowUpdateSplash(), false);
    assert.equal(storage.getItem('yayra:last-run-version'), '1.0.6', 'marker untouched');
  } finally {
    cleanupSplash();
    cleanup();
  }
});
