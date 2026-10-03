# Yayra Windows Native Browser Engine (Microsoft WebView2)

## 1. Architectural Overview

The Yayra Windows Native Browser Engine (`@yayra/browser-windows`) provides an isolated, leak-free, hardware-accelerated desktop browser runtime built directly on **Microsoft Edge WebView2 Evergreen**. It bridges the universal `@yayra/browser-contract` interfaces to the 64-bit Windows desktop environment (`x86_64` / `ARM64`) while embedding directly into Win32 `HWND` desktop view hierarchies.

```
┌────────────────────────────────────────────────────────────┐
│                  @yayra/browser-contract                   │
│         (IBrowserEngine, BrowserTab, UrlInterpreter)       │
└─────────────────────────────▲──────────────────────────────┘
                              │
┌─────────────────────────────┴──────────────────────────────┐
│                  WindowsWebView2Engine                     │
│     • Multiple Tab Coordination & History Stacks           │
│     • Runtime Detection & Recovery Lifecycle               │
│     • Win32 HWND Bounds & Visibility Synchronization       │
│     • Hardened Security Invariants & Error Surface         │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                  Native Windows Components                 │
│  • YayraWebView2RuntimeDetector (Registry & Bootstrapper)  │
│  • YayraWebView2Controller (Win32 HWND Embedder & COM)     │
│  • ICoreWebView2NavigationStartingEventHandler (SSL/Rules) │
│  • ICoreWebView2DownloadStartingEventHandler (Safe DL)     │
│  • ICoreWebView2ProcessFailedEventHandler (Crash Recovery) │
└────────────────────────────────────────────────────────────┘
```

---

## 2. 64-Bit Evergreen Runtime Detection & Recovery

Windows WebView2 requires the Microsoft Edge WebView2 Evergreen Runtime. Yayra provides native detection and automated remediation mechanisms:

### Registry Key Detection
Yayra inspects the Windows Registry via Win32 `RegOpenKeyExW` / `RegQueryValueExW` across:
1. `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-F500-4100-9A2E-C9454B7D23E7}` (`pv` value).
2. `HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-F500-4100-9A2E-C9454B7D23E7}` (`pv` value).
3. `GetAvailableCoreWebView2BrowserVersionString` COM export from `WebView2Loader.dll`.

### Remediation Guidance & Silent Evergreen Bootstrapper
If the runtime is missing or corrupt:
- Returns `WebView2RuntimeStatus` with `isAvailable: false`.
- Directs users to the official Microsoft Evergreen Bootstrapper: `https://go.microsoft.com/fwlink/p/?LinkId=2124703`.
- Provides silent installation command: `MicrosoftEdgeWebview2Setup.exe /silent /install`.

---

## 3. Security Invariants & Threat Mitigations

| Security Policy | Implementation | Threat Mitigation |
| :--- | :--- | :--- |
| **Strict TLS Certificate Verification** | `ICoreWebView2ServerCertificateErrorDetectedEventHandler` sets `args->put_Action(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL)`. | Prevents Man-in-the-Middle (MitM) attacks, invalid certificate bypasses, and hostile proxy interception. |
| **Dangerous Scheme Interception** | `NavigationStarting` blocks `javascript:`, `data:`, `vbscript:`, and unsafe `file:///` executions. | Prevents Cross-Site Scripting (XSS) and top-level privilege escalation. |
| **Restricted Host Bridge** | `add_WebMessageReceived` uses strict JSON contract deserialization and sender origin filtering. | Eliminates arbitrary COM object injection and unauthorized host RPC execution. |
| **Safe Download Pipeline** | `DownloadStarting` cancels downloads matching untrusted signatures, forces explicit file paths, and monitors progress via `COREWEBVIEW2_DOWNLOAD_STATE`. | Prevents drive-by downloads and unprompted filesystem writes. |
| **Local File Sandboxing** | `ICoreWebView2Settings::put_AreFileAccessAndLocalAccessRulesPermitted(FALSE)`. | Restricts web documents from traversing the host NTFS filesystem. |
| **Web Permission Prompt Mediation** | `PermissionRequested` handler forwards camera, mic, and geolocation requests to native desktop dialogs. | Disallows automatic or silent acquisition of sensitive desktop peripherals. |

---

## 4. Multi-Tab Management & Win32 Window Embedding

- **Zero Fake Browser Processes**: WebView2 controllers are attached directly to the host application's Win32 `HWND` or sub-HWND containers using `CreateCoreWebView2Controller(parentHwnd, ...)`.
- **Dynamic Tab Switching**: Inactive tabs are hidden via `put_IsVisible(FALSE)`, while active tabs are displayed with `put_IsVisible(TRUE)` and repositioned using `put_Bounds(bounds)`.
- **Independent History & Navigation**: Each `BrowserTab` retains an isolated history stack, loading status, title, URL, and security state.
- **Process Failure & Crash Isolation**: `ProcessFailed` traps renderer termination, subframe crashes, and GPU process re-initializations without crashing the parent desktop window.

---

## 5. Explicit Teardown & Leak Prevention

```cpp
void YayraWebView2Controller::Destroy() {
    if (m_webView) {
        m_webView->Stop();
        m_webView = nullptr;
    }
    if (m_controller) {
        m_controller->Close();
        m_controller = nullptr;
    }
    if (m_environment) {
        m_environment = nullptr;
    }
}
```

- Disassociates all event token registrations (`remove_NavigationStarting`, `remove_SourceChanged`, etc.).
- Invokes `ICoreWebView2Controller::Close()` to release underlying DirectComposition and HWND surfaces.
- Cleans up isolated user data folder profiles if ephemeral or clears specific caches on session termination.

---

## 6. Documented Limitations & Platform Discrepancies

1. **Windows 7 / 8 / 8.1 EOL**: Microsoft Edge WebView2 Evergreen support ended on Windows 7/8/8.1 with Edge v109. Supported targets are Windows 10 (Build 17763+) and Windows 11 on `x86_64` and `ARM64`.
2. **Elevated (Admin) Privilege Restrictions**: WebView2 by design prevents running standard user data directories from processes elevated via UAC ("Run as Administrator") due to sandbox privilege separation.
3. **Pure Win32 HWND Airspace**: In non-composition hosting modes, Win32 HWND surfaces draw on top of child Direct2D/DirectWrite overlays ("Airspace limitation"). Yayra leverages `ICoreWebView2CompositionController` where hardware composition transparency is required.
