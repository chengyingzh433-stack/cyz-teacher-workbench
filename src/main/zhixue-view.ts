import { BrowserWindow, WebContentsView } from 'electron';
import type { ZhixueState } from '../shared/types';

export const ZHIXUE_DEFAULT_URL = 'https://www.zhixue.com/login.html';

/**
 * Clean-room Electron WebContentsView companion for 智学网 and any online marking platform.
 * Uses an isolated persistent session partition ("persist:zhixue") so teacher login stays alive,
 * captures either full pane or user-selected rectangle via native Chromium capturePage(),
 * and supports safe score fill when explicitly triggered.
 */
export class ZhixueCompanionManager {
  private view: WebContentsView | null = null;
  private attached = false;
  private currentUrl = ZHIXUE_DEFAULT_URL;

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private emitState: (state: ZhixueState) => void,
  ) {}

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

  async captureRegion(rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ dataUrl: string; width: number; height: number }> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      throw new Error('请先打开网阅页面再抓取答卷画面');
    }
    const safeRect = rect
      ? {
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          width: Math.max(20, Math.round(rect.width)),
          height: Math.max(20, Math.round(rect.height)),
        }
      : undefined;
    const img = await wc.capturePage(safeRect);
    const size = img.getSize();
    return {
      dataUrl: img.toDataURL(),
      width: size.width,
      height: size.height,
    };
  }

  /**
   * Explicitly fills a score string into the focused input (or Zhixuewang's visible score input)
   * without clicking submit automatically, keeping teacher in full control.
   */
  async fillScore(
    scoreText: string,
    selectorHint?: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const wc = this.getLiveWebContents();
    if (!wc || !this.attached) {
      return { ok: false, detail: '网阅页面未打开' };
    }
    const payload = JSON.stringify({ score: scoreText.trim(), hint: selectorHint?.trim() || '' });
    const result = (await wc.executeJavaScript(`(() => {
      const { score, hint } = ${payload};
      const isVisible = (el) => el && el.offsetParent !== null && !el.disabled && !el.readOnly;
      const candidates = [];
      if (hint) {
        try { const h = document.querySelector(hint); if (h) candidates.push(h); } catch {}
      }
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        candidates.push(document.activeElement);
      }
      const selectors = [
        'input[placeholder*="分"]',
        'input[placeholder*="打分"]',
        'input[class*="score" i]',
        'input[id*="score" i]',
        'input[type="number"]',
        'input[type="text"]'
      ];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) candidates.push(el);
      }
      const target = candidates.find(isVisible);
      if (!target) return { ok: false, detail: '未找到可见的打分输入框，请先在左侧点击一下打分框再重试' };
      const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      target.focus();
      if (setter) setter.call(target, score);
      else target.value = score;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: '已填入分值 ' + score + '（请核对后在原页面点击提交）' };
    })()`)) as { ok: boolean; detail: string };
    return result;
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
