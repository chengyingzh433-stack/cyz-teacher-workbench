export type WindowMaterialMode = 'opaque' | 'glass-light' | 'glass-dark';

export interface ThemeWindowMeta {
  id: string;
  isDark: boolean;
  windowMaterial: WindowMaterialMode;
  /** Opaque fallback window background color (also used on Win10 / Linux / opaque themes). */
  windowBg: string;
}

export const THEME_WINDOW_META: Record<string, ThemeWindowMeta> = {
  'studio-light': {
    id: 'studio-light',
    isDark: false,
    windowMaterial: 'opaque',
    windowBg: '#faf9f6',
  },
  'studio-dark': {
    id: 'studio-dark',
    isDark: true,
    windowMaterial: 'opaque',
    windowBg: '#131517',
  },
  'glass-mist': {
    id: 'glass-mist',
    isDark: false,
    windowMaterial: 'glass-light',
    windowBg: '#e8f1fa',
  },
  'glass-aurora': {
    id: 'glass-aurora',
    isDark: true,
    windowMaterial: 'glass-dark',
    windowBg: '#0b1020',
  },
  'sakura-campus': {
    id: 'sakura-campus',
    isDark: false,
    windowMaterial: 'opaque',
    windowBg: '#fffbf7',
  },
  'editorial-paper': {
    id: 'editorial-paper',
    isDark: false,
    windowMaterial: 'opaque',
    windowBg: '#f6f1e5',
  },
  'cozy-pixel': {
    id: 'cozy-pixel',
    isDark: false,
    windowMaterial: 'opaque',
    windowBg: '#faf3e0',
  },
};

export function getThemeWindowMeta(themeId: string): ThemeWindowMeta {
  return THEME_WINDOW_META[themeId] || THEME_WINDOW_META['studio-light'];
}
