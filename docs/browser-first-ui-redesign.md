# Yayra Browser: Browser-First UI Architecture & Redesign Specification

**Version**: `0.1.0`  
**Target Platforms**: Android (10–15+), Windows 10/11 (64-bit), Debian/Ubuntu Linux (X11 & Wayland), Web/PWA  
**Design Philosophy**: Polished, mainstream browser interface inspired by familiar desktop Chrome and mobile Safari interaction patterns, maintaining Yayra's signature lightweight glassmorphism and local-first privacy.

---

## 1. Design Overview & Paradigm Shift

Yayra has transitioned from a technical management dashboard view to a **clean, mainstream, browser-first experience**:
- **On Desktop (Windows & Linux)**: Opens directly into a Chrome-style browser shell with a top tab strip, navigation toolbar, unified Omnibox, and full-screen active webpage area.
- **On Mobile (Android & iOS / Narrow Screens)**: Opens directly into a Safari-style mobile layout with a top address pill, full-height webpage, and a compact bottom toolbar with a tab switcher and action menu.
- **Zero Technical Clutter**: System metrics, engine details, and service logs are removed from the default browsing view and organized cleanly into secondary menus and settings.
- **Floating Capability Intact**: Dual desktop floating modes (Mode A: Circle-First vs Mode B: Browser-First) and Android floating bubbles remain fully accessible without cluttering the primary browsing experience.

---

## 2. Desktop Shell (Chrome-Style Interaction Pattern)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [● Tab 1 (Active) ✕] [● Tab 2 ✕] [+]                 [○ Bubble] [— □ ✕]│
├────────────────────────────────────────────────────────────────────────┤
│ [◀] [▶] [⟳]  [ 🔒 search or enter address                  ★ ]  [Mode A] [⋮] │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                          Active Webpage Content                        │
│                         (or Minimal New-Tab Page)                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### A. Top Tab Strip (`.fb-chrome-tabstrip`)
1. **Horizontal Tab Items**: Each tab displays a favicon (or fallback globe/incognito mask), truncated page title, and a distinct close button (`×`).
2. **Active Tab Distinction**: Active tab rises seamlessly from the navigation toolbar with elevated glassmorphism highlight.
3. **New Tab Button**: Prominent `+` button in the tab strip creating new regular or incognito tabs (`Ctrl+T` / `Ctrl+Shift+N`).
4. **Window & Overlay Actions**: Includes a subtle "Minimize to Floating Bubble" action and native window controls.

### B. Navigation & Omnibox Toolbar (`.fb-chrome-navbar`)
1. **Navigation Controls**:
   - **Back (◀)** and **Forward (▶)** with automatic disabled states when history bounds are reached.
   - **Reload / Stop (⟳ / ✕)**: Dynamically flips to stop button during active network loads.
2. **Unified Omnibox (`.fb-omnibox-container`)**:
   - **Security Status Badge**: Green lock (`🔒`) for HTTPS; security warning icon for insecure HTTP.
   - **Smart Address & Search**: Direct domain/URL input or natural language queries auto-routed to configured search engines (DuckDuckGo, Google, Bing, Startpage).
   - **Keyboard Navigation**: `Enter` navigates; `Escape` restores current page URL; auto-selects text on focus.
   - **Bookmark Star (★)**: Toggles bookmark persistence instantly with local SQLite/IndexedDB store.
3. **Action Menu (⋮)**:
   - Compact menu button exposing: New Tab, New Private Tab, History, Bookmarks, Downloads, Desktop Floating Modes, Settings, Permissions, and About.

### C. Minimalist New-Tab Page (`.fb-newtab-page`)
When navigating to `yayra://newtab` or opening a fresh tab:
- Centered Yayra glass orb logo and brand typography.
- Prominent search input with auto-focus.
- Clean row of top visited / bookmarked shortcut cards.
- Discreet local-first privacy tag: *"Local-First • Zero Cloud Sync • Isolated Storage"*.

---

## 3. Mobile Experience (Safari-Style Interaction Pattern)

```
┌──────────────────────────────────────────┐
│ [ 🔒 search or enter address         ⟳ ] │  ← Top Address Pill
├──────────────────────────────────────────┤
│                                          │
│                                          │
│          Active Mobile Webpage           │
│                                          │
│                                          │
├──────────────────────────────────────────┤
│   [◀]    [▶]    [📤]    [★]   [🗂 (3)]  [•••]  │  ← Bottom Toolbar
└──────────────────────────────────────────┘
```

### A. Mobile Top Bar (`.fb-mobile-topbar`)
- Compact address pill showing connection security lock, current domain/search query, and a reload button.
- Tapping the pill opens a quick search overlay with immediate virtual keyboard focus.

### B. Mobile Bottom Toolbar (`.fb-mobile-bottombar`)
- **Back (◀)** / **Forward (▶)**: Touch-friendly navigation.
- **Share (📤)**: Invokes the native Web Share API or copies link to clipboard.
- **Bookmarks (★)**: Opens the bookmarks sheet.
- **Tab Switcher (🗂)**: Displays an active badge with open tab count (e.g. `3`).
- **More (•••)**: Opens a compact bottom sheet with secondary browser options.

### C. Mobile Tab Switcher (`.fb-tabswitcher-grid`)
- Fullscreen grid layout showing visual tab cards with page titles, hostnames, and close buttons.
- Bottom action bar with **"+ New Tab"** and **"Done"**.

---

## 4. Secondary Information Architecture & Modals

All secondary features are neatly organized in lightweight, accessible modals:

| Modal / Sheet | Features & Capabilities |
| :--- | :--- |
| **History (`Ctrl+H`)** | Searchable browsing history with timestamps, domain grouping, visit launch, and "Clear All" action. |
| **Bookmarks (`Ctrl+B`)** | Hierarchical bookmarks list, instant star toggling, and quick launch. |
| **Downloads (`Ctrl+J`)** | List of downloaded files with progress/size indicator, path verification, and quarantine safety. |
| **Settings** | Appearance (Dark/Light/System), Desktop Floating Modes (Mode A vs Mode B), Search Engine selection, HTTPS-First toggle, and Clear Data on Exit. |
| **Site Permissions** | Origin-scoped camera, microphone, geolocation, and notification permissions. |
| **About Yayra** | Version `0.1.0`, license, build SHA, and manual update verification. |

---

## 5. Keyboard Accessibility Matrix

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+T` / `Cmd+T` | Open new tab |
| `Ctrl+Shift+N` | Open new private/incognito tab |
| `Ctrl+W` / `Cmd+W` | Close active tab |
| `Ctrl+L` / `Cmd+L` | Focus address bar (Omnibox) |
| `Ctrl+R` / `Cmd+R` / `F5` | Reload current page |
| `Ctrl+H` | Open History modal |
| `Ctrl+B` | Open Bookmarks modal |
| `Ctrl+J` | Open Downloads modal |
| `Escape` | Dismiss open modal or reset Omnibox text |

---

## 6. Verification & Automated Test Coverage

The redesigned browser-first shell is verified by 156 automated tests:
- `tests/browser-first-ui-redesign.test.mjs` (7 subtests verifying Chrome tab strip, Omnibox, modals, floating mode toggling, mobile Safari layout, tab switcher, and star bookmarking).
- Full regression matrix across navigation, security, packaging, persistence, and floating subsystems: **156/156 passing**.
