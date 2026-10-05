/**
 * "The mouse pointer decreases in the app" - root cause & pin.
 *
 * On Windows, CSS cursor types with a native equivalent (default, pointer,
 * text, move, not-allowed, the resize arrows...) are loaded through the OS
 * (IDC_ARROW, IDC_HAND, IDC_SIZEALL, ...), so they are drawn at the user's
 * configured pointer size (Settings > Accessibility > Mouse pointer) and
 * track live changes. But cursor types Windows has NO native cursor for -
 * grab, grabbing, cell, alias, copy, zoom-in/out, col/row-resize,
 * vertical-text, context-menu - are painted by Chromium from its own
 * FIXED-SIZE built-in bitmaps, which ignore the Windows pointer size
 * entirely. Yayra used grab/grabbing on the floating bubble (hovered
 * system-wide!), the orb and the mini-panel drag handle, so the pointer
 * visibly SHRANK there for anyone with an enlarged Windows pointer.
 *
 * Contract pinned here: Yayra only ever requests cursor types that map to
 * native system cursors - the pointer stays the same size as Windows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Cursor types Chromium renders from its own fixed-size bitmaps on Windows
// (no IDC_* system cursor exists for them).
const BITMAP_CURSORS = [
  'grab', 'grabbing', 'cell', 'alias', 'copy', 'vertical-text',
  'zoom-in', 'zoom-out', 'col-resize', 'row-resize', 'context-menu'
];

// Everything styled in the app: shared-ui CSS, web entry points, and the
// Electron overlay/bubble windows (inline CSS inside .cjs templates).
function collectStyledSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'release' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(css|html)$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of ['packages', 'src', 'public']) walk(path.join(ROOT, dir));
  for (const entry of fs.readdirSync(path.join(ROOT, 'electron'))) {
    if (entry.endsWith('.cjs')) files.push(path.join(ROOT, 'electron', entry));
  }
  return files;
}

test('no Chromium-bitmap cursor types anywhere - the pointer always stays Windows-sized', () => {
  const files = collectStyledSources();
  assert.ok(files.length > 10, `plausible scan set (got ${files.length} files)`);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const type of BITMAP_CURSORS) {
      const re = new RegExp(`cursor\\s*:\\s*${type}\\b`, 'g');
      if (re.test(src)) offenders.push(`${path.relative(ROOT, file)} -> cursor: ${type}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these cursor types are painted by Chromium at a FIXED size and shrink the pointer for users with a larger Windows pointer');
});

test('floating bubble + drag handles use native system cursors (pointer/move)', () => {
  const overlay = fs.readFileSync(path.join(ROOT, 'electron/overlayWindow.cjs'), 'utf8');
  assert.match(overlay, /cursor:pointer;[\s\S]{0,400}#bubble\.dragging \{ cursor:move; \}/,
    'native bubble: pointer at rest, move while dragging - both OS-drawn');
  const ds = fs.readFileSync(path.join(ROOT, 'packages/shared-ui/src/theme/design-system.css'), 'utf8');
  assert.equal(/cursor:\s*grab/.test(ds), false, 'design-system has no grab/grabbing left');
  const glass = fs.readFileSync(path.join(ROOT, 'packages/shared-ui/src/glassmorphism.css'), 'utf8');
  assert.equal(/cursor:\s*grab/.test(glass), false, 'glassmorphism has no grab/grabbing left');
});
