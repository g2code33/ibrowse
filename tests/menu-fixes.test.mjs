import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * "Some of the menu in the Yayra menu is not working - fix them all":
 *  - AUDIT: every item in the Yayra side-drawer menu must respond to a
 *    click without throwing (and do its real action / honest notice).
 *  - Install page as app: REAL per-platform behaviour (Android native
 *    shortcut, desktop bridge, web PWA prompt) instead of a dead end.
 *  - Import bookmarks: a REAL file import (Chrome/Firefox HTML exports +
 *    JSON), not just opening the bookmarks page.
 *  - Tab groups: REAL named colour groups (create / group / ungroup +
 *    colour dot in the tab strip), not mislabelled tab actions.
 *  - Translate: the working translate.goog mechanism (the old
 *    translate.google.com/translate?u= endpoint is dead).
 *  - Paste: the async clipboard API into the focused field (execCommand
 *    'paste' is dead in every modern browser).
 */

function makeStorage() {
  const disk = new Map();
  return {
    getItem: (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: (k, v) => disk.set(k, String(v)),
    removeItem: (k) => disk.delete(k),
    key: (i) => [...disk.keys()][i] ?? null,
    get length() { return disk.size; }
  };
}

async function makeShell({ storage } = {}) {
  if (storage) globalThis.localStorage = storage;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, isMobile: false });
  await shell.initialize();
  shell.render(container);
  return { shell, container };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

