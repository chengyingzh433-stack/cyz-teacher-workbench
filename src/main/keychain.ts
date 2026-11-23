import fs from 'node:fs';
import path from 'node:path';
import { AppError, type AiConfigInput, type AiConfigView, type AiRoleConfigView } from '../shared/types';
import { AI_PRESETS, DEEPSEEK_DEFAULTS } from '../shared/ai-presets';

export { AI_PRESETS, DEEPSEEK_DEFAULTS };

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

interface StoredSecret {
  enc?: string; // base64 safeStorage buffer
  plain?: string; // fallback only when OS keychain unavailable (e.g. headless tests)
}

interface StoredAiConfig {
  general: { provider: 'deepseek' | 'custom'; url: string; model: string; secret: StoredSecret };
  vision: { mode: 'inherit' | 'custom'; url: string; model: string; secret: StoredSecret };
  judge: { mode: 'inherit' | 'custom'; url: string; model: string; secret: StoredSecret };
  ocr: { mode: 'off' | 'vision-model' | 'http-ocr'; url: string; model: string; secret: StoredSecret };
}

export function isLocalUrl(urlStr: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(urlStr).hostname);
  } catch {
    return false;
  }
}

export function validateApiBaseUrl(input: string, label = 'API 地址'): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError('AI_CONFIG', `请输入完整的 ${label}，例如 https://api.deepseek.com`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalUrl(url.toString()))) {
    throw new AppError('AI_CONFIG', `${label} 须使用 HTTPS；本机 localhost 可用 HTTP`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AppError('AI_CONFIG', `${label} 中不要携带密钥或参数，请填在下方 API Key 栏`);
  }
  return url;
}

export function normalizeChatEndpoint(input: string): string {
  const url = validateApiBaseUrl(input);
  const p = url.pathname.replace(/\/+$/, '');
  url.pathname = p.endsWith('/chat/completions') ? p : `${p}/chat/completions`;
  return url.toString();
}

export function normalizeModelsEndpoint(input: string): string {
  const url = validateApiBaseUrl(input);
  const p = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  url.pathname = `${p}/models`;
  return url.toString();
}

export class AiKeychainStore {
  private filePath: string;
  private data: StoredAiConfig;

