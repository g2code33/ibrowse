# ADR 0003: Local-First Persistence and Privacy Architecture

## Status
Accepted

## Context
Yayra is strictly designed as a **local-first, privacy-respecting floating browser**:
* No mandatory accounts, login portals, cloud backends, subscriptions, or paid third-party SDKs.
* All user browsing history, bookmarks, open tab sessions, window geometries, and settings must remain exclusively on the user's physical device unless the user explicitly exports or backs them up.

## Decision
1. **Local-First Storage Engine (`@yayra/persistence`)**:
   - Built on an extensible adapter interface (`IPersistenceAdapter`).
   - Supports `LocalStorageAdapter` / `IndexedDBStore` for Web/PWA/Electron renderer environments and `SQLiteStore` / `FileStore` for native Android/Desktop environments.
2. **Repository Architecture**:
   - `SettingsRepository`: Manages user configuration (`desktopFloatingMode`, `theme`, `searchEngine`, `adBlockEnabled`, `glassmorphismBlurRadius`, `window-geometry`).
   - `HistoryRepository`: Encrypted/indexed visit logging with domain search, timestamps, visit counts, and automatic retention cleanup.
   - `BookmarkRepository`: Nested folder hierarchy with custom titles, URLs, and favicons.
   - `SessionRepository`: Tab persistence, active tab index tracking, and automatic crash recovery state.
3. **Incognito / Private Mode Isolation**:
   - Incognito tabs are explicitly omitted from `SessionRepository` and `HistoryRepository` writes.
   - Native browser engines are instructed to initialize ephemeral data partitions (e.g., `webkit_website_data_manager_new_ephemeral` on Linux, in-memory partition on Windows/Android).

## Consequences
### Positive
* Zero cloud latency for settings, history, and tab lookups.
* 100% offline functionality.
* Uncompromising user privacy with zero telemetry of browsing behavior.
