import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Regression coverage for a real production bug seen on the deployed PWA
 * (https://yayra.pages.dev): BrowserShell.checkForUpdates() used to have a
 * SECOND, independent "fallback" path that fetched the raw GitHub Releases
 * API directly and compared the tag against a version string hardcoded to
 * the literal '0.1.0'. That path ran any time the real UpdateService (wired
 * to the Cloudflare Worker's /updates/manifest.json) reported the app was
 * already up to date, because the only early-return guard checked for
 * status === 'available' | 'ready'. Since '0.1.0' can never equal a real
 * release tag, it declared an update "ready" on every single check -
 * including immediately after the user clicked "restart and apply", which
 * just reloads the page and re-runs the same broken check - producing an
 * infinite "An update for Yayra (vX.Y.Z) is ready!" confirm-dialog loop that
 * only stopped when the user clicked Cancel.
 *
 * Fix: delete the duplicate fallback entirely; trust the Worker-backed
 * UpdateService as the single source of truth, and stop hardcoding version
 * strings anywhere in the prompt/menu UI.
 */

function installFakeUpdateService(resultsQueue, { installedVersion = '0.1.9' } = {}) {
  const calls = [];
  return {
    installedVersion,
    check: async (opts) => {
      calls.push(opts);
      const next = resultsQueue.length > 1 ? resultsQueue.shift() : resultsQueue[0];
      return { installedVersion, ...next };
    },
    calls
  };
}

function installConfirmStub(answer) {
  const prompts = [];
  window.confirm = (msg) => { prompts.push(msg); return answer; };
  window.alert = () => {};
  window.location = window.location || {};
  const reloads = [];
  window.location.reload = () => reloads.push(true);
  return { prompts, reloads, uninstall: () => { delete window.confirm; delete window.alert; } };
}

test('checkForUpdates: already up to date NEVER shows the update-ready dialog, even though no real update exists', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'upToDate', version: '0.1.9' }]);
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  const { prompts, uninstall } = installConfirmStub(true);
  try {
    await shell.checkForUpdates(false);
    assert.equal(prompts.length, 0, 'no confirm dialog should ever be shown when already up to date');
    assert.equal(shell.state.updateState.status, 'uptodate');
    assert.equal(shell.state.updateState.availableVersion, null);
  } finally {
    uninstall();
  }
});

test('checkForUpdates: repeated checks while up to date never escalate into a prompt (regression for the infinite-loop bug)', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'upToDate', version: '0.1.9' }]);
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  const { prompts, uninstall } = installConfirmStub(true);
  try {
    // Simulate several page loads worth of checks in a row (what happened in
    // production every time the broken fallback reloaded the page).
    await shell.checkForUpdates(false);
    await shell.checkForUpdates(false);
    await shell.checkForUpdates(false);
    assert.equal(prompts.length, 0, 'no update prompt should ever fire across repeated up-to-date checks');
  } finally {
    uninstall();
  }
});

test('checkForUpdates: a genuinely available update shows exactly one correctly-versioned prompt and applies on confirm', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'available', version: '0.2.0', force: false }], { installedVersion: '0.1.9' });
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  const { prompts, reloads, uninstall } = installConfirmStub(true);
  try {
    await shell.checkForUpdates(false);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /v0\.2\.0/);
    assert.equal(shell.state.updateState.status, 'ready');
    assert.equal(shell.state.updateState.availableVersion, '0.2.0');
    assert.equal(reloads.length, 1, 'confirming the dialog should apply (reload) exactly once');
  } finally {
    uninstall();
  }
});

test('checkForUpdates: declining the prompt does not reload and does not loop on its own', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'available', version: '0.2.0', force: false }], { installedVersion: '0.1.9' });
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  const { prompts, reloads, uninstall } = installConfirmStub(false);
  try {
    await shell.checkForUpdates(false);
    assert.equal(prompts.length, 1);
    assert.equal(reloads.length, 0, 'declining must not reload the page');
  } finally {
    uninstall();
  }
});

test('checkForUpdates: never calls out to the raw GitHub Releases API directly (that duplicate fallback was removed)', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'upToDate', version: '0.1.9' }]);
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async (url) => {
    fetchCalled = true;
    throw new Error(`unexpected direct fetch during checkForUpdates: ${url}`);
  };
  const { uninstall } = installConfirmStub(true);
  try {
    await shell.checkForUpdates(false);
    assert.equal(fetchCalled, false, 'checkForUpdates must rely solely on the injected UpdateService, never a direct fetch');
  } finally {
    uninstall();
    globalThis.fetch = originalFetch;
  }
});

test('checkForUpdates: with no updateService configured, reports "unknown" instead of fabricating a false "ready" state', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true });
  await shell.initialize();
  const { prompts, uninstall } = installConfirmStub(true);
  try {
    await shell.checkForUpdates(false);
    assert.equal(prompts.length, 0);
    assert.equal(shell.state.updateState.status, 'unknown');
  } finally {
    uninstall();
  }
});

test('checkForUpdates: a blocked/throwing alert() during applyUpdate must not be mistaken for a failed update check or skip the reload', async () => {
  // Regression for a second bug found while fixing the first: applyUpdate()
  // used to call the bare `alert(...)` global (not window.alert) inside the
  // same try/catch as the network check, so if the dialog ever throws or is
  // blocked (e.g. Chrome's "Prevent this page from creating additional
  // dialogs" safeguard - plausible after a prior dialog loop), the state was
  // silently reset to 'uptodate' and window.location.reload() was never
  // reached, with no visible error.
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'available', version: '0.2.0', force: false }], { installedVersion: '0.1.9' });
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  window.confirm = () => true;
  window.alert = () => { throw new Error('dialogs blocked by browser'); };
  window.location = window.location || {};
  const reloads = [];
  window.location.reload = () => reloads.push(true);
  try {
    await shell.checkForUpdates(false);
    assert.equal(shell.state.updateState.status, 'ready', 'a blocked alert() must not be mistaken for a failed update check');
    assert.equal(shell.state.updateState.availableVersion, '0.2.0');
    assert.equal(reloads.length, 1, 'reload must still happen even if the informational alert() throws/is blocked');
  } finally {
    delete window.confirm;
    delete window.alert;
  }
});

test('constructor: installedVersion is seeded from the real UpdateService, not a hardcoded placeholder', async () => {
  const container = document.createElement('div');
  const updateService = installFakeUpdateService([{ status: 'upToDate', version: '0.1.9' }], { installedVersion: '0.1.9' });
  const shell = new BrowserShell({ container, platform: 'pwa', isMobile: true, updateService });
  await shell.initialize();
  assert.equal(shell.state.updateState.installedVersion, '0.1.9');
});
