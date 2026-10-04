import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseAppModeUrl, sanitizeAppName, buildInstallPlan } = require('../electron/appMode.cjs');

test('parseAppModeUrl extracts a valid https --app url', () => {
  assert.equal(
    parseAppModeUrl(['/usr/bin/yayra', '--app=https://music.youtube.com/']),
    'https://music.youtube.com/'
  );
});

test('parseAppModeUrl strips surrounding quotes (desktop Exec lines quote the url)', () => {
  assert.equal(
    parseAppModeUrl(['yayra', '--app="https://example.com/dash?x=1"']),
    'https://example.com/dash?x=1'
  );
});

test('parseAppModeUrl rejects unsafe schemes and missing flag', () => {
  assert.equal(parseAppModeUrl(['yayra', '--app=javascript:alert(1)']), null);
  assert.equal(parseAppModeUrl(['yayra', '--app=file:///etc/passwd']), null);
  assert.equal(parseAppModeUrl(['yayra', '--app=chrome://settings']), null);
  assert.equal(parseAppModeUrl(['yayra', 'https://example.com']), null);
  assert.equal(parseAppModeUrl([]), null);
  assert.equal(parseAppModeUrl(undefined), null);
});

test('sanitizeAppName cleans filesystem-hostile characters and falls back to host', () => {
  assert.equal(sanitizeAppName('My: App/Name?', 'https://example.com'), 'My App Name');
  assert.equal(sanitizeAppName('', 'https://music.youtube.com/'), 'music.youtube.com');
});

test('buildInstallPlan linux: desktop + applications-menu .desktop entries launching yayra --app', () => {
  const plan = buildInstallPlan({
    platform: 'linux',
    execPath: '/opt/Yayra/yayra',
    url: 'https://music.youtube.com/',
    title: 'YouTube Music',
    desktopDir: '/home/me/Desktop',
    applicationsDir: '/home/me/.local/share/applications',
    iconPath: '/opt/Yayra/icon.png'
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.name, 'YouTube Music');
  assert.equal(plan.inLauncher, true);
  assert.equal(plan.artifacts.length, 2);
  const [desktop, launcher] = plan.artifacts;
  assert.equal(desktop.path, '/home/me/Desktop/YouTube Music.desktop');
  assert.equal(launcher.path, '/home/me/.local/share/applications/yayra-app-youtube-music.desktop');
  for (const artifact of plan.artifacts) {
    assert.equal(artifact.kind, 'file');
    assert.equal(artifact.executable, true);
    assert.match(artifact.contents, /^\[Desktop Entry\]\n/);
    assert.ok(artifact.contents.includes('Exec="/opt/Yayra/yayra" --app="https://music.youtube.com/"'));
    assert.ok(artifact.contents.includes('Name=YouTube Music'));
    assert.ok(artifact.contents.includes('Icon=/opt/Yayra/icon.png'));
    assert.ok(artifact.contents.includes('Terminal=false'));
  }
});

test('buildInstallPlan linux without applicationsDir: desktop entry only, not in launcher', () => {
  const plan = buildInstallPlan({
    platform: 'linux',
    execPath: '/opt/Yayra/yayra',
    url: 'https://example.com/',
    title: 'Example',
    desktopDir: '/home/me/Desktop'
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.inLauncher, false);
  assert.equal(plan.artifacts.length, 1);
  assert.ok(!plan.artifacts[0].contents.includes('Icon='));
});

test('buildInstallPlan win32: desktop + Start Menu shortcuts with --app args', () => {
  const plan = buildInstallPlan({
    platform: 'win32',
    execPath: 'C:\\Yayra\\yayra.exe',
    url: 'https://example.com/app',
    title: 'Example App',
    desktopDir: 'C:\\Users\\me\\Desktop',
    startMenuDir: 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
    iconPath: 'C:\\Yayra\\yayra.ico'
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.inLauncher, true);
  assert.equal(plan.artifacts.length, 2);
  const [desktop, startMenu] = plan.artifacts;
  assert.equal(desktop.kind, 'shortcut');
  assert.equal(desktop.path, 'C:\\Users\\me\\Desktop\\Example App.lnk');
  assert.ok(startMenu.path.endsWith('\\Programs\\Example App.lnk'));
  for (const artifact of plan.artifacts) {
    assert.equal(artifact.options.target, 'C:\\Yayra\\yayra.exe');
    assert.equal(artifact.options.args, '--app="https://example.com/app"');
    assert.equal(artifact.options.icon, 'C:\\Yayra\\yayra.ico');
  }
});

test('buildInstallPlan darwin: honest unsupported-platform', () => {
  const plan = buildInstallPlan({
    platform: 'darwin',
    execPath: '/Applications/Yayra.app/Contents/MacOS/Yayra',
    url: 'https://example.com/',
    title: 'Example',
    desktopDir: '/Users/me/Desktop'
  });
  assert.deepEqual(plan, { ok: false, reason: 'unsupported-platform' });
});

test('buildInstallPlan rejects invalid or non-http urls and missing paths', () => {
  assert.deepEqual(
    buildInstallPlan({ platform: 'linux', execPath: '/x', url: 'yayra://newtab', desktopDir: '/d' }),
    { ok: false, reason: 'invalid-url' }
  );
  assert.deepEqual(
    buildInstallPlan({ platform: 'linux', execPath: '/x', url: 'not a url', desktopDir: '/d' }),
    { ok: false, reason: 'invalid-url' }
  );
  assert.deepEqual(
    buildInstallPlan({ platform: 'linux', execPath: '', url: 'https://example.com', desktopDir: '/d' }),
    { ok: false, reason: 'missing-paths' }
  );
});
