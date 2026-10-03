import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../packages/shared-core/src/events.js';
import { NavigationController } from '../packages/shared-core/src/navigation.js';

test('NavigationController creates, switches, and closes tabs with event emission', () => {
  const bus = new EventBus();
  const nav = new NavigationController(bus);

  const createdEvents = [];
  bus.on('tab:created', (payload) => createdEvents.push(payload.tab));

  const tab1 = nav.createTab('https://example.com');
  assert.equal(createdEvents.length, 1);
  assert.equal(tab1.url, 'https://example.com');
  assert.equal(tab1.isSecure, true);
  assert.equal(nav.getActiveTab()?.id, tab1.id);

  const tab2 = nav.createTab('https://yayra.app');
  assert.equal(createdEvents.length, 2);
  assert.equal(nav.getAllTabs().length, 2);

  nav.switchTab(tab2.id);
  assert.equal(nav.getActiveTab()?.id, tab2.id);

  nav.closeTab(tab2.id);
  assert.equal(nav.getAllTabs().length, 1);
  assert.equal(nav.getActiveTab()?.id, tab1.id);
});

test('NavigationController sanitizes URLs and falls back to search engine query', () => {
  const bus = new EventBus();
  const nav = new NavigationController(bus);

  assert.equal(nav.sanitizeUrl(''), 'about:blank');
  assert.equal(nav.sanitizeUrl('https://wikipedia.org'), 'https://wikipedia.org');
  assert.equal(nav.sanitizeUrl('github.com'), 'https://github.com');
  assert.equal(nav.sanitizeUrl('quantum computing news'), 'https://duckduckgo.com/?q=quantum%20computing%20news');
});
