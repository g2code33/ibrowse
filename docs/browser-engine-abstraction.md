# Yayra Browser Engine Abstraction & Shared Navigation Contract

## 1. Overview & Architecture

Yayra Floating Browser uses a decoupled, platform-independent browser architecture. The contract package `@yayra/browser-contract` defines pure interfaces and state machines without direct runtime bindings to Android WebView, WebView2, or WebKitGTK.

```
┌────────────────────────────────────────────────────────┐
│                   Shared UI Layer                      │
│     (Toolbar, Dashboard, Glass Window, Bubble)         │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│             BrowserNavigationManager                   │
│   • Tab Manager (create / close / undo / select)       │
│   • History Stack & Traversal                          │
│   • State Transitions (Loading / Committed / Loaded)   │
│   • Session Restoration & Serialization                │
└────────────┬─────────────────────────────┬─────────────┘
             │                             │
┌────────────▼─────────────┐ ┌─────────────▼─────────────┐
│      UrlInterpreter      │ │  Download & Permissions   │
│  • Zero-trust validation │ │  • BaseDownloadManager    │
│  • Scheme security filter│ │  • BasePermissionManager  │
│  • IDN & Punycode support│ └───────────────────────────┘
│  • Search engine query   │
└──────────────────────────┘
             │
┌────────────▼───────────────────────────────────────────┐
│               Native Engine Adapters                   │
│   Android (WebView) │ Windows (WebView2) │ Linux (WebKitGTK)
└────────────────────────────────────────────────────────┘
```

---

## 2. Explicit State Models

| State Model | Module Path | Purpose |
| :--- | :--- | :--- |
| `BrowserTab` | `src/models/BrowserTab.ts` | Encapsulates tab identity, URL, title, favicon, loading state, history stack, security flags, and isolation modes. |
| `BrowserSession` | `src/models/BrowserSession.ts` | Complete browser session snapshot with open tabs, active tab focus, and closed tab history for undo restoration. |
| `BrowserNavigationState` | `src/models/BrowserNavigationState.ts` | Explicit representation of navigation history stack, pointer index, and `canGoBack` / `canGoForward` capabilities. |
| `BrowserLoadingState` | `src/models/BrowserLoadingState.ts` | Lifecycle states (`idle`, `loading`, `committed`, `loaded`, `failed`, `cancelled`), progress (0-100), and `NavigationError`. |
| `BrowserSettings` | `src/models/BrowserSettings.ts` | Local-first browser configurations (search engine, zoom, privacy, ad blocking, floating modes). |
| `BrowserHistoryEntry` | `src/models/BrowserHistoryEntry.ts` | Local visit log tracking URL, title, timestamps, and frequency. |
| `BrowserBookmark` | `src/models/BrowserBookmark.ts` | Nested bookmark hierarchy supporting folders and tags. |
| `DownloadRecord` | `src/models/DownloadRecord.ts` | File download tracking with status lifecycle and byte metrics. |
| `WebsitePermission` | `src/models/WebsitePermission.ts` | Origin-scoped web API permissions (`geolocation`, `camera`, `microphone`, `notifications`, etc.). |

---

## 3. Safe URL Interpretation & Zero-Trust Normalization

The `UrlInterpreter` module performs strict input sanitization:
1. **Valid HTTP & HTTPS**: Standardized with port and path normalization.
2. **Search Query Resolution**: Natural language input and multi-word strings are automatically mapped to search engine query templates (`duckduckgo`, `searx`, `google`, `bing`, `custom`).
3. **Dangerous Scheme Protection**: Blocks `javascript:`, `data:`, `vbscript:`, `file:`, `intent:`, `blob:`, etc. for top-level navigation.
4. **Special Internal Schemes**: Permits `yayra://dashboard`, `yayra://settings`, `about:blank`, `about:config`.
5. **Internationalized Domain Names (IDN)**: Handles UTF-8 Unicode domain strings (e.g., `münchen.de`, `https://россия.рф/каталог`) and strips invalid characters.
6. **Trailing Dots & Whitespace**: Automatically trims and normalizes malformed domain strings.

---

## 4. Platform Engine Interface (`IBrowserEngine`)

Unified contract implemented by native platform hosts:
- **Android**: `packages/browser-android/src/AndroidWebViewEngine.ts` / Kotlin WebView Manager.
- **Windows**: `packages/browser-windows/src/WindowsWebView2Engine.ts` / C++ WebView2 Controller.
- **Linux**: `packages/browser-linux/src/LinuxWebKitEngine.ts` / C WebKitGTK View.

### Required Interface Methods:
- `loadUrl(url: string, options?: NavigationOptions): Promise<void>`
- `search(query: string, engine?: SearchEngineType): Promise<void>`
- `goBack(): Promise<boolean>`
- `goForward(): Promise<boolean>`
- `reload(bypassCache?: boolean): Promise<void>`
- `stop(): Promise<void>`
- `navigateHome(): Promise<void>`
- `getCurrentUrl(): string`
- `getPageTitle(): string`
- `getLoadingProgress(): number`
- `getLoadingState(): BrowserLoadingState`
- `getNavigationState(): BrowserNavigationState`
- `evaluateJavaScript<T>(script: string): Promise<T>`
- `setZoomLevel(zoom: number): Promise<void>`
- `destroy(): Promise<void>`

---

## 5. Download & Permission Systems

- **Download Manager**: Tracks download lifecycle (`startDownload`, `pauseDownload`, `resumeDownload`, `cancelDownload`, `getDownloads`) and dispatches progress events.
- **Permission Manager**: Handles origin-level permission queries and prompts (`requestPermission`, `getPermission`, `setPermission`, `clearPermissions`).
