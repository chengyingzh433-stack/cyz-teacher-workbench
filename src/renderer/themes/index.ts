import type { WindowMaterialMode } from '../../shared/theme-meta';

export interface ThemeDefinition {
  id: string;
  name: string;
  badge: string;
  tagline: string;
  isDark: boolean;
  windowMaterial: WindowMaterialMode;
  preview: {
    canvas: string;
    sidebar: string;
    surface: string;
    accent: string;
    secondary: string;
    board: string;
    border: string;
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
    /** Optional vertical gradient top color for ECharts bars (luminous glass themes). */
    barGradientTo?: string;
    barRadius?: number;
  };
  /** Optional custom CSS variable overrides for dynamically registered third-party themes. */
  cssVars?: Record<string, string>;
}

const registry = new Map<string, ThemeDefinition>();

const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'studio-light',
    name: '现代暖白工作室',
    badge: '默认旗舰',
    tagline: '温润米纸画布 + 柔和松林绿阳光教室，平衡耐看',
    isDark: false,
    windowMaterial: 'opaque',
    preview: {
      canvas: '#faf9f6',
      sidebar: '#f3f1ec',
      surface: '#ffffff',
      accent: '#1d6b52',
      secondary: '#3b82f6',
      board: '#234137',
      border: '#d4cfc3',
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
  },
  {
    id: 'studio-dark',
    name: '深夜护眼工作室',
    badge: '夜间护眼',
    tagline: '沉静炭灰画布 + 柔和夜灯教室，长时间批卷不刺眼',
    isDark: true,
    windowMaterial: 'opaque',
    preview: {
      canvas: '#131517',
      sidebar: '#1a1c1f',
      surface: '#1e2024',
      accent: '#38b286',
      secondary: '#60a5fa',
      board: '#183029',
      border: '#3a404a',
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
  },
  {
    id: 'glass-mist',
    name: '晨雾毛玻璃',
    badge: '真透明毛玻璃',
    tagline: 'macOS 原生透壁纸磨砂 / Win 亚克力柔光 + 冰川蓝玻璃教室',
    isDark: false,
    windowMaterial: 'glass-light',
    preview: {
      canvas: 'linear-gradient(135deg, #dceeff 0%, #f8f2ec 55%, #d6ebff 100%)',
      sidebar: 'rgba(255, 255, 255, 0.62)',
      surface: 'rgba(255, 255, 255, 0.80)',
      accent: '#2563eb',
      secondary: '#0ea5e9',
      board: '#314961',
      border: 'rgba(255, 255, 255, 0.85)',
    },
    chartPalette: {
      primary: '#2563eb',
      secondary: '#0ea5e9',
      accent: '#f59e0b',
      grid: 'rgba(148, 163, 184, 0.28)',
      text: '#0f172a',
      muted: '#475569',
      tooltipBg: 'rgba(255, 255, 255, 0.94)',
      tooltipBorder: 'rgba(148, 163, 184, 0.35)',
      barGradientTo: '#38bdf8',
      barRadius: 9,
    },
  },
  {
    id: 'glass-aurora',
    name: '极光深玻',
    badge: '深夜真透明',
    tagline: '烟熏暗色真毛玻璃 + 极光微光 + 晚自习暖灯教室',
    isDark: true,
    windowMaterial: 'glass-dark',
    preview: {
      canvas: 'linear-gradient(135deg, #0b132b 0%, #102a3c 55%, #1c1836 100%)',
      sidebar: 'rgba(15, 23, 42, 0.68)',
      surface: 'rgba(24, 34, 58, 0.72)',
      accent: '#2dd4bf',
      secondary: '#38bdf8',
      board: '#17343a',
      border: 'rgba(148, 163, 184, 0.28)',
    },
    chartPalette: {
      primary: '#2dd4bf',
      secondary: '#38bdf8',
      accent: '#fbbf24',
      grid: 'rgba(148, 163, 184, 0.16)',
      text: '#f1f5f9',
      muted: '#94a3b8',
      tooltipBg: 'rgba(15, 23, 42, 0.94)',
      tooltipBorder: 'rgba(148, 163, 184, 0.30)',
      barGradientTo: '#38bdf8',
      barRadius: 9,
    },
  },
  {
    id: 'sakura-campus',
    name: '日系樱雪手账',
    badge: '二次元绝配',
    tagline: '暖奶霜手账纸 + 樱花粉与抹茶绿 + 春日樱光像素教室',
    isDark: false,
    windowMaterial: 'opaque',
    preview: {
      canvas: '#fffbf8',
      sidebar: '#faf0f3',
      surface: '#ffffff',
      accent: '#d45c85',
      secondary: '#4d8567',
      board: '#315747',
      border: '#edd6de',
    },
    chartPalette: {
      primary: '#5a9474',
      secondary: '#e07298',
      accent: '#e69f4c',
      grid: '#f1e3e8',
      text: '#3b2e2b',
      muted: '#8c7671',
      tooltipBg: '#ffffff',
      tooltipBorder: '#ead4dc',
      barGradientTo: '#e281a3',
      barRadius: 10,
    },
  },
  {
    id: 'editorial-paper',
    name: '羊皮纸墨书房',
    badge: '低蓝光纸墨',
    tagline: '护眼暖羊皮纸 + 书卷衬线排印 + 教师红笔朱砂印章色',
    isDark: false,
    windowMaterial: 'opaque',
    preview: {
      canvas: '#f5efe2',
      sidebar: '#ece4d3',
      surface: '#fbf8f0',
      accent: '#b9382c',
      secondary: '#244d3c',
      board: '#1e3d31',
      border: '#d6ccb8',
    },
    chartPalette: {
      primary: '#b9382c',
      secondary: '#244d3c',
      accent: '#b87a24',
      grid: '#e2d9c6',
      text: '#2a231d',
      muted: '#7a6e5f',
      tooltipBg: '#fbf8f0',
      tooltipBorder: '#d2c7b2',
      barRadius: 4,
    },
  },
  {
    id: 'cozy-pixel',
    name: '复古暖像素学园',
    badge: '投影点名王牌',
    tagline: '星露谷式 2px 胡桃像素描边 + 轻硬投影 + 琥珀松石配色',
    isDark: false,
    windowMaterial: 'opaque',
    preview: {
      canvas: '#faf3e0',
      sidebar: '#f2e4c6',
      surface: '#fffcf2',
      accent: '#237876',
      secondary: '#e59f1c',
      board: '#275243',
      border: '#4a3728',
    },
    chartPalette: {
      primary: '#237876',
      secondary: '#e59f1c',
      accent: '#d95d39',
      grid: '#e3d5b7',
      text: '#38291e',
      muted: '#78624d',
      tooltipBg: '#fffcf2',
      tooltipBorder: '#4a3728',
      barRadius: 3,
    },
  },
];

