import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

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
  BrowserToolbar
} from '../packages/shared-ui/src/index.js';

test('UI Components: Colors, Typography, Spacing, Icons definitions are complete', () => {
  assert.equal(typeof Colors.dark.bgDeepNavy, 'string');
  assert.equal(typeof Colors.light.bgDeepNavy, 'string');
  assert.equal(typeof Typography.fontSize.h1, 'string');
  assert.equal(typeof Spacing.base, 'number');
  assert.equal(typeof Radius.lg, 'number');
  assert.equal(typeof Blur.md, 'number');
  assert.ok(Icons.logoOrb.length > 50);
});

test('UI Components: WindowControls renders for Windows and Linux layouts', () => {
  let minFired = false;
  let maxFired = false;
  let closeFired = false;

  // Windows layout
  const winEl = WindowControls.render({
    platform: 'windows',
    isMaximized: false,
    onMinimize: () => { minFired = true; },
    onMaximize: () => { maxFired = true; },
    onClose: () => { closeFired = true; }
  });

  assert.ok(winEl.className.includes('fb-window-controls'));
  assert.ok(winEl.className.includes('fb-window-controls-windows'));

  // Linux layout
  const linuxEl = WindowControls.render({
    platform: 'linux',
    isMaximized: true,
    onMinimize: () => {},
    onMaximize: () => {},
    onClose: () => {}
  });

  assert.ok(linuxEl.className.includes('fb-window-controls-linux'));
});

test('UI Components: BrowserToolbar renders URL bar, tabs, and action buttons', () => {
  let navUrl = null;
  const toolbarEl = BrowserToolbar.render({
    currentUrl: 'https://duckduckgo.com',
    canGoBack: true,
    canGoForward: false,
    isLoading: false,
    tabs: [
      { id: 't1', title: 'DuckDuckGo Search', url: 'https://duckduckgo.com', active: true },
      { id: 't2', title: 'GitHub', url: 'https://github.com', active: false }
    ],
    onNavigate: (url) => { navUrl = url; }
  });

  assert.ok(toolbarEl.className.includes('fb-browser-toolbar'));
});

test('UI Components: GlassCard renders interactive container and stat variants', () => {
  const card = GlassCard.render({
    title: 'Storage Metrics',
    subtitle: 'Local-first IndexedDB',
    content: '5.2 MB used',
    variant: 'subtle',
    interactive: true
  });

  assert.ok(card.className.includes('fb-glass-card'));

  const statCard = GlassCard.renderStatCard('Memory Usage', '42 MB', 'WebKitGTK isolated sandbox', Icons.shield);
  assert.ok(statCard.className.includes('fb-glass-card'));
});

test('UI Components: Button renders multiple variants, icons, and loading states', () => {
  let clicked = false;
  const btn = Button.render({
    label: 'Launch Window',
    variant: 'primary',
    size: 'lg',
    icon: Icons.externalLink,
    onClick: () => { clicked = true; }
  });

  assert.ok(btn.className.includes('fb-btn-primary'));
  assert.ok(btn.className.includes('fb-btn-lg'));

  const loadingBtn = Button.render({
    label: 'Syncing',
    loading: true
  });

  assert.ok(loadingBtn.className.includes('fb-btn-loading'));
  assert.ok(loadingBtn.disabled);
});

test('UI Components: Input renders search, text, prefix icons, and clear buttons', () => {
  const { container, input } = Input.render({
    type: 'search',
    placeholder: 'Search the web...',
    prefixIcon: Icons.search,
    value: 'https://example.com'
  });

  assert.ok(container.className.includes('fb-input-wrapper'));
  assert.equal(input.value, 'https://example.com');
});

test('UI Components: Toggle renders switch with reactive state callback', () => {
  let changedVal = null;
  const { container, checkbox } = Toggle.render({
    label: 'Enable Hardware Acceleration',
    description: 'Use GPU for canvas rasterization and glass filter rendering',
    checked: true,
    onChange: (checked) => { changedVal = checked; }
  });

  assert.ok(container.className.includes('fb-toggle-container'));
  assert.equal(checkbox.checked, true);
});

test('UI Components: Loading provides spinner, skeleton, and progress bar', () => {
  const spinner = Loading.renderOrbSpinner(32);
  assert.ok(spinner.className.includes('fb-orb-spinner'));

  const skeleton = Loading.renderSkeletonCard();
  assert.ok(skeleton.className.includes('fb-skeleton'));

  const { container: progressBar, setProgress } = Loading.renderProgressBar(75);
  assert.ok(progressBar.className.includes('fb-progress-track'));
  assert.equal(typeof setProgress, 'function');
});

test('UI Components: FloatingBubble renders glass orb and reacts to options', () => {
  let bubbleClicked = false;
  const bubble = FloatingBubble.render({
    sizePx: 58,
    isActive: true,
    showPulse: true,
    badgeCount: 2,
    onClick: () => { bubbleClicked = true; }
  });

  assert.ok(bubble.className.includes('fb-floating-bubble'));
  assert.ok(bubble.className.includes('fb-orb'));
});
