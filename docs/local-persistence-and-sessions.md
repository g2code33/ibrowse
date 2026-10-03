# Local-First Persistence, Browser History, Bookmarks & Sessions

## Architecture & System Overview

`yayra` implements a maintainable, local-first cross-platform persistence subsystem. The architecture provides relational and structured key-value persistence without requiring cloud infrastructure, subscriptions, or mandatory user accounts.

```
+-------------------------------------------------------------------------+
|                        Unified Persistence Architecture                 |
|                                                                         |
|  +--------------------+  +--------------------+  +-------------------+  |
|  | Normal Browsing    |  | Incognito Partition|  | Corrupted Record  |  |
|  | Storage Controller |  | Ephemeral Context  |  | Recovery Adapter  |  |
|  +--------------------+  +--------------------+  +-------------------+  |
|            |                       |                       |            |
+------------+-----------------------+-----------------------+------------+
                                     |
+------------------------------------+------------------------------------+
|                         The 8 Database Entities                        |
|                                                                         |
|  1. BrowserTab          2. BrowserHistory       3. BrowserBookmark      |
|  4. BrowserSession      5. DownloadRecord       6. BrowserSettings      |
|  7. FloatingSettings    8. DesktopFloatingMode                          |
+------------------------------------+------------------------------------+
                                     |
+------------------------------------+------------------------------------+
|                    Repositories & Privacy Engine                        |
|                                                                         |
|  - HistoryRepository: Credential sanitization, search, last visited     |
|  - BookmarkRepository: Hierarchy tree, folders, position ordering       |
|  - SessionRepository: Safe restoration, URL validation, state restore   |
|  - DownloadRepository: Progress, mime-types, state transitions          |
|  - SettingsRepository: Local preferences, geometry, bubble coordinate   |
|  - PrivacyManager: Clear history, cookies, cache, web storage, wipe    |
+-------------------------------------------------------------------------+
```

---

## 1. Storage Architecture & Multiplatform Strategy

### Cross-Platform Evaluation: SQLDelight & SQLite
While Android provides Android Room (an abstraction over SQLite), Room depends on Android runtime components (`android.arch.persistence.room`) and cannot be used unchanged across Windows (Win32), Linux (Debian/Ubuntu WebKitGTK), and Web/PWA platforms.

`yayra` uses a portable architecture:
- **Relational Schema Definition:** Defined via cross-platform SQLite/SQLDelight DDL declarations.
- **Local-First Abstract Contract (`IPersistenceAdapter`):** Implemented via SQLite native bindings on desktop/mobile, IndexedDB/localStorage on Web/PWA, and `MemoryPersistenceAdapter` for in-memory testing and ephemeral contexts.
- **Resilient Recovery (`CorruptedDataRecoveryAdapter`):** Catches corrupted data or malformed storage entries, records corruption diagnostics, and falls back to last-known-good state or safe defaults without crashing.

---

## 2. The 8 Database Entities

### 1. `BrowserTab` (`browser_tab`)
- `id`: Unique tab identifier (`string`).
- `sessionId`: Parent session foreign key (`string`).
- `url`: Validated URL destination (`string`).
- `title`: Tab title (`string`).
- `favicon`: Tab favicon URI (`string | null`).
- `isIncognito`: Whether tab belongs to an incognito partition (`boolean`).
- `zoomLevel`: Current page zoom (`number`).
- `canGoBack` / `canGoForward`: History navigation state (`boolean`).
- `position`: Tab index order in strip (`number`).
- `createdAt` / `updatedAt`: Timestamps (`number`).

### 2. `BrowserHistory` (`browser_history`)
- `id`: History entry UUID (`string`).
- `url`: Sanitized URL (credentials and sensitive query parameters redacted) (`string`).
- `title`: Page title (`string`).
- `favicon`: Favicon URI (`string | null`).
- `visitCount`: Accumulated visits count (`number`).
- `lastVisitedAt`: Timestamp of latest visit (`number`).
- `isIncognito`: Partition flag (`boolean`).
- `searchTerms`: Indexed lowercase title and URL query terms (`string`).

### 3. `BrowserBookmark` (`browser_bookmark`)
- `id`: Bookmark entry UUID (`string`).
- `parentId`: Parent folder UUID for nested hierarchical trees (`string | null`).
- `title`: Bookmark or folder name (`string`).
- `url`: Bookmark target URL (`string | undefined`).
- `favicon`: Bookmark favicon (`string | null`).
- `isFolder`: Whether entry is a container folder (`boolean`).
- `position`: Sibling ordering index (`number`).
- `createdAt` / `updatedAt`: Timestamps (`number`).

### 4. `BrowserSession` (`browser_session`)
- `id`: Session UUID (`string`).
- `name`: Session name (`string`).
- `activeTabId`: Currently active tab ID (`string | null`).
- `tabs`: Array of non-incognito `BrowserTabEntity` records.
- `windowGeometry`: Saved window coordinates and dimensions (`WindowGeometry`).
- `bubblePosition`: Saved floating bubble `(x, y)` and snap side (`SnapSide`).
- `isPrivate`: Whether session is private (`boolean`).
- `createdAt` / `updatedAt`: Timestamps (`number`).

