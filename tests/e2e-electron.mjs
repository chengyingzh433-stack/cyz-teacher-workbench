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

      // Step 9b: Switch drawer to 「家校与日常」 tab -> verify student comm record & daily summary
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes('家校与日常'));
          if (!btn) throw new Error('Drawer homeroom tab not found');
          btn.click();
        })()
      `);
      await sleep(500);
      const drawerHrCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.querySelector('[role="dialog"]')?.innerText || '';
        return {
          hasDailySummary: text.includes('日常点检记录汇总'),
          hasCommLedger: text.includes('家校沟通与谈心台账') && text.includes('受力分析'),
        };
      })()`);
      assert.equal(drawerHrCheck.hasDailySummary, true, 'Drawer must display daily check summary');
      assert.equal(drawerHrCheck.hasCommLedger, true, 'Drawer must display seeded comm record for 林知行');
      await saveShot(win, '09b-student-drawer-homeroom.png');

      await win.webContents.executeJavaScript(`
        (() => {
          const closeBtn = document.querySelector('[role="dialog"] button[aria-label="关闭抽屉"]');
          if (closeBtn) closeBtn.click();
        })()
      `);
      await sleep(300);

      // Step 10: Classroom Quick-Check mode + Floating Focus Timer (switch back to studio-light for crisp check)
      await openSettingsThemeTab(win);
      await clickThemeCard(win, '现代暖白工作室');
      await closeSettings(win);
      await navTo(win, '互动教室');
      await win.webContents.executeJavaScript(`
        (() => {
          const qc = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('快速点检'));
          if (!qc) throw new Error('Quick-check button not found');
          qc.click();
        })()
      `);
      await sleep(350);
      await win.webContents.executeJavaScript(`
        (() => {
          const seatRect = document.querySelector('[data-seat="1"][data-row="0"][data-col="1"] rect');
          if (!seatRect) throw new Error('Seat cell rect not found');
          seatRect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          const timerBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '计时器');
          if (!timerBtn) throw new Error('Focus timer toggle button not found');
          timerBtn.click();
        })()
      `);
      await sleep(500);
      const qcState = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return {
          hasMarkedOne: text.includes('已标记 缺勤/请假：1 / 32 人'),
          hasTimer: text.includes('25:00') && text.includes('专注 / 课堂倒计时'),
        };
      })()`);
      assert.equal(qcState.hasMarkedOne, true, 'Quick-check mode must toggle seat anomaly count to 1 / 32');
      assert.equal(qcState.hasTimer, true, 'Floating focus timer must open with 25:00');
      await saveShot(win, '10-classroom-quickcheck-timer.png');

      // Step 11: Homeroom Workbench -> Daily Plan & Check-ins
      await navTo(win, '带班工作台');
      await sleep(600);
      const hrDailyCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return {
          hasPills: text.includes('今日待办') && text.includes('待跟进家长') && text.includes('待落实安全'),
          hasCheckins: text.includes('晨检出勤打卡') && text.includes('班会德育打卡'),
          hasTasks: text.includes('每日带班计划') && text.includes('告家长书'),
          hasNotes: text.includes('今日带班记'),
        };
      })()`);
      assert.equal(hrDailyCheck.hasPills, true, 'Homeroom top bar must display 4 status pills');
      assert.equal(hrDailyCheck.hasCheckins, true, 'Homeroom daily tab must display check-in cards');
      assert.equal(hrDailyCheck.hasTasks, true, 'Homeroom daily tab must display seeded tasks');
      assert.equal(hrDailyCheck.hasNotes, true, 'Homeroom daily tab must display daily notes');
      await saveShot(win, '11-homeroom-daily.png');

      // Step 12: Homeroom Workbench -> Parent-Teacher Comms Ledger
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('家校沟通台账'));
          if (!btn) throw new Error('Comms tab not found');
          btn.click();
        })()
      `);
      await sleep(500);
      const hrCommsCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return text.includes('新增家校沟通记录') && text.includes('林知行') && text.includes('共商整改方案');
      })()`);
      assert.equal(hrCommsCheck, true, 'Comms ledger tab must show form and seeded student records');
      await saveShot(win, '12-homeroom-comms.png');

      // Step 13: Homeroom Workbench -> Monthly Stats & ECharts bar chart
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('班级月度统计'));
          if (!btn) throw new Error('Monthly stats tab not found');
          btn.click();
        })()
      `);
      await sleep(750);
      const hrStatsCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        const charts = Array.from(document.querySelectorAll('[_echarts_instance_] svg, [_echarts_instance_] canvas'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 200 && r.height > 120;
          });
        return {
          hasRates: text.includes('月度出勤率') && text.includes('作业完成率') && text.includes('安全工作落实率'),
          hasAutoMode: text.includes('教室点检自动汇总'),
          chartCount: charts.length,
        };
      })()`);
      assert.equal(hrStatsCheck.hasRates, true, 'Monthly stats must display 3 rate cards');
      assert.equal(hrStatsCheck.hasAutoMode, true, 'Monthly stats must indicate auto aggregation from classroom checks');
      assert.ok(hrStatsCheck.chartCount >= 1, 'Monthly stats ECharts bar chart must render visibly');
      await saveShot(win, '13-homeroom-stats.png');

      // Step 14: Homeroom Workbench -> Moral & Safety Materials Library + Work Memos
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('德育素材与备忘'));
          if (!btn) throw new Error('Materials & Memos tab not found');
          btn.click();
        })()
      `);
      await sleep(500);
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').trim() === '校园防欺凌');
          if (!btn) throw new Error('校园防欺凌 theme button not found');
          btn.click();
        })()
      `);
      await sleep(400);
      const hrMatCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return (
          text.includes('向校园欺凌亮剑') &&
          text.includes('家长会宣讲短脚本') &&
          text.includes('工作备忘录') &&
          text.includes('高二年级期中家长会流程')
        );
      })()`);
      assert.equal(hrMatCheck, true, 'Materials & Memos tab must display theme content and seeded memos');
      await saveShot(win, '14-homeroom-materials-memos.png');

      // Step 15: Open Zhixuewang Companion -> verify WebContentsView attaches cleanly with 0 errors
      await navTo(win, '智学网伴侣');
      await saveShot(win, '15-zhixue-companion.png');

      assert.equal(errors.length, 0, `Encountered runtime errors:\n${errors.join('\n')}`);
      console.log('[E2E PASS] All 16 real desktop user flows passed with 0 errors!');
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
