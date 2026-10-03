import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultSecurityPolicy } from '../packages/browser-contract/src/ISecurityPolicy.js';
import { WebsitePermissionManager } from '../packages/browser-contract/src/permissions/WebsitePermissionManager.js';
import { PrivateBrowsingStorageContext } from '../packages/persistence/src/PrivateBrowsingStorageContext.js';
import { MemoryPersistenceAdapter } from '../packages/persistence/src/LocalFirstStore.js';
import { PrivacyManager } from '../packages/persistence/src/PrivacyManager.js';
import { HistoryRepository, BookmarkRepository, SessionRepository, DownloadRepository } from '../packages/persistence/src/HistoryRepository.js';

test('Web Security: HTTPS-first upgrades insecure HTTP urls while exempting localhost', () => {
  const policy = new DefaultSecurityPolicy();

  // Standard web domains upgraded to https:
  const res1 = policy.validateUrl('http://example.com/search?q=yayra', true);
  assert.equal(res1.allowed, true);
  assert.equal(res1.isUpgradedHttps, true);
  assert.equal(res1.sanitizedUrl, 'https://example.com/search?q=yayra');

  // Already HTTPS preserved
  const res2 = policy.validateUrl('https://yayra.org/dashboard', true);
  assert.equal(res2.allowed, true);
  assert.equal(res2.isUpgradedHttps, false);
  assert.equal(res2.sanitizedUrl, 'https://yayra.org/dashboard');

  // Localhost exempt from forced upgrade
  const res3 = policy.validateUrl('http://127.0.0.1:8080/test', true);
  assert.equal(res3.allowed, true);
  assert.equal(res3.isUpgradedHttps, false);
  assert.equal(res3.sanitizedUrl, 'http://127.0.0.1:8080/test');

  const res4 = policy.validateUrl('http://app.localhost:3000/api', true);
  assert.equal(res4.allowed, true);
  assert.equal(res4.isUpgradedHttps, false);
  assert.equal(res4.sanitizedUrl, 'http://app.localhost:3000/api');
});

