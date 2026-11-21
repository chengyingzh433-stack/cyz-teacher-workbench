import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';

// Ensure macOS App Nap / screen-lock window occlusion never stalls Chromium compositor frames during E2E capture.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const projectRoot = path.resolve(import.meta.dirname, '..');
const shotsDir = path.join(projectRoot, 'test-results', 'prove-it');
fs.rmSync(shotsDir, { recursive: true, force: true });
fs.mkdirSync(shotsDir, { recursive: true });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cyz-e2e-'));
const tmpUserData = path.join(tmpRoot, 'userData');
const tmpVault = path.join(tmpRoot, 'vault');
fs.mkdirSync(tmpUserData, { recursive: true });
fs.mkdirSync(tmpVault, { recursive: true });

app.setPath('userData', tmpUserData);
fs.writeFileSync(
  path.join(tmpUserData, 'preferences.json'),
  JSON.stringify({
    themeId: 'studio-light',
    vaultPath: tmpVault,
    sidebarCollapsed: false,
    recentVaults: [tmpVault],
  }),
);

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('uncaughtException', (err) => {
  errors.push(`[main:uncaughtException] ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  errors.push(`[main:unhandledRejection] ${reason}`);
});

let lastShotHash = '';
async function saveShot(win, filename) {
  // Force two real Chromium paint frames so capturePage never reads a stale compositor buffer
  await win.webContents.executeJavaScript(
    `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))`,
  );
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  const hash = crypto.createHash('sha256').update(png).digest('hex');
  assert.notEqual(
    hash,
    lastShotHash,
    `Screenshot ${filename} is byte-identical to previous step (compositor frame did not update!)`,
  );
  lastShotHash = hash;
  const outPath = path.join(shotsDir, filename);
  fs.writeFileSync(outPath, png);
  console.log(`[E2E SHOT] ${filename} (${img.getSize().width}x${img.getSize().height}, sha256=${hash.slice(0, 10)})`);
}

function readPersistedThemeId() {
  const raw = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'preferences.json'), 'utf8'));
  return raw.themeId;
}

async function openSettingsThemeTab(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('aside button')).find((b) => (b.textContent || '').trim() === '设置');
      if (!btn) throw new Error('Settings button not found');
      btn.click();
    })()
  `);
  await sleep(300);
  await win.webContents.executeJavaScript(`
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes('外观与主题风格'));
      if (!tab) throw new Error('Theme tab not found');
      tab.click();
    })()
  `);
  await sleep(300);
}

async function closeSettings(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const closeBtn = document.querySelector('[role="dialog"] button[aria-label="关闭弹窗"]');
      if (closeBtn) closeBtn.click();
    })()
  `);
  await sleep(300);
}

async function clickThemeCard(win, label) {
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes(${JSON.stringify(label)}));
      if (!btn) throw new Error('Theme card not found: ' + ${JSON.stringify(label)});
      btn.click();
    })()
  `);
  await sleep(400);
}

