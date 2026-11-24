import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, safeStorage } from 'electron';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

// Local simulated online marking page for real WebContentsView ROI / score-crawler / submit E2E
let mockPaperIndex = 1;
const mockZhixueHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>模拟智学网在线阅卷页</title>
  <style>
    body { margin:0; font-family:system-ui,-apple-system,sans-serif; background:#f1f5f9; color:#0f172a; display:flex; height:100vh; overflow:hidden; }
    .paper-pane { flex:1; padding:18px; display:flex; flex-direction:column; gap:10px; }
    .paper-header { font-size:13px; color:#475569; font-weight:600; display:flex; justify-content:space-between; }
    #paper-box { flex:1; background:#ffffff; border:2px solid #cbd5e1; border-radius:12px; padding:24px; display:flex; flex-direction:column; justify-content:center; gap:14px; }
    #paper-title { font-size:20px; font-weight:700; color:#0f172a; }
    #paper-work { font-size:17px; line-height:1.9; color:#1e293b; font-family:Georgia,serif; }
    .mark-pane { width:220px; background:#ffffff; border-left:1px solid #cbd5e1; padding:16px; display:flex; flex-direction:column; gap:14px; }
    .score-panel { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
    .score-btn { height:38px; border:1px solid #cbd5e1; border-radius:8px; background:#f8fafc; font-size:15px; font-weight:700; cursor:pointer; }
    .score-btn.active { background:#059669; color:#fff; border-color:#059669; }
    #score-input { width:100%; box-sizing:border-box; height:36px; border:1px solid #cbd5e1; border-radius:8px; padding:0 10px; font-size:14px; }
    #submit-next-btn { height:40px; border:none; border-radius:8px; background:#2563eb; color:#fff; font-size:14px; font-weight:700; cursor:pointer; }
    #status-bar { font-size:12px; color:#059669; font-weight:600; }
  </style>
</head>
<body>
  <div class="paper-pane">
    <div class="paper-header">
      <span>智学网 · 高二物理第 13 题阅卷模拟</span>
      <span id="paper-badge">第 1 份答卷</span>
    </div>
    <div id="paper-box">
      <div id="paper-title">学生手写答卷 #1（牛顿第二定律）</div>
      <div id="paper-work">解：由牛顿第二定律 F = ma<br/>代入得 a = 10 / 2 = 5 m/s²<br/>经过 t = 2s 后速度 v = at = 10 m/s</div>
    </div>
  </div>
  <div class="mark-pane">
    <div style="font-size:13px;font-weight:700;">快捷打分（满分 6 分）</div>
    <div class="score-panel" id="score-panel">
      <button class="score-btn" type="button">0</button>
      <button class="score-btn" type="button">1</button>
      <button class="score-btn" type="button">2</button>
      <button class="score-btn" type="button">3</button>
      <button class="score-btn" type="button">4</button>
      <button class="score-btn" type="button">5</button>
      <button class="score-btn" type="button">6</button>
    </div>
    <input id="score-input" type="number" placeholder="输入分值" />
    <button id="submit-next-btn" type="button">提交并下一份</button>
    <div id="status-bar">等待给分…</div>
  </div>
  <script>
    window.__mockState = { paper: 1, lastScore: '', submittedCount: 0 };
    const btns = Array.from(document.querySelectorAll('.score-btn'));
    const input = document.getElementById('score-input');
    const status = document.getElementById('status-bar');
    btns.forEach((b) => b.addEventListener('click', () => {
      btns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      input.value = b.textContent.trim();
      window.__mockState.lastScore = input.value;
      status.textContent = '已选中分值：' + input.value + ' 分';
    }));
    document.getElementById('submit-next-btn').addEventListener('click', () => {
      window.__mockState.submittedCount += 1;
      window.__mockState.paper += 1;
      const p = window.__mockState.paper;
      document.getElementById('paper-badge').textContent = '第 ' + p + ' 份答卷';
      document.getElementById('paper-title').textContent = '学生手写答卷 #' + p + '（动能定理）';
      document.getElementById('paper-work').innerHTML = '解：由动能定理 W = ΔEk = ½mv²<br/>代入得 Ek = 0.5 × 2 × 4² = 16 J';
      status.textContent = '已提交第 ' + (p - 1) + ' 份（' + window.__mockState.lastScore + ' 分）';
      btns.forEach((x) => x.classList.remove('active'));
      input.value = '';
    });
  </script>
</body>
</html>`;

const mockServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(mockZhixueHtml);
});
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
const mockPort = mockServer.address().port;
const mockZhixueUrl = `http://127.0.0.1:${mockPort}/`;
void mockPaperIndex;

// Guardrail spy: verify zero passive macOS Keychain async prompts across the entire desktop run!
let asyncKeychainCalls = 0;
if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
  const origAsync = safeStorage.isAsyncEncryptionAvailable.bind(safeStorage);
  safeStorage.isAsyncEncryptionAvailable = (...args) => {
    asyncKeychainCalls += 1;
    return origAsync(...args);
  };
}

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

let mainWindowAttached = false;

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

  if (mainWindowAttached) return;
  mainWindowAttached = true;

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

      // Step 3: Settings -> Theme Gallery -> assert all 7 preset theme cards + in-app version display present
      const expectedVersion = 'v' + JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
      const sidebarHasVersion = await win.webContents.executeJavaScript(
        `(document.querySelector('aside')?.innerText || '').includes(${JSON.stringify(expectedVersion)})`,
      );
      assert.equal(sidebarHasVersion, true, `Sidebar footer must show app version ${expectedVersion}`);
      await openSettingsThemeTab(win);
      const settingsHasVersion = await win.webContents.executeJavaScript(
        `(document.querySelector('[role="dialog"]')?.innerText || '').includes(${JSON.stringify(expectedVersion)})`,
      );
      assert.equal(settingsHasVersion, true, `Settings modal must show app version ${expectedVersion}`);
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

      // Step 3b: Settings -> AI Model & Keychain -> verify platform links, Stage 2 judge, and OCR presets!
      await win.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes('AI 模型与系统钥匙串'));
        if (!tab) throw new Error('AI settings tab not found');
        tab.click();
      })()`);
      await sleep(350);
      // Open OCR select and choose 独立视觉 OCR 模型 to reveal SiliconFlow/DashScope OCR presets
      await win.webContents.executeJavaScript(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const triggers = Array.from(dlg.querySelectorAll('button[role="combobox"]'));
        const ocrTrigger = triggers.find((b) => (b.textContent || '').includes('关闭（单路轻模式'));
        if (!ocrTrigger) throw new Error('OCR mode select trigger not found');
        ocrTrigger.click();
      })()`);
      await sleep(250);
      await win.webContents.executeJavaScript(`(() => {
        const opt = Array.from(document.querySelectorAll('[role="option"]')).find((el) => (el.textContent || '').includes('独立视觉 OCR 模型'));
        if (!opt) throw new Error('Vision OCR option not found');
        opt.click();
      })()`);
      await sleep(250);
      // Click 硅基 DeepSeek-OCR preset and verify URL + Model ID auto-filled
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').trim() === '硅基 DeepSeek-OCR');
        if (!btn) throw new Error('SiliconFlow DeepSeek-OCR preset button not found');
        btn.click();
      })()`);
      await sleep(250);
      const aiSettingsCheck = await win.webContents.executeJavaScript(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const text = dlg?.innerText || '';
        const inputs = Array.from(dlg.querySelectorAll('input')).map((i) => i.value);
        return {
          hasDeepSeekLink: text.includes('DeepSeek 开放平台'),
          hasSiliconLink: text.includes('硅基流动 SiliconFlow'),
          hasDoc2xLink: text.includes('去 Doc2X 官网获取 Key'),
          hasStage2Judge: text.includes('阶段二：得分点判分推理模型'),
          hasOcrPresets: text.includes('百炼 qwen-vl-ocr') && text.includes('硅基 DeepSeek-OCR'),
          filledSiliconUrl: inputs.includes('https://api.siliconflow.cn/v1'),
          filledDeepSeekOcr: inputs.includes('deepseek-ai/DeepSeek-OCR'),
        };
      })()`);
      assert.equal(aiSettingsCheck.hasDeepSeekLink, true, 'AI settings must link to DeepSeek console');
      assert.equal(aiSettingsCheck.hasSiliconLink, true, 'AI settings must link to SiliconFlow console');
      assert.equal(aiSettingsCheck.hasDoc2xLink, true, 'AI settings must link to Doc2X website');
      assert.equal(aiSettingsCheck.hasStage2Judge, true, 'AI settings must expose Stage 2 judge model');
      assert.equal(aiSettingsCheck.hasOcrPresets, true, 'AI settings must display OCR model presets');
      assert.equal(aiSettingsCheck.filledSiliconUrl, true, 'Clicking OCR preset must auto-fill SiliconFlow URL');
      assert.equal(aiSettingsCheck.filledDeepSeekOcr, true, 'Clicking OCR preset must auto-fill DeepSeek-OCR model ID');
      await saveShot(win, '03b-settings-ai-presets.png');
      // Switch back to Theme tab for Step 4
      await win.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes('外观与主题风格'));
        if (!tab) throw new Error('Theme tab not found');
        tab.click();
      })()`);
      await sleep(250);

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
          hasZhixueShortcut: text.includes('智学网 AI 阅卷'),
          hasCollapsedOffline: text.includes('离线拍照阅卷'),
          chartCount: charts.length,
          hasBandLabels: chartText.includes('90%–100%') && chartText.includes('9人'),
        };
      })()`);
      assert.equal(examCheck.hasMean, true, 'Exam center must show 78.22 class average');
      assert.equal(examCheck.hasZhixueShortcut, true, 'Exam center must provide shortcut to Zhixue AI grading');
      assert.equal(examCheck.hasCollapsedOffline, true, 'Exam center must keep offline photo grading as secondary entry');
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

      // Step 10: Classroom Drag-then-Quick-Check regression + Floating Focus Timer
      // Regression guard: dragging a seat in edit mode must NEVER leave suppressClick stuck
      // and break subsequent real mouse clicks in Quick-Check or profile mode.
      await openSettingsThemeTab(win);
      await clickThemeCard(win, '现代暖白工作室');
      await closeSettings(win);
      await navTo(win, '互动教室');
      await win.webContents.executeJavaScript(`
        (() => {
          const editBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('进入排座'));
          if (!editBtn) throw new Error('Enter seating button not found');
          editBtn.click();
        })()
      `);
      await sleep(350);
      const dragCoords = await win.webContents.executeJavaScript(`(() => {
        const r1 = document.querySelector('[data-seat="1"][data-row="0"][data-col="0"] rect')?.getBoundingClientRect();
        const r2 = document.querySelector('[data-seat="1"][data-row="0"][data-col="1"] rect')?.getBoundingClientRect();
        if (!r1 || !r2) throw new Error('Seat rects not found for drag regression');
        return {
          x1: Math.round(r1.left + r1.width / 2),
          y1: Math.round(r1.top + r1.height / 2),
          x2: Math.round(r2.left + r2.width / 2),
          y2: Math.round(r2.top + r2.height / 2),
        };
      })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: dragCoords.x1, y: dragCoords.y1 });
      await sleep(50);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: dragCoords.x1, y: dragCoords.y1, button: 'left', clickCount: 1 });
      await sleep(60);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: dragCoords.x2, y: dragCoords.y2, button: 'left' });
      await sleep(100);
      win.webContents.sendInputEvent({ type: 'mouseUp', x: dragCoords.x2, y: dragCoords.y2, button: 'left', clickCount: 1 });
      await sleep(400);
      await win.webContents.executeJavaScript(`
        (() => {
          const doneBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('完成排座'));
          if (!doneBtn) throw new Error('Finish seating button not found');
          doneBtn.click();
        })()
      `);
      await sleep(350);
      await win.webContents.executeJavaScript(`
        (() => {
          const qc = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('快速点检'));
          if (!qc) throw new Error('Quick-check button not found');
          qc.click();
        })()
      `);
      await sleep(350);
      // Real Chromium mouse click on a seated student's head/body after drag-and-exit!
      const qcSeatPos = await win.webContents.executeJavaScript(`(() => {
        const r = document.querySelector('[data-seat="1"][data-row="0"][data-col="1"] rect')?.getBoundingClientRect();
        if (!r) throw new Error('Seat cell rect not found');
        return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
      })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: qcSeatPos.x, y: qcSeatPos.y });
      await sleep(80);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      await sleep(250);
      // Toggle off and toggle back on with real clicks to verify repeated toggling works
      win.webContents.sendInputEvent({ type: 'mouseDown', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      await sleep(200);
      const qcAfterUnmark = await win.webContents.executeJavaScript(`document.body.innerText.includes('已标记 缺勤/请假：0 / 32 人')`);
      assert.equal(qcAfterUnmark, true, 'Quick-check second real click must unmark seat back to 0 / 32');
      win.webContents.sendInputEvent({ type: 'mouseDown', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: qcSeatPos.x, y: qcSeatPos.y, button: 'left', clickCount: 1 });
      await sleep(250);
      await win.webContents.executeJavaScript(`
        (() => {
          const timerBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '计时器');
          if (!timerBtn) throw new Error('Focus timer toggle button not found');
          timerBtn.click();
        })()
      `);
      await sleep(400);
      const qcState = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return {
          hasMarkedOne: text.includes('已标记 缺勤/请假：1 / 32 人'),
          hasTimer: text.includes('25:00') && text.includes('专注 / 课堂倒计时'),
        };
      })()`);
      assert.equal(qcState.hasMarkedOne, true, 'Quick-check mode must toggle seat anomaly count to 1 / 32 via real click after drag');
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

      // Step 15: Zhixuewang Companion -> load local mock marking page, test ROI picker, score crawler, click+submit, auto-mode interval!
      await navTo(win, '智学网伴侣');
      await sleep(450);
      await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('main form input');
        if (!input) throw new Error('Zhixue URL input not found');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(mockZhixueUrl)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const submit = document.querySelector('main form button[type="submit"]');
        submit.click();
      })()`);
      await sleep(1100);

      // 15a. Click 自动爬取得分选项 -> verify 7 score buttons (0..6) & submit button detected!
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('自动爬取得分选项'));
        if (!btn) throw new Error('Crawl score options button not found');
        btn.click();
      })()`);
      await sleep(500);
      // Expand quick rubric card briefly to verify sync max button, then collapse back so recognition box stays full-height
      await win.webContents.executeJavaScript(`(() => {
        const rubricToggle = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('本题评分细则'));
        if (!rubricToggle) throw new Error('Rubric card toggle not found');
        rubricToggle.click();
      })()`);
      await sleep(200);
      const crawlUiCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return {
          hasCount: text.includes('已爬取 7 个分值'),
          hasSubmit: text.includes('提交并下一份'),
          hasSyncMax: text.includes('同步满分(6)'),
          hasRecBox: text.includes('识别内容与核对框'),
        };
      })()`);
      assert.equal(crawlUiCheck.hasCount, true, 'Must crawl all 7 score buttons (0..6) from mock marking page');
      assert.equal(crawlUiCheck.hasSubmit, true, 'Must detect 提交并下一份 submit button');
      assert.equal(crawlUiCheck.hasSyncMax, true, 'Quick rubric must offer syncing crawled max score (6)');
      assert.equal(crawlUiCheck.hasRecBox, true, 'Always-visible recognition content box must render');
      await win.webContents.executeJavaScript(`(() => {
        const rubricToggle = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('本题评分细则'));
        rubricToggle?.click();
      })()`);
      await sleep(150);

      // 15b. Test interactive ROI picker inside WebContentsView!
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('设置读取区域'));
        if (!btn) throw new Error('Pick region button not found');
        btn.click();
      })()`);
      await sleep(450);
      const childView = win.contentView.children[0];
      assert.ok(childView && childView.webContents, 'WebContentsView must be attached as child view');
      await childView.webContents.executeJavaScript(`(() => {
        const host = document.getElementById('__cyz_roi_picker__');
        if (!host || !host.shadowRoot) throw new Error('ROI picker overlay not injected');
        const mask = host.shadowRoot.getElementById('mask');
        const box = document.getElementById('paper-box').getBoundingClientRect();
        mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + 10, clientY: box.top + 10 }));
        mask.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.right - 10, clientY: box.bottom - 10 }));
        mask.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: box.right - 10, clientY: box.bottom - 10 }));
        host.shadowRoot.getElementById('btnOk').click();
      })()`);
      await sleep(600);
      const roiUiCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        const shotImg = document.querySelector('main img[alt="截取答卷区"]');
        return {
          hasRoiBadge: /读取区 \\d+×\\d+/.test(text),
          hasPreviewImg: Boolean(shotImg && shotImg.src.startsWith('data:image/png;base64,')),
        };
      })()`);
      assert.equal(roiUiCheck.hasRoiBadge, true, 'Setting ROI must display 读取区 W×H badge');
      assert.equal(roiUiCheck.hasPreviewImg, true, 'Setting ROI must capture and preview the ROI thumbnail');

      // 15c. Click crawled score option "5" in right panel -> click 打分并提交 -> verify mock page updated to paper #2!
      await win.webContents.executeJavaScript(`(() => {
        const fiveBtn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').trim() === '5');
        if (!fiveBtn) throw new Error('Crawled score button 5 not found');
        fiveBtn.click();
      })()`);
      await sleep(250);
      await win.webContents.executeJavaScript(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('打分并提交'));
        if (!submitBtn) throw new Error('Apply & submit button not found');
        submitBtn.click();
      })()`);
      await sleep(500);
      const mockStateAfterSubmit = await childView.webContents.executeJavaScript(`window.__mockState`);
      assert.equal(mockStateAfterSubmit.lastScore, '5', 'Clicking score 5 must select score 5 inside embedded webpage');
      assert.equal(mockStateAfterSubmit.submittedCount, 1, 'Clicking 打分并提交 must click webpage submit button');
      assert.equal(mockStateAfterSubmit.paper, 2, 'Submitting must advance mock marking page to paper #2');

      // 15d. Switch to 自动模式 and pick custom auto-submit delay 2.5s -> verify persistence on disk!
      await win.webContents.executeJavaScript(`(() => {
        const autoTab = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').trim() === '自动模式');
        if (!autoTab) throw new Error('Auto mode tab not found');
        autoTab.click();
      })()`);
      await sleep(250);
      await win.webContents.executeJavaScript(`(() => {
        const delayBtn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').trim() === '2.5s');
        if (!delayBtn) throw new Error('2.5s auto-delay button not found');
        delayBtn.click();
      })()`);
      await sleep(350);
      const savedProfiles = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'zhixue-profiles.json'), 'utf8'));
      const originKey = new URL(mockZhixueUrl).origin;
      assert.equal(savedProfiles[originKey]?.autoDelaySec, 2.5, 'Selected auto-submit interval (2.5s) must persist');
      assert.ok(savedProfiles[originKey]?.roi?.width > 100, 'Selected ROI rect must persist to zhixue-profiles.json');
      await saveShot(win, '15-zhixue-companion.png');
      // Also capture the live embedded WebContentsView itself to visually verify the dashed AI 读取区 frame on the webpage
      const webviewImg = await childView.webContents.capturePage();
      fs.writeFileSync(path.join(shotsDir, '15b-zhixue-webview.png'), webviewImg.toPNG());
      console.log(`[E2E SHOT] 15b-zhixue-webview.png (${webviewImg.getSize().width}x${webviewImg.getSize().height})`);

      // Step 16: Apps Hub -> verify 6 module cards & customizable sidebar pin/unpin persistence
      await navTo(win, '全部功能中心');
      const hubInit = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        return text.includes('全部功能中心') && text.includes('物理题库') && text.includes('互动教室') && text.includes('智学网伴侣');
      })()`);
      assert.equal(hubInit, true, 'Apps Hub must display all core module cards');

      // Unpin 智学网伴侣 -> verify removed from sidebar & persisted in preferences.json
      await win.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector('button[aria-label="取消置顶智学网伴侣"]');
        if (!btn) throw new Error('Unpin button for 智学网伴侣 not found');
        btn.click();
      })()`);
      await sleep(350);
      const afterUnpin = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('aside button')).some((b) => (b.textContent || '').includes('智学网伴侣'))
      `);
      assert.equal(afterUnpin, false, 'Unpinned 智学网伴侣 must disappear from left sidebar');
      const prefsAfterUnpin = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'preferences.json'), 'utf8'));
      assert.equal(prefsAfterUnpin.pinnedSpaces.includes('zhixue'), false, 'Unpin must persist to preferences.json');
      await saveShot(win, '16-apps-hub-pin.png');

      // Re-pin 智学网伴侣 -> verify restored in sidebar
      await win.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector('button[aria-label="置顶智学网伴侣"]');
        if (!btn) throw new Error('Re-pin button for 智学网伴侣 not found');
        btn.click();
      })()`);
      await sleep(350);
      const afterRepin = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('aside button')).some((b) => (b.textContent || '').includes('智学网伴侣'))
      `);
      assert.equal(afterRepin, true, 'Re-pinned 智学网伴侣 must reappear in left sidebar');

      // Step 17: Physics Question Bank -> Continuous Intake with real 6-page physics exam PDF (or portable fallback PDF)
      const realExamPdf = '/Users/metric/.gemini/antigravity/brain/bfabc4a2-96e4-4de3-aa33-7c00a77303e0/.user_uploaded/media_1795420888662_132e0847.pdf';
      let intakePdfPath = realExamPdf;
      let expectedPages = 6;
      if (!fs.existsSync(intakePdfPath)) {
        const fallbackDoc = await PDFDocument.create();
        const p1 = fallbackDoc.addPage([595, 842]);
        p1.drawText('Physics Exam Q1: A block of mass m accelerates under force F = ma.', { x: 40, y: 740, size: 14 });
        const p2 = fallbackDoc.addPage([595, 842]);
        p2.drawText('Physics Exam Q2: Energy conservation.', { x: 40, y: 740, size: 14 });
        intakePdfPath = path.join(tmpRoot, 'fallback-physics-exam.pdf');
        fs.writeFileSync(intakePdfPath, await fallbackDoc.save());
        expectedPages = 2;
      }

      await navTo(win, '物理题库');
      await win.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('连续录题'));
        if (!tab) throw new Error('Intake tab not found');
        tab.click();
      })()`);
      await sleep(400);

      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [intakePdfPath] });
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('导入试卷 PDF'));
        if (!btn) throw new Error('Import PDF button not found');
        btn.click();
      })()`);
      await sleep(1800);

      const pdfLoaded = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        const canvas = document.querySelector('[data-qbank-pdf-surface="1"] canvas');
        return {
          hasPageInfo: text.includes('第 1 / ${expectedPages} 页'),
          canvasW: canvas ? canvas.width : 0,
          canvasH: canvas ? canvas.height : 0,
        };
      })()`);
      assert.equal(pdfLoaded.hasPageInfo, true, `PDF viewer must display 第 1 / ${expectedPages} 页`);
      assert.ok(pdfLoaded.canvasW > 300 && pdfLoaded.canvasH > 400, 'PDF page 1 canvas must render');

      // Drag-select text region on page 1 (Q1 area) -> verify cleaned text extracted into draft
      await win.webContents.executeJavaScript(`(() => {
        const surface = document.querySelector('[data-qbank-pdf-surface="1"]');
        const r = surface.getBoundingClientRect();
        const x1 = r.left + r.width * 0.06, y1 = r.top + r.height * 0.16;
        const x2 = r.left + r.width * 0.94, y2 = r.top + r.height * 0.36;
        surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x1, clientY: y1 }));
        surface.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x2, clientY: y2 }));
        surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x2, clientY: y2 }));
      })()`);
      await sleep(500);

      // Switch to 框选配图 and crop a compact physics figure -> verify proportional widthPercent <= 70%
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('框选配图'));
        if (!btn) throw new Error('Figure crop tool not found');
        btn.click();
      })()`);
      await sleep(250);
      await win.webContents.executeJavaScript(`(() => {
        const surface = document.querySelector('[data-qbank-pdf-surface="1"]');
        const r = surface.getBoundingClientRect();
        const x1 = r.left + r.width * 0.60, y1 = r.top + r.height * 0.22;
        const x2 = r.left + r.width * 0.86, y2 = r.top + r.height * 0.35;
        surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x1, clientY: y1 }));
        surface.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x2, clientY: y2 }));
        surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x2, clientY: y2 }));
      })()`);
      await sleep(600);

      const intakeDraftCheck = await win.webContents.executeJavaScript(`(() => {
        const text = document.body.innerText;
        const textareas = Array.from(document.querySelectorAll('main textarea'));
        const extracted = textareas.map((t) => t.value).join('\\n');
        return {
          extractedLen: extracted.trim().length,
          hasFigureBlock: text.includes('配图 #'),
          hasCompactWidth: /图宽 (20|25|30|35|40|45|50|55|60|65|70)%/.test(text),
        };
      })()`);
      assert.ok(intakeDraftCheck.extractedLen > 10, 'PDF text selection must extract stem text into draft');
      assert.equal(intakeDraftCheck.hasFigureBlock, true, 'Cropped figure block must appear in draft');
      assert.equal(intakeDraftCheck.hasCompactWidth, true, 'Cropped figure must use proportional width <= 70%');
      await saveShot(win, '17-qbank-intake-pdf.png');

      // Step 18: Publish draft and enter Proofread Editor (TipTap + MathLive) -> insert F = ma -> save -> lazily open AI/OCR modal
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('入库并校对公式'));
        if (!btn) throw new Error('Publish and edit button not found');
        btn.click();
      })()`);
      await sleep(800);

      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('插入公式'));
        if (!btn) throw new Error('Insert math button not found');
        btn.click();
      })()`);
      await sleep(300);
      await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[role="dialog"] input');
        if (!input) throw new Error('Math LaTeX input not found');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'F = ma');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(250);
      await win.webContents.executeJavaScript(`(() => {
        const ok = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent || '').includes('确定插入'));
        if (!ok) throw new Error('Confirm math insert button not found');
        ok.click();
      })()`);
      await sleep(350);
      await win.webContents.executeJavaScript(`(() => {
        const save = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('保存修改'));
        if (!save) throw new Error('Save edits button not found');
        save.click();
      })()`);
      await sleep(500);

      const editorCheck = await win.webContents.executeJavaScript(`(() => ({
        hasV2: document.body.innerText.includes('v2'),
        mathChips: document.querySelectorAll('[data-math-chip="1"]').length,
        figureImgs: document.querySelectorAll('main img[src^="workbench-asset://question-bank/"]').length,
      }))()`);
      assert.equal(editorCheck.hasV2, true, 'Saving edits must bump revision to v2');
      assert.ok(editorCheck.mathChips >= 1, 'MathLive inline math chip must render in TipTap editor');
      assert.ok(editorCheck.figureImgs >= 1, 'Cropped physics diagram must stay preserved after inserting math formula');
      await saveShot(win, '18-qbank-editor-mathlive.png');

      // Open lazy AI/OCR modal once -> verify it opens cleanly and triggers ZERO async Keychain prompts, then close
      await win.webContents.executeJavaScript(`(() => {
        const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('AI / OCR 识图转写'));
        if (!btn) throw new Error('OCR button not found');
        btn.click();
      })()`);
      await sleep(400);
      const ocrOpenOk = await win.webContents.executeJavaScript(`
        (document.querySelector('[role="dialog"]')?.innerText || '').includes('工作台统一 AI 视觉模型')
      `);
      assert.equal(ocrOpenOk, true, 'Lazy OCR modal must offer unified Workbench AI channel');
      await closeSettings(win);

      // Step 19: Question Bank List -> create folder, verify question appears, add to basket
      await win.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('题库检索'));
        if (!tab) throw new Error('Bank tab not found');
        tab.click();
      })()`);
      await sleep(500);
      await win.webContents.executeJavaScript(`(() => {
        const addBtn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('加入组卷篮'));
        if (!addBtn) throw new Error('Add to basket button not found');
        addBtn.click();
      })()`);
      await sleep(450);
      await saveShot(win, '19-qbank-bank-search.png');

      // Step 20: Basket & 3-Format Exports (real Electron Word OMML, PDF, PPTX!)
      await win.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes('组卷篮与导出'));
        if (!tab) throw new Error('Basket tab not found');
        tab.click();
      })()`);
      await sleep(500);
      await saveShot(win, '20-qbank-basket-export.png');

      const exportOutDir = path.join(shotsDir, 'exports');
      fs.mkdirSync(exportOutDir, { recursive: true });
      for (const [ext, btnLabel] of [
        ['docx', '导出 Word 试卷'],
        ['pdf', '导出 PDF'],
        ['pptx', '导出课件'],
      ]) {
        const targetFile = path.join(exportOutDir, `e2e-physics.${ext}`);
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetFile });
        await win.webContents.executeJavaScript(`(() => {
          const btn = Array.from(document.querySelectorAll('main button')).find((b) => (b.textContent || '').includes(${JSON.stringify(btnLabel)}));
          if (!btn) throw new Error('Export button not found: ' + ${JSON.stringify(btnLabel)});
          btn.click();
        })()`);
        // Wait up to 20s for raster/word export file to finish writing
        const deadline = Date.now() + 20_000;
        while (!fs.existsSync(targetFile) && Date.now() < deadline) await sleep(250);
        assert.ok(fs.existsSync(targetFile), `Exported ${ext} file must be written to disk`);
      }

      // Verify all 3 exported artifacts structurally!
      const docxZip = unzipSync(new Uint8Array(fs.readFileSync(path.join(exportOutDir, 'e2e-physics.docx'))));
      const docxXml = Buffer.from(docxZip['word/document.xml']).toString('utf8');
      assert.ok(docxXml.includes('<m:oMath'), 'E2E exported Word .docx must include native <m:oMath> formula');
      const pdfBytes = fs.readFileSync(path.join(exportOutDir, 'e2e-physics.pdf'));
      assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-', 'E2E exported PDF must have valid %PDF- header');
      const pptxZip = unzipSync(new Uint8Array(fs.readFileSync(path.join(exportOutDir, 'e2e-physics.pptx'))));
      assert.ok(pptxZip['ppt/slides/slide1.xml'], 'E2E exported PPTX must include slide1.xml');

      // Step 21: Dark Glass Theme check inside Question Bank
      await openSettingsThemeTab(win);
      await clickThemeCard(win, '极光深玻');
      await closeSettings(win);
      await saveShot(win, '21-qbank-glass-aurora.png');

      assert.equal(
        asyncKeychainCalls,
        0,
        `macOS zero-popup guardrail violated: safeStorage.isAsyncEncryptionAvailable called ${asyncKeychainCalls} times!`,
      );
      assert.equal(errors.length, 0, `Encountered runtime errors:\n${errors.join('\n')}`);
      console.log('[E2E PASS] All 23 real desktop user flows (incl. AI presets, Zhixue ROI/crawler/auto-delay, Apps Hub & 6-page physics PDF qbank + Word/PDF/PPTX exports) passed with 0 errors!');
      mockServer.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      app.exit(0);
    } catch (err) {
      console.error('[E2E FAIL]', err);
      if (errors.length) console.error('[CAPTURED ERRORS]\n' + errors.join('\n'));
      mockServer.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      app.exit(1);
    }
  });
});

await import(pathToFileURL(path.join(projectRoot, 'out/main/index.js')).toString());
