export interface ThemeDefinition {
  id: string;
  name: string;
  tagline: string;
  isDark: boolean;
  preview: {
    canvas: string;
    sidebar: string;
    surface: string;
    accent: string;
  };
  chartPalette: {
    primary: string;
    secondary: string;
    accent: string;
    grid: string;
    text: string;
    muted: string;
    tooltipBg: string;
    tooltipBorder: string;
  };
  /** Optional custom CSS variable overrides for dynamically registered third-party themes. */
  cssVars?: Record<string, string>;
}

const registry = new Map<string, ThemeDefinition>();

const STUDIO_LIGHT: ThemeDefinition = {
  id: 'studio-light',
  name: '现代暖白工作室',
  tagline: '温润纸感画布 + 柔和木纹阳光教室（默认旗舰）',
  isDark: false,
  preview: {
    canvas: '#faf9f6',
    sidebar: '#f3f1ec',
    surface: '#ffffff',
    accent: '#1d6b52',
  },
  chartPalette: {
    primary: '#1d6b52',
    secondary: '#3b82f6',
    accent: '#d97706',
    grid: '#e7e3da',
    text: '#1c1917',
    muted: '#78716c',
    tooltipBg: '#ffffff',
    tooltipBorder: '#d4cfc3',
  },
};

const STUDIO_DARK: ThemeDefinition = {
  id: 'studio-dark',
  name: '深夜护眼工作室',
  tagline: '沉静炭黑画布 + 柔和夜灯教室（长时间批卷推荐）',
  isDark: true,
  preview: {
    canvas: '#131517',
    sidebar: '#1a1c1f',
    surface: '#1e2024',
    accent: '#38b286',
  },
  chartPalette: {
    primary: '#38b286',
    secondary: '#60a5fa',
    accent: '#fbbf24',
    grid: '#2b2f36',
    text: '#f2efe9',
    muted: '#8a867e',
    tooltipBg: '#25282d',
    tooltipBorder: '#3a404a',
  },
};

registry.set(STUDIO_LIGHT.id, STUDIO_LIGHT);
registry.set(STUDIO_DARK.id, STUDIO_DARK);

/** Extensible theme registration hook — future themes (e.g. 日系手账 / 极客 / 像素风) plug right in here. */
export function registerTheme(theme: ThemeDefinition) {
  registry.set(theme.id, theme);
}

export function listThemes(): ThemeDefinition[] {
  return [...registry.values()];
}

export function getTheme(id: string): ThemeDefinition {
  return registry.get(id) || STUDIO_LIGHT;
}

export function applyThemeToDocument(themeId: string): ThemeDefinition {
  const theme = getTheme(themeId);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  // Clear previous dynamic vars and apply any custom overrides
  if (theme.cssVars) {
    for (const [k, v] of Object.entries(theme.cssVars)) {
      root.style.setProperty(k, v);
    }
  }
  return theme;
}