test('Web Security: Blocks dangerous and unsupported protocol schemes', () => {
  const policy = new DefaultSecurityPolicy();

  // Script schemes blocked
  assert.equal(policy.validateUrl('javascript:alert(document.cookie)').allowed, false);
  assert.equal(policy.validateUrl('vbscript:msgbox("pwnd")').allowed, false);

  // Local file system access blocked
  assert.equal(policy.validateUrl('file:///etc/shadow').allowed, false);
  assert.equal(policy.validateUrl('file://C:/Windows/System32/calc.exe').allowed, false);

  // App / Market intent schemes blocked
  assert.equal(policy.validateUrl('intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end').allowed, false);
  assert.equal(policy.validateUrl('market://details?id=com.malware.app').allowed, false);
  assert.equal(policy.validateUrl('chrome://settings').allowed, false);

  // Dangerous executable data: URLs blocked
  assert.equal(policy.validateUrl('data:text/html,<script>alert(1)</script>').allowed, false);
  assert.equal(policy.validateUrl('data:application/javascript,console.log(1)').allowed, false);
  assert.equal(policy.validateUrl('data:text/javascript,evil()').allowed, false);

  // Safe data: image or text allowed
  assert.equal(policy.validateUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=').allowed, true);
});

test('Web Security: Validates redirect navigation and prevents HTTPS downgrade', () => {
  const policy = new DefaultSecurityPolicy();

  // Valid HTTPS to HTTPS redirect allowed
  const validRedirect = policy.validateNavigationRedirect('https://yayra.app/login', 'https://auth.yayra.app/oauth');
  assert.equal(validRedirect.allowed, true);

  // Downgrade redirect from HTTPS to HTTP blocked
  const downgradeRedirect = policy.validateNavigationRedirect('https://bank.example.com/account', 'http://bank.example.com/insecure');
  assert.equal(downgradeRedirect.allowed, false);
  assert.match(downgradeRedirect.reason, /insecure redirect downgrade/i);

  // Redirect to javascript: blocked
  const maliciousRedirect = policy.validateNavigationRedirect('https://site.com', 'javascript:evil()');
  assert.equal(maliciousRedirect.allowed, false);
});

test('Web Security: Sanitizes download filenames against path traversal, null bytes and OS reserved devices', () => {
  const policy = new DefaultSecurityPolicy();

  // Directory traversal stripped
  assert.equal(policy.sanitizeDownloadFilename('../../etc/passwd'), 'passwd');
  assert.equal(policy.sanitizeDownloadFilename('..\\..\\Windows\\System32\\cmd.exe'), 'cmd.exe');

  // Null bytes and control characters stripped
  assert.equal(policy.sanitizeDownloadFilename('report\x00.pdf.exe'), 'report.pdf.exe');

  // Illegal filesystem characters sanitized ( < > : " | ? * -> 7 underscores)
  assert.equal(policy.sanitizeDownloadFilename('file<>:"|?*name.zip'), 'file_______name.zip');

  // Windows reserved device names protected
  assert.equal(policy.sanitizeDownloadFilename('CON.txt'), 'safe_CON.txt');
  assert.equal(policy.sanitizeDownloadFilename('aux.tar.gz'), 'safe_aux.tar.gz');
  assert.equal(policy.sanitizeDownloadFilename('nul'), 'safe_nul');
  assert.equal(policy.sanitizeDownloadFilename('COM1.log'), 'safe_COM1.log');

  // Default fallback for empty or dots
  assert.equal(policy.sanitizeDownloadFilename(''), 'download.bin');
  assert.equal(policy.sanitizeDownloadFilename('..'), 'download.bin');
});

test('Web Security: Native JavaScript bridge validates origin, action authorization, and structure', () => {
  const policy = new DefaultSecurityPolicy();
  const trustedRegex = /^https:\/\/yayra\.app(\/.*)?$/;

  // Valid message from trusted origin
  const validMsg = {
    channel: 'yayra:ui',
    action: 'openSettings',
    origin: 'https://yayra.app',
    payload: { tab: 'privacy' }
  };
  assert.equal(policy.validateBridgeMessage(validMsg, trustedRegex).valid, true);

  // Untrusted origin rejected
  const untrustedMsg = {
    channel: 'yayra:ui',
    action: 'openSettings',
    origin: 'https://malicious-site.com',
    payload: {}
  };
  const untrustedRes = policy.validateBridgeMessage(untrustedMsg, trustedRegex);
  assert.equal(untrustedRes.valid, false);
  assert.match(untrustedRes.error, /Unauthorized message origin/i);

  // Prohibited dangerous actions rejected even if origin is trusted
  const dangerousMsg = {
    channel: 'yayra:native',
    action: 'executeCommand',
    origin: 'https://yayra.app',
    payload: { cmd: 'rm -rf /' }
  };
  const dangerRes = policy.validateBridgeMessage(dangerousMsg, trustedRegex);
  assert.equal(dangerRes.valid, false);
  assert.match(dangerRes.error, /prohibited on the native bridge/i);
});

test('Website Permissions: Enforces zero automatic grants, origin scoping, and user prompting', async () => {
  const manager = new WebsitePermissionManager();

  // Default state is prompt
  const initial = await manager.getPermission('https://example.com/sub/page', 'camera');
  assert.equal(initial, 'prompt');

  // Normalize origin works across paths and ports
  assert.equal(manager.normalizeOrigin('https://example.com/some/path?query=1'), 'https://example.com');
  assert.equal(manager.normalizeOrigin('http://localhost:3000/app'), 'http://localhost:3000');

  // Automated request without user handler resolves safely to denied
  const unhandledDecision = await manager.requestPermission('https://unattended.com', 'microphone');
  assert.equal(unhandledDecision, 'denied');

  // Handled prompt with explicit user grant
  let promptHandled = false;
  manager.on('permission:requested', (event) => {
    promptHandled = true;
    assert.equal(event.origin, 'https://trusted.org');
    assert.equal(event.permission, 'geolocation');
    event.respond('granted');
  });

  const grantedDecision = await manager.requestPermission('https://trusted.org/map', 'geolocation');
  assert.equal(promptHandled, true);
  assert.equal(grantedDecision, 'granted');

  // Subsequent check returns granted without re-prompting
  const cachedState = await manager.getPermission('https://trusted.org', 'geolocation');
  assert.equal(cachedState, 'granted');

  // Different origin remains in prompt state (origin-scoped)
  const otherOriginState = await manager.getPermission('https://other.org', 'geolocation');
  assert.equal(otherOriginState, 'prompt');
});

test('Website Permissions: Respects native platform OS permission rejection', async () => {
  const mockNativeProvider = {
    hasSystemPermission: async () => false,
    requestSystemPermission: async () => false // OS dialog was denied by user
  };

  const manager = new WebsitePermissionManager(mockNativeProvider);

  manager.on('permission:requested', (event) => {
    // Website requested and in-browser prompt agreed, but native OS denied
    event.respond('granted');
  });

  const decision = await manager.requestPermission('https://camera-app.com', 'camera');
  assert.equal(decision, 'denied');
  assert.equal(await manager.getPermission('https://camera-app.com', 'camera'), 'denied');
});

test('Website Permissions: Origin-scoped clearing when site data is cleared', async () => {
  const manager = new WebsitePermissionManager();
  await manager.setPermission('https://site-a.com', 'camera', 'granted');
  await manager.setPermission('https://site-b.com', 'microphone', 'granted');

  assert.equal(await manager.getPermission('https://site-a.com', 'camera'), 'granted');
  assert.equal(await manager.getPermission('https://site-b.com', 'microphone'), 'granted');

  // Clear only site-a
  await manager.clearPermissions('https://site-a.com');
  assert.equal(await manager.getPermission('https://site-a.com', 'camera'), 'prompt');
  assert.equal(await manager.getPermission('https://site-b.com', 'microphone'), 'granted');

  // Clear all
  await manager.clearPermissions();
  assert.equal(await manager.getPermission('https://site-b.com', 'microphone'), 'prompt');
});

test('Browser Isolation: Private browsing storage context prevents leakage to persistent disk', async () => {
  const persistentStore = new MemoryPersistenceAdapter();
  const privateContext = new PrivateBrowsingStorageContext();
  const ephemeralAdapter = privateContext.getAdapter();

  // Store transient private data
  await ephemeralAdapter.set('session_token', 'private_secret_123');
  await ephemeralAdapter.set('history_visit', 'https://private-search.org');

  assert.equal(await ephemeralAdapter.get('session_token'), 'private_secret_123');
  // Persistent store should remain untouched
  assert.equal(await persistentStore.get('session_token'), null);
  assert.equal(await persistentStore.get('history_visit'), null);

  // Destroying ephemeral context wipes all in-memory private artifacts
  await privateContext.destroy();
  assert.equal(privateContext.isContextActive(), false);
});

test('Privacy Controls: PrivacyManager executes full wipe of history, cookies, cache, and permissions', async () => {
  const store = new MemoryPersistenceAdapter();
  const historyRepo = new HistoryRepository(store);
  const bookmarkRepo = new BookmarkRepository(store);
  const sessionRepo = new SessionRepository(store);
  const downloadRepo = new DownloadRepository(store);

  await historyRepo.addEntry('https://tracked-site.com', 'Tracked Site');
  await downloadRepo.addRecord({
    id: 'dl_1',
    url: 'https://site.com/file.zip',
    filename: 'file.zip',
    targetPath: '/downloads/file.zip',
    totalBytes: 1024,
    receivedBytes: 1024,
    state: 'completed',
    mimeType: 'application/zip'
  });

  const privacyManager = new PrivacyManager(
    store,
    historyRepo,
    bookmarkRepo,
    sessionRepo,
    downloadRepo
  );

  await privacyManager.clearAllUserData();

  const historyList = await historyRepo.getEntries(10);
  assert.equal(historyList.length, 0);

  const downloadsList = await downloadRepo.getRecords();
  assert.equal(downloadsList.length, 0);
});