### 5. `DownloadRecord` (`download_record`)
- `id`: Download UUID (`string`).
- `url`: Source file URL (`string`).
- `fileName`: Target filename (`string`).
- `filePath`: Local destination path (`string`).
- `totalBytes`: Total file size in bytes (`number`).
- `receivedBytes`: Downloaded bytes progress (`number`).
- `state`: `'pending' | 'in-progress' | 'completed' | 'cancelled' | 'interrupted'`.
- `mimeType`: Content MIME type (`string`).
- `createdAt` / `completedAt`: Timestamps (`number`).

### 6. `BrowserSettings` (`browser_settings`)
- `theme`: `'dark' | 'light' | 'system'`.
- `searchEngine`: `'duckduckgo' | 'searx' | 'google' | 'bing' | 'custom'`.
- `customSearchUrl`: Custom search template URL (`string`).
- `startUrl` / `homepage`: Default launch URLs (`string`).
- `defaultZoom`: Base zoom factor (`number`).
- `hardwareAcceleration`: GPU acceleration enabled (`boolean`).
- `adBlockEnabled`: Built-in content blocking enabled (`boolean`).
- `clearHistoryOnExit`: Automatic history clearance on shutdown (`boolean`).
- `glassmorphismBlurRadius` / `glassmorphismOpacity`: Visual glass styling tokens.
- `customUserAgent`: Optional custom HTTP User-Agent string.

### 7. `FloatingSettings` (`floating_settings`)
- `desktopFloatingMode`: `'circle-first' | 'browser-first'`.
- `startFloatingOnLaunch`: Auto-mount overlay on launch (`boolean`).
- `alwaysOnTop`: Topmost z-order flag (`boolean`).
- `rememberPosition` / `rememberSize`: Window geometry persistence (`boolean`).
- `minimizeToBubble`: Collapse to circle on minimize (`boolean`).
- `closeToTray`: Close button minimizes to tray/bubble (`boolean`).
- `startWithWindows`: OS startup preference (`boolean`).
- `bubbleX` / `bubbleY`: Floating bubble coordinates (`number`).
- `bubbleSnapSide`: Magnetic snap side (`'left' | 'right' | 'top' | 'bottom' | 'free'`).

### 8. `DesktopFloatingMode`
- Discrete domain model representing `Mode A: Circle-First` vs `Mode B: Browser-First`.

---

## 3. Session Rules & Safe URL Restoration

1. **Minimizing Does Not Delete Sessions:** Minimizing the browser (whether on Windows, Linux, or Android) hides the overlay surface or docks to the bubble; all active DOM, JavaScript state, WebViews, and tabs remain preserved in memory.
2. **Tab Disposal:** Closing an individual tab cleans up its renderer process, view handles, and memory allocations.
3. **Application Shutdown:** On application exit, non-incognito open tabs and window geometry are saved to `SessionRepository`.
4. **URL Sanitization on Restore:**
   - URLs are validated before re-loading into the browser engine.
   - Dangerous executable pseudo-schemes (`javascript:`, `vbscript:`, `data:text/html`) are neutralized to the user's default search engine.
   - Cleartext sensitive credentials (e.g. `?password=`, `?token=`, `?secret=`) are automatically redacted from persisted URLs and session states.
   - Form field passwords and sensitive inputs are never persisted or restored.

---

## 4. Privacy Engine & Data Management

`PrivacyManager` provides granular and complete user privacy control:

- **Clear History:** Purges all navigation records and search term indexes.
- **Clear Cookies:** Deletes all stored session and persistent cookies.
- **Clear Cache:** Evicts HTTP disk and memory cache entries.
- **Clear Website Storage:** Clears HTML5 `localStorage`, `IndexedDB`, and site service worker storage partitions.
- **Delete Individual Records:** Removes specific history items or bookmark entries by ID.
- **Clear Downloads:** Clears the download activity log without deleting local downloaded files.
- **Clear All User Data:** Performs a total privacy wipe, returning the application to initial clean state.

---

## 5. Private Browsing Architecture

`PrivateBrowsingStorageContext` isolates private/incognito browsing:
- Private tabs operate on an ephemeral, in-memory partition.
- Private browsing history, cookies, cache, and session tabs are **never written to persistent storage**.
- When the private session closes or the window is destroyed, `PrivateBrowsingStorageContext.destroy()` immediately wipes the ephemeral partition from RAM.

---

## 6. Schema Migrations & Corruption Resilience

- **Migration Pipeline (`DatabaseMigrationRunner`):** Tracks database versions sequentially (`schema_version`), enabling progressive schema evolution (e.g. v1 to v2) without data loss.
- **Corrupted Data Recovery (`CorruptedDataRecoveryAdapter`):** If a corrupted storage entry or malformed JSON payload is detected during startup, `yayra` intercepts the error, logs the diagnostic incident, and restores the last-known-good state, ensuring uninterrupted browser launch.
