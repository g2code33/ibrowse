/**
 * P39: real site logos in tabs + personal autofill in the address bar.
 *
 *  1. A tab showing a real website must display THAT SITE'S logo
 *     (favicon) in the tab strip - not a generic globe. The globe is
 *     only the under-image fallback; yayra:// pages keep their icons
 *     and the loading hourglass is untouched.
 *
 *  2. Typing in the omnibox must autofill from everything the user has
 *     used before: known links (history + bookmarks, matched anywhere
 *     in the address or title), and words/phrases they have actually
 *     searched before (recovered from search-result URLs in history).
 *     Addresses the user has used also inline-complete (score 0).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

async function makeShell() {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  shell.render(container);
  return shell;
}

test('tab shows the REAL site logo for web pages (globe only as under-image fallback)', async () => {
  const shell = await makeShell();
  const html = shell.getTabFavicon({ id: 't1', url: 'https://www.youtube.com/watch?v=abc', isLoading: false });
  assert.match(html, /fb-tab-site-logo/, 'real logo img rendered');
  assert.match(html, /icons\.duckduckgo\.com\/ip3\/www\.youtube\.com\.ico/, 'logo resolved from the site host');
  assert.match(html, /fb-tab-logo-fallback/, 'globe fallback kept underneath');
});

test('page-reported favicon wins over the icon service', async () => {
  const shell = await makeShell();
  const html = shell.getTabFavicon({ id: 't1', url: 'https://example.com/', favicon: 'https://example.com/fav.png', isLoading: false });
  assert.match(html, /src="https:\/\/example\.com\/fav\.png"/, 'the favicon the page itself reported is used');
});

test('hourglass while loading and internal-page icons are untouched', async () => {
  const shell = await makeShell();
  assert.match(
    shell.getTabFavicon({ id: 't1', url: 'https://example.com/', isLoading: true }),
    /fb-tab-loading-hourglass/,
    'time sign still shows while loading'
  );
  const settingsIcon = shell.getTabFavicon({ id: 't2', url: 'yayra://settings', isLoading: false });
  assert.doesNotMatch(settingsIcon, /fb-tab-site-logo/, 'yayra:// pages keep their own icons');
});

test('autofill matches known links from history AND bookmarks, anywhere in address or title', async () => {
  const shell = await makeShell();
  shell.state.historyItems = [
    { url: 'https://www.youtube.com/', title: 'YouTube' },
    { url: 'https://news.ycombinator.com/', title: 'Hacker News' },
    { url: 'ftp://ignored.example/', title: 'not web' }
  ];
  shell.state.bookmarksItems = [{ url: 'https://github.com/g2code33/yayra', title: 'yayra repo' }];

  const byAddressStart = shell.getAutofillMatches('you');
  assert.equal(byAddressStart[0].url, 'https://www.youtube.com/', 'address-start match ranks first');
  assert.equal(byAddressStart[0].score, 0, 'score 0 = inline-completable');

  const byTitle = shell.getAutofillMatches('hacker');
  assert.equal(byTitle[0].url, 'https://news.ycombinator.com/', 'title match found');

  const anywhere = shell.getAutofillMatches('code33');
  assert.equal(anywhere[0].url, 'https://github.com/g2code33/yayra', 'match ANYWHERE in the address, from bookmarks too');

  assert.equal(shell.getAutofillMatches('ignored').length, 0, 'non-web schemes never suggested');
});

test('words the user searched before are remembered and suggested', async () => {
  const shell = await makeShell();
  shell.state.historyItems = [
    { url: 'https://www.google.com/search?q=best+jollof+recipe', title: 'best jollof recipe - Google Search' },
    { url: 'https://duckduckgo.com/?q=electron+wayland+fix', title: 'DuckDuckGo' },
    { url: 'https://example.com/plain', title: 'Plain page' }
  ];
  const phrases = shell.getRememberedSearchPhrases();
  assert.ok(phrases.includes('best jollof recipe'), 'google search words recovered');
  assert.ok(phrases.includes('electron wayland fix'), 'duckduckgo search words recovered');

  const suggestions = shell.getLocalSearchSuggestions('jollof');
  assert.ok(suggestions.includes('best jollof recipe'), 'previously searched words resurface while typing');
});

test('dropdown shows personal autofill rows for typed text', async () => {
  const shell = await makeShell();
  shell.state.historyItems = [{ url: 'https://www.youtube.com/', title: 'YouTube' }];

  const input = document.createElement('input');
  input.dataset = input.dataset || {};
  const host = document.createElement('div');
  host.className = 'fb-omnibox-container';
  host.appendChild(input);
  input.closest = (sel) => (sel === '.fb-omnibox-container' ? host : null);
  shell.bindSearchSuggestions(input);

  const matches = shell.getAutofillMatches('youtu');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, 'history');
  assert.equal(matches[0].title, 'YouTube');
});
