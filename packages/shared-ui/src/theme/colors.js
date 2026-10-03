/**
 * FloatBrowse Design System - Color System (JS runtime)
 */

export const ColorPalette = Object.freeze({
  navy: {
    950: '#060b19',
    900: '#0a1026',
    850: '#0d1736',
    800: '#111f48',
    700: '#172554',
    600: '#1e3a8a',
    500: '#3b82f6',
    400: '#60a5fa',
    300: '#93c5fd',
    200: '#bfdbfe',
    100: '#dbeafe',
    50: '#eff6ff'
  },
  cyan: {
    900: '#164e63',
    800: '#155e75',
    700: '#0e7490',
    600: '#0891b2',
    500: '#06b6d4',
    400: '#22d3ee',
    300: '#67e8f9',
    200: '#a5f3fc',
    100: '#cffafe',
    50: '#ecfeff'
  },
  blue: {
    600: '#2563eb',
    500: '#3b82f6',
    400: '#60a5fa',
    300: '#93c5fd'
  },
  slate: {
    900: '#0f172a',
    800: '#1e293b',
    700: '#334155',
    600: '#475569',
    500: '#64748b',
    400: '#94a3b8',
    300: '#cbd5e1',
    200: '#e2e8f0',
    100: '#f1f5f9',
    50: '#f8fafc'
  },
  semantic: {
    success: '#10b981',
    successGlass: 'rgba(16, 185, 129, 0.18)',
    warning: '#f59e0b',
    warningGlass: 'rgba(245, 158, 11, 0.18)',
    danger: '#ef4444',
    dangerGlass: 'rgba(239, 68, 68, 0.18)',
    info: '#38bdf8',
    infoGlass: 'rgba(56, 189, 248, 0.18)'
  }
});

export const DarkThemeTokens = Object.freeze({
  bgApp: ColorPalette.navy[950],
  bgDeepNavy: ColorPalette.navy[950],
  bgSurface: 'rgba(13, 23, 54, 0.72)',
  bgSurfaceNavy: 'rgba(13, 23, 54, 0.72)',
  bgSurfaceElevated: 'rgba(23, 37, 84, 0.75)',
  bgGlassCard: 'rgba(17, 31, 72, 0.65)',
  bgGlassInput: 'rgba(6, 11, 25, 0.55)',
  glassFill: 'rgba(17, 31, 72, 0.65)',
  borderGlass: 'rgba(255, 255, 255, 0.14)',
  glassBorder: 'rgba(255, 255, 255, 0.14)',
  borderGlassHighlight: 'rgba(56, 189, 248, 0.35)',
  textPrimary: ColorPalette.slate[50],
  textSecondary: ColorPalette.slate[400],
  textMuted: ColorPalette.slate[500],
  accentPrimary: ColorPalette.cyan[500],
  accentCyan: ColorPalette.cyan[500],
  accentSecondary: ColorPalette.blue[600],
  accentBlue: ColorPalette.blue[600],
  accentGlow: 'rgba(6, 182, 212, 0.35)',
  shadowSurface: '0 20px 40px -15px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)',
  statusActive: ColorPalette.semantic.success,
  statusInactive: ColorPalette.slate[500],
  statusWarning: ColorPalette.semantic.warning
});

export const LightThemeTokens = Object.freeze({
  bgApp: '#f0f4f8',
  bgDeepNavy: '#f0f4f8',
  bgSurface: 'rgba(255, 255, 255, 0.75)',
  bgSurfaceNavy: 'rgba(255, 255, 255, 0.75)',
  bgSurfaceElevated: 'rgba(255, 255, 255, 0.90)',
  bgGlassCard: 'rgba(255, 255, 255, 0.70)',
  bgGlassInput: 'rgba(241, 245, 249, 0.80)',
  glassFill: 'rgba(255, 255, 255, 0.70)',
  borderGlass: 'rgba(0, 0, 0, 0.08)',
  glassBorder: 'rgba(0, 0, 0, 0.08)',
  borderGlassHighlight: 'rgba(14, 116, 144, 0.45)',
  textPrimary: ColorPalette.slate[900],
  textSecondary: ColorPalette.slate[600],
  textMuted: ColorPalette.slate[400],
  accentPrimary: ColorPalette.cyan[600],
  accentCyan: ColorPalette.cyan[600],
  accentSecondary: ColorPalette.blue[600],
  accentBlue: ColorPalette.blue[600],
  accentGlow: 'rgba(8, 145, 178, 0.25)',
  shadowSurface: '0 20px 40px -15px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.06)',
  statusActive: ColorPalette.semantic.success,
  statusInactive: ColorPalette.slate[400],
  statusWarning: ColorPalette.semantic.warning
});

export const Colors = Object.freeze({
  dark: DarkThemeTokens,
  light: LightThemeTokens,
  palette: ColorPalette
});
