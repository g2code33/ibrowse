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
 * Google (and several other identity providers) actively detect and refuse
 * to complete sign-in inside embedded browser surfaces as an anti-phishing
 * measure - see https://developers.google.com/identity/protocols/oauth2/policies#embedded-webviews.
 * An earlier version of this file tried presenting a desktop-Chrome identity
 * string (see `buildBrowserUserAgent()` below) specifically to get Google
 * sign-in itself to complete embedded. That did not work: Google also
 * inspects Client Hints (`navigator.userAgentData`, `Sec-CH-UA*` headers),
 * which a simple User-Agent string override does not change, and multiple
 * independent reports confirm Google has been actively closing this
 * loophole even for full Client Hints spoofing. Chasing that further is a
 * fragile, ever-escalating fight against Google's own anti-phishing system
 * for uncertain payoff, so Google sign-in is back on the system-browser
 * handoff path here, same as Apple/Microsoft, per Google's own
 * recommendation and RFC 8252 ("OAuth 2.0 for Native Apps").
 *
 * `buildBrowserUserAgent()` is kept and still applied to every tab, but only
 * for ordinary general-purpose site compatibility (many sites show "upgrade
 * your browser" nags or misrender for a Electron/x.y.z identity string) -
 * not as an attempt to defeat any site's anti-phishing/anti-automation
 * checks, which remain in effect and are handled by the handoff below.
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

/**
 * Builds a standard desktop Chrome User-Agent string for the current
 * platform/Chromium version, deliberately omitting the "Electron/x.y.z"
 * token Electron appends by default. Pure function (reads only static
 * `process.versions`/`process.platform`), fully unit-testable. Used only for
 * general site compatibility - see the "GOOGLE / IDENTITY PROVIDER SIGN-IN"
 * note above.
 */
function buildBrowserUserAgent({ platform = process.platform, chromeVersion = process.versions.chrome } = {}) {
  const platformToken = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

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

/**
 * History navigation helpers.
 * Electron 32 deprecated webContents.canGoBack/goBack/canGoForward/goForward
 * in favor of the webContents.navigationHistory object, and the legacy
 * methods can be removed in any future major. Prefer the new API whenever
 * the webContents exposes it, but keep the legacy call as a fallback so
 * dependency-injected test doubles (and any embedder that still provides
 * only the old shape) keep working unchanged.
 */
function historyCanGoBack(wc) {
  const h = wc.navigationHistory;
  if (h && typeof h.canGoBack === 'function') return h.canGoBack();
  return typeof wc.canGoBack === 'function' ? wc.canGoBack() : false;
}

function historyCanGoForward(wc) {
  const h = wc.navigationHistory;
  if (h && typeof h.canGoForward === 'function') return h.canGoForward();
  return typeof wc.canGoForward === 'function' ? wc.canGoForward() : false;
}

function historyGoBack(wc) {
  const h = wc.navigationHistory;
  if (h && typeof h.goBack === 'function') return h.goBack();
  if (typeof wc.goBack === 'function') wc.goBack();
}

function historyGoForward(wc) {
  const h = wc.navigationHistory;
  if (h && typeof h.goForward === 'function') return h.goForward();
  if (typeof wc.goForward === 'function') wc.goForward();
}

/**
 * Builds a Chrome-equivalent native right-click context menu template for a
 * WebContentsView, from the `params` Electron's own `context-menu` webContents
 * event already hands us (link/image/selection/editable info - no manual
 * DOM inspection needed). Pure(ish) function - only touches the passed-in
 * `wc` (to read canGoBack/canGoForward and to run the actual action when a
 * user clicks an item) and `clipboard`/`send` - so it is fully unit-testable
 * without a real Electron `Menu`. See tests/electron-webview-bridge.test.mjs.
 */
function buildContextMenuTemplate({ params, wc, tabId, send, clipboard }) {
  const template = [];
  const isLink = !!(params && params.linkURL);
  const isImage = !!(params && params.mediaType === 'image' && params.srcURL);
  const isEditable = !!(params && params.isEditable);
  const hasSelection = !!(params && params.selectionText && params.selectionText.trim());

  if (isLink) {
    template.push(
      { label: 'Open Link in New Tab', click: () => send(tabId, 'new-window-request', { url: params.linkURL }) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) }
    );
  }

  if (isImage) {
    if (template.length) template.push({ type: 'separator' });
    template.push(
      { label: 'Open Image in New Tab', click: () => send(tabId, 'new-window-request', { url: params.srcURL }) },
      { label: 'Save Image As\u2026', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) }
    );
  }

  if (isEditable) {
    if (template.length) template.push({ type: 'separator' });
    const flags = params.editFlags || {};
    template.push(
      { label: 'Undo', enabled: flags.canUndo !== false, click: () => wc.undo() },
      { label: 'Redo', enabled: flags.canRedo === true, click: () => wc.redo() },
      { type: 'separator' },
      { label: 'Cut', enabled: flags.canCut !== false, click: () => wc.cut() },
      { label: 'Copy', enabled: flags.canCopy !== false, click: () => wc.copy() },
      { label: 'Paste', enabled: flags.canPaste !== false, click: () => wc.paste() },
      { type: 'separator' },
      { label: 'Select All', enabled: flags.canSelectAll !== false, click: () => wc.selectAll() }
    );
  } else if (hasSelection) {
    if (template.length) template.push({ type: 'separator' });
    const trimmed = params.selectionText.trim();
    const shortText = trimmed.length > 32 ? `${trimmed.slice(0, 32)}\u2026` : trimmed;
    template.push(
      { label: 'Copy', click: () => wc.copy() },
      {
        label: `Search Google for "${shortText}"`,
        click: () => send(tabId, 'new-window-request', { url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}` })
      }
    );
  }

  if (template.length) template.push({ type: 'separator' });
  template.push(
    { label: 'Back', enabled: historyCanGoBack(wc), click: () => historyGoBack(wc) },
    { label: 'Forward', enabled: historyCanGoForward(wc), click: () => historyGoForward(wc) },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Inspect', click: () => wc.inspectElement((params && params.x) || 0, (params && params.y) || 0) }
  );

  return template;
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
  // Injected (rather than `require('electron')`'d directly) so this stays
  // unit-testable with fakes - see tests/electron-webview-bridge.test.mjs.
  // Both are optional: if a host app doesn't pass them, right-click simply
  // does nothing instead of throwing.
  Menu = null,
  clipboard = null,
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
      canGoBack: historyCanGoBack(webContents),
      canGoForward: historyCanGoForward(webContents)
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
    // Chrome-equivalent native right-click menu. A WebContentsView (unlike
    // a plain <webview> tag) shows NO context menu at all by default, so
    // without this, right-clicking any real website inside Yayra would
    // silently do nothing.
    wc.on('context-menu', (_event, params) => {
      if (!Menu) return;
      const template = buildContextMenuTemplate({
        params,
        wc,
        tabId,
        send,
        clipboard: clipboard || { writeText: () => {} }
      });
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      Menu.buildFromTemplate(template).popup({ window: win });
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
    if (typeof view.webContents.setUserAgent === 'function') {
      view.webContents.setUserAgent(buildBrowserUserAgent());
    }
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
      if (historyCanGoBack(view.webContents)) historyGoBack(view.webContents);
    });
  }

  function goForward(tabId) {
    withView(tabId, (view) => {
      if (historyCanGoForward(view.webContents)) historyGoForward(view.webContents);
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
  buildBrowserUserAgent,
  buildContextMenuTemplate,
  createWebviewBridge
};
