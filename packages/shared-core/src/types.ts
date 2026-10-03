/**
 * Yayra Floating Browser - Shared Core Domain Models
 * Platform-independent type definitions and interfaces.
 */

export type DesktopFloatingMode = 'circle-first' | 'browser-first';

export type SnapSide = 'left' | 'right' | 'top' | 'bottom' | 'free';

export type ThemeMode = 'dark' | 'light' | 'system';

export type SearchEngine = 'duckduckgo' | 'google' | 'bing' | 'searx' | 'custom';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorIndex?: number;
}

export interface WindowState {
  geometry: WindowGeometry;
  isVisible: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  isAlwaysOnTop: boolean;
  isDockedToCircle: boolean;
  opacity: number;
  zIndex: number;
}

export interface FloatingCircleState {
  x: number;
  y: number;
  radius: number;
  isVisible: boolean;
  isExpanded: boolean;
  isDragging: boolean;
  snapSide: SnapSide;
  badgeCount: number;
  opacity: number;
  monitorIndex?: number;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  isLoading: boolean;
  loadingProgress: number; // 0 to 100
  canGoBack: boolean;
  canGoForward: boolean;
  zoomLevel: number;
  isIncognito: boolean;
  isSecure: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  timestamp: number;
  visitCount: number;
}

export interface BookmarkItem {
  id: string;
  parentId: string | null;
  title: string;
  url?: string;
  favicon?: string | null;
  isFolder: boolean;
  createdAt: number;
}

export interface UserSettings {
  desktopFloatingMode: DesktopFloatingMode;
  startFloatingOnLaunch: boolean;
  floatingEnabledByDefault?: boolean;
  alwaysOnTop: boolean;
  rememberPosition: boolean;
  rememberSize: boolean;
  minimizeToBubble: boolean;
  closeToTray: boolean;
  startWithWindows: boolean;
  theme: ThemeMode;
  searchEngine: SearchEngine;
  customSearchUrl?: string;
  startUrl: string;
  defaultZoom: number;
  hardwareAcceleration: boolean;
  adBlockEnabled: boolean;
  savePasswordsEnabled?: boolean;
  autofillEnabled?: boolean;
  clearHistoryOnExit: boolean;
  glassmorphismBlurRadius: number; // in px (e.g. 24)
  glassmorphismOpacity: number; // 0.0 to 1.0 (e.g. 0.88)
  bubbleOpacity?: number;
  frameOpacity?: number;
  customUserAgent?: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  desktopFloatingMode: 'circle-first',
  startFloatingOnLaunch: true,
  floatingEnabledByDefault: true,
  alwaysOnTop: true,
  rememberPosition: true,
  rememberSize: true,
  minimizeToBubble: true,
  closeToTray: true,
  startWithWindows: false,
  theme: 'dark',
  searchEngine: 'duckduckgo',
  startUrl: 'https://duckduckgo.com',
  defaultZoom: 1.0,
  hardwareAcceleration: true,
  adBlockEnabled: true,
  savePasswordsEnabled: true,
  autofillEnabled: true,
  clearHistoryOnExit: false,
  glassmorphismBlurRadius: 24,
  glassmorphismOpacity: 0.88,
  bubbleOpacity: 0.88,
  frameOpacity: 0.85
});

export type NavigationEventType =
  | 'navigation:started'
  | 'navigation:committed'
  | 'navigation:completed'
  | 'navigation:failed'
  | 'navigation:title-changed'
  | 'navigation:favicon-changed'
  | 'navigation:progress-changed'
  | 'tab:created'
  | 'tab:closed'
  | 'tab:switched'
  | 'floating:circle-toggled'
  | 'floating:mode-changed'
  | 'window:resized'
  | 'window:moved'
  | 'window:minimized'
  | 'window:restored'
  | 'window:closed'
  | 'tray:clicked'
  | 'tray:menu-action'
  | 'settings:updated';

export interface NavigationEventPayloads {
  'navigation:started': { tabId: string; url: string };
  'navigation:committed': { tabId: string; url: string };
  'navigation:completed': { tabId: string; url: string; status: number };
  'navigation:failed': { tabId: string; url: string; error: string; code?: number };
  'navigation:title-changed': { tabId: string; title: string };
  'navigation:favicon-changed': { tabId: string; favicon: string };
  'navigation:progress-changed': { tabId: string; progress: number };
  'tab:created': { tab: BrowserTab };
  'tab:closed': { tabId: string };
  'tab:switched': { previousTabId: string | null; currentTabId: string };
  'floating:circle-toggled': { isExpanded: boolean };
  'floating:mode-changed': { mode: DesktopFloatingMode };
  'window:resized': { width: number; height: number };
  'window:moved': { x: number; y: number };
  'window:minimized': { dockedToCircle: boolean };
  'window:restored': { geometry: WindowGeometry };
  'window:closed': { toTray: boolean };
  'tray:clicked': { button: 'left' | 'right' | 'double' };
  'tray:menu-action': { action: string };
  'settings:updated': { settings: Partial<UserSettings> };
}
