import {
  BUILTIN_THEMES,
  getQuickToggleThemeId,
  type ThemeDefinition,
} from '../../shared/theme-meta';

export { getQuickToggleThemeId, type ThemeDefinition };

const registry = new Map<string, ThemeDefinition>();
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