async function navTo(win, label) {
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('aside button')).find((b) => (b.textContent || '').includes(${JSON.stringify(label)}));
      if (!btn) throw new Error('Sidebar nav not found: ' + ${JSON.stringify(label)});
      btn.click();
    })()
  `);
  await sleep(750);
}

app.on('browser-window-created', (_ev, win) => {
  win.webContents.on('console-message', (details) => {
    const level = typeof details === 'object' && details !== null ? details.level : 'info';
    const message = typeof details === 'object' && details !== null ? details.message : String(details);
    if (level === 'error' || /uncaught|failed|error/i.test(message)) {
      errors.push(`[renderer:${level}] ${message}`);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`[renderer:gone] ${JSON.stringify(details)}`);
  });

  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1000);

      // Step 1: Welcome + all 6 WebP sprites return HTTP 200 OK
      const sprites = await win.webContents.executeJavaScript(`
        (async () => {
          const names = ['touhou.webp', 'mygo.webp', 'ave.webp', 'trio.webp', 'hashira.webp', 'desk.webp'];
          const out = [];
          for (const n of names) {
            const r = await fetch('workbench-asset://sprite/' + n);
            const buf = await r.arrayBuffer();
            out.push({ n, status: r.status, bytes: buf.byteLength });
          }
          return out;
        })()
      `);
      for (const s of sprites) {
        assert.equal(s.status, 200, `Sprite ${s.n} must return 200`);
        assert.ok(s.bytes > 10000, `Sprite ${s.n} bytes unexpectedly small: ${s.bytes}`);
      }
      await saveShot(win, '01-welcome.png');

      // Step 2: Load 32-student demo class -> verify Vector Classroom seats rendered
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('一键载入演示班级'));
          if (!btn) throw new Error('Demo button not found');
          btn.click();
        })()
      `);
      await sleep(1400);
      const seatCount = await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-seat="1"]').length`,
      );
      assert.equal(seatCount, 40, 'Demo 5x8 classroom should render 40 seat cells');
      await saveShot(win, '02-demo-classroom.png');

      // Step 3: Settings -> Theme Gallery -> assert all 7 preset theme cards present
      await openSettingsThemeTab(win);
      const themeNames = [
        '现代暖白工作室',
        '深夜护眼工作室',
        '晨雾毛玻璃',
        '极光深玻',
        '日系樱雪手账',
        '羊皮纸墨书房',
        '复古暖像素学园',
      ];
      const foundThemes = await win.webContents.executeJavaScript(`
        (() => {
          const text = document.querySelector('[role="dialog"]')?.innerText || '';
          return ${JSON.stringify(themeNames)}.filter((n) => text.includes(n));
        })()
      `);
      assert.deepEqual(foundThemes, themeNames, 'Settings modal must list all 7 preset themes');
      await saveShot(win, '03-settings-7-themes.png');

      // Step 4: Select 晨雾毛玻璃 -> verify DOM attributes + real disk persistence
      await clickThemeCard(win, '晨雾毛玻璃');
      await closeSettings(win);
      const mistState = await win.webContents.executeJavaScript(`({
        theme: document.documentElement.dataset.theme,
        surface: document.documentElement.dataset.surfaceMode,
      })`);
      assert.equal(mistState.theme, 'glass-mist');
      assert.equal(mistState.surface, 'glass-light');
      assert.equal(readPersistedThemeId(), 'glass-mist', 'glass-mist must persist to preferences.json');
      await saveShot(win, '04-theme-glass-mist.png');

      // Step 5: Click Sidebar Sun/Moon smart toggle -> must pair glass-mist -> glass-aurora!
      await win.webContents.executeJavaScript(`
        (() => {
          const toggle = document.querySelector('aside button[title="一键切换浅色/深色主题"]');
          if (!toggle) throw new Error('Sidebar theme toggle not found');
          toggle.click();
        })()
      `);
      await sleep(500);
      const auroraState = await win.webContents.executeJavaScript(`({
        theme: document.documentElement.dataset.theme,
        surface: document.documentElement.dataset.surfaceMode,
      })`);
      assert.equal(auroraState.theme, 'glass-aurora');
      assert.equal(auroraState.surface, 'glass-dark');
      assert.equal(readPersistedThemeId(), 'glass-aurora', 'glass-aurora must persist to preferences.json');
      await saveShot(win, '05-theme-glass-aurora-toggle.png');

      // Step 6: Cmd+K search theme switching -> open Cmd+K, click 复古暖像素学园
      await win.webContents.executeJavaScript(`
        (() => {
          const trigger = Array.from(document.querySelectorAll('aside button')).find((b) => (b.textContent || '').includes('快速找人'));
          if (!trigger) throw new Error('Cmd+K trigger not found');
          trigger.click();
        })()
      `);
      await sleep(350);
      await win.webContents.executeJavaScript(`
        (() => {
          const item = Array.from(document.querySelectorAll('[cmdk-item]')).find((el) => (el.textContent || '').includes('复古暖像素学园'));
          if (!item) throw new Error('Cozy pixel item not found in Cmd+K');
          item.click();
        })()
      `);
      await sleep(500);
      const pixelTheme = await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`);
      assert.equal(pixelTheme, 'cozy-pixel', 'Cmd+K must switch directly to cozy-pixel');
      assert.equal(readPersistedThemeId(), 'cozy-pixel');
      await saveShot(win, '06-cmdk-cozy-pixel-classroom.png');

      // Step 7: Switch to 日系樱雪手账 -> Classroom screenshot
      await openSettingsThemeTab(win);
      await clickThemeCard(win, '日系樱雪手账');
      await closeSettings(win);
      assert.equal(
        await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`),
        'sakura-campus',
      );
      await saveShot(win, '07-sakura-classroom.png');

      // Step 8: Switch to 羊皮纸墨书房 -> Exam Center + ECharts histogram visible check
      await openSettingsThemeTab(win);
      await clickThemeCard(win, '羊皮纸墨书房');
      await closeSettings(win);
      await navTo(win, '统一考试中心');
      const examCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        const charts = Array.from(document.querySelectorAll('[_echarts_instance_] svg, [_echarts_instance_] canvas'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 200 && r.height > 100;
          });
        const chartText = charts.map((c) => c.textContent || '').join(' ');
        return {
          hasMean: text.includes('78.22'),
          chartCount: charts.length,
          hasBandLabels: chartText.includes('90%–100%') && chartText.includes('9人'),
        };
      })()`);
      assert.equal(examCheck.hasMean, true, 'Exam center must show 78.22 class average');
      assert.ok(examCheck.chartCount >= 1, 'ECharts histogram must render visibly');
      assert.equal(examCheck.hasBandLabels, true, 'ECharts histogram must show score band labels and counts');
      await saveShot(win, '08-editorial-exams.png');

      // Step 9: Click first student ("林知行") -> Student Growth Profile Drawer + ECharts trend chart
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('table button, td button')).find((b) => (b.textContent || '').includes('林知行'));
          if (!btn) throw new Error('Student row button not found');
          btn.click();
        })()
      `);
      await sleep(800);
      const drawerCheck = await win.webContents.executeJavaScript(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const charts = dlg
          ? Array.from(dlg.querySelectorAll('[_echarts_instance_] svg, [_echarts_instance_] canvas')).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 150 && r.height > 80;
            })
          : [];
        const chartText = charts.map((c) => c.textContent || '').join(' ');
        return {
          open: Boolean(dlg),
          hasName: (dlg?.innerText || '').includes('成长档案'),
          chartCount: charts.length,
          hasLegend: chartText.includes('个人得分') && chartText.includes('班级均分'),
        };
      })()`);
      assert.equal(drawerCheck.open, true, 'Student profile drawer must open');
      assert.equal(drawerCheck.hasName, true, 'Drawer must display 成长档案');
      assert.ok(drawerCheck.chartCount >= 1, 'Student growth ECharts chart must render visibly');
      assert.equal(drawerCheck.hasLegend, true, 'Student growth chart must show 个人得分 & 班级均分');
      await saveShot(win, '09-student-growth-drawer.png');
      await win.webContents.executeJavaScript(`
        (() => {
          const closeBtn = document.querySelector('[role="dialog"] button[aria-label="关闭抽屉"]');
          if (closeBtn) closeBtn.click();
        })()
      `);
      await sleep(300);

      // Step 10: Open Zhixuewang Companion -> verify WebContentsView attaches cleanly with 0 errors
      await navTo(win, '智学网伴侣');
      await saveShot(win, '10-zhixue-companion.png');

      assert.equal(errors.length, 0, `Encountered runtime errors:\n${errors.join('\n')}`);
      console.log('[E2E PASS] All 10 real desktop user flows passed with 0 errors!');
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      app.exit(0);
    } catch (err) {
      console.error('[E2E FAIL]', err);
      if (errors.length) console.error('[CAPTURED ERRORS]\n' + errors.join('\n'));
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      app.exit(1);
    }
  });
});

await import(pathToFileURL(path.join(projectRoot, 'out/main/index.js')).toString());
