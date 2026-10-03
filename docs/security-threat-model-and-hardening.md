# Yayra Floating Browser: Security Architecture, Threat Model & Hardening Report

This document specifies the security architecture, formal threat model, defense-in-depth mitigations, website permission framework, and local privacy guarantees of **Yayra Floating Browser** across Android, Windows, and Linux.

---

## 1. Executive Summary & Design Principles

Yayra is engineered as a zero-trust, local-first floating browser designed to minimize attack surface across mobile and desktop environments. Web content is inherently treated as untrusted and hostile.

### Core Security Invariants
1. **Zero Automatic Grants**: No sensitive web permission (Camera, Microphone, Geolocation, Notifications, Clipboard, Storage) is ever granted without explicit origin-scoped user consent.
2. **Strict TLS Enforcement**: SSL/TLS certificate verification failures are strictly fatal; connections are immediately aborted without bypass options.
3. **HTTPS-First Standard**: Insecure HTTP requests are proactively upgraded to HTTPS (with exceptions strictly restricted to loopback/local developer endpoints).
4. **Content Isolation & Least Privilege Native Bridges**: Web content is strictly quarantined from privileged native OS APIs. Native bridge messages are cryptographically structured, origin-verified, and whitelist-filtered to prevent remote command execution or file system breakout.
5. **Safe Overlay Guarantees**: Floating UI elements adhere to strict visual disambiguation rules, preventing tapjacking, overlay spoofing, credential phishing, or imitation of system/security dialogs.
6. **Local-First Privacy by Default**: Zero telemetry, zero third-party ad/analytics SDKs, zero mandatory accounts or cloud synchronization, and isolated private browsing contexts with zero persistent disk footprint.

---

## 2. Web Security Architecture

### 2.1 HTTPS-First & TLS Error Handling
- **Automated Scheme Upgrades**: Web navigation via `UrlInterpreter` and `ISecurityPolicy` inspects scheme targets and upgrades `http://` to `https://`.
- **Local Development Allowance**: Plain HTTP is permitted only for `127.0.0.1` and `*.localhost`.
- **Strict TLS Rejection**:
  - **Android**: `onReceivedSslError` invokes `handler.cancel()`, halting resource loading and dispatching an error template (`DefaultSecurityPolicy.generateSslErrorHtml`).
  - **Windows (WebView2)**: `NavigationStarting` and `ServerCertificateErrorDetected` event handlers cancel invalid certificate chains (`args.set_Cancel(TRUE)`).
  - **Linux (WebKitGTK)**: `load-failed-with-tls-errors` cancels the load pipeline.

### 2.2 Protocol Scheme Allowlisting & Dangerous Scheme Filtering
Web views and navigation controllers restrict protocol schemes using `DefaultSecurityPolicy.validateUrl`:
- **Allowed Schemes**: `https:`, `http:` (subject to upgrade), `about:blank`, `data:` (non-executable image/media MIME types only), `blob:`, and desktop internal `yayra:`.
- **Blocked & Prohibited Schemes**:
  - `javascript:` / `vbscript:`: Prevents cross-context script injection and URL bar XSS.
  - `file:`: Completely blocked from untrusted web navigations, preventing unauthorized reads of local filesystem assets (`/etc/passwd`, `C:\Windows\System32`).
  - `intent:` / `market:`: Blocked to prevent intent-redirection attacks on Android.
  - `data:text/html` / `data:application/javascript`: Blocked from top-level navigation to eliminate sandbox breakout vectors.

