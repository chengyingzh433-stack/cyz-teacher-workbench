import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUILTIN_THEMES,
  getQuickToggleThemeId,
  getThemeWindowMeta,
} from '../src/shared/theme-meta';
import { VaultManager } from '../src/main/vault';

const TOKENS_CSS_PATH = path.resolve(import.meta.dirname, '../src/renderer/themes/tokens.css');

test('7 套主题单一数据源与 tokens.css 样式块严格对齐，且无 macOS 浅色毛玻璃 saturate 预乘色带隐患', () => {
  assert.equal(BUILTIN_THEMES.length, 7, '应内置 7 套预设主题');

  const css = fs.readFileSync(TOKENS_CSS_PATH, 'utf8');
  const seen = new Set<string>();
  for (const t of BUILTIN_THEMES) {
    assert.equal(seen.has(t.id), false, `主题 ID 重复：${t.id}`);
    seen.add(t.id);
    assert.equal(getThemeWindowMeta(t.id).id, t.id);
    assert.ok(
      css.includes(`[data-theme='${t.id}']`),
      `tokens.css 缺少 [data-theme='${t.id}'] 样式定义块`,
    );
  }

  // Prevent regression of Skia premultiplied-alpha rainbow banding on macOS vibrancy light glass
  const darwinMistBlock = css.match(/\[data-theme='glass-mist'\]\[data-platform='darwin'\][^}]*}/);
  assert.ok(darwinMistBlock, 'tokens.css 应显式定义 macOS 晨雾毛玻璃透明画布层');
  assert.equal(
    /backdrop-filter:[^;]*saturate\(/.test(css),
    false,
    'tokens.css 禁止在毛玻璃规则中叠加 saturate(>100%)，否则 macOS 浅色 vibrancy 会出现 Skia 预乘色带',
  );
});

test('侧栏快捷深浅切换配对：毛玻璃双生互切，其余主题按明暗配对', () => {
  assert.equal(getQuickToggleThemeId('glass-mist'), 'glass-aurora');
  assert.equal(getQuickToggleThemeId('glass-aurora'), 'glass-mist');
  assert.equal(getQuickToggleThemeId('studio-light'), 'studio-dark');
  assert.equal(getQuickToggleThemeId('studio-dark'), 'studio-light');
  assert.equal(getQuickToggleThemeId('sakura-campus'), 'studio-dark');
  assert.equal(getQuickToggleThemeId('editorial-paper'), 'studio-dark');
  assert.equal(getQuickToggleThemeId('cozy-pixel'), 'studio-dark');
});

test('主题偏好真实落盘 preferences.json，重启 Vault 后恢复所选主题', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cyz-theme-pref-'));
  try {
    const first = new VaultManager(userData);
    assert.equal(first.getPreferences().themeId, 'studio-light');

    for (const t of BUILTIN_THEMES) {
      first.updatePreferences({ themeId: t.id });
      const reopened = new VaultManager(userData);
      assert.equal(reopened.getPreferences().themeId, t.id, `重启后应保持主题 ${t.id}`);
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