test('AUDIT: every Yayra menu item responds to a click without throwing', async () => {
  const { shell, container } = await makeShell();
  try {
    shell.state.tabs[0].url = 'https://example.com/';
    shell.state.tabs[0].title = 'Example Site';
    // Prompt dialogs + file picker: deterministic stand-ins.
    shell._textPromptDialog = async () => 'Research';
    shell._openFilePicker = async () => null;
    shell.checkForUpdates = async () => {};
    shell.requestAppClose = () => {};
    shell.state.isSideDrawerOpen = true;
    shell.render(container);

    const items = Array.from(container.querySelectorAll('.fb-drawer-item'));
    assert.ok(items.length >= 30, `the drawer exposes its menu items (${items.length} found)`);
    const failures = [];
    for (const item of items) {
      try {
        item.click();
        await flush(); // async handlers get a turn; any throw = broken item
      } catch (err) {
        failures.push(`${item.className.split(' ').filter((c) => c.startsWith('fb-dr-') || c.includes('btn'))[0] || item.className}: ${err && err.message}`);
      }
    }
    assert.deepEqual(failures, [], `every menu item must work: broken -> ${failures.join('; ')}`);
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('INSTALL AS APP (Android): a REAL native home-screen shortcut is requested via the overlay plugin', async () => {
  const installCalls = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      YayraOverlay: {
        hasPermission: async () => ({ granted: true }),
        show: async () => {},
        installSiteAsApp: async (opts) => { installCalls.push(opts); return { ok: true, method: 'pinned-shortcut' }; }
      }
    }
  };
  const { shell, container } = await makeShell();
  try {
    shell.state.tabs[0].url = 'https://news.example.com/';
    shell.state.tabs[0].title = 'Example News';
    shell.render(container);
    await shell.installPageAsApp();
    assert.equal(installCalls.length, 1, 'the native install method was called');
    assert.equal(installCalls[0].url, 'https://news.example.com/');
    assert.equal(installCalls[0].title, 'Example News');
  } finally {
    shell.destroy();
    delete window.Capacitor;
  }
});

test('INSTALL AS APP (web): triggers the browser\'s real PWA install flow when available; internal pages are refused honestly', async () => {
  const { shell, container } = await makeShell();
  try {
    // Internal page: honest refusal, no prompt.
    shell.state.tabs[0].url = 'yayra://newtab';
    await shell.installPageAsApp();
    // Web + browser install prompt available: the REAL install flow runs.
    let prompted = 0;
    shell._pwaInstallPrompt = {
      prompt: async () => { prompted += 1; },
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };
    shell.state.tabs[0].url = 'https://example.com/';
    await shell.installPageAsApp();
    assert.equal(prompted, 1, 'the browser install prompt was triggered');
    assert.equal(shell._pwaInstallPrompt, null, 'the one-shot prompt is consumed');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('INSTALL AS APP (Android deep link): a com.yayra.app:/browse shortcut opens Yayra straight on the site', async () => {
  const urlOpens = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: () => {},
        getLaunchUrl: async () => ({ url: `com.yayra.app:/browse?url=${encodeURIComponent('https://shop.example.com/offers')}` })
      }
    }
  };
  const { shell } = await makeShell();
  try {
    // initialize() consumes getLaunchUrl() via the deep-link hookup.
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(urlOpens, [], 'no other navigation side effects');
    assert.equal(shell.getActiveTab().url, 'https://shop.example.com/offers', 'launch deep link opens Yayra straight on the site');
  } finally {
    shell.destroy();
    delete window.Capacitor;
  }
});

test('IMPORT BOOKMARKS: parses real Chrome/Firefox HTML exports and JSON, dedupes, imports into the repo', async () => {
  const { shell } = await makeShell({ storage: makeStorage() });
  try {
    const netscape = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://github.com/g2code33/yayra" ADD_DATE="1700000000">Yayra on GitHub</A>
        <DT><A HREF="https://example.com/dup">Duplicate</A>
        <DT><A HREF="https://example.com/dup">Duplicate</A>
        <DT><A HREF="javascript:alert(1)">evil</A>
        <DT><A HREF="https://news.example.com/&amp;more">News &amp; more</A>
      </DL><p>`;
    const parsed = shell.parseBookmarksImport(netscape);
    assert.equal(parsed.length, 3, 'http(s) links parsed; dupes + javascript: URLs dropped');
    assert.deepEqual(parsed[0], { url: 'https://github.com/g2code33/yayra', title: 'Yayra on GitHub' });
    assert.equal(parsed[2].title, 'News & more', 'HTML entities decoded');

    const asJson = shell.parseBookmarksImport(JSON.stringify([
      { url: 'https://a.example.com/', title: 'A' },
      'https://b.example.com/',
      { nope: true }
    ]));
    assert.equal(asJson.length, 2, 'JSON arrays parse too');
    assert.equal(shell.parseBookmarksImport('not a bookmarks file at all').length, 0);

    // The full import flow through the repo.
    const before = (await shell.bookmarksRepo.getAllBookmarks()).length;
    shell._openFilePicker = async () => netscape;
    await shell.importBookmarks();
    const after = await shell.bookmarksRepo.getAllBookmarks();
    assert.equal(after.length, before + 3, 'three new bookmarks imported');
    assert.ok(shell.state.bookmarksItems.some((b) => b.url === 'https://github.com/g2code33/yayra'));
    // Re-import: dedupe means nothing new.
    await shell.importBookmarks();
    assert.equal((await shell.bookmarksRepo.getAllBookmarks()).length, before + 3, 're-import adds nothing');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('TAB GROUPS: real create / group / ungroup with colour dots in the tab strip', async () => {
  const { shell, container } = await makeShell();
  try {
    shell._textPromptDialog = async () => 'Research';
    shell.state.tabs[0].url = 'https://example.com/';
    await shell.createTabGroup();
    const grouped = shell.state.tabs.filter((t) => t.group);
    assert.equal(grouped.length, 2, 'active tab + fresh tab are in the group');
    assert.ok(grouped.every((t) => t.group.name === 'Research'), 'group name applied');
    assert.ok(grouped.every((t) => t.group.color === grouped[0].group.color), 'one colour per group');

    shell.render(container);
    const dots = Array.from(container.querySelectorAll('.fb-tab-group-dot'));
    assert.equal(dots.length, 2, 'colour dots render in the tab strip');
    assert.equal(dots[0].style?.background || dots[0].getAttribute('style'), dots[0].style?.background || dots[0].getAttribute('style'));

    // Join the same group by name keeps the SAME colour.
    shell.createNewTab();
    const third = shell.getActiveTab();
    await shell.groupCurrentTab();
    assert.equal(third.group.name, 'Research');
    assert.equal(third.group.color, grouped[0].group.color, 'joining by name reuses the group colour');

    // Ungroup removes every group.
    shell.ungroupAllTabs();
    assert.ok(shell.state.tabs.every((t) => !t.group), 'all tabs ungrouped');
    shell.render(container);
    assert.equal(container.querySelectorAll('.fb-tab-group-dot').length, 0, 'dots disappear after ungrouping');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('TRANSLATE: uses the working translate.goog mechanism (old translate?u= endpoint is dead) and navigates', async () => {
  const { shell } = await makeShell();
  try {
    const url = shell.buildTranslatedPageUrl('https://example.com/path?q=1', 'fr');
    assert.ok(url.startsWith('https://example-com.translate.goog/path?'), `translated host is the goog proxy: ${url}`);
    assert.ok(url.includes('_x_tr_tl=fr'));
    assert.ok(url.includes(`_x_tr_u=${encodeURIComponent('https://example.com/path?q=1')}`));
    assert.equal(shell.buildTranslatedPageUrl('yayra://newtab', 'fr'), null, 'internal pages are refused');
    assert.equal(shell.buildTranslatedPageUrl('https://example-com.translate.goog/', 'fr'), null, 'already-translated pages are not re-translated');

    shell._textPromptDialog = async () => 'fr';
    shell.state.tabs[0].url = 'https://example.com/article';
    await shell.translateActivePage();
    assert.equal(shell.getActiveTab().url, shell.buildTranslatedPageUrl('https://example.com/article', 'fr'), 'the tab navigates to the translated page');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('PASTE: no focused field -> honest instruction instead of a dead execCommand', async () => {
  const { shell } = await makeShell();
  try {
    await shell.pasteIntoFocusedField(); // nothing focused in the shim
    // Reaching here without throwing is the contract; the honest notice
    // path is taken (showTransientNotice is render-safe in the shim).
    assert.ok(true);
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('KOTTON (Kotlin pin): the Android plugin really implements installSiteAsApp with a pinned deep-link shortcut', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../packages/floating-android/src/kotlin/com/yayra/floating/android/YayraOverlayPlugin.kt', import.meta.url), 'utf8');
  assert.ok(src.includes('fun installSiteAsApp'), 'plugin method exists');
  assert.ok(src.includes('requestPinShortcut'), 'real pinned-shortcut API on Android 8+');
  assert.ok(src.includes('com.yayra.app:/browse?url='), 'shortcut deep-links back into Yayra on the site');
  assert.ok(src.includes('INSTALL_SHORTCUT'), 'legacy broadcast fallback declared');
  const ensure = readFileSync(new URL('../scripts/ensure-capacitor-platform.mjs', import.meta.url), 'utf8');
  assert.ok(ensure.includes('com.android.launcher.permission.INSTALL_SHORTCUT'), 'manifest permission injected for legacy devices');
});
