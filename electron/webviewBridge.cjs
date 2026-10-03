'use strict';

/**
 * Yayra Floating Browser - Native Web Content Engine Bridge (Electron main process)
 *
 * ROOT CAUSE THIS FILE FIXES
 * --------------------------
 * The renderer UI (packages/shared-ui/src/components/BrowserShell.js) used to
 * render every visited website inside a plain HTML <iframe>. Real sites
 * (Google, GitHub, Facebook, ...) send X-Frame-Options / CSP frame-ancestors
 * headers that forbid ANY iframe embedding, so navigating to
 * https://www.google.com/ inside that iframe always failed with:
 *   "Refused to display 'https://www.google.com/' in a frame because it set
 *    'X-Frame-Options' to 'sameorigin'."
 * No amount of Yayra-side CSP configuration can override a restriction the
 * TARGET site itself enforces against iframes.
 *
 * The fix is architectural: on Electron (Linux + Windows desktop builds),
 * external websites are now rendered in a dedicated `WebContentsView`
 * (Electron's modern, non-deprecated replacement for `BrowserView`) attached
 * directly to the application window's content view, NOT nested inside the
 * HTML document as an <iframe>. A WebContentsView is a first-class sibling
 * surface, not a nested browsing context, so X-Frame-Options / frame-ancestors
 * never apply to it - the same mechanism every other desktop "browser shell"
 * app (and Electron's own official guidance for embedding arbitrary web
 * content) relies on.
 *
 * The HTML/CSS UI (tabs, address bar, buttons, floating window chrome) is
 * untouched; the renderer just tells this bridge where on screen to position
 * a transparent native layer for the active tab's real content.
 *
 * GOOGLE / IDENTITY PROVIDER SIGN-IN
 * -----------------------------------
 * Independent of iframes, Google (and several other identity providers)
 * actively detect and refuse to complete sign-in inside ANY embedded browser
 * surface - including a legitimate WebContentsView - as an anti-phishing
 * measure. See https://developers.google.com/identity/protocols/oauth2/policies#embedded-webviews.
 * Yayra does not attempt to spoof or bypass that detection. Instead,
 * navigations to a known identity-provider sign-in host are handed off to the
 * user's default system browser via `shell.openExternal`, which is Google's
 * own documented recommendation for native/desktop apps.
 */

// Apex hostnames (and all subdomains) that must be completed in the user's
// default system browser instead of the embedded WebContentsView.
const SYSTEM_BROWSER_AUTH_HOSTS = Object.freeze([
  'accounts.google.com',
  'appleid.apple.com',
  'login.live.com',
  'login.microsoftonline.com'
]);