  constructor(
    userDataDir: string,
    private safeStorage?: SafeStorageLike,
  ) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.filePath = path.join(userDataDir, 'ai-config.json');
    this.data = this.load();
  }

  private defaultData(): StoredAiConfig {
    return {
      general: {
        provider: 'deepseek',
        url: DEEPSEEK_DEFAULTS.url,
        model: DEEPSEEK_DEFAULTS.model,
        secret: {},
      },
      vision: { mode: 'inherit', url: '', model: '', secret: {} },
      judge: { mode: 'inherit', url: '', model: '', secret: {} },
      ocr: { mode: 'off', url: '', model: '', secret: {} },
    };
  }

  private load(): StoredAiConfig {
    const def = this.defaultData();
    try {
      if (!fs.existsSync(this.filePath)) return def;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<StoredAiConfig>;
      return {
        general: { ...def.general, ...parsed.general },
        vision: { ...def.vision, ...parsed.vision },
        judge: { ...def.judge, ...parsed.judge },
        ocr: { ...def.ocr, ...parsed.ocr },
      };
    } catch {
      return def;
    }
  }

  private saveFile() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  private encryptKey(raw: string): StoredSecret {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (/[\r\n\s]/.test(trimmed)) throw new AppError('AI_CONFIG', 'API Key 中不能包含空白或换行');
    if (this.safeStorage?.isEncryptionAvailable()) {
      return { enc: this.safeStorage.encryptString(trimmed).toString('base64') };
    }
    return { plain: trimmed };
  }

  private decryptKey(secret?: StoredSecret): string {
    if (!secret) return '';
    if (secret.enc && this.safeStorage?.isEncryptionAvailable()) {
      try {
        return this.safeStorage.decryptString(Buffer.from(secret.enc, 'base64'));
      } catch {
        return '';
      }
    }
    return secret.plain || '';
  }

  getView(): AiConfigView {
    const gKey = this.decryptKey(this.data.general.secret);
    const gReady = Boolean(gKey) || isLocalUrl(this.data.general.url);

    const roleView = (r: StoredAiConfig['vision']): AiRoleConfigView => {
      const k = this.decryptKey(r.secret);
      if (r.mode === 'inherit') {
        return {
          mode: 'inherit',
          url: r.url,
          model: r.model,
          hasKey: Boolean(k),
          ready: gReady,
          effectiveLabel: `跟随统一（${this.data.general.model}）`,
        };
      }
      const ready = Boolean(r.url && r.model && (k || isLocalUrl(r.url)));
      return {
        mode: 'custom',
        url: r.url,
        model: r.model,
        hasKey: Boolean(k),
        ready,
        effectiveLabel: ready ? `自定义（${r.model}）` : '自定义（未完成）',
      };
    };

    const o = this.data.ocr;
    const oKey = this.decryptKey(o.secret);
    const ocrReady =
      o.mode === 'off'
        ? false
        : o.mode === 'vision-model'
          ? Boolean(o.url && o.model && (oKey || isLocalUrl(o.url)))
          : Boolean(o.url);
    let ocrHost = '未填地址';
    if (o.url) {
      try {
        ocrHost = new URL(o.url).host;
      } catch {
        ocrHost = o.url;
      }
    }

    return {
      secureStorageAvailable: Boolean(this.safeStorage?.isEncryptionAvailable()),
      general: {
        provider: this.data.general.provider,
        url: this.data.general.url,
        model: this.data.general.model,
        hasKey: Boolean(gKey),
        ready: gReady,
      },
      vision: roleView(this.data.vision),
      judge: roleView(this.data.judge),
      ocr: {
        mode: o.mode,
        url: o.url,
        model: o.model,
        hasKey: Boolean(oKey),
        ready: ocrReady,
        effectiveLabel:
          o.mode === 'off'
            ? '未开启（单路封顶 82%）'
            : o.mode === 'vision-model'
              ? `独立 OCR 模型（${o.model || '未填'}）`
              : `本机/HTTP OCR（${ocrHost}）`,
      },
    };
  }

  save(input: AiConfigInput): AiConfigView {
    if (input.general) {
      const g = input.general;
      const url = g.provider === 'deepseek' ? DEEPSEEK_DEFAULTS.url : g.url.trim();
      validateApiBaseUrl(url, '统一模型地址');
      const model = g.model.trim();
      if (!model) throw new AppError('AI_CONFIG', '请填写模型 ID');
      const keepPrev = g.url.trim() === this.data.general.url && g.provider === this.data.general.provider;
      const secret = g.key?.trim()
        ? this.encryptKey(g.key)
        : keepPrev
          ? this.data.general.secret
          : {};
      this.data.general = { provider: g.provider, url, model, secret };
    }

    const updateRole = (
      prev: StoredAiConfig['vision'],
      next: AiConfigInput['vision'],
      label: string,
    ): StoredAiConfig['vision'] => {
      if (!next) return prev;
      if (next.mode === 'inherit') return { ...prev, mode: 'inherit' };
      const url = next.url.trim();
      const model = next.model.trim();
      validateApiBaseUrl(url, `${label}地址`);
      if (!model) throw new AppError('AI_CONFIG', `请填写${label}模型 ID`);
      const keepPrev = url === prev.url;
      const secret = next.key?.trim() ? this.encryptKey(next.key) : keepPrev ? prev.secret : {};
      return { mode: 'custom', url, model, secret };
    };

    this.data.vision = updateRole(this.data.vision, input.vision, '盲识图视觉模型');
    this.data.judge = updateRole(this.data.judge, input.judge, '得分点采纳模型');

    if (input.ocr) {
      const o = input.ocr;
      if (o.mode === 'off') {
        this.data.ocr = { ...this.data.ocr, mode: 'off' };
      } else {
        const url = o.url.trim();
        validateApiBaseUrl(url, 'OCR 接口地址');
        const model = o.model.trim();
        if (o.mode === 'vision-model' && !model) {
          throw new AppError('AI_CONFIG', '请填写辅助 OCR 模型名称');
        }
        const keepPrev = url === this.data.ocr.url && o.mode === this.data.ocr.mode;
        const secret = o.key?.trim() ? this.encryptKey(o.key) : keepPrev ? this.data.ocr.secret : {};
        this.data.ocr = { mode: o.mode, url, model, secret };
      }
    }

    this.saveFile();
    return this.getView();
  }

  clearAllKeys(): AiConfigView {
    this.data.general.secret = {};
    this.data.vision.secret = {};
    this.data.judge.secret = {};
    this.data.ocr.secret = {};
    this.saveFile();
    return this.getView();
  }

  resolveChatRole(role: 'general' | 'vision' | 'judge'): { endpoint: string; model: string; key: string } {
    if (role !== 'general') {
      const cfg = this.data[role];
      if (cfg.mode === 'custom') {
        const key = this.decryptKey(cfg.secret);
        const endpoint = normalizeChatEndpoint(cfg.url);
        if (!key && !isLocalUrl(endpoint)) {
          throw new AppError('AI_CONFIG', `请先在「设置 → AI 连接」填写${role === 'vision' ? '视觉识图' : '评分推理'}模型的 API Key`);
        }
        return { endpoint, model: cfg.model, key };
      }
    }
    const g = this.data.general;
    const key = this.decryptKey(g.secret);
    const endpoint = normalizeChatEndpoint(g.url);
    if (!key && !isLocalUrl(endpoint)) {
      throw new AppError('AI_CONFIG', '请先在左下角「设置 → AI 与密钥」中配置 API Key');
    }
    return { endpoint, model: g.model, key };
  }

  resolveOcr(): { mode: 'off' | 'vision-model' | 'http-ocr'; url: string; model: string; key: string } {
    return {
      mode: this.data.ocr.mode,
      url: this.data.ocr.url,
      model: this.data.ocr.model,
      key: this.decryptKey(this.data.ocr.secret),
    };
  }

  resolveFallbackKey(role: 'general' | 'vision' | 'judge' | 'ocr', targetUrl: string): string {
    const slot = this.data[role];
    if (!slot?.url) return '';
    try {
      if (normalizeModelsEndpoint(slot.url) === normalizeModelsEndpoint(targetUrl)) {
        return this.decryptKey(slot.secret);
      }
    } catch {
      return '';
    }
    return '';
  }
}
