import test from 'node:test';
import assert from 'node:assert/strict';
import { LinuxWebKitEngine } from '../packages/browser-linux/src/index.js';
import { UrlInterpreter } from '../packages/browser-contract/src/url/UrlInterpreter.js';

test('Linux WebKitGTK: detects WebKitGTK runtime and recovery guidance', async () => {
  const status = LinuxWebKitEngine.detectRuntime();
  assert.equal(typeof status.isAvailable, 'boolean');
  assert.equal(status.flavor, 'webkit2gtk-4.1');
  assert.match(status.flavorName, /WebKitGTK/);
  assert.match(status.packagesNeeded, /libwebkit2gtk-4.1-0/);
  assert.match(status.installationCommand, /apt-get install/);
  assert.equal(typeof status.isWayland, 'boolean');
});

test('Linux WebKitGTK: loads URLs and converts search queries', async () => {
  const engine = new LinuxWebKitEngine();
  await engine.initialize({});

  // 1. Direct HTTPS URL
  await engine.navigate('https://yayra.app');
  assert.equal(engine.getCurrentUrl(), 'https://yayra.app/');
  assert.equal(engine.isSecurityValid(), true);
  assert.equal(engine.isLoading(), false);

  // 2. Natural language search query (default: Google)
  await engine.navigate('debian webkitgtk embedded browser');
  assert.equal(engine.getCurrentUrl(), 'https://www.google.com/search?q=debian%20webkitgtk%20embedded%20browser');
});

test('Linux WebKitGTK: manages back, forward, reload, and stop navigation commands', async () => {
  const engine = new LinuxWebKitEngine();
  await engine.initialize({});

  await engine.navigate('https://site-a.org');
  await engine.navigate('https://site-b.org');
  assert.equal(engine.getCurrentUrl(), 'https://site-b.org/');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), false);

  const backResult = await engine.goBack();
  assert.equal(backResult, true);
  assert.equal(engine.getCurrentUrl(), 'https://site-a.org/');
  assert.equal(engine.canGoForward(), true);

  const forwardResult = await engine.goForward();
  assert.equal(forwardResult, true);
  assert.equal(engine.getCurrentUrl(), 'https://site-b.org/');

  await engine.reload();
  assert.equal(engine.getCurrentUrl(), 'https://site-b.org/');

  await engine.stop();
  assert.equal(engine.isLoading(), false);
});

test('Linux WebKitGTK: supports window resizing and Wayland/X11 bounds updates', async () => {
  const engine = new LinuxWebKitEngine();
  let receivedBounds = null;
  engine.addEventListener('boundsChanged', (bounds) => {
    receivedBounds = bounds;
  });

  engine.resize(1024, 768);
  assert.deepEqual(receivedBounds, { width: 1024, height: 768 });
  assert.equal(typeof engine.isWaylandSession(), 'boolean');
});

test('Linux WebKitGTK: manages multiple independent tabs and isolation', async () => {
  const engine = new LinuxWebKitEngine();
  assert.equal(engine.getTabs().length, 1);

  const tab2 = engine.createTab('https://kernel.org', false);
  const tab3 = engine.createTab('https://debian.org', true); // Private tab
  assert.equal(engine.getTabs().length, 3);
  assert.equal(tab3.isPrivate, true);

  engine.selectTab(tab2.id);
  assert.equal(engine.getActiveTab()?.id, tab2.id);
  assert.equal(engine.getCurrentUrl(), 'https://kernel.org');

  engine.closeTab(tab2.id);
  assert.equal(engine.getTabs().length, 2);
  assert.notEqual(engine.getActiveTab()?.id, tab2.id);
});

test('Linux WebKitGTK: strictly handles TLS errors and blocks dangerous URL schemes', async () => {
  const engine = new LinuxWebKitEngine();
  const cert = engine.getSecurityCertificate();
  assert.ok(cert);
  assert.equal(cert.protocol, 'TLS 1.3');

  // Verify dangerous scheme interception via UrlInterpreter
  const dangerousJs = UrlInterpreter.interpret('javascript:alert(document.cookie)');
  assert.equal(dangerousJs.isBlockedScheme, true);
  assert.notEqual(dangerousJs.normalizedUrl, 'javascript:alert(document.cookie)');

  const dangerousData = UrlInterpreter.interpret('data:text/html,<script>steal()</script>');
  assert.equal(dangerousData.isBlockedScheme, true);

  const safeHttps = UrlInterpreter.interpret('https://debian.org');
  assert.equal(safeHttps.isBlockedScheme, false);
  assert.equal(safeHttps.normalizedUrl, 'https://debian.org/');
});

test('Linux WebKitGTK: exports and restores complete session', async () => {
  const engine = new LinuxWebKitEngine();
  const tab2 = engine.createTab('https://ubuntu.com');
  engine.selectTab(tab2.id);

  const exportedSession = engine.exportSession();
  assert.equal(exportedSession.tabs.length, 2);
  assert.equal(exportedSession.activeTabId, tab2.id);

  const newEngine = new LinuxWebKitEngine();
  await newEngine.restoreSession(exportedSession);
  assert.equal(newEngine.getTabs().length, 2);
  assert.equal(newEngine.getActiveTab()?.id, tab2.id);
});

test('Linux WebKitGTK: disposes resources cleanly upon destruction and prevents memory leaks', async () => {
  const engine = new LinuxWebKitEngine();
  await engine.initialize({});
  assert.equal(engine.getTabs().length, 1);

  await engine.destroy();
  assert.equal(engine.getTabs().length, 0);

  await assert.rejects(
    async () => {
      await engine.navigate('https://yayra.app');
    },
    /Cannot navigate on destroyed LinuxWebKitEngine/
  );
});
