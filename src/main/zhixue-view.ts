import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, WebContentsView, type NativeImage } from 'electron';
import type {
  ZhixueApplyScoreResult,
  ZhixueCrawledControls,
  ZhixuePaperChangeResult,
  ZhixueRoiRect,
  ZhixueSiteProfile,
  ZhixueState,
} from '../shared/types';

export const ZHIXUE_DEFAULT_URL = 'https://www.zhixue.com/login.html';

function originKeyOf(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.origin;
  } catch {
    return 'default';
  }
}

function imageToGrayscale32(img: NativeImage): Uint8Array {
  const resized = img.resize({ width: 32, height: 32, quality: 'good' });
  const buf = resized.toBitmap();
  const totalPixels = Math.floor(buf.length / 4);
  if (totalPixels <= 0) return new Uint8Array(0);
  // Sample down to at most 1024 pixels evenly so 1x and 2x Retina bitmaps produce consistent lengths
  const sampleCount = Math.min(1024, totalPixels);
  const out = new Uint8Array(sampleCount);
  const step = totalPixels / sampleCount;
  for (let i = 0; i < sampleCount; i++) {
    const px = Math.min(totalPixels - 1, Math.floor(i * step));
    const o = px * 4;
    // Electron toBitmap() is BGRA on macOS/Windows
    const b = buf[o] ?? 0;
    const g = buf[o + 1] ?? 0;
    const r = buf[o + 2] ?? 0;
    out[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return out;
}

function normalizedMad(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / (len * 255);
}

/**
 * Clean-room Electron WebContentsView companion for 智学网 and any online marking platform.
 * Uses an isolated persistent session partition ("persist:zhixue") so teacher login stays alive,
 * supports interactive ROI region picking, automatic score-option & submit-button crawling,
 * manual element calibration, perceptual paper-change detection, and safe interceptable scoring.
 */
export class ZhixueCompanionManager {
  private view: WebContentsView | null = null;
  private attached = false;
  private currentUrl = ZHIXUE_DEFAULT_URL;
  private profilesPath: string;
  private profiles: Record<string, ZhixueSiteProfile> = {};
  private baselineGray: Uint8Array | null = null;
  private prevPollGray: Uint8Array | null = null;

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private emitState: (state: ZhixueState) => void,
    userDataDir: string,
    private emitEscape?: () => void,
  ) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.profilesPath = path.join(userDataDir, 'zhixue-profiles.json');
    this.profiles = this.loadProfiles();
  }

  private loadProfiles(): Record<string, ZhixueSiteProfile> {
    try {
      if (!fs.existsSync(this.profilesPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.profilesPath, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed as Record<string, ZhixueSiteProfile>;
      return {};
    } catch {
      return {};
    }
  }

  private persistProfiles() {
    try {
      fs.writeFileSync(this.profilesPath, JSON.stringify(this.profiles, null, 2), 'utf8');
    } catch {
      // ignore write errors in restricted environments
    }
  }

  private getLiveWebContents() {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    return wc;
  }

  private ensureView(): WebContentsView {
    if (this.view && this.getLiveWebContents()) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:zhixue',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const wc = view.webContents;
    const push = () => {
      if (this.getLiveWebContents()) this.emitState(this.getState());
    };
    wc.on('did-start-loading', push);
    wc.on('did-stop-loading', push);
    wc.on('did-navigate', push);
    wc.on('did-navigate-in-page', push);
    wc.on('page-title-updated', push);
    // Forward Escape keypresses from inside the embedded webpage to emergency-stop auto-grading!
    wc.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        this.emitEscape?.();
      }
    });
    // Keep popups (e.g., exam paper windows opened by Zhixuewang) inside the same view!
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void wc.loadURL(url).catch(() => {});
      }
      return { action: 'deny' };
    });
    this.view = view;
    return view;
  }

  getState(): ZhixueState {
    const wc = this.getLiveWebContents();
    if (!wc) {
      return {
        attached: false,
        url: this.currentUrl,
        title: '智学网 / 网阅伴侣',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      };
    }
    return {
      attached: this.attached,
      url: wc.getURL() || this.currentUrl,
      title: wc.getTitle() || '智学网 / 网阅伴侣',
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  getSiteProfile(url?: string): ZhixueSiteProfile {
    const key = originKeyOf(url || this.getState().url);
    const existing = this.profiles[key];
    if (existing) return { ...existing };
    return { origin: key, roi: null, autoDelaySec: 1.5 };
  }

  saveSiteProfile(patch: Partial<ZhixueSiteProfile> & { url?: string }): ZhixueSiteProfile {
    const key = patch.origin || originKeyOf(patch.url || this.getState().url);
    const prev = this.profiles[key] || { origin: key, roi: null, autoDelaySec: 1.5 };
    const next: ZhixueSiteProfile = {
      origin: key,
      roi: patch.roi !== undefined ? patch.roi : prev.roi,
      scoreGroupSelector:
        patch.scoreGroupSelector !== undefined ? patch.scoreGroupSelector : prev.scoreGroupSelector,
      submitSelector: patch.submitSelector !== undefined ? patch.submitSelector : prev.submitSelector,
      autoDelaySec:
        patch.autoDelaySec !== undefined
          ? Math.max(0.5, Math.min(15, Number(patch.autoDelaySec) || 1.5))
          : prev.autoDelaySec ?? 1.5,
    };
    this.profiles[key] = next;
    this.persistProfiles();
    return { ...next };
  }

  async attach(
    bounds: { x: number; y: number; width: number; height: number },
    url?: string,
  ): Promise<ZhixueState> {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return this.getState();
    const view = this.ensureView();
    const wc = this.getLiveWebContents();
    if (!wc) return this.getState();
    if (!this.attached) {
      win.contentView.addChildView(view);
      this.attached = true;
    }
    view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(100, Math.round(bounds.width)),
      height: Math.max(100, Math.round(bounds.height)),
    });
    const targetUrl = url?.trim();
    if (targetUrl && /^https?:\/\//i.test(targetUrl)) {
      this.currentUrl = targetUrl;
      void wc.loadURL(targetUrl).catch(() => {});
    } else if (!wc.getURL()) {
      void wc.loadURL(this.currentUrl).catch(() => {});
    }
    const state = this.getState();
    this.emitState(state);
    return state;
  }

  resize(bounds: { x: number; y: number; width: number; height: number }) {
    if (!this.view || !this.attached || !this.getLiveWebContents()) return;
    this.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(100, Math.round(bounds.width)),
      height: Math.max(100, Math.round(bounds.height)),
    });
  }

  detach() {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed() && this.view && this.attached) {
      try {
        win.contentView.removeChildView(this.view);
      } catch {
        // ignore
      }
      this.attached = false;
      this.emitState(this.getState());
    }
  }

  async navigate(url: string): Promise<ZhixueState> {
    this.ensureView();
    const wc = this.getLiveWebContents();
    if (!wc) return this.getState();
    const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    this.currentUrl = normalized;
    this.baselineGray = null;
    this.prevPollGray = null;
    void wc.loadURL(normalized).catch(() => {});
    const st = this.getState();
    this.emitState(st);
    return st;
  }

  goBack(): ZhixueState {
    const wc = this.getLiveWebContents();
    if (wc?.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
    return this.getState();
  }

  goForward(): ZhixueState {
    const wc = this.getLiveWebContents();
    if (wc?.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
    return this.getState();
  }

  reload(): ZhixueState {
    this.getLiveWebContents()?.reload();
    return this.getState();
  }

  private clampRect(rect?: ZhixueRoiRect): ZhixueRoiRect | undefined {
    if (!rect) return undefined;
    const viewBounds = this.view?.getBounds();
    const maxW = Math.max(20, viewBounds?.width || 4000);
    const maxH = Math.max(20, viewBounds?.height || 4000);
    const x = Math.max(0, Math.min(maxW - 20, Math.round(rect.x)));
    const y = Math.max(0, Math.min(maxH - 20, Math.round(rect.y)));
    const width = Math.max(20, Math.min(maxW - x, Math.round(rect.width)));
    const height = Math.max(20, Math.min(maxH - y, Math.round(rect.height)));
    return { x, y, width, height };
  }

  async captureRegion(rect?: ZhixueRoiRect): Promise<{ dataUrl: string; width: number; height: number }> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      throw new Error('请先打开网阅页面再抓取答卷画面');
    }
    const safeRect = this.clampRect(rect);
    const img = await wc.capturePage(safeRect);
    const size = img.getSize();
    return {
      dataUrl: img.toDataURL(),
      width: size.width,
      height: size.height,
    };
  }

  /**
   * Injects a Shadow-DOM isolated drag-selection overlay inside WebContentsView
   * so the teacher can draw the exact answer-sheet reading region directly on Zhixuewang.
   */
  async pickRegion(): Promise<ZhixueRoiRect | null> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      throw new Error('请先打开网阅页面再框选读取区域');
    }
    await this.cancelPickElement();
    const result = (await wc.executeJavaScript(`new Promise((resolve) => {
      const OLD = document.getElementById('__cyz_roi_picker__');
      if (OLD) {
        if (typeof OLD.__cyzCancel === 'function') OLD.__cyzCancel();
        OLD.remove();
      }
      const host = document.createElement('div');
      host.id = '__cyz_roi_picker__';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:auto;';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = \`
        <style>
          .mask { position:fixed; inset:0; background:rgba(15,23,42,0.34); cursor:crosshair; user-select:none; font-family:system-ui,-apple-system,sans-serif; }
          .banner { position:fixed; top:14px; left:50%; transform:translateX(-50%); background:#0f172a; color:#f8fafc; padding:8px 14px; border-radius:999px; font-size:12.5px; display:flex; align-items:center; gap:10px; box-shadow:0 8px 24px rgba(0,0,0,0.3); pointer-events:auto; }
          .banner button { border:none; border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; background:rgba(255,255,255,0.16); color:#fff; }
          .banner button:hover { background:rgba(255,255,255,0.28); }
          .box { position:fixed; border:2px solid #10b981; background:rgba(16,185,129,0.12); box-shadow:0 0 0 9999px rgba(15,23,42,0.22); pointer-events:none; display:none; }
          .size { position:absolute; top:-24px; left:0; background:#10b981; color:#052e16; font-weight:700; font-size:11px; padding:2px 6px; border-radius:4px; white-space:nowrap; }
          .actions { position:fixed; display:none; gap:6px; background:#0f172a; padding:6px 8px; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.35); pointer-events:auto; }
          .actions button { border:none; border-radius:6px; padding:5px 11px; font-size:12px; font-weight:600; cursor:pointer; }
          .ok { background:#10b981; color:#052e16; }
          .ok:hover { background:#34d399; }
          .retry { background:rgba(255,255,255,0.15); color:#fff; }
          .cancel { background:rgba(239,68,68,0.25); color:#fecaca; }
        </style>
        <div class="mask" id="mask">
          <div class="banner" id="banner">
            <span>拖拽框选【学生手写答卷读取区域】（回车确认 · Esc 取消）</span>
            <button type="button" id="topCancel">取消</button>
          </div>
          <div class="box" id="box"><span class="size" id="sizeTag"></span></div>
          <div class="actions" id="actions">
            <button type="button" class="ok" id="btnOk">✓ 确认读取区域</button>
            <button type="button" class="retry" id="btnRetry">重新框选</button>
            <button type="button" class="cancel" id="btnCancel">取消</button>
          </div>
        </div>
      \`;
      document.documentElement.appendChild(host);

      const mask = shadow.getElementById('mask');
      const box = shadow.getElementById('box');
      const sizeTag = shadow.getElementById('sizeTag');
      const actions = shadow.getElementById('actions');
      let start = null;
      let rect = null;
      let done = false;

      const finish = (val) => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(val);
      };
      host.__cyzCancel = () => finish(null);

      const renderBox = (r) => {
        box.style.display = 'block';
        box.style.left = r.x + 'px';
        box.style.top = r.y + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
        sizeTag.textContent = Math.round(r.width) + ' × ' + Math.round(r.height) + ' px';
      };

      const placeActions = (r) => {
        actions.style.display = 'flex';
        const top = Math.min(window.innerHeight - 48, r.y + r.height + 10);
        const left = Math.max(12, Math.min(window.innerWidth - 260, r.x));
        actions.style.top = top + 'px';
        actions.style.left = left + 'px';
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        } else if (e.key === 'Enter' && rect && rect.width >= 24 && rect.height >= 24) {
          e.preventDefault();
          e.stopPropagation();
          finish(rect);
        }
      };
      window.addEventListener('keydown', onKey, true);

      mask.addEventListener('pointerdown', (e) => {
        if (e.target.closest('#actions') || e.target.closest('#banner')) return;
        actions.style.display = 'none';
        start = { x: e.clientX, y: e.clientY };
        rect = { x: start.x, y: start.y, width: 0, height: 0 };
        renderBox(rect);
      });
      mask.addEventListener('pointermove', (e) => {
        if (!start) return;
        const x = Math.min(start.x, e.clientX);
        const y = Math.min(start.y, e.clientY);
        const width = Math.abs(e.clientX - start.x);
        const height = Math.abs(e.clientY - start.y);
        rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
        renderBox(rect);
      });
      mask.addEventListener('pointerup', () => {
        if (!start) return;
        start = null;
        if (rect && rect.width >= 24 && rect.height >= 24) {
          placeActions(rect);
        } else {
          rect = null;
          box.style.display = 'none';
        }
      });

      shadow.getElementById('btnOk').addEventListener('click', () => finish(rect));
      shadow.getElementById('btnRetry').addEventListener('click', () => {
        rect = null;
        box.style.display = 'none';
        actions.style.display = 'none';
      });
      shadow.getElementById('btnCancel').addEventListener('click', () => finish(null));
      shadow.getElementById('topCancel').addEventListener('click', () => finish(null));
    })`)) as ZhixueRoiRect | null;
    return result ? this.clampRect(result) || null : null;
  }

  async cancelPickRegion(): Promise<void> {
    const wc = this.getLiveWebContents();
    if (!wc) return;
    try {
      await wc.executeJavaScript(`(() => {
        const el = document.getElementById('__cyz_roi_picker__');
        if (el) {
          if (typeof el.__cyzCancel === 'function') el.__cyzCancel();
          el.remove();
        }
      })()`);
    } catch {
      // ignore if page is navigating
    }
  }

  /**
   * Renders a non-interactive dashed guide border OUTSIDE the ROI coordinates
   * so capturePage(roi) contains 0 border pixels while the teacher always sees the active zone.
   */
  async setRoiHighlight(rect: ZhixueRoiRect | null, visible: boolean): Promise<void> {
    const wc = this.getLiveWebContents();
    if (!wc) return;
    const payload = JSON.stringify({ rect: rect ? this.clampRect(rect) : null, visible });
    try {
      await wc.executeJavaScript(`(() => {
        const { rect, visible } = ${payload};
        let el = document.getElementById('__cyz_roi_frame__');
        if (!rect || !visible) {
          if (el) el.remove();
          return;
        }
        if (!el) {
          el = document.createElement('div');
          el.id = '__cyz_roi_frame__';
          document.documentElement.appendChild(el);
        }
        el.style.cssText = [
          'position:fixed',
          'pointer-events:none',
          'z-index:2147483640',
          'box-sizing:content-box',
          'border:2px dashed #10b981',
          'border-radius:4px',
          'left:' + Math.max(0, rect.x - 2) + 'px',
          'top:' + Math.max(0, rect.y - 2) + 'px',
          'width:' + rect.width + 'px',
          'height:' + rect.height + 'px',
        ].join(';');
        el.innerHTML = '<span style="position:absolute;top:-22px;left:-2px;background:#10b981;color:#052e16;font:700 10.5px/1 system-ui,sans-serif;padding:3px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.2);">AI 读取区 ' + rect.width + '×' + rect.height + '</span>';
      })()`);
    } catch {
      // ignore during navigation
    }
  }

  /**
   * Automatically crawls visible score option buttons, score inputs, and submit/next buttons
   * across main document and accessible same-origin iframes.
   */
  async crawlControls(hints?: {
    scoreGroupSelector?: string;
    submitSelector?: string;
  }): Promise<ZhixueCrawledControls> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      throw new Error('请先打开网阅页面再探测得分选项');
    }
    const payload = JSON.stringify({
      scoreGroupSelector: hints?.scoreGroupSelector?.trim() || '',
      submitSelector: hints?.submitSelector?.trim() || '',
    });
    const crawled = (await wc.executeJavaScript(`(() => {
      const { scoreGroupSelector, submitSelector } = ${payload};
      const getDocs = () => {
        const docs = [document];
        const walk = (d) => {
          for (const f of Array.from(d.querySelectorAll('iframe'))) {
            try {
              if (f.contentDocument) {
                docs.push(f.contentDocument);
                walk(f.contentDocument);
              }
            } catch {}
          }
        };
        walk(document);
        return docs;
      };
      const isVisible = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const st = el.ownerDocument.defaultView?.getComputedStyle(el);
        if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 10 && r.height >= 10;
      };
      const buildSelector = (el) => {
        if (!el || el.nodeType !== 1) return '';
        if (el.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(el.id)) return '#' + el.id;
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && depth < 5) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(cur.id)) {
            parts.unshift('#' + cur.id);
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
          }
          parts.unshift(seg);
          cur = parent;
          depth++;
        }
        return parts.join(' > ');
      };
      const parseScoreLabel = (raw) => {
        const t = String(raw || '').replace(/\\s+/g, '').trim();
        if (!t || t.length > 8) return null;
        if (/^(零分|0分)$/.test(t)) return { label: t, value: 0 };
        if (/^(满分|全对)$/.test(t)) return { label: t, value: null };
        if (/^(半对)$/.test(t)) return { label: t, value: null };
        const m = t.match(/^\\+?(\\d+(?:\\.\\d+)?)分?$/);
        if (!m) return null;
        const num = Number(m[1]);
        if (!Number.isFinite(num) || num < 0 || num > 150) return null;
        return { label: t, value: num };
      };
      const isClickable = (el) => {
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A') return true;
        if (el.getAttribute('role') === 'button') return true;
        if (typeof el.onclick === 'function') return true;
        const st = el.ownerDocument.defaultView?.getComputedStyle(el);
        if (st && st.cursor === 'pointer') return true;
        const cls = String(el.className || '');
        return /btn|button|score|mark|point|option|item|key|num/i.test(cls);
      };

      const docs = getDocs();
      // Clear previous markers
      for (const d of docs) {
        d.querySelectorAll('[data-cyz-score-id]').forEach((n) => n.removeAttribute('data-cyz-score-id'));
        d.querySelectorAll('[data-cyz-input-id]').forEach((n) => n.removeAttribute('data-cyz-input-id'));
        d.querySelectorAll('[data-cyz-submit-id]').forEach((n) => n.removeAttribute('data-cyz-submit-id'));
      }

      // 1. Score options discovery
      const collectFromRoot = (root) => {
        const found = [];
        const nodes = root.querySelectorAll('button, [role="button"], a, li, span, div');
        for (const el of nodes) {
          if (el.id === '__cyz_roi_picker__' || el.id === '__cyz_roi_frame__' || el.id === '__cyz_el_picker__') continue;
          if (!isVisible(el)) continue;
          // Prefer leaf-like clickable items (avoid grabbing an entire wrapper div)
          if (el.children.length > 2) continue;
          if (!isClickable(el)) continue;
          const parsed = parseScoreLabel(el.textContent);
          if (!parsed) continue;
          found.push({ el, label: parsed.label, value: parsed.value });
        }
        return found;
      };

      let bestGroup = [];
      if (scoreGroupSelector) {
        for (const d of docs) {
          try {
            const container = d.querySelector(scoreGroupSelector);
            if (container) {
              const items = collectFromRoot(container);
              if (items.length > bestGroup.length) bestGroup = items;
            }
          } catch {}
        }
      }

      if (!bestGroup.length) {
        const allItems = [];
        for (const d of docs) {
          allItems.push(...collectFromRoot(d));
        }
        // Cluster by common ancestor (parent or grandparent)
        const buckets = new Map();
        for (const item of allItems) {
          const p1 = item.el.parentElement;
          const p2 = p1?.parentElement;
          for (const anc of [p1, p2]) {
            if (!anc || anc.tagName === 'BODY' || anc.tagName === 'HTML') continue;
            if (!buckets.has(anc)) buckets.set(anc, []);
            buckets.get(anc).push(item);
          }
        }
        let bestScore = -1;
        for (const [anc, list] of buckets.entries()) {
          // Deduplicate same element or nested child inside same cluster
          const uniq = [];
          const seenLabels = new Set();
          for (const it of list) {
            if (uniq.some((u) => u.el === it.el || u.el.contains(it.el) || it.el.contains(u.el))) continue;
            if (seenLabels.has(it.label)) continue;
            seenLabels.add(it.label);
            uniq.push(it);
          }
          const numVals = uniq.filter((u) => u.value !== null).map((u) => u.value);
          if (numVals.length < 2) continue;
          const hasZero = numVals.includes(0);
          const hintBonus = /score|mark|point|grade|fen|打分|给分|score-bar|score-panel/i.test(
            String(anc.className || '') + ' ' + String(anc.id || '') + ' ' + String(anc.getAttribute('aria-label') || '')
          ) ? 8 : 0;
          const score = numVals.length * 3 + (hasZero ? 5 : 0) + hintBonus - Math.max(0, uniq.length - 30);
          if (score > bestScore) {
            bestScore = score;
            bestGroup = uniq;
          }
        }
      }

      // Sort options cleanly: numeric ascending first, then special labels
      bestGroup.sort((a, b) => {
        if (a.value !== null && b.value !== null) return a.value - b.value;
        if (a.value !== null) return -1;
        if (b.value !== null) return 1;
        return a.label.localeCompare(b.label, 'zh-CN');
      });

      const scoreOptions = bestGroup.map((it, idx) => {
        const id = 'cyz-s' + idx;
        it.el.setAttribute('data-cyz-score-id', id);
        return {
          id,
          label: it.label,
          value: it.value,
          selector: buildSelector(it.el),
        };
      });

      // Infer max and step from numeric score options
      const numericSorted = Array.from(
        new Set(scoreOptions.filter((o) => o.value !== null).map((o) => o.value))
      ).sort((a, b) => a - b);
      let inferredMax = numericSorted.length ? numericSorted[numericSorted.length - 1] : null;
      let inferredStep = null;
      if (numericSorted.length >= 2) {
        let minDiff = Infinity;
        for (let i = 1; i < numericSorted.length; i++) {
          const diff = Math.round((numericSorted[i] - numericSorted[i - 1]) * 100) / 100;
          if (diff > 0 && diff < minDiff) minDiff = diff;
        }
        if (Number.isFinite(minDiff)) inferredStep = minDiff;
      }

      // 2. Score inputs discovery
      const scoreInputs = [];
      const seenInputs = new Set();
      const inputSelectors = [
        'input[placeholder*="分"]',
        'input[placeholder*="打分"]',
        'input[class*="score" i]',
        'input[id*="score" i]',
        'input[name*="score" i]',
        'input[type="number"]',
      ];
      for (const d of docs) {
        for (const sel of inputSelectors) {
          for (const el of d.querySelectorAll(sel)) {
            if (seenInputs.has(el) || !isVisible(el) || el.disabled || el.readOnly) continue;
            seenInputs.add(el);
            const id = 'cyz-in' + scoreInputs.length;
            el.setAttribute('data-cyz-input-id', id);
            const prevText = (el.previousElementSibling?.textContent || el.parentElement?.textContent || '')
              .replace(/\\s+/g, ' ')
              .trim()
              .slice(0, 24);
            scoreInputs.push({
              id,
              label: prevText || ('输入框 #' + (scoreInputs.length + 1)),
              placeholder: el.getAttribute('placeholder') || '',
              selector: buildSelector(el),
            });
          }
        }
      }

      // 3. Submit / Next button discovery
      let submitEl = null;
      let submitLabel = '';
      if (submitSelector) {
        for (const d of docs) {
          try {
            const candidate = d.querySelector(submitSelector);
            if (candidate && isVisible(candidate)) {
              submitEl = candidate;
              submitLabel = (candidate.textContent || candidate.value || '已校准提交键').replace(/\\s+/g, '').trim().slice(0, 16);
              break;
            }
          } catch {}
        }
      }
      if (!submitEl) {
        const submitRules = [
          { re: /^(提交并下一份|提交下一份|保存并下一份)$/, rank: 100 },
          { re: /^(提交打分|确认打分|提交给分|提交成绩)$/, rank: 92 },
          { re: /^(提交|确认提交)$/, rank: 85 },
          { re: /^(下一份|下一张|下一题|下一个)$/, rank: 78 },
          { re: /(提交并下一|提交打分|下一份)/, rank: 70 },
          { re: /^(确定|保存)$/, rank: 50 },
        ];
        let bestSubmitRank = -1;
        for (const d of docs) {
          for (const el of d.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a, span, div')) {
            if (!isVisible(el) || el.disabled) continue;
            if (el.children.length > 2) continue;
            if (!isClickable(el) && el.tagName !== 'INPUT') continue;
            const txt = (el.tagName === 'INPUT' ? el.value : el.textContent || '').replace(/\\s+/g, '').trim();
            if (!txt || txt.length > 14) continue;
            for (const rule of submitRules) {
              if (rule.re.test(txt) && rule.rank > bestSubmitRank) {
                bestSubmitRank = rule.rank;
                submitEl = el;
                submitLabel = txt;
              }
            }
          }
        }
      }

      let submitButton = null;
      if (submitEl) {
        submitEl.setAttribute('data-cyz-submit-id', 'cyz-submit');
        submitButton = {
          id: 'cyz-submit',
          label: submitLabel || '提交',
          selector: buildSelector(submitEl),
        };
      }

      const parts = [];
      if (scoreOptions.length) parts.push('探测到 ' + scoreOptions.length + ' 个得分选项');
      if (scoreInputs.length) parts.push(scoreInputs.length + ' 个打分输入框');
      if (submitButton) parts.push('已定位「' + submitButton.label + '」');
      const summary = parts.length ? parts.join(' · ') : '未自动发现得分控件，请进入具体阅卷页后重试，或点击“拾取校准”';

      return {
        url: location.href,
        crawledAt: new Date().toISOString(),
        scoreOptions,
        scoreInputs,
        submitButton,
        inferredMax,
        inferredStep,
        summary,
      };
    })()`)) as ZhixueCrawledControls;
    return crawled;
  }

  /**
   * Manual element calibration picker inside WebContentsView.
   * Teacher hovers and clicks the score button group or submit button (intercepted safely without triggering webpage click).
   */
  async pickElement(role: 'score-group' | 'submit'): Promise<{ selector: string; label: string } | null> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      throw new Error('请先打开网阅页面再拾取控件');
    }
    await this.cancelPickRegion();
    const roleJson = JSON.stringify(role);
    const picked = (await wc.executeJavaScript(`new Promise((resolve) => {
      const role = ${roleJson};
      const OLD = document.getElementById('__cyz_el_picker__');
      if (OLD) {
        if (typeof OLD.__cyzCancel === 'function') OLD.__cyzCancel();
        OLD.remove();
      }
      const host = document.createElement('div');
      host.id = '__cyz_el_picker__';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = \`
        <style>
          .bar { position:fixed; top:14px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:8px 14px; border-radius:999px; font:500 12.5px/1.3 system-ui,sans-serif; display:flex; align-items:center; gap:10px; box-shadow:0 8px 24px rgba(0,0,0,0.32); pointer-events:auto; }
          .bar button { border:none; border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; background:rgba(255,255,255,0.18); color:#fff; }
          .hl { position:fixed; border:2px solid #f59e0b; background:rgba(245,158,11,0.16); border-radius:6px; pointer-events:none; display:none; transition:all 60ms linear; }
          .tag { position:absolute; top:-22px; left:0; background:#f59e0b; color:#451a03; font:700 11px/1 system-ui,sans-serif; padding:3px 6px; border-radius:4px; white-space:nowrap; }
        </style>
        <div class="bar">
          <span id="hint"></span>
          <button type="button" id="cancel">取消 (Esc)</button>
        </div>
        <div class="hl" id="hl"><span class="tag" id="tag"></span></div>
      \`;
      document.documentElement.appendChild(host);
      shadow.getElementById('hint').textContent =
        role === 'score-group'
          ? '请点击网页里的【任意分值按钮或得分选项区】锁定打分区（不会真的提交）'
          : '请点击网页里的【提交 / 下一份】按钮锁定提交键（不会真的提交）';
      const hl = shadow.getElementById('hl');
      const tag = shadow.getElementById('tag');

      const buildSelector = (el) => {
        if (!el || el.nodeType !== 1) return '';
        if (el.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(el.id)) return '#' + el.id;
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && depth < 5) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(cur.id)) {
            parts.unshift('#' + cur.id);
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
          }
          parts.unshift(seg);
          cur = parent;
          depth++;
        }
        return parts.join(' > ');
      };

      const resolveTarget = (rawEl) => {
        if (!rawEl || rawEl.id === '__cyz_el_picker__' || rawEl.closest?.('#__cyz_el_picker__')) return null;
        if (role === 'score-group') {
          // If hovering a single numeric button, auto-promote to its enclosing button-group container
          const txt = (rawEl.textContent || '').replace(/\\s+/g, '').trim();
          if (/^\\+?\\d+(?:\\.\\d+)?分?$|^(满分|零分)$/.test(txt)) {
            let p = rawEl.parentElement;
            for (let i = 0; i < 3 && p && p.tagName !== 'BODY'; i++, p = p.parentElement) {
              const numBtns = Array.from(p.querySelectorAll('button,[role="button"],a,li,span,div')).filter((c) => {
                if (c.children.length > 2) return false;
                return /^\\+?\\d+(?:\\.\\d+)?分?$|^(满分|零分)$/.test((c.textContent || '').replace(/\\s+/g, '').trim());
              });
              if (numBtns.length >= 2) return p;
            }
          }
        }
        return rawEl;
      };

      let done = false;
      const cleanup = (val) => {
        if (done) return;
        done = true;
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(val);
      };
      host.__cyzCancel = () => cleanup(null);

      const onMove = (e) => {
        const t = resolveTarget(e.target);
        if (!t) {
          hl.style.display = 'none';
          return;
        }
        const r = t.getBoundingClientRect();
        hl.style.display = 'block';
        hl.style.left = r.left + 'px';
        hl.style.top = r.top + 'px';
        hl.style.width = r.width + 'px';
        hl.style.height = r.height + 'px';
        const preview = (t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18);
        tag.textContent = (role === 'score-group' ? '得分选项区' : '提交按钮') + (preview ? ' · ' + preview : '');
      };
      const onClick = (e) => {
        if (e.composedPath().includes(shadow.getElementById('cancel'))) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const t = resolveTarget(e.target);
        if (!t) return;
        const selector = buildSelector(t);
        const label = (t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20) || selector;
        cleanup({ selector, label });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanup(null);
        }
      };

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
      shadow.getElementById('cancel').addEventListener('click', () => cleanup(null));
    })`)) as { selector: string; label: string } | null;
    return picked;
  }

  async cancelPickElement(): Promise<void> {
    const wc = this.getLiveWebContents();
    if (!wc) return;
    try {
      await wc.executeJavaScript(`(() => {
        const el = document.getElementById('__cyz_el_picker__');
        if (el) {
          if (typeof el.__cyzCancel === 'function') el.__cyzCancel();
          el.remove();
        }
      })()`);
    } catch {
      // ignore
    }
  }

  /**
   * Clicks the matching crawled score option button (or fills the score input if no button matches).
   * Only clicks the submit/next button when `autoSubmit: true` is explicitly passed by teacher action
   * or after auto-mode's interceptable countdown completes cleanly.
   */
  async applyScore(params: {
    scoreText: string;
    optionId?: string;
    autoSubmit?: boolean;
    scoreGroupSelector?: string;
    submitSelector?: string;
  }): Promise<ZhixueApplyScoreResult> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      return { ok: false, submitted: false, detail: '网阅页面未打开' };
    }
    const payload = JSON.stringify({
      scoreText: String(params.scoreText || '').trim(),
      optionId: params.optionId?.trim() || '',
      autoSubmit: Boolean(params.autoSubmit),
      submitSelector: params.submitSelector?.trim() || '',
    });

    const result = (await wc.executeJavaScript(`(async () => {
      const { scoreText, optionId, autoSubmit, submitSelector } = ${payload};
      const getDocs = () => {
        const docs = [document];
        const walk = (d) => {
          for (const f of Array.from(d.querySelectorAll('iframe'))) {
            try {
              if (f.contentDocument) {
                docs.push(f.contentDocument);
                walk(f.contentDocument);
              }
            } catch {}
          }
        };
        walk(document);
        return docs;
      };
      const isVisible = (el) => {
        if (!el || el.nodeType !== 1 || el.disabled) return false;
        const st = el.ownerDocument.defaultView?.getComputedStyle(el);
        if (!st || st.display === 'none' || st.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      };
      const fireClick = (el) => {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        el.focus?.();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
      };

      const docs = getDocs();
      let clickedOptionLabel = '';
      let filledInput = false;

      // Priority 1: Direct click on crawled score option button
      let targetBtn = null;
      if (optionId) {
        for (const d of docs) {
          const found = d.querySelector('[data-cyz-score-id="' + optionId + '"]');
          if (found && isVisible(found)) {
            targetBtn = found;
            break;
          }
        }
      }
      if (!targetBtn && scoreText) {
        const targetNum = Number(scoreText);
        const targetUnits = Number.isFinite(targetNum) ? Math.round(targetNum * 100) : null;
        for (const d of docs) {
          for (const el of d.querySelectorAll('[data-cyz-score-id]')) {
            if (!isVisible(el)) continue;
            const txt = (el.textContent || '').replace(/\\s+/g, '').trim();
            if (txt === scoreText || txt === scoreText + '分') {
              targetBtn = el;
              break;
            }
            const m = txt.match(/^\\+?(\\d+(?:\\.\\d+)?)分?$/);
            if (m && targetUnits !== null && Math.round(Number(m[1]) * 100) === targetUnits) {
              targetBtn = el;
              break;
            }
            if (targetUnits === 0 && /^(零分|0分)$/.test(txt)) {
              targetBtn = el;
              break;
            }
          }
          if (targetBtn) break;
        }
      }

      if (targetBtn) {
        clickedOptionLabel = (targetBtn.textContent || '').replace(/\\s+/g, '').trim();
        fireClick(targetBtn);
      } else {
        // Priority 2: Fill visible score input box
        const candidates = [];
        for (const d of docs) {
          for (const el of d.querySelectorAll('[data-cyz-input-id]')) candidates.push(el);
          if (d.activeElement && ['INPUT', 'TEXTAREA'].includes(d.activeElement.tagName)) {
            candidates.push(d.activeElement);
          }
          for (const sel of [
            'input[placeholder*="分"]',
            'input[placeholder*="打分"]',
            'input[class*="score" i]',
            'input[id*="score" i]',
            'input[type="number"]',
            'input[type="text"]',
          ]) {
            for (const el of d.querySelectorAll(sel)) candidates.push(el);
          }
        }
        const targetInput = candidates.find((el) => isVisible(el) && !el.readOnly);
        if (!targetInput) {
          return {
            ok: false,
            submitted: false,
            detail: '未匹配到分值「' + scoreText + '」按钮或打分输入框，请先点“自动探测得分”或点击左侧打分框',
          };
        }
        const proto =
          targetInput.tagName === 'TEXTAREA'
            ? targetInput.ownerDocument.defaultView.HTMLTextAreaElement.prototype
            : targetInput.ownerDocument.defaultView.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        targetInput.focus();
        if (setter) setter.call(targetInput, scoreText);
        else targetInput.value = scoreText;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        filledInput = true;
      }

      let submitted = false;
      let submitName = '';
      if (autoSubmit) {
        await new Promise((r) => setTimeout(r, 180));
        let submitBtn = null;
        for (const d of docs) {
          const marked = d.querySelector('[data-cyz-submit-id="cyz-submit"]');
          if (marked && isVisible(marked)) {
            submitBtn = marked;
            break;
          }
          if (submitSelector) {
            try {
              const custom = d.querySelector(submitSelector);
              if (custom && isVisible(custom)) {
                submitBtn = custom;
                break;
              }
            } catch {}
          }
        }
        if (submitBtn) {
          submitName = (submitBtn.textContent || submitBtn.value || '提交').replace(/\\s+/g, '').trim();
          fireClick(submitBtn);
          submitted = true;
        }
      }

      const actionDesc = clickedOptionLabel
        ? '已点选得分选项「' + clickedOptionLabel + '」'
        : '已填入分值 ' + scoreText;
      const submitDesc = autoSubmit
        ? submitted
          ? '并触发「' + submitName + '」'
          : '（未定位到提交按钮，请手动提交或点“拾取提交键”校准）'
        : '（未自动提交，请核对后提交）';
      return {
        ok: true,
        clickedOptionLabel: clickedOptionLabel || undefined,
        filledInput: filledInput || undefined,
        submitted,
        detail: actionDesc + submitDesc,
      };
    })()`)) as ZhixueApplyScoreResult;
    return result;
  }

  /** Backward-compatible wrapper for legacy callers. */
  async fillScore(
    scoreText: string,
    selectorHint?: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const res = await this.applyScore({
      scoreText,
      autoSubmit: false,
      submitSelector: selectorHint,
    });
    return { ok: res.ok, detail: res.detail };
  }

  /** Marks current ROI frame as baseline for perceptual next-paper change detection. */
  async markPaperBaseline(rect?: ZhixueRoiRect): Promise<void> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) return;
    const safeRect = this.clampRect(rect);
    const img = await wc.capturePage(safeRect);
    const gray = imageToGrayscale32(img);
    this.baselineGray = gray;
    this.prevPollGray = gray;
  }

  /** Compares current ROI frame against last graded paper baseline + previous poll frame. */
  async checkPaperChanged(rect?: ZhixueRoiRect): Promise<ZhixuePaperChangeResult> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      return { diffFromBaseline: 0, diffFromPrev: 0, stableChanged: false };
    }
    const safeRect = this.clampRect(rect);
    const img = await wc.capturePage(safeRect);
    const gray = imageToGrayscale32(img);
    if (!this.baselineGray) {
      this.baselineGray = gray;
      this.prevPollGray = gray;
      return { diffFromBaseline: 0, diffFromPrev: 0, stableChanged: false };
    }
    const diffFromBaseline = normalizedMad(this.baselineGray, gray);
    const diffFromPrev = normalizedMad(this.prevPollGray, gray);
    this.prevPollGray = gray;
    // New paper has loaded & settled when visibly different from previous paper and stable across consecutive frames
    const stableChanged = diffFromBaseline >= 0.035 && diffFromPrev <= 0.015;
    return {
      diffFromBaseline: Number(diffFromBaseline.toFixed(4)),
      diffFromPrev: Number(diffFromPrev.toFixed(4)),
      stableChanged,
    };
  }

  destroy() {
    this.detach();
    if (this.view) {
      try {
        this.view.webContents.close();
      } catch {
        // ignore
      }
      this.view = null;
    }
  }
}