const WEBVIEW_EVENT_CHANNEL = 'yayra:webview-event';

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function requiresSystemBrowserAuth(rawUrl, hosts = SYSTEM_BROWSER_AUTH_HOSTS) {
  const hostname = hostnameOf(rawUrl);
  if (!hostname) return false;
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function sanitizeBounds(bounds) {
  const safeNumber = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  return {
    x: safeNumber(bounds && bounds.x),
    y: safeNumber(bounds && bounds.y),
    width: safeNumber(bounds && bounds.width),
    height: safeNumber(bounds && bounds.height)
  };
}

/**
 * Creates and wires the IPC surface used by the renderer's native-engine
 * bridge (see BrowserShell.js's `createWebContentFrame`). Dependency-injected
 * so the business logic (hostname auth handoff, bounds sanitizing, tab
 * lifecycle bookkeeping) stays unit-testable without a real Electron runtime
 * - see tests/electron-webview-bridge.test.mjs.
 */
function createWebviewBridge({
  WebContentsView,
  ipcMain,
  shell,
  getMainWindow,
  authHosts = SYSTEM_BROWSER_AUTH_HOSTS,
  logger = console
}) {
  const views = new Map(); // tabId -> { view, lastUrl }

  function send(tabId, type, payload = {}) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(WEBVIEW_EVENT_CHANNEL, { tabId, type, ...payload });
  }

  function navState(webContents) {
    return {
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward()
    };
  }

  function attachListeners(tabId, view) {
    const wc = view.webContents;
    wc.on('did-start-loading', () => send(tabId, 'loading-start'));
    wc.on('did-stop-loading', () => send(tabId, 'loading-stop'));
    wc.on('did-navigate', (_event, url) => {
      const entry = views.get(tabId);
      if (entry) entry.lastUrl = url;
      send(tabId, 'navigated', { url, ...navState(wc) });
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      const entry = views.get(tabId);
      if (entry) entry.lastUrl = url;
      send(tabId, 'navigated', { url, ...navState(wc) });
    });
    wc.on('page-title-updated', (_event, title) => send(tabId, 'title-updated', { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      send(tabId, 'favicon-updated', { favicon: (favicons && favicons[0]) || null });
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED: almost always a navigation superseded by another
      // one (e.g. the user typed a new URL before the previous one settled)
      // and is not a real failure worth surfacing.
      if (!isMainFrame || errorCode === -3) return;
      send(tabId, 'fail-load', { errorCode, errorDescription, url: validatedUrl });
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (requiresSystemBrowserAuth(url, authHosts)) {
        shell.openExternal(url).catch((err) => logger.error('[yayra:webview] failed to open external auth url', err));
        send(tabId, 'system-browser-handoff', { url });
        return { action: 'deny' };
      }
      // Let the renderer decide (usually: open as a new Yayra tab).
      send(tabId, 'new-window-request', { url });
      return { action: 'deny' };
    });
  }

  function createView(tabId, isPrivate) {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: isPrivate ? `incognito-${tabId}` : 'persist:yayra-webview'
      }
    });
    const entry = { view, lastUrl: null };
    views.set(tabId, entry);
    attachListeners(tabId, view);
    return entry;
  }

  function ensureView(tabId, url, { isPrivate = false } = {}) {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || !tabId || !url) return { handedOffToSystemBrowser: false };

    if (requiresSystemBrowserAuth(url, authHosts)) {
      shell.openExternal(url).catch((err) => logger.error('[yayra:webview] failed to open external auth url', err));
      send(tabId, 'system-browser-handoff', { url });
      return { handedOffToSystemBrowser: true };
    }

    let entry = views.get(tabId);
    if (!entry) {
      entry = createView(tabId, isPrivate);
      win.contentView.addChildView(entry.view);
    }

    if (entry.lastUrl !== url) {
      entry.lastUrl = url;
      entry.view.webContents.loadURL(url).catch((err) => {
        logger.error(`[yayra:webview] failed to load ${url}`, err);
        send(tabId, 'fail-load', { errorCode: -2, errorDescription: String((err && err.message) || err), url });
      });
    }
    return { handedOffToSystemBrowser: false };
  }

  function withView(tabId, fn) {
    const entry = views.get(tabId);
    if (!entry) return undefined;
    return fn(entry.view);
  }

  function setBounds(tabId, bounds) {
    withView(tabId, (view) => view.setBounds(sanitizeBounds(bounds)));
  }

  function setVisible(tabId, visible) {
    withView(tabId, (view) => {
      if (visible) {
        // Restoring a previously zeroed-out view just needs its real bounds
        // back; the caller (renderer ResizeObserver) sends those right after.
        return;
      }
      // Zeroing bounds (rather than removing/re-adding the child view) hides
      // the surface without destroying the guest page or losing its state.
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    });
  }

  function goBack(tabId) {
    withView(tabId, (view) => {
      if (view.webContents.canGoBack()) view.webContents.goBack();
    });
  }

  function goForward(tabId) {
    withView(tabId, (view) => {
      if (view.webContents.canGoForward()) view.webContents.goForward();
    });
  }

  function reload(tabId) {
    withView(tabId, (view) => view.webContents.reload());
  }

  function stop(tabId) {
    withView(tabId, (view) => view.webContents.stop());
  }

  function destroyView(tabId) {
    const entry = views.get(tabId);
    if (!entry) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(entry.view);
      } catch (err) {
        logger.error(`[yayra:webview] failed to detach view for ${tabId}`, err);
      }
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    views.delete(tabId);
  }

  function destroyAll() {
    for (const tabId of Array.from(views.keys())) destroyView(tabId);
  }

  ipcMain.handle('yayra:webview-ensure', (_event, { tabId, url, isPrivate } = {}) => ensureView(tabId, url, { isPrivate }));
  ipcMain.handle('yayra:webview-set-bounds', (_event, { tabId, bounds } = {}) => setBounds(tabId, bounds));
  ipcMain.handle('yayra:webview-set-visible', (_event, { tabId, visible } = {}) => setVisible(tabId, visible));
  ipcMain.handle('yayra:webview-go-back', (_event, { tabId } = {}) => goBack(tabId));
  ipcMain.handle('yayra:webview-go-forward', (_event, { tabId } = {}) => goForward(tabId));
  ipcMain.handle('yayra:webview-reload', (_event, { tabId } = {}) => reload(tabId));
  ipcMain.handle('yayra:webview-stop', (_event, { tabId } = {}) => stop(tabId));
  ipcMain.handle('yayra:webview-destroy', (_event, { tabId } = {}) => destroyView(tabId));

  return {
    destroyAll,
    // Exposed for tests and for main.cjs lifecycle hooks only.
    _internal: { views, ensureView, setBounds, setVisible, goBack, goForward, reload, stop, destroyView }
  };
}

module.exports = {
  WEBVIEW_EVENT_CHANNEL,
  SYSTEM_BROWSER_AUTH_HOSTS,
  requiresSystemBrowserAuth,
  sanitizeBounds,
  createWebviewBridge
};
