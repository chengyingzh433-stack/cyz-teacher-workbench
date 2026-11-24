import { useEffect, useState } from 'react';
import {
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { AiConfigView, RemoteModelInfo } from '../../shared/types';
import {
  AI_PLATFORM_LINKS,
  AI_PRESETS,
  DEEPSEEK_DEFAULTS,
  findPlatformLinkForUrl,
} from '../../shared/ai-presets';
import { Badge, Button, Card, Input, Select } from './ui/primitives';

function ExternalPlatformLink({
  label,
  url,
  onOpen,
}: {
  label: string;
  url: string;
  onOpen: (url: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      title={url}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--accent-soft)]/70 text-[var(--accent)] hover:bg-[var(--accent-soft)] border border-[var(--accent)]/20 cursor-pointer transition-colors"
    >
      {label}
      <ExternalLink className="w-3 h-3 shrink-0" />
    </button>
  );
}

function RoleModelPuller({
  url,
  keyValue,
  fallbackRole,
  currentModel,
  onSelectModel,
  onNotify,
}: {
  url: string;
  keyValue: string;
  fallbackRole: 'general' | 'vision' | 'judge' | 'ocr';
  currentModel: string;
  onSelectModel: (id: string) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [pulling, setPulling] = useState(false);
  const [models, setModels] = useState<RemoteModelInfo[]>([]);
  const [query, setQuery] = useState('');

  async function pull() {
    if (!url.trim()) {
      onNotify('请先填入 API 地址或点击上方常用平台预设', 'err');
      return;
    }
    setPulling(true);
    try {
      const list = await window.workbenchApi.ai.listModels({
        url,
        key: keyValue || undefined,
        fallbackRole,
      });
      setModels(list);
      setQuery('');
      onNotify(`成功拉取 ${list.length} 个可用模型`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setPulling(false);
    }
  }

  const filtered = models.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button size="xs" variant="soft" disabled={pulling || !url.trim()} onClick={() => void pull()}>
          <RefreshCw className={`w-3 h-3 ${pulling ? 'animate-spin' : ''}`} />
          {pulling ? '拉取中…' : models.length ? `重新拉取 (${models.length})` : '拉取可用模型'}
        </Button>
        {models.length > 6 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选关键词（如 vl / ocr / deepseek）…"
            className="h-6 text-[11px] flex-1"
          />
        )}
      </div>
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-0.5">
          {filtered.slice(0, 40).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectModel(m.id)}
              className={`px-2 py-0.5 rounded-md text-[11px] border cursor-pointer ${
                currentModel.trim() === m.id
                  ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold'
                  : 'bg-[var(--bg-muted)] border-transparent hover:border-[var(--border-strong)]'
              }`}
            >
              {m.id}
              {m.vision ? ' 👁' : ''}
            </button>
          ))}
          {!filtered.length && (
            <span className="text-[11px] text-[var(--ink-muted)]">无匹配「{query}」的模型</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AiSettingsTab({
  open,
  onNotify,
}: {
  open: boolean;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [aiView, setAiView] = useState<AiConfigView | null>(null);

  const [gProvider, setGProvider] = useState<'deepseek' | 'custom'>('deepseek');
  const [gUrl, setGUrl] = useState<string>(DEEPSEEK_DEFAULTS.url);
  const [gModel, setGModel] = useState<string>(DEEPSEEK_DEFAULTS.model);
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

  const [d2xEnabled, setD2xEnabled] = useState(false);
  const [d2xKey, setD2xKey] = useState('');
  const [saving, setSaving] = useState(false);

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
      setD2xEnabled(Boolean(cfg.doc2x?.enabled));
      setD2xKey('');
    });
  }, [open]);

  function openExternalUrl(url: string) {
    window.workbenchApi.openExternal(url).catch((e) => {
      onNotify((e as Error).message, 'err');
    });
  }

  async function saveAiConfig() {
    setSaving(true);
    try {
      const updated = await window.workbenchApi.ai.saveConfig({
        general: { provider: gProvider, url: gUrl, model: gModel, key: gKey || undefined },
        vision: { mode: vMode, url: vUrl, model: vModel, key: vKey || undefined },
        judge: { mode: jMode, url: jUrl, model: jModel, key: jKey || undefined },
        ocr: { mode: oMode, url: oUrl, model: oModel, key: oKey || undefined },
        doc2x: { enabled: d2xEnabled, key: d2xKey || undefined },
      });
      setAiView(updated);
      setGKey('');
      setVKey('');
      setJKey('');
      setOKey('');
      setD2xKey('');
      onNotify('AI 配置已通过系统钥匙串安全加密保存！全站所有模块已同步生效');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  const effectiveGeneralUrl = gProvider === 'deepseek' ? DEEPSEEK_DEFAULTS.url : gUrl;
  const effectiveVisionModel = vMode === 'custom' ? vModel.trim() : gModel.trim();
  const visionPlatform = findPlatformLinkForUrl(vUrl);
  const judgePlatform = findPlatformLinkForUrl(jUrl);
  const ocrPlatform = findPlatformLinkForUrl(oUrl);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Unified Keychain Banner */}
      <div className="p-3 rounded-xl bg-[var(--ok-soft)] text-[var(--ok)] text-xs flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            {aiView?.secureStorageAvailable
              ? '系统钥匙串加密已开启：所有 API Key 经系统原生加密保存于本机，绝不写入资料库文件夹。'
              : 'API Key 保存于本机用户私有配置目录，绝不写入资料库文件夹。'}
          </span>
          <span className="text-[11px] opacity-90 pl-5">
            全站统一配置：智学网伴侣 AI 阅卷、学情助教、物理题库识图与带班素材均直接复用此处模型，无需重复配置。
          </span>
        </div>
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

      {/* Card 1: Unified Default Model */}
      <Card className="p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-[var(--accent)]" /> 统一默认模型（全站默认复用）
          </h4>
          {aiView?.general.hasKey && <Badge tone="ok">已加密记住 Key</Badge>}
        </div>

        {/* One-click platform presets */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] text-[var(--ink-muted)] shrink-0">一键填入常用平台：</span>
            {AI_PRESETS.general.map((p) => {
              const active =
                (p.provider === 'deepseek' && gProvider === 'deepseek') ||
                (p.provider === 'custom' && gProvider === 'custom' && gUrl.trim() === p.url);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setGProvider(p.provider);
                    setGUrl(p.url);
                    setGModel(p.model);
                  }}
                  className={`text-[11px] px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold'
                      : 'bg-[var(--bg-muted)] border-transparent hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] text-[var(--ink-muted)] shrink-0">申请 API Key 直达：</span>
            {(['deepseek', 'siliconflow', 'dashscope', 'zhipu', 'volcengine', 'ollama'] as const).map((k) => {
              const link = AI_PLATFORM_LINKS[k];
              return (
                <ExternalPlatformLink
                  key={link.id}
                  label={link.label}
                  url={link.url}
                  onOpen={openExternalUrl}
                />
              );
            })}
          </div>
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
                  setGUrl(DEEPSEEK_DEFAULTS.url);
                  setGModel(DEEPSEEK_DEFAULTS.model);
                }
              }}
              className="w-full"
              options={[
                { value: 'deepseek', label: 'DeepSeek 官方' },
                { value: 'custom', label: '自定义 OpenAI 兼容接口（硅基流动 / 百炼 / Ollama 等）' },
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
              placeholder="如 https://api.siliconflow.cn/v1 或 https://dashscope.aliyuncs.com/compatible-mode/v1"
              className="h-8 text-xs"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
          API Key（留空则保持已加密记住的旧 Key 不变）
          <Input
            type="password"
            value={gKey}
            onChange={(e) => setGKey(e.target.value)}
            placeholder={aiView?.general.hasKey ? '••••••••（已加密保存，重新输入可覆盖）' : 'sk-...'}
            className="h-8 text-xs"
          />
        </label>

        <RoleModelPuller
          url={effectiveGeneralUrl}
          keyValue={gKey}
          fallbackRole="general"
          currentModel={gModel}
          onSelectModel={setGModel}
          onNotify={onNotify}
        />
      </Card>

      {/* Card 2: Specialized Vision / Judge / OCR / Doc2X */}
      <Card className="p-3.5 flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h4 className="text-[13.5px] font-semibold">AI 阅卷模型分工与辅助 OCR（智学网伴侣共用 · 可选）</h4>
            <p className="text-[11px] text-[var(--ink-muted)] mt-0.5">
              建议：阶段一选强视觉模型（如百炼 Qwen-VL / 硅基 Qwen2.5-VL）盲读答卷，阶段二用 DeepSeek 严格按得分点判分，并开启辅助 OCR 防数字/单位幻觉。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Stage 1: Vision Model */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold">阶段一：盲识图视觉模型 (VLM)</span>
              {vMode === 'custom' && aiView?.vision.hasKey && <Badge tone="ok">已存 Key</Badge>}
            </div>
            <Select
              value={vMode}
              onValueChange={(v) => setVMode(v as 'inherit' | 'custom')}
              className="w-full"
              options={[
                { value: 'inherit', label: `跟随统一模型 (${gModel})` },
                { value: 'custom', label: '单独指定视觉模型（推荐读图用）' },
              ]}
            />
            {vMode === 'custom' && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <div className="flex flex-wrap gap-1">
                  {AI_PRESETS.vision.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setVUrl(p.url);
                        setVModel(p.model);
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer ${
                        vUrl.trim() === p.url && vModel.trim() === p.model
                          ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium'
                          : 'bg-[var(--bg-muted)] border-transparent hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center flex-wrap gap-1">
                  {visionPlatform ? (
                    <ExternalPlatformLink
                      label={`去 ${visionPlatform.label} 获取 Key`}
                      url={visionPlatform.url}
                      onOpen={openExternalUrl}
                    />
                  ) : (
                    <>
                      <ExternalPlatformLink
                        label="硅基流动"
                        url={AI_PLATFORM_LINKS.siliconflow.url}
                        onOpen={openExternalUrl}
                      />
                      <ExternalPlatformLink
                        label="阿里云百炼"
                        url={AI_PLATFORM_LINKS.dashscope.url}
                        onOpen={openExternalUrl}
                      />
                    </>
                  )}
                </div>
                <Input
                  value={vUrl}
                  onChange={(e) => setVUrl(e.target.value)}
                  placeholder="API URL（点上方预设自动填入）"
                  className="h-7 text-xs"
                />
                <Input
                  value={vModel}
                  onChange={(e) => setVModel(e.target.value)}
                  placeholder="视觉模型 ID（如 qwen-vl-max）"
                  className="h-7 text-xs"
                />
                <Input
                  type="password"
                  value={vKey}
                  onChange={(e) => setVKey(e.target.value)}
                  placeholder={aiView?.vision.hasKey ? '••••••••（已加密保存，留空不变）' : 'API Key（本机 Ollama 可空）'}
                  className="h-7 text-xs"
                />
                <RoleModelPuller
                  url={vUrl}
                  keyValue={vKey}
                  fallbackRole="vision"
                  currentModel={vModel}
                  onSelectModel={setVModel}
                  onNotify={onNotify}
                />
              </div>
            )}
          </div>

          {/* Stage 2: Judge Model */}
          <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold">阶段二：得分点判分推理模型</span>
              {jMode === 'custom' && aiView?.judge.hasKey && <Badge tone="ok">已存 Key</Badge>}
            </div>
            <Select
              value={jMode}
              onValueChange={(v) => setJMode(v as 'inherit' | 'custom')}
              className="w-full"
              options={[
                { value: 'inherit', label: `跟随统一模型 (${gModel})` },
                { value: 'custom', label: '单独指定推理判分模型' },
              ]}
            />
            {jMode === 'custom' && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <div className="flex flex-wrap gap-1">
                  {AI_PRESETS.judge.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setJUrl(p.url);
                        setJModel(p.model);
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer ${
                        jUrl.trim() === p.url && jModel.trim() === p.model
                          ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium'
                          : 'bg-[var(--bg-muted)] border-transparent hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center flex-wrap gap-1">
                  {judgePlatform ? (
                    <ExternalPlatformLink
                      label={`去 ${judgePlatform.label} 获取 Key`}
                      url={judgePlatform.url}
                      onOpen={openExternalUrl}
                    />
                  ) : (
                    <>
                      <ExternalPlatformLink
                        label="DeepSeek 开放平台"
                        url={AI_PLATFORM_LINKS.deepseek.url}
                        onOpen={openExternalUrl}
                      />
                      <ExternalPlatformLink
                        label="硅基流动"
                        url={AI_PLATFORM_LINKS.siliconflow.url}
                        onOpen={openExternalUrl}
                      />
                    </>
                  )}
                </div>
                <Input
                  value={jUrl}
                  onChange={(e) => setJUrl(e.target.value)}
                  placeholder="API URL（点上方预设自动填入）"
                  className="h-7 text-xs"
                />
                <Input
                  value={jModel}
                  onChange={(e) => setJModel(e.target.value)}
                  placeholder="判分模型 ID（如 deepseek-chat）"
                  className="h-7 text-xs"
                />
                <Input
                  type="password"
                  value={jKey}
                  onChange={(e) => setJKey(e.target.value)}
                  placeholder={aiView?.judge.hasKey ? '••••••••（已加密保存，留空不变）' : 'API Key（本机可空）'}
                  className="h-7 text-xs"
                />
                <RoleModelPuller
                  url={jUrl}
                  keyValue={jKey}
                  fallbackRole="judge"
                  currentModel={jModel}
                  onSelectModel={setJModel}
                  onNotify={onNotify}
                />
              </div>
            )}
          </div>
        </div>

        {/* Auxiliary Cross-Check OCR */}
        <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <span className="text-xs font-semibold">辅助交叉核对 OCR（数字/单位分歧标黄防幻觉）</span>
              <span className="text-[11px] text-[var(--ink-muted)] ml-2">
                {oMode === 'off' ? '未开启时客观置信度上限 82%' : '双路核对数字、小数点、正负号与物理单位'}
              </span>
            </div>
            {oMode !== 'off' && aiView?.ocr.hasKey && <Badge tone="ok">已存 Key</Badge>}
          </div>

          <Select
            value={oMode}
            onValueChange={(v) => setOMode(v as 'off' | 'vision-model' | 'http-ocr')}
            className="w-full"
            options={[
              { value: 'off', label: '关闭（单路轻模式，置信度封顶 82%）' },
              { value: 'vision-model', label: '独立视觉 OCR 模型（推荐：硅基 DeepSeek-OCR / 百炼 qwen-vl-ocr）' },
              { value: 'http-ocr', label: '本机/HTTP OCR 服务（Pix2Text / PaddleOCR）' },
            ]}
          />

          {oMode === 'vision-model' && (
            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[11px] text-[var(--ink-muted)] shrink-0">推荐 OCR 预设：</span>
                {AI_PRESETS.ocrModel.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setOUrl(p.url);
                      setOModel(p.model);
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer ${
                      oUrl.trim() === p.url && oModel.trim() === p.model
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium'
                        : 'bg-[var(--bg-muted)] border-transparent hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[11px] text-[var(--ink-muted)] shrink-0">去平台申请 Key：</span>
                {ocrPlatform && (
                  <ExternalPlatformLink
                    label={`当前：${ocrPlatform.label}`}
                    url={ocrPlatform.url}
                    onOpen={openExternalUrl}
                  />
                )}
                {(['siliconflow', 'dashscope', 'zhipu', 'ollama'] as const)
                  .filter((k) => k !== ocrPlatform?.id)
                  .map((k) => {
                    const link = AI_PLATFORM_LINKS[k];
                    return (
                      <ExternalPlatformLink
                        key={link.id}
                        label={link.label}
                        url={link.url}
                        onOpen={openExternalUrl}
                      />
                    );
                  })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  value={oUrl}
                  onChange={(e) => setOUrl(e.target.value)}
                  placeholder="API URL（如 https://api.siliconflow.cn/v1）"
                  className="h-7 text-xs"
                />
                <Input
                  value={oModel}
                  onChange={(e) => setOModel(e.target.value)}
                  placeholder="OCR 模型 ID（如 deepseek-ai/DeepSeek-OCR）"
                  className="h-7 text-xs"
                />
              </div>
              <Input
                type="password"
                value={oKey}
                onChange={(e) => setOKey(e.target.value)}
                placeholder={aiView?.ocr.hasKey ? '••••••••（已加密保存，留空不变）' : 'OCR 模型 API Key（本机 Ollama 免填）'}
                className="h-7 text-xs"
              />
              <RoleModelPuller
                url={oUrl}
                keyValue={oKey}
                fallbackRole="ocr"
                currentModel={oModel}
                onSelectModel={setOModel}
                onNotify={onNotify}
              />
              {oModel.trim() && oModel.trim() === effectiveVisionModel && (
                <div className="text-[11px] text-[var(--warn)]">
                  提示：当前 OCR 模型与阶段一视觉模型相同，建议换用不同模型（如 DeepSeek-OCR 或 qwen-vl-ocr），交叉防幻觉更准。
                </div>
              )}
            </div>
          )}

          {oMode === 'http-ocr' && (
            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[11px] text-[var(--ink-muted)] shrink-0">常用本机地址：</span>
                {AI_PRESETS.ocrHttp.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOUrl(p.url)}
                    className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer ${
                      oUrl.trim() === p.url
                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium'
                        : 'bg-[var(--bg-muted)] border-transparent hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <ExternalPlatformLink
                  label={AI_PLATFORM_LINKS.pix2text.label}
                  url={AI_PLATFORM_LINKS.pix2text.url}
                  onOpen={openExternalUrl}
                />
                <ExternalPlatformLink
                  label={AI_PLATFORM_LINKS.paddleocr.label}
                  url={AI_PLATFORM_LINKS.paddleocr.url}
                  onOpen={openExternalUrl}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  value={oUrl}
                  onChange={(e) => setOUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8500/ocr"
                  className="h-7 text-xs"
                />
                <Input
                  type="password"
                  value={oKey}
                  onChange={(e) => setOKey(e.target.value)}
                  placeholder="鉴权 Token（本机免填）"
                  className="h-7 text-xs"
                />
              </div>
              <div className="text-[11px] text-[var(--ink-muted)]">
                以 JSON POST 发送 <code>{`{ image, image_base64 }`}</code>，自动解析返回体中的 <code>text / markdown / results</code>。
              </div>
            </div>
          )}
        </div>

        {/* Physics Question Bank Doc2X */}
        <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                <span>物理题库增强公式 OCR：Doc2X（可选）</span>
                {aiView?.doc2x?.hasKey && <Badge tone="ok">已存 Key</Badge>}
                <ExternalPlatformLink
                  label="去 Doc2X 官网获取 Key"
                  url={AI_PLATFORM_LINKS.doc2x.url}
                  onOpen={openExternalUrl}
                />
              </div>
              <div className="text-[11px] text-[var(--ink-muted)] mt-0.5">
                题库默认直接复用上方视觉模型转写公式；如需 Doc2X 专业版面解析，可在此按需开启（绝不自动上传）
              </div>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={d2xEnabled}
                onChange={(e) => setD2xEnabled(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              启用 Doc2X
            </label>
          </div>
          {d2xEnabled && (
            <Input
              type="password"
              value={d2xKey}
              onChange={(e) => setD2xKey(e.target.value)}
              placeholder={
                aiView?.doc2x?.hasKey
                  ? '••••••••（已加密记住 Doc2X Key，留空保持不变）'
                  : 'sk-...（Doc2X API Key）'
              }
              className="h-8 text-xs"
            />
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="primary" disabled={saving} onClick={() => void saveAiConfig()}>
            {saving ? '加密保存中…' : '保存并加密记住配置'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
