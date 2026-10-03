import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Colors,
  Typography,
  Spacing,
  Radius,
  Blur,
  ThemeManager,
  Icons,
  GlassCard,
  Button,
  Input,
  Toggle,
  Dialog,
  Loading,
  FloatingBubble,
  WindowControls,
  BrowserToolbar,
  MainDashboard
} from '../packages/shared-ui/src/index.js';

test('Theme Tokens: Colors definition contains required palette and glass tokens', () => {
  assert.ok(Colors.dark.bgDeepNavy === '#060b19' || Colors.dark.bgDeepNavy.startsWith('#0'));
  assert.ok(Colors.dark.bgSurfaceNavy);
  assert.ok(Colors.dark.accentCyan);
  assert.ok(Colors.dark.accentBlue);
  assert.ok(Colors.dark.glassFill);
  assert.ok(Colors.dark.glassBorder);
  assert.ok(Colors.dark.statusActive);
  assert.ok(Colors.dark.statusInactive);
  assert.ok(Colors.dark.statusWarning);

  assert.ok(Colors.light.bgDeepNavy);
  assert.ok(Colors.light.accentCyan);
  assert.ok(Colors.light.glassFill);
});

test('Theme Tokens: Typography scale & Spacing grid enforce design consistency', () => {
  assert.equal(Spacing.xs, 4);
  assert.equal(Spacing.sm, 8);
  assert.equal(Spacing.md, 12);
  assert.equal(Spacing.base, 16);
  assert.equal(Spacing.lg, 24);
  assert.equal(Spacing.xl, 32);

  assert.equal(Radius.sm, 6);
  assert.equal(Radius.md, 10);
  assert.equal(Radius.lg, 16);
  assert.equal(Radius.xl, 24);
  assert.equal(Radius.full, 9999);

  assert.equal(Blur.sm, 8);
  assert.equal(Blur.md, 16);
  assert.equal(Blur.lg, 24);

  assert.ok(Typography.fontFamily.sans);
  assert.ok(Typography.fontSize.h1);
  assert.ok(Typography.fontSize.body);
});

test('ThemeManager: manages dark/light/system mode and exports CSS custom properties', () => {
  let savedMode = null;
  const manager = new ThemeManager('dark', (mode) => {
    savedMode = mode;
  });

  assert.equal(manager.getMode(), 'dark');
  assert.equal(manager.getEffectiveMode(), 'dark');

  const cssProps = manager.getCssCustomProperties();
  assert.ok(cssProps['--fb-bg-deep']);
  assert.ok(cssProps['--fb-accent-primary']);
  assert.ok(cssProps['--fb-glass-fill']);
  assert.ok(cssProps['--fb-radius-lg']);

  const cssText = manager.generateCssCustomPropertiesText();
  assert.ok(cssText.includes('--fb-bg-deep:'));
  assert.ok(cssText.includes('--fb-accent-primary:'));

  const nextMode = manager.toggleMode();
  assert.equal(nextMode, 'light');
  assert.equal(manager.getMode(), 'light');
  assert.equal(savedMode, 'light');

  manager.setMode('system');
  assert.equal(manager.getMode(), 'system');
  assert.ok(['dark', 'light'].includes(manager.getEffectiveMode()));
});

test('Icons: provides valid SVG markup and distinctive FloatBrowse glass orb logo', () => {
  assert.ok(Icons.logoOrb.includes('<svg'));
  assert.ok(Icons.logoOrb.includes('orbGradient'));
  assert.ok(Icons.logoOrb.includes('circle'));
  assert.ok(Icons.logoOrb.includes('path'));

  // Verify all essential browser navigation icons
  const requiredIcons = [
    'arrowLeft', 'arrowRight', 'refresh', 'home', 'search',
    'lock', 'shield', 'bookmark', 'history', 'download',
    'settings', 'plus', 'close', 'minimize', 'maximize',
    'restore', 'chevronDown', 'pin', 'sun', 'moon', 'globe'
  ];

  requiredIcons.forEach((key) => {
    assert.ok(typeof Icons[key] === 'string' && Icons[key].includes('<svg'), `Missing or invalid SVG for ${key}`);
  });
});

test('FloatingBubble: computes boundary constraints and screen snapping physics', () => {
  // Bubble at (10, 100) on 400px wide screen should snap to left edge (12px padding)
  const leftSnap = FloatingBubble.calculateSnapPosition({ x: 10, y: 100 }, 56, 400, 800, 12);
  assert.equal(leftSnap.x, 12);
  assert.equal(leftSnap.y, 100);

  // Bubble at (350, 100) on 400px wide screen should snap to right edge (400 - 56 - 12 = 332px)
  const rightSnap = FloatingBubble.calculateSnapPosition({ x: 350, y: 100 }, 56, 400, 800, 12);
  assert.equal(rightSnap.x, 332);
  assert.equal(rightSnap.y, 100);

  // Clamping within screen bounds
  const clampedSnap = FloatingBubble.calculateSnapPosition({ x: 200, y: -50 }, 56, 400, 800, 12);
  assert.equal(clampedSnap.y, 12); // Snapped to min top bound

  const clampedBottomSnap = FloatingBubble.calculateSnapPosition({ x: 200, y: 900 }, 56, 400, 800, 12);
  assert.equal(clampedBottomSnap.y, 800 - 56 - 12); // Snapped to max bottom bound
});

test('MainDashboard: initializes with local-first configuration and switches tabs', async () => {
  let startedFloating = false;
  let launchedUrl = null;
  const mockSettings = {
    desktopFloatingMode: 'circle-first',
    theme: 'dark',
    searchEngine: 'duckduckgo',
    startUrl: 'https://duckduckgo.com',
    defaultZoom: 1.0,
    hardwareAcceleration: true,
    adBlockEnabled: true,
    clearHistoryOnExit: false,
    glassmorphismBlurRadius: 20,
    glassmorphismOpacity: 0.88
  };

  const dashboard = new MainDashboard({
    platform: 'linux',
    settingsRepo: {
      getSettings: async () => mockSettings,
      updateSettings: async (updates) => ({ ...mockSettings, ...updates })
    },
    onStartFloating: () => { startedFloating = true; },
    onLaunchBrowser: (url) => { launchedUrl = url; }
  });

  await dashboard.initialize();
  assert.equal(dashboard.state.settings.desktopFloatingMode, 'circle-first');
  assert.equal(dashboard.state.platform, 'linux');
  assert.equal(dashboard.state.activeTab, 'overview');

  dashboard.switchTab('settings');
  assert.equal(dashboard.state.activeTab, 'settings');

  dashboard.switchTab('history');
  assert.equal(dashboard.state.activeTab, 'history');
});
