import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Chrome-style tab strip layout.
 *
 * 1. Tabs are width-capped (CSS flex: 0 1 220px + min-width floor) so a
 *    long page title can never produce a giant tab, and they shrink
 *    together as more tabs open - the CSS lives in design-system.css;
 *    what the DOM must guarantee is the structure below.
 * 2. The "+" new-tab button is a SIBLING of the scrollable tab row, not a
 *    child of it - that is what keeps it permanently visible when many
 *    tabs force the row into horizontal scrolling.
 */

test('"+" button is pinned OUTSIDE the scrollable tab row so it never scrolls out of sight', async () => {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  const el = shell.render(container);

  const newTabBtn = el.querySelector('.fb-btn-newtab');
  assert.ok(newTabBtn, 'new-tab button rendered');
  assert.ok(
    String(newTabBtn.parentElement.className).includes('fb-chrome-tabstrip'),
    'parent is the tab strip itself, NOT the scrollable row'
  );
  assert.ok(
    !String(newTabBtn.parentElement.className).includes('fb-tabs-scroll-container'),
    'must not live inside the overflow-x container'
  );
});

test('with MANY tabs the "+" button stays a pinned sibling and still creates tabs', async () => {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  for (let i = 0; i < 14; i += 1) shell.createNewTab();
  const el = shell.render(container);

  assert.equal(shell.state.tabs.length, 15);
  const scroll = el.querySelector('.fb-tabs-scroll-container');
  const tabs = scroll.querySelectorAll('.fb-tab-item');
  assert.equal(tabs.length, 15, 'all tabs live in the scrollable row');

  const newTabBtn = el.querySelector('.fb-btn-newtab');
  assert.ok(String(newTabBtn.parentElement.className).includes('fb-chrome-tabstrip'));

  newTabBtn.click();
  assert.equal(shell.state.tabs.length, 16, 'pinned button still works at high tab counts');
});