for (const t of BUILTIN_THEMES) {
  registry.set(t.id, t);
}

/** Extensible theme registration hook — custom skins can plug right in here. */
export function registerTheme(theme: ThemeDefinition) {
  registry.set(theme.id, theme);
}

export function listThemes(): ThemeDefinition[] {
  return [...registry.values()];
}

export function getTheme(id: string): ThemeDefinition {
  return registry.get(id) || BUILTIN_THEMES[0];
}

/** Smart dark/light counterpart for the quick sidebar toggle button. */
export function getQuickToggleThemeId(currentId: string): string {
  if (currentId === 'glass-mist') return 'glass-aurora';
  if (currentId === 'glass-aurora') return 'glass-mist';
  const cur = getTheme(currentId);
  return cur.isDark ? 'studio-light' : 'studio-dark';
}

export function applyThemeToDocument(themeId: string): ThemeDefinition {
  const theme = getTheme(themeId);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-surface-mode', theme.windowMaterial);
  const platform =
    typeof window !== 'undefined' && window.workbenchApi?.platform
      ? window.workbenchApi.platform
      : 'darwin';
  root.setAttribute('data-platform', platform);

  if (theme.cssVars) {
    for (const [k, v] of Object.entries(theme.cssVars)) {
      root.style.setProperty(k, v);
    }
  }
  return theme;
}
