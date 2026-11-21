import { useEffect, useState } from 'react';
import {
  Check,
  FolderOpen,
  HardDrive,
  KeyRound,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AiConfigView, RemoteModelInfo, VaultInfo } from '../../shared/types';
import { listThemes } from '../themes';
import { Badge, Button, Card, Input, Modal, Select } from './ui/primitives';

const VISION_PRESETS = [
  { label: '阿里云百炼 Qwen-VL', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
  { label: '硅基流动 VL', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct' },
  { label: '智谱 GLM-4V', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
  { label: '本机 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5vl:7b' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialTab = 'theme',
  themeId,
  vaultInfo,
  onChangeTheme,
  onVaultChanged,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: 'theme' | 'ai' | 'vault';
  themeId: string;
  vaultInfo: VaultInfo | null;
  onChangeTheme: (id: string) => void;
  onVaultChanged: (info: VaultInfo) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'theme' | 'ai' | 'vault'>(initialTab);
  const [aiView, setAiView] = useState<AiConfigView | null>(null);

  // AI form states
  const [gProvider, setGProvider] = useState<'deepseek' | 'custom'>('deepseek');
  const [gUrl, setGUrl] = useState('');
  const [gModel, setGModel] = useState('deepseek-chat');
  const [gKey, setGKey] = useState('');

  const [vMode, setVMode] = useState<'inherit' | 'custom'>('inherit');
  const [vUrl, setVUrl] = useState('');
  const [vModel, setVModel] = useState('');
  const [vKey, setVKey] = useState('');

  const [jMode, setJMode] = useState<'inherit' | 'custom'>('inherit');
  const [jUrl, setJUrl] = useState('');
  const [jModel, setJModel] = useState('');
  const [jKey, setJKey] = useState('');

  const [oMode, setOMode] = useState<'off' | 'vision-model' | 'http-ocr'>('off');
  const [oUrl, setOUrl] = useState('');
  const [oModel, setOModel] = useState('');
  const [oKey, setOKey] = useState('');

  const [pulledModels, setPulledModels] = useState<RemoteModelInfo[]>([]);
  const [pulling, setPulling] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    window.workbenchApi.ai.getConfig().then((cfg) => {
      setAiView(cfg);
      setGProvider(cfg.general.provider);
      setGUrl(cfg.general.url);
      setGModel(cfg.general.model);
      setGKey('');
      setVMode(cfg.vision.mode);
      setVUrl(cfg.vision.url);
      setVModel(cfg.vision.model);
      setVKey('');
      setJMode(cfg.judge.mode);
      setJUrl(cfg.judge.url);
      setJModel(cfg.judge.model);
      setJKey('');
      setOMode(cfg.ocr.mode);
      setOUrl(cfg.ocr.url);
      setOModel(cfg.ocr.model);
      setOKey('');
    });
  }, [open]);

  async function saveAiConfig() {
    setSaving(true);
    try {
      const updated = await window.workbenchApi.ai.saveConfig({
        general: { provider: gProvider, url: gUrl, model: gModel, key: gKey || undefined },
        vision: { mode: vMode, url: vUrl, model: vModel, key: vKey || undefined },
        judge: { mode: jMode, url: jUrl, model: jModel, key: jKey || undefined },
        ocr: { mode: oMode, url: oUrl, model: oModel, key: oKey || undefined },
      });
      setAiView(updated);
      setGKey('');
      setVKey('');
      setJKey('');
      setOKey('');
      onNotify('AI 配置已通过系统钥匙串安全加密保存！重启软件不再丢失');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  async function pullModels() {
    setPulling(true);
    try {
      const url = gProvider === 'deepseek' ? 'https://api.deepseek.com' : gUrl;
      const list = await window.workbenchApi.ai.listModels({
        url,
        key: gKey || undefined,
        fallbackRole: 'general',
      });
      setPulledModels(list);
      onNotify(`成功拉取 ${list.length} 个可用模型`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setPulling(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="工作台设置"
      subtitle="外观主题引擎 · 系统钥匙串 AI 连接 · Obsidian 式本地资料库"
      size="lg"
    >
      <div className="flex gap-1.5 mb-4 p-1 rounded-xl bg-[var(--bg-muted)]">
        {(
          [
            ['theme', '外观与主题风格', Palette],
            ['ai', 'AI 模型与系统钥匙串', Sparkles],
            ['vault', '本地资料库（Vault）', HardDrive],
          ] as const
        ).map(([k, label, IconComp]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-1.5 px-3 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              tab === k
                ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            <IconComp className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* TAB 1: Extensible Design Token Theme Engine */}
      {tab === 'theme' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {listThemes().map((t) => {
              const active = themeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeTheme(t.id)}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-3 ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]/50 ring-2 ring-[var(--accent)]/25'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  {/* Mini visual mockup preview */}
                  <div
                    className="h-20 rounded-xl border border-black/10 overflow-hidden flex"
                    style={{ background: t.preview.canvas }}
                  >
                    <div className="w-1/4 h-full p-2 flex flex-col gap-1.5" style={{ background: t.preview.sidebar }}>
                      <div className="h-2 w-10 rounded-full opacity-50" style={{ background: t.preview.accent }} />
                      <div className="h-1.5 w-8 rounded-full bg-current opacity-20" />
                      <div className="h-1.5 w-12 rounded-full bg-current opacity-15" />
                    </div>
                    <div className="flex-1 p-2.5 flex flex-col gap-2">
                      <div className="h-3 w-20 rounded-md" style={{ background: t.preview.accent }} />
                      <div className="flex-1 rounded-lg border border-black/5" style={{ background: t.preview.surface }} />
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14px] font-semibold">{t.name}</div>
                      <div className="text-xs text-[var(--ink-muted)] mt-0.5">{t.tagline}</div>
                    </div>
                    {active && (
                      <Badge tone="accent">
                        <Check className="w-3 h-3" /> 使用中
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--bg-muted)]/70 text-xs text-[var(--ink-secondary)] leading-relaxed">
            <strong>多风格扩展接口已就绪：</strong>全站界面、矢量教室地板/黑板、Apache ECharts 图表色板均由语义化{' '}
            <code>ThemeDefinition</code> Token 驱动。后续随时可零改动插拔「日系手账风」「极客高密度风」「独立游戏像素风」等更多主题皮肤。
          </div>
        </div>
      )}

      {/* TAB 2: AI Models & OS Keychain */}
      {tab === 'ai' && (
        <div className="flex flex-col gap-4">
          <div className="p-3 rounded-xl bg-[var(--ok-soft)] text-[var(--ok)] text-xs flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              {aiView?.secureStorageAvailable
                ? '系统钥匙串加密已开启：所有 API Key 经系统原生加密保存于本机，绝不写入资料库文件夹。'
                : 'API Key 保存于本机用户私有配置目录，绝不写入资料库文件夹。'}
            </span>
            <Button
              size="xs"
              variant="danger-ghost"
              onClick={async () => {
                const updated = await window.workbenchApi.ai.clearKeys();
                setAiView(updated);
                onNotify('已清除全部已存 API Key');
              }}
            >
              <Trash2 className="w-3.5 h-3.5" /> 清空密钥
            </Button>
          </div>

          {/* Unified Default Model */}
          <Card className="p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-[var(--accent)]" /> 统一默认模型（学情助教 + 阅卷默认复用）
              </h4>
              {aiView?.general.hasKey && <Badge tone="ok">已加密记住 Key</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--ink-muted)]">服务商</span>
                <Select
                  value={gProvider}
                  onValueChange={(v) => {
                    const p = v as 'deepseek' | 'custom';
                    setGProvider(p);
                    if (p === 'deepseek') {
                      setGUrl('https://api.deepseek.com');
                      setGModel('deepseek-chat');
                    }
                  }}
                  className="w-full"
                  options={[
                    { value: 'deepseek', label: 'DeepSeek 官方' },
                    { value: 'custom', label: '自定义 OpenAI 兼容接口（含本机 Ollama）' },
                  ]}
                />
              </div>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                模型 ID
                <Input value={gModel} onChange={(e) => setGModel(e.target.value)} className="h-8 text-xs" />
              </label>
            </div>
            {gProvider === 'custom' && (
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                API Base URL
                <Input
                  value={gUrl}
                  onChange={(e) => setGUrl(e.target.value)}
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  className="h-8 text-xs"
                />
              </label>
            )}
            <div className="flex items-end gap-2">
              <label className="flex-1 flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                API Key（留空则保持已加密记住的旧 Key 不变）
                <Input
                  type="password"
                  value={gKey}
                  onChange={(e) => setGKey(e.target.value)}
                  placeholder={aiView?.general.hasKey ? '••••••••（已加密保存，重新输入可覆盖）' : 'sk-...'}
                  className="h-8 text-xs"
                />
              </label>
              <Button size="sm" disabled={pulling} onClick={() => void pullModels()}>
                <RefreshCw className={`w-3.5 h-3.5 ${pulling ? 'animate-spin' : ''}`} /> 拉取模型
              </Button>
            </div>
            {pulledModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                {pulledModels.slice(0, 30).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setGModel(m.id)}
                    className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer ${
                      gModel === m.id
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold'
                        : 'bg-[var(--bg-muted)] border-transparent'
                    }`}
                  >
                    {m.id}
                    {m.vision ? ' 👁' : ''}
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Optional Specialized Vision / Judge / OCR */}
          <Card className="p-3.5 flex flex-col gap-3">
            <h4 className="text-[13.5px] font-semibold">手写阅卷模型分工与辅助 OCR（可选）</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">阶段一：盲识图视觉模型 (VLM)</span>
                <Select
                  value={vMode}
                  onValueChange={(v) => setVMode(v as 'inherit' | 'custom')}
                  className="w-full"
                  options={[
                    { value: 'inherit', label: `跟随统一模型 (${gModel})` },
                    { value: 'custom', label: '单独指定视觉模型' },
                  ]}
                />
                {vMode === 'custom' && (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex flex-wrap gap-1">
                      {VISION_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            setVUrl(p.url);
                            setVModel(p.model);
                          }}
                          className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] cursor-pointer"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <Input value={vUrl} onChange={(e) => setVUrl(e.target.value)} placeholder="API URL" className="h-7 text-xs" />
                    <Input value={vModel} onChange={(e) => setVModel(e.target.value)} placeholder="模型 ID" className="h-7 text-xs" />
                    <Input type="password" value={vKey} onChange={(e) => setVKey(e.target.value)} placeholder="API Key（本机可空）" className="h-7 text-xs" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">辅助交叉核对 OCR（数字/单位标黄）</span>
                <Select
                  value={oMode}
                  onValueChange={(v) => setOMode(v as 'off' | 'vision-model' | 'http-ocr')}
                  className="w-full"
                  options={[
                    { value: 'off', label: '关闭（单路轻模式，封顶 82%）' },
                    { value: 'http-ocr', label: '本机/HTTP OCR（Pix2Text / PaddleOCR）' },
                    { value: 'vision-model', label: '独立视觉 OCR 模型' },
                  ]}
                />
                {oMode !== 'off' && (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <Input
                      value={oUrl}
                      onChange={(e) => setOUrl(e.target.value)}
                      placeholder={oMode === 'http-ocr' ? 'http://127.0.0.1:8500/ocr' : 'API URL'}
                      className="h-7 text-xs"
                    />
                    {oMode === 'vision-model' && (
                      <Input value={oModel} onChange={(e) => setOModel(e.target.value)} placeholder="OCR 模型 ID" className="h-7 text-xs" />
                    )}
                    <Input type="password" value={oKey} onChange={(e) => setOKey(e.target.value)} placeholder="Key（本机免填）" className="h-7 text-xs" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="primary" disabled={saving} onClick={() => void saveAiConfig()}>
                {saving ? '加密保存中…' : '保存并加密记住配置'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: Obsidian-Style Local Vault */}
      {tab === 'vault' && vaultInfo && (
        <div className="flex flex-col gap-4">
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-[var(--ink-muted)]">当前本地资料库文件夹</div>
                <div className="text-[14px] font-semibold mt-0.5 break-all">{vaultInfo.path}</div>
              </div>
              <Badge tone="ok">SQLite 单文件直存</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">数据库体积</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{formatBytes(vaultInfo.dbBytes)}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">答卷照片数</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{vaultInfo.photoCount} 张</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">照片占用空间</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{formatBytes(vaultInfo.photoBytes)}</div>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => void window.workbenchApi.vault.openInFinder()}>
                <FolderOpen className="w-4 h-4" /> 在访达 / 资源管理器中打开
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const next = await window.workbenchApi.vault.chooseFolder();
                  if (next) {
                    await onVaultChanged(next);
                    onNotify(`已切换资料库至：${next.path}`);
                  }
                }}
              >
                切换 / 新建资料库位置
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const res = await window.workbenchApi.vault.exportSnapshot();
                  if (res) onNotify(`整库备份已导出至：${res.path}`);
                }}
              >
                一键导出整库备份
              </Button>
            </div>
          </Card>
          <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
            提示：本资料库由 <code>workbench.sqlite</code> 与 <code>photos/</code> 组成，可直接拷入 U 盘或放进 iCloud / 坚果云同步。API 密钥独立加密保存在本机系统钥匙串中，同步资料库绝不会泄露密钥。
          </p>
        </div>
      )}
    </Modal>
  );
}
