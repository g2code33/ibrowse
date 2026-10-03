# Yayra Android Native Browser Engine

## 1. Architectural Overview

The Yayra Android Native Browser Engine (`@yayra/browser-android`) provides an isolated, leak-free, hardware-accelerated browser runtime built directly on native Android `WebView`. It bridges the universal `@yayra/browser-contract` interfaces to the Android platform while strictly enforcing Android security best practices.

```
┌────────────────────────────────────────────────────────────┐
│                  @yayra/browser-contract                   │
│         (IBrowserEngine, BrowserTab, UrlInterpreter)       │
└─────────────────────────────▲──────────────────────────────┘
                              │
┌─────────────────────────────┴──────────────────────────────┐
│                    AndroidWebViewEngine                    │
│     • Multiple Tab Coordination & History Stacks           │
│     • Desktop / Mobile User-Agent Mode Toggle              │
│     • Dynamic View Attachment / Detachment                 │
│     • Hardened Security Invariants & Error Surface         │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                  Native Android Components                 │
│  • YayraWebViewManager (Hardened WebView factory)          │
│  • YayraTabManager (Multi-tab pool & lifecycle state)      │
│  • YayraWebViewClient (Strict SSL & safe intent routing)   │
│  • YayraWebChromeClient (Progress, title & permission gate)│
│  • YayraDownloadListener (Android DownloadManager service) │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Security Invariants & Protections

| Security Policy | Implementation | Threat Mitigation |
| :--- | :--- | :--- |
| **Strict SSL Verification** | `onReceivedSslError` invokes `handler.cancel()`. NEVER bypasses or calls `handler.proceed()`. | Prevents Man-in-the-Middle (MitM) attacks, certificate spoofing, and compromised network eavesdropping. |
| **Strict File Access Sandboxing** | `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, `setAllowFileAccessFromFileURLs(false)`, `setAllowUniversalAccessFromFileURLs(false)`. | Prevents local sandbox traversal and file exfiltration from untrusted web pages. |
| **Mixed Content Blocking** | `WebSettings.MIXED_CONTENT_NEVER_ALLOW`. | Prevents insecure HTTP resource loading within secure HTTPS pages. |
| **Website Permissions Mediation** | `WebChromeClient.onPermissionRequest` and `onGeolocationPermissionsShowPrompt` require explicit user prompts. | Never automatically grants camera, microphone, or geolocation permissions. |
| **Navigation Scheme Allowlist** | `shouldOverrideUrlLoading` blocks `javascript:`, `data:`, `vbscript:`, `file:`, `content:`. | Prevents XSS script execution in top-level browser contexts. |
| **Safe External Intent Resolution** | Validates `intent:`, `mailto:`, `tel:`, `sms:`, and `geo:` URLs with `CATEGORY_BROWSABLE` and `resolveActivity` checks. | Prevents intent injection and unauthorized component activation. |
| **Minimal JS Interface** | Restricts `@JavascriptInterface` exposure to structured, validated JSON messaging bridges. | Eliminates Java reflection vulnerabilities and arbitrary code execution. |

---

## 3. Lifecycle Ownership & Zero-Leak Management

- **Application Context Grounding**: WebView instances avoid retaining destroyed Activity contexts.
- **Dynamic View Detachment / Attachment**: Tabs can be attached to or detached from the visible `ViewGroup` dynamically without destroying background tab execution or navigation state.
- **Renderer Process Crash Recovery**: `onRenderProcessGone` traps renderer termination (`killed = true/false`) and recreates the webview surface cleanly rather than allowing an unhandled host process abort.
- **Explicit Disposal Protocol**:
  1. Remove view from parent `ViewGroup`.
  2. `webView.stopLoading()`.
  3. `webView.onPause()`.
  4. `webView.clearHistory()` & `webView.clearCache(true)`.
  5. `webView.loadUrl("about:blank")`.
  6. `webView.removeAllViews()`.
  7. `webView.destroy()`.

---

## 4. Multi-Tab & Desktop Mode Capabilities

- **Independent Tab Instances**: Each tab maintains its own isolated `WebView`, DOM storage partition, and navigation stack.
- **Desktop Mode Switcher**:
  - Desktop Mode: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ... Chrome/128.0.0.0 Safari/537.36`, wide viewport enabled (`useWideViewPort = true`).
  - Mobile Mode: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ... Mobile Safari/537.36`.
- **Session Serialization & State Restore**: Serializes tab list, active selection, and Android state bundles into persistent local storage.
- **Integrated Download Listener**: Integrates with Android `DownloadManager` with session cookie forwarding and public storage downloads.

---

## 5. Verification & Automated Test Coverage

Verified via `tests/android-browser.test.mjs` (8 test suites, 61 total repository tests):
1. HTTPS and HTTP navigation with native command dispatch.
2. Search query conversions (Google, DuckDuckGo, SearXNG).
3. Back, forward, and reload navigation commands with boundary checking.
4. Multiple independent tab creation, switching, and closing.
5. Desktop / Mobile mode switching.
6. Strict SSL error cancellation and security warning rendering.
7. Full multi-tab session export and restoration.
8. Graceful recovery from renderer process termination.