### 2.3 Download Path Sanitization & Safe Handling
- **Path Traversal Prevention**: Incoming suggested filenames are stripped of directory separators (`/`, `\`), relative path components (`..`), and null bytes (`\0`).
- **OS Reserved Names Filter**: Windows device identifiers (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) are automatically prefixed (`safe_<name>`).
- **No Automatic Execution**: Yayra never automatically launches, executes, or invokes system loaders on downloaded binary artifacts (`.exe`, `.apk`, `.deb`, `.sh`, `.bat`, `.ps1`, `.msi`). Files remain inert in user-designated download directories.

### 2.4 Hardened Native Bridge Communication
When the web layer interfaces with native platform shells:
- All messages require structured JSON schemas containing `channel`, `action`, `origin`, and `payload`.
- Origins are validated against regex-anchored internal allowlists (`yayra://`).
- Critical native actions (such as `eval`, `executeCommand`, `accessFilesystem`, `exposePrivateKeys`, `runBinary`) are explicitly forbidden on the bridge contract.

---

## 3. Website Permission Policy & Origin Scoping

Yayra implements an origin-scoped permission state machine (`WebsitePermissionManager`):

```
                     ┌──────────────────┐
                     │     PROMPT       │ (Default state)
                     └────────┬─────────┘
                              │
               User receives explicit prompt modal
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌──────────────────┐              ┌──────────────────┐
   │     GRANTED      │              │      DENIED      │
   └─────────┬────────┘              └──────────────────┘
             │
   Check Native OS System
   Permission (Camera, Mic, GPS)
             │
   (If OS Denied -> State = DENIED)
```

### 3.1 Permission Scopes
The permission system handles:
1. `camera`: Native camera capture devices.
2. `microphone`: Audio input channels.
3. `geolocation`: Location coordinates.
4. `notifications`: Web push notifications.
5. `clipboard-read` & `clipboard-write`: System clipboard access.
6. `sensors` & `midi`: Device telemetry and peripheral streams.

### 3.2 Key Invariants
- **No Implicit Grants**: Origin permissions default to `prompt`. If no UI handler is attached or the user ignores the prompt, the request safely defaults to `denied`.
- **Origin Normalization**: Permissions are bound to explicit canonical web origins (`scheme://host:port`) and do not propagate to subdomains or distinct parent domains.
- **Synchronized Clearance**: Clearing browsing data or site cookies immediately revokes and flushes associated website permission grants.

---

## 4. Threat Model & Risk Assessment

| Threat Vector | Potential Attack / Vector | Yayra Mitigation Strategy | Residual Risk & Status |
| :--- | :--- | :--- | :--- |
| **Malicious Websites** | Drive-by downloads, clickjacking, XSS, malicious redirection to HTTP. | HTTPS-First upgrades, strict CSP enforcement, blocking script schemes, downgrade redirect rejection. | **Mitigated**: Modern browser engine sandbox protections active. |
| **Malicious Downloads** | Filename path traversal (`../../etc/passwd`), null-byte bypasses, auto-executing scripts. | `sanitizeDownloadFilename` sanitization, Windows reserved name guards, zero auto-execute. | **Mitigated**: Downloads saved inertly without auto-execution. |
| **WebView Attacks** | Malicious injection into privileged JavaScript bridges, DOM-to-native escapes. | Channel/action/origin validation, prohibited action blocklist, zero exposure of OS shell APIs. | **Mitigated**: Bridge is isolated to high-level UI commands. |
| **External Intent Abuse** | Android intent URL crafting (`intent://...`), triggering unauthorized local activities. | Explicit blocking of `intent:`, `market:`, and unregistered custom schemes. | **Mitigated**: URL interpreter blocks external app intent schemes. |
| **Local Database Exposure** | SQLite database snooping, cleartext credential or session token leaks. | SQLDelight/SQLite sanitized storage, query parameter credential stripping (`REDACTED`), PrivateBrowsing memory context. | **Mitigated**: Sensitive query parameters redacted; private mode strictly in-memory. |
| **Overlay Abuse / Tapjacking** | Invisible overlays stealing keystrokes or faking system security dialogs. | Distinct glassmorphic visual style, minimum opacity floor, touch slop drag disambiguation, strict UI hierarchy. | **Mitigated**: Floating views never mimic OS authorization modals. |
| **Permission Misuse** | Silent camera/microphone activation by background web tabs. | Zero automatic grants, OS-level permission synchronization, active tab visibility requirements. | **Mitigated**: Explicit user prompt and OS-level enforcement. |
| **Session Leakage** | Private browsing tab history persisting to disk across app restarts. | `PrivateBrowsingStorageContext` isolates incognito state to volatile memory; zero disk writes. | **Mitigated**: Destroying private context clears all memory stores. |

---

## 5. Overlay Safety & Window Isolation

### 5.1 Android System Alert Window Hardening
- **No System Dialog Mimicry**: The floating bubble and browser window use Yayra's distinctive glassmorphism styling and never imitate Android system alerts, permission dialogues, or lock screens.
- **Input Isolation**: Yayra's overlay view does not intercept global keystrokes or monitor touch events occurring outside its designated window bounds.
- **Touch Slop Disambiguation**: Android `YayraFloatBubbleManager` computes Euclidean drag distances against system `touchSlop` (8dp), preventing accidental touch activation or tapjacking.

### 5.2 Desktop Floating Overlay Isolation
- **Windows Topmost Safety**: `WS_EX_TOPMOST` and `WS_EX_TOOLWINDOW` flags ensure the floating window stays accessible without stealing keyboard focus from active productivity apps unless explicitly clicked.
- **Linux Wayland / X11 Clamping**: Floating windows are constrained to monitor work area boundaries, preventing off-screen trapping or window hijacking.

---

## 6. Privacy Architecture & Data Protection

1. **Local-First Architecture**: All browsing history, bookmarks, tabs, settings, and permissions are stored locally in the user's secure application data directory.
2. **Zero Remote Tracking**: Yayra contains no remote telemetry beacons, no user behavior trackers, and no ad networks.
3. **Transparent Privacy Manager**:
   - Granular deletion for history visits, search queries, download logs, and bookmarks.
   - One-click **Clear All User Data** (`PrivacyManager.clearAllUserData()`) completely purges databases, caches, cookies, and web storage.
4. **Ephemerality of Private Mode**:
   - `PrivateBrowsingStorageContext` uses `MemoryPersistenceAdapter`.
   - Private sessions are never written to SQLite or LocalStorage.
   - Exiting private mode or closing the window instantly purges memory structures.

---

## 7. Honest Vulnerability & Platform Limitation Reporting

In accordance with transparent engineering principles, the following platform-dependent considerations and constraints are documented:

1. **Underlying WebView Engine Vulnerabilities**:
   - Yayra relies on the host OS browser runtimes (Android System WebView / Blink, Windows WebView2 / Chromium, Linux WebKitGTK).
   - Zero-day vulnerabilities in the underlying Chromium/WebKit engines must be patched via platform system updates (Google Play Services, Microsoft Edge WebView2 Evergreen, or Linux distribution packages).
2. **Wayland Floating Position Restrictions**:
   - Modern Wayland compositors (GNOME Mutter, KDE KWin) strictly restrict clients from placing arbitrary floating windows at fixed global screen coordinates. While Yayra supports layer-shell and XWayland fallbacks, full global coordinate control is compositor-dependent.
3. **Android Overlay Permission Restrictions**:
   - Android 10+ strictly requires the user to grant `SYSTEM_ALERT_WINDOW` via the system settings menu. Yayra handles denial gracefully and provides in-app recovery flows.

---

## 8. Automated Security Test Verification

The security hardening boundaries are continuously verified by the automated test suite in `tests/browser-security-hardening.test.mjs` and `tests/security.test.mjs`:
- ✅ `HTTPS-first upgrades insecure HTTP urls while exempting localhost`
- ✅ `Blocks dangerous and unsupported protocol schemes`
- ✅ `Validates redirect navigation and prevents HTTPS downgrade`
- ✅ `Sanitizes download filenames against path traversal, null bytes and OS reserved devices`
- ✅ `Native JavaScript bridge validates origin, action authorization, and structure`
- ✅ `Website Permissions: Enforces zero automatic grants, origin scoping, and user prompting`
- ✅ `Website Permissions: Respects native platform OS permission rejection`
- ✅ `Website Permissions: Origin-scoped clearing when site data is cleared`
- ✅ `Browser Isolation: Private browsing storage context prevents leakage to persistent disk`
- ✅ `Privacy Controls: PrivacyManager executes full wipe of history, cookies, cache, and permissions`
- ✅ `Content Security Policy is pinned to self, exact hosts, and desktop custom scheme`
- ✅ `Local asset serving refuses directory traversal and preserves JS MIME type`
