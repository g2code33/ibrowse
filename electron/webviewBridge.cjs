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
  // Resolves the BrowserWindow that owns a given webContents, so views
  // created by the floating mini-shell window attach to THAT window instead
  // of the main one. Injected for testability; when absent (older tests,
  // direct _internal calls) everything falls back to getMainWindow().
  getWindowForWebContents = null,
  // Injected (rather than `require('electron')`'d directly) so this stays
  // unit-testable with fakes - see tests/electron-webview-bridge.test.mjs.
  // Both are optional: if a host app doesn't pass them, right-click simply
  // does nothing instead of throwing.
  Menu = null,
  clipboard = null,
  logger = console
}) {
  // key -> { view, lastUrl, tabId, hostWc, hostWin }
  // key namespaces the renderer-chosen tabId by the webContents that asked
  // for it: the main window and the floating mini window each run their own
  // BrowserShell instance whose generated ids ("tab-1", "tab-2", ...) would
  // otherwise collide and steal each other's native views.
  const views = new Map();

  function viewKey(event, tabId) {
    const senderId = event && event.sender && typeof event.sender.id === 'number' ? event.sender.id : null;
    return senderId === null ? String(tabId) : `wc${senderId}:${tabId}`;
  }

  function resolveHost(event) {
    const hostWc = (event && event.sender) || null;
    let hostWin = null;
    if (hostWc && typeof getWindowForWebContents === 'function') {
      try { hostWin = getWindowForWebContents(hostWc) || null; } catch { hostWin = null; }
    }
    if (!hostWin) hostWin = getMainWindow();
    return { hostWc, hostWin };
  }

  function sendTo(entry, type, payload = {}) {
    const message = { tabId: entry.tabId, type, ...payload };
    const wc = entry.hostWc && !entry.hostWc.isDestroyed?.() ? entry.hostWc : null;
    if (wc) {
      wc.send(WEBVIEW_EVENT_CHANNEL, message);
      return;
    }
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(WEBVIEW_EVENT_CHANNEL, message);
  }

  function navState(webContents) {
    return {
      canGoBack: historyCanGoBack(webContents),
      canGoForward: historyCanGoForward(webContents)
    };
  }

  function attachListeners(key, entry) {
    const wc = entry.view.webContents;
    wc.on('did-start-loading', () => sendTo(entry, 'loading-start'));
    wc.on('did-stop-loading', () => sendTo(entry, 'loading-stop'));
    wc.on('did-navigate', (_event, url) => {
      entry.lastUrl = url;
      sendTo(entry, 'navigated', { url, ...navState(wc) });
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      entry.lastUrl = url;
      sendTo(entry, 'navigated', { url, ...navState(wc) });
    });
    wc.on('page-title-updated', (_event, title) => sendTo(entry, 'title-updated', { title }));
    wc.on('page-favicon-updated', (_event, favicons) => {
      sendTo(entry, 'favicon-updated', { favicon: (favicons && favicons[0]) || null });
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED: almost always a navigation superseded by another
      // one (e.g. the user typed a new URL before the previous one settled)
      // and is not a real failure worth surfacing.
      if (!isMainFrame || errorCode === -3) return;
      sendTo(entry, 'fail-load', { errorCode, errorDescription, url: validatedUrl });
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
        tabId: entry.tabId,
        send: (tabId, type, payload) => sendTo(entry, type, payload),
        clipboard: clipboard || { writeText: () => {} }
      });
      const win = (entry.hostWin && !entry.hostWin.isDestroyed?.()) ? entry.hostWin : getMainWindow();
      if (!win || win.isDestroyed()) return;
      Menu.buildFromTemplate(template).popup({ window: win });
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (requiresSystemBrowserAuth(url, authHosts)) {
        shell.openExternal(url).catch((err) => logger.error('[yayra:webview] failed to open external auth url', err));
        sendTo(entry, 'system-browser-handoff', { url });
        return { action: 'deny' };
      }
      // Let the renderer decide (usually: open as a new Yayra tab).
      sendTo(entry, 'new-window-request', { url });
      return { action: 'deny' };
    });
  }

  function createView(key, tabId, isPrivate, hostWc, hostWin) {
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
    const entry = { view, lastUrl: null, tabId, hostWc, hostWin };
    views.set(key, entry);
    attachListeners(key, entry);
    return entry;
  }

  function ensureView(key, tabId, url, { isPrivate = false, hostWc = null, hostWin = null } = {}) {
    const win = (hostWin && !hostWin.isDestroyed?.()) ? hostWin : getMainWindow();
    if (!win || win.isDestroyed() || !tabId || !url) return { handedOffToSystemBrowser: false };

    if (requiresSystemBrowserAuth(url, authHosts)) {
      shell.openExternal(url).catch((err) => logger.error('[yayra:webview] failed to open external auth url', err));
      sendTo({ tabId, hostWc }, 'system-browser-handoff', { url });
      return { handedOffToSystemBrowser: true };
    }

    let entry = views.get(key);
    if (!entry) {
      entry = createView(key, tabId, isPrivate, hostWc, win);
      win.contentView.addChildView(entry.view);
    }

    if (entry.lastUrl !== url) {
      entry.lastUrl = url;
      entry.view.webContents.loadURL(url).catch((err) => {
        logger.error(`[yayra:webview] failed to load ${url}`, err);
        sendTo(entry, 'fail-load', { errorCode: -2, errorDescription: String((err && err.message) || err), url });
      });
    }
    return { handedOffToSystemBrowser: false };
  }

  function withView(key, fn) {
    const entry = views.get(key);
    if (!entry) return undefined;
    return fn(entry.view);
  }

  function setBounds(key, bounds) {
    withView(key, (view) => view.setBounds(sanitizeBounds(bounds)));
  }

  async function setVisible(key, visible, { capture = false } = {}) {
    const entry = views.get(key);
    if (!entry) return undefined;
    const view = entry.view;
    if (visible) {
      // Restoring a previously zeroed-out view just needs its real bounds
      // back; the caller (renderer ResizeObserver) sends those right after.
      return undefined;
    }
    // Overlay-aware hiding: the renderer's own chrome (menu drawer, modals,
    // dropdowns) are HTML that a native WebContentsView would otherwise
    // cover, because native views always paint above the page document.
    // When the renderer asks for a capture, grab a snapshot of the page
    // BEFORE zeroing the bounds so the renderer can show a pixel-identical
    // still image underneath its overlay UI - making the chrome truly
    // overlay the page instead of the page covering the chrome.
    let snapshot = null;
    if (capture && view.webContents && typeof view.webContents.capturePage === 'function') {
      try {
        const image = await view.webContents.capturePage();
        if (image && typeof image.toDataURL === 'function' && !(typeof image.isEmpty === 'function' && image.isEmpty())) {
          snapshot = image.toDataURL();
        }
      } catch (err) {
        logger.error?.(`[yayra:webview] capturePage failed for ${key}`, err);
      }
    }
    // Zeroing bounds (rather than removing/re-adding the child view) hides
    // the surface without destroying the guest page or losing its state.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return snapshot ? { snapshot } : undefined;
  }

  function goBack(key) {
    withView(key, (view) => {
      if (historyCanGoBack(view.webContents)) historyGoBack(view.webContents);
    });
  }

  function goForward(key) {
    withView(key, (view) => {
      if (historyCanGoForward(view.webContents)) historyGoForward(view.webContents);
    });
  }

  function reload(key) {
    withView(key, (view) => view.webContents.reload());
  }

  function stop(key) {
    withView(key, (view) => view.webContents.stop());
  }

  function destroyView(key) {
    const entry = views.get(key);
    if (!entry) return;
    const win = (entry.hostWin && !entry.hostWin.isDestroyed?.()) ? entry.hostWin : getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(entry.view);
      } catch (err) {
        logger.error(`[yayra:webview] failed to detach view for ${key}`, err);
      }
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    views.delete(key);
  }

  function destroyAll() {
    for (const key of Array.from(views.keys())) destroyView(key);
  }

  // Destroys only the views owned by one shell window (used when the main
  // window or the floating mini window closes, WITHOUT tearing down the
  // other window's tabs - they are independent).
  function destroyForWebContents(wc) {
    if (!wc) return;
    for (const [key, entry] of Array.from(views.entries())) {
      if (entry.hostWc === wc) destroyView(key);
    }
  }

  ipcMain.handle('yayra:webview-ensure', (event, { tabId, url, isPrivate } = {}) => {
    const { hostWc, hostWin } = resolveHost(event);
    return ensureView(viewKey(event, tabId), tabId, url, { isPrivate, hostWc, hostWin });
  });
  ipcMain.handle('yayra:webview-set-bounds', (event, { tabId, bounds } = {}) => setBounds(viewKey(event, tabId), bounds));
  ipcMain.handle('yayra:webview-set-visible', (event, { tabId, visible, capture } = {}) => setVisible(viewKey(event, tabId), visible, { capture }));
  ipcMain.handle('yayra:webview-go-back', (event, { tabId } = {}) => goBack(viewKey(event, tabId)));
  ipcMain.handle('yayra:webview-go-forward', (event, { tabId } = {}) => goForward(viewKey(event, tabId)));
  ipcMain.handle('yayra:webview-reload', (event, { tabId } = {}) => reload(viewKey(event, tabId)));
  ipcMain.handle('yayra:webview-stop', (event, { tabId } = {}) => stop(viewKey(event, tabId)));
  ipcMain.handle('yayra:webview-destroy', (event, { tabId } = {}) => destroyView(viewKey(event, tabId)));

  return {
    destroyAll,
    destroyForWebContents,
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
