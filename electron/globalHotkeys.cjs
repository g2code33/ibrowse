/**
 * System-wide CapsLock chords:
 *   CapsLock + Y         -> open the main Yayra window
 *   CapsLock + Shift + R -> open yayra mini (the floating bubble's panel)
 *
 * Electron's globalShortcut CANNOT do this: its accelerators only accept
 * Ctrl/Alt/Shift/Super as modifiers - "Capslock+Y" is rejected as
 * invalid. So Yayra uses a real low-level keyboard hook (uiohook-napi,
 * prebuilt for win/mac/linux) that OBSERVES keys system-wide without
 * swallowing them: while the CapsLock KEY is physically held down,
 * pressing Y or Shift+R fires the action. (CapsLock still toggles its
 * light - an unavoidable OS behavior since nothing may suppress keys it
 * doesn't own.)
 *
 * The chord state machine is pure and dependency-injected so it is unit
 * testable without the native hook (see tests/global-hotkeys.test.mjs).
 */

/**
 * @param {object} opts
 * @param {object} opts.keycodes  {capsLock, y, r} uiohook keycodes
 * @param {() => void} opts.onOpenMain
 * @param {() => void} opts.onOpenMini
 */
function createCapsLockChords({ keycodes, onOpenMain, onOpenMini, logger = console } = {}) {
  if (!keycodes || !keycodes.capsLock || !keycodes.y || !keycodes.r) {
    throw new Error('createCapsLockChords requires {capsLock, y, r} keycodes');
  }
  const state = { capsHeld: false };

  function handleKeydown(event) {
    if (!event) return null;
    if (event.keycode === keycodes.capsLock) {
      state.capsHeld = true;
      return null;
    }
    if (!state.capsHeld) return null;
    if (event.keycode === keycodes.y && !event.shiftKey) {
      try { onOpenMain?.(); } catch (err) { logger.error?.('[yayra:hotkeys] open-main failed', err); }
      return 'open-main';
    }
    if (event.keycode === keycodes.r && event.shiftKey) {
      try { onOpenMini?.(); } catch (err) { logger.error?.('[yayra:hotkeys] open-mini failed', err); }
      return 'open-mini';
    }
    return null;
  }

  function handleKeyup(event) {
    if (event && event.keycode === keycodes.capsLock) state.capsHeld = false;
  }

  let hooked = null;
  /** Attach to a uiohook-style emitter ({on, start, stop}). */
  function attach(hook) {
    if (!hook || typeof hook.on !== 'function') return false;
    hook.on('keydown', handleKeydown);
    hook.on('keyup', handleKeyup);
    try { hook.start?.(); } catch (err) {
      logger.error?.('[yayra:hotkeys] keyboard hook failed to start', err);
      return false;
    }
    hooked = hook;
    return true;
  }

  function detach() {
    try { hooked?.stop?.(); } catch { /* process is exiting anyway */ }
    hooked = null;
  }

  return { handleKeydown, handleKeyup, attach, detach, state };
}

/**
 * Production wiring: load uiohook-napi (optional native dep - absent or
 * broken builds degrade to "no global hotkeys" with a log line, never a
 * crash) and bind the chords.
 */
function startGlobalHotkeys({ onOpenMain, onOpenMini, logger = console } = {}) {
  let uio;
  try {
    uio = require('uiohook-napi');
  } catch (err) {
    logger.warn?.('[yayra:hotkeys] uiohook-napi unavailable - CapsLock shortcuts disabled', String(err?.message || err));
    return null;
  }
  const { uIOhook, UiohookKey } = uio;
  const chords = createCapsLockChords({
    keycodes: { capsLock: UiohookKey.CapsLock, y: UiohookKey.Y, r: UiohookKey.R },
    onOpenMain,
    onOpenMini,
    logger
  });
  if (!chords.attach(uIOhook)) return null;
  logger.log?.('[yayra:hotkeys] CapsLock+Y (main) and CapsLock+Shift+R (yayra mini) active system-wide');
  return chords;
}

module.exports = { createCapsLockChords, startGlobalHotkeys };
