/**
 * P40: "the recover recent tab is still not coming" - root causes & pins.
 *
 * Two real bugs silently destroyed the last-session snapshot before the
 * user ever saw the "Continue with these tabs?" prompt:
 *
 *  1. LAUNCH-WIPE: a fresh run opens on a lone newtab and the rolling
 *     snapshot (600ms debounce) saved [] over the previous session. If
 *     the user quit again without browsing - or the app auto-reopened
 *     after an update - the offer was gone forever.
 *  2. MINI-SHELL CLOBBER: the bubble's mini panel runs its own shell on
 *     the SAME profile storage; every bubble use snapshotted the mini's
 *     empty tab list over the main window's session.
 *
 * Pinned here: the offer survives idle runs and mini-panel usage, the
 * prompt renders (ABOVE the frequent tiles), "No thanks" answers it for
 * good, and "Restore all" consumes it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

// Shared "disk" so consecutive shells behave like consecutive app runs.
const disk = new Map();
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
  key: (i) => [...disk.keys()][i] ?? null,
  get length() { return disk.size; }
};

const { BrowserShell } = await import('../packages/shared-ui/src/components/BrowserShell.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'yayra:p:default:last-session-tabs';
const diskTabs = () => (JSON.parse(disk.get(KEY) || 'null')?.tabs || []).map((t) => t.url);

async function boot(opts = {}) {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false, ...opts });
  await shell.initialize();
  shell.render(container);
  return { shell, container };
}

test('full lifecycle: browse -> quit -> idle relaunch (+ bubble mini) -> offer STILL prompts', async () => {
  disk.clear();

  // RUN 1: the user browses two sites, then the app dies.
  {
    const { shell } = await boot();
    shell.state.tabs.push(
      { id: 't-a', title: 'YouTube', url: 'https://www.youtube.com/', isLoading: false, isPrivate: false, favicon: null },
      { id: 't-b', title: 'GitHub', url: 'https://github.com/', isLoading: false, isPrivate: false, favicon: null }
    );
    shell.render();
    await sleep(900); // flush the 600ms snapshot debounce
    assert.deepEqual(diskTabs(), ['https://www.youtube.com/', 'https://github.com/'], 'rolling snapshot saved');
  }

  // RUN 2: relaunch, user does NOTHING (newtab only), also opens the
  // bubble mini panel; previously both paths wiped the snapshot.
  {
    const { container } = await boot();
    assert.ok(container.querySelector('.fb-continue-card'), 'prompt shown on the fresh newtab');
    const mini = await boot({ isMiniShell: true, isMobile: true });
    mini.shell.render();
    await sleep(900);
    assert.deepEqual(diskTabs(), ['https://www.youtube.com/', 'https://github.com/'],
      'snapshot SURVIVES an idle run and mini-panel usage (the launch-wipe + mini-clobber fixes)');
  }

  // RUN 3: the offer must still prompt; "No thanks" answers it.
  {
    const { shell, container } = await boot();
    const items = container.querySelectorAll('.fb-continue-item');
    assert.ok(container.querySelector('.fb-continue-card'), 'prompt STILL shown on the next run');
    assert.ok(items.length >= 2, 'both last-session tabs offered');
    shell.dismissContinueTabs();
    await sleep(900);
    assert.equal(container.querySelector('.fb-continue-card'), null, 'No thanks removes the card');
    assert.deepEqual(diskTabs(), [], 'rolling snapshot resumes once the offer is answered');
  }

  // RUN 4: no zombie re-prompt of a dismissed/consumed session.
  {
    const { container } = await boot();
    const fromSession = [...container.querySelectorAll('.fb-continue-meta')]
      .some((m) => (m.textContent || '').includes('From last session'));
    assert.equal(fromSession, false, 'dismissed session never re-offers its tabs');
  }
});

test('Restore all consumes the offer and reopens every tab', async () => {
  disk.clear();
  {
    const { shell } = await boot();
    shell.state.tabs.push(
      { id: 't-a', title: 'YouTube', url: 'https://www.youtube.com/', isLoading: false, isPrivate: false, favicon: null }
    );
    shell.render();
    await sleep(900);
  }
  {
    const { shell } = await boot();
    const entries = (shell.state.continueTabs || []).map((t) => ({ url: t.url, title: t.title }));
    assert.equal(entries.length, 1, 'offer loaded');
    shell.restoreContinueTabs(entries);
    assert.equal(shell.getActiveTab().url, 'https://www.youtube.com/', 'newtab became the restored tab');
    assert.equal(shell.state.continueTabs.length, 0, 'offer consumed');
  }
});

test('prompt renders ABOVE the frequent tiles (source-order pin)', () => {
  const src = fs.readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  const cardAt = src.indexOf('this.appendContinueCard(newTabPage, frequentSites);');
  const tilesAt = src.indexOf("frequentSection.appendChild(frequentGrid);");
  assert.ok(cardAt > 0 && tilesAt > 0, 'both blocks exist');
  assert.ok(cardAt < tilesAt, 'continue card is appended before the frequent-sites section');
});

test('mini shell never writes the session snapshot (static pin)', () => {
  const src = fs.readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  assert.match(src, /if \(this\.options\?\.isMiniShell\) return;/, 'queueSessionSnapshot mini guard');
  const mainJs = fs.readFileSync(new URL('../src/browser/main.js', import.meta.url), 'utf8');
  assert.match(mainJs, /isMiniShell,/, 'main.js passes the mini flag into the shell');
});
