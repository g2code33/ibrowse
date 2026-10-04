#!/usr/bin/env python3
"""
Lets Google sign-in work DIRECTLY inside Yayra's own floating browser view
(electron/webviewBridge.cjs), like a normal Chrome tab, instead of always
handing it off to your system browser.

WHY THIS WAS BLOCKED, AND WHAT THIS SCRIPT CHANGES
----------------------------------------------------
Google detects embedded app browsers mainly by checking for the
"Electron/x.y.z" token Electron puts in its default browser identity
(User-Agent) string, and refuses to complete sign-in when it sees that token
- an anti-phishing measure. This script:

  1. Makes every browsing tab (WebContentsView) present itself with a normal
     desktop Chrome identity string instead (same Chromium engine either
     way - only the identity string text changes).
  2. Stops routing accounts.google.com navigations out to your system
     browser, so Google sign-in (including third-party "Sign in with Google"
     buttons) can complete directly inside Yayra's own browser view.

This is explicitly AGAINST Google's own stated recommendation (they say to
hand off to the system browser, not to change the identity string), even
though it does not change Yayra's actual security model in any way - it is a
known, commonly used technique, but not guaranteed to keep working forever
and carries some residual risk of a future Google-side block. Apple and
Microsoft sign-in hosts are left unaffected (still handed off to your system
browser) - this only applies to Google, and only on Electron desktop (the
Android/iOS/web builds are untouched and keep the safer handoff behavior,
since mobile embedded-webview detection is stricter and riskier to bypass).

This script is idempotent: safe to run more than once.

Usage:
    cd "/path/to/your/yayra/checkout"
    python3 apply_google_embedded_signin_fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def replace_once(path, old, new, label):
    content = read(path)
    if new in content:
        print(f"  [skip] {label} (already applied)")
        return
    if old not in content:
        print(f"  [FAIL] {label} - anchor text not found; file may have changed. Leaving untouched.")
        return
    content = content.replace(old, new, 1)
    write(path, content)
    print(f"  [ok]   {label}")


def patch_webview_bridge():
    path = os.path.join(ROOT, "electron", "webviewBridge.cjs")
    print("electron/webviewBridge.cjs:")
    if not os.path.exists(path):
        print("  [FAIL] file not found - is this your Yayra checkout root?")
        return

    replace_once(
        path,
        old=''' * GOOGLE / IDENTITY PROVIDER SIGN-IN
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

function hostnameOf(rawUrl) {''',
        new=''' * GOOGLE / IDENTITY PROVIDER SIGN-IN
 * -----------------------------------
 * Google (and several other identity providers) actively detect and refuse
 * to complete sign-in inside embedded browser surfaces as an anti-phishing
 * measure, primarily by checking for an "Electron/x.y.z" token in the
 * browser's identity (User-Agent) string - see
 * https://developers.google.com/identity/protocols/oauth2/policies#embedded-webviews.
 * Google's own guidance is to hand these off to the system browser instead
 * of changing that string, which is what this file does for Apple/Microsoft
 * sign-in hosts below.
 *
 * For Google specifically, at the explicit, informed request of this
 * deployment's owner (who wants Google sign-in to work the same way it does
 * inside a normal desktop browser tab, including on third-party "Sign in
 * with Google" buttons encountered while browsing), `buildBrowserUserAgent()`
 * presents each WebContentsView as a standard desktop Chrome browser instead
 * of Electron's default identity string. This does not change the actual
 * rendering engine or its security properties in any way - a WebContentsView
 * already IS the same sandboxed, contextIsolated Chromium Google's detection
 * is designed to protect users from the absence of; only the identity string
 * changes. This is a known, widely used technique (several real-world
 * Electron-based browsers do the same), but it is explicitly against
 * Google's own stated recommendation, is not guaranteed to keep working if
 * Google changes its detection approach, and carries some residual risk of
 * being flagged. Apple/Microsoft hosts are left on the system-browser
 * handoff path, unaffected by this choice.
 */

// Apex hostnames (and all subdomains) that must be completed in the user's
// default system browser instead of the embedded WebContentsView.
const SYSTEM_BROWSER_AUTH_HOSTS = Object.freeze([
  'appleid.apple.com',
  'login.live.com',
  'login.microsoftonline.com'
]);

const WEBVIEW_EVENT_CHANNEL = 'yayra:webview-event';

/**
 * Builds a standard desktop Chrome User-Agent string for the current
 * platform/Chromium version, deliberately omitting the "Electron/x.y.z"
 * token Electron appends by default. Pure function (reads only static
 * `process.versions`/`process.platform`), fully unit-testable. See the
 * "GOOGLE / IDENTITY PROVIDER SIGN-IN" note above for why this exists.
 */
function buildBrowserUserAgent({ platform = process.platform, chromeVersion = process.versions.chrome } = {}) {
  const platformToken = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function hostnameOf(rawUrl) {''',
        label="replace header comment + remove accounts.google.com from the handoff list + add buildBrowserUserAgent()",
    )

    replace_once(
        path,
        old="""    const entry = { view, lastUrl: null };
    views.set(tabId, entry);
    attachListeners(tabId, view);
    return entry;
  }""",
        new="""    if (typeof view.webContents.setUserAgent === 'function') {
      view.webContents.setUserAgent(buildBrowserUserAgent());
    }
    const entry = { view, lastUrl: null };
    views.set(tabId, entry);
    attachListeners(tabId, view);
    return entry;
  }""",
        label="apply the browser-like user agent to every new tab",
    )

    replace_once(
        path,
        old="""module.exports = {
  WEBVIEW_EVENT_CHANNEL,
  SYSTEM_BROWSER_AUTH_HOSTS,
  requiresSystemBrowserAuth,
  sanitizeBounds,
  createWebviewBridge
};""",
        new="""module.exports = {
  WEBVIEW_EVENT_CHANNEL,
  SYSTEM_BROWSER_AUTH_HOSTS,
  requiresSystemBrowserAuth,
  sanitizeBounds,
  buildBrowserUserAgent,
  createWebviewBridge
};""",
        label="export buildBrowserUserAgent",
    )


def main():
    print("Applying Google embedded sign-in fix (desktop floating browser)...\n")
    patch_webview_bridge()
    print(
        "\nDone. This only affects electron/webviewBridge.cjs (the Electron\n"
        "desktop floating browser engine). Next steps:\n"
        "  1. npm test   (should still be all-green)\n"
        "  2. npx electron .\n"
        "  3. Browse to a site with 'Sign in with Google', or straight to\n"
        "     accounts.google.com/gmail.com - it should sign in directly in\n"
        "     Yayra's own view now instead of opening your system browser.\n"
        "\n"
        "Note: this is NOT guaranteed by Google to keep working, and is a\n"
        "deliberate deviation from Google's own guidance - see the comment\n"
        "block in electron/webviewBridge.cjs for the full rationale.\n"
    )


if __name__ == "__main__":
    sys.exit(main())
