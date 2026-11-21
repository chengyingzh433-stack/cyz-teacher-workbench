import { useState } from 'react';
import {
  AssistantConnection,
  DEEPSEEK_DEFAULTS,
  OCR_HTTP_PRESETS,
  OCR_MODEL_PRESETS,
  VISION_PRESETS,
  type ConnectionInput,
  type GradingRoleInput,
  type OcrConfigInput,
  type RemoteModelInfo,
} from '../modules/assistant/provider';
import { Modal, ErrorText } from './Modal';
import { Badge } from './Primitives';
import { Icon } from './Icons';

function ModelPullPanel({
  connection,
  url,
  keyValue,
  fallbackRole,
  currentModel,
  onSelect,
}: {
  connection: AssistantConnection;
  url: string;
  keyValue: string;
  fallbackRole: 'general' | 'vision' | 'judge' | 'ocr';
  currentModel: string;
  onSelect: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<RemoteModelInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [pullError, setPullError] = useState('');

  async function pull() {
    setLoading(true);
    setPullError('');
    try {
      const list = await connection.listModels({ url, key: keyValue, fallbackRole });
      setModels(list);
      setQuery('');
    } catch (e) {
      setPullError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = (models || []).filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row between">
        <button type="button" className="sm" disabled={loading || !url.trim()} onClick={() => void pull()}>
          <Icon name="refresh" size={12} />
          {loading ? '拉取中…' : models ? `重新拉取模型 (${models.length})` : '拉取可用模型'}
        </button>
        {models && <span className="tip">点击下方模型即填入，不用手敲</span>}
      </div>
      {pullError && <div className="text-danger" style={{ fontSize: 12.5 }}>{pullError}</div>}
      {models && (
        <div className="model-picker col" style={{ gap: 6 }}>
          {models.length > 6 && (
            <input
              type="search"
              placeholder="输入关键词筛选（如 vl / ocr / flash / pro）…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="model-list">
            {filtered.slice(0, 80).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`model-opt ${currentModel.trim() === m.id ? 'active' : ''}`}
                onClick={() => onSelect(m.id)}
              >
                <span className="row" style={{ gap: 6 }}>
                  <code>{m.id}</code>
                  {m.name && <span className="tip">{m.name}</span>}
                </span>
                {m.vision && <Badge tone="success">支持读图</Badge>}
              </button>
            ))}
            {!filtered.length && <span className="tip" style={{ padding: 6 }}>没有匹配「{query}」的模型</span>}
            {filtered.length > 80 && <span className="tip" style={{ padding: 6 }}>仅显示前 80 条，请输入关键词缩小范围</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistantSettings({
  connection,
  initialTab = 'general',
  close,
}: {
  connection: AssistantConnection;
  initialTab?: 'general' | 'grading';
  close: () => void;
}) {
  const [init] = useState(() => connection.view());
  const [gInit] = useState(() => connection.gradingView());
  const [tab, setTab] = useState<'general' | 'grading'>(initialTab);

  // Unified workbench model
  const [provider, setProvider] = useState<ConnectionInput['provider']>(init.provider);
  const [url, setUrl] = useState(init.provider === 'custom' ? init.url : '');
  const [model, setModel] = useState(init.model);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [hasKey, setHasKey] = useState(init.hasKey);
  const [generalDirty, setGeneralDirty] = useState(false);

  // Per-role grading overrides (default: inherit unified model)
  const [vision, setVision] = useState<GradingRoleInput>({
    mode: gInit.vision.mode,
    url: gInit.vision.url,
    model: gInit.vision.model,
    key: '',
  });
  const [judge, setJudge] = useState<GradingRoleInput>({
    mode: gInit.judge.mode,
    url: gInit.judge.url,
    model: gInit.judge.model,
    key: '',
  });
  const [ocr, setOcr] = useState<OcrConfigInput>({
    mode: gInit.ocr.mode,
    url: gInit.ocr.url,
    model: gInit.ocr.model,
    key: '',
  });
  const [gradingDirty, setGradingDirty] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const dirty = generalDirty || gradingDirty;
  const gView = connection.gradingView();
  const effectiveGeneralUrl = provider === 'deepseek' ? DEEPSEEK_DEFAULTS.url : url;
  const leave = () => { if (!dirty || window.confirm('设置尚未应用，确定关闭？')) close(); };

  const pick = (next: ConnectionInput['provider']) => {
    setProvider(next);
    setModel(next === 'deepseek' ? DEEPSEEK_DEFAULTS.model : '');
    setKey('');
    setNotice('');
    setError('');
    setGeneralDirty(true);
  };

  const save = () => {
    setError('');
    setNotice('');
    try {
      const shouldSaveGeneral = generalDirty || (tab === 'general' && (!!key.trim() || hasKey || provider === 'custom'));
      if (shouldSaveGeneral && (key.trim() || hasKey || (provider === 'custom' && /localhost|127\.0\.0\.1|\[::1\]/.test(url)))) {
        const v = connection.configure({ provider, url, model, key });
        setKey('');
        setHasKey(v.hasKey);
        setGeneralDirty(false);
      } else if (tab === 'general' && generalDirty) {
        const v = connection.configure({ provider, url, model, key });
        setKey('');
        setHasKey(v.hasKey);
        setGeneralDirty(false);
      }
      if (gradingDirty || tab === 'grading') {
        connection.configureGrading({ vision, judge, ocr });
        setVision((v) => ({ ...v, key: '' }));
        setJudge((v) => ({ ...v, key: '' }));
        setOcr((v) => ({ ...v, key: '' }));
        setGradingDirty(false);
      }
      setNotice('已应用于本次会话！可用于「成绩册分析」AI 问数与「答卷批阅」智能识图打分。');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renderRoleCard = (
    roleKey: 'vision' | 'judge',
    title: string,
    desc: string,
    role: GradingRoleInput,
    hasSavedKey: boolean,
    setRole: (next: GradingRoleInput) => void,
    showVisionPresets: boolean,
  ) => (
    <div className="soft-card col" style={{ gap: 10 }}>
      <div className="row between">
        <div>
          <strong style={{ fontSize: 13.5 }}>{title}</strong>
          <div className="tip">{desc}</div>
        </div>
        <div className="btn-group" role="group" aria-label={title}>
          <button
            type="button"
            className={role.mode === 'inherit' ? 'active' : ''}
            onClick={() => { setRole({ ...role, mode: 'inherit' }); setGradingDirty(true); }}
          >
            跟随统一模型
          </button>
          <button
            type="button"
            className={role.mode === 'custom' ? 'active' : ''}
            onClick={() => { setRole({ ...role, mode: 'custom' }); setGradingDirty(true); }}
          >
            单独自定义
          </button>
        </div>
      </div>

      {role.mode === 'inherit' ? (
        <div className="row between">
          <span className="tip">
            当前复用统一模型：<code>{model || DEEPSEEK_DEFAULTS.model}</code>
          </span>
          {showVisionPresets && provider === 'deepseek' && model.trim() === 'deepseek-flash' && (
            <Badge tone="success">DeepSeek-V4.1-Flash 原生支持读图</Badge>
          )}
          {showVisionPresets && provider === 'deepseek' && model.trim() === 'deepseek-v4-pro' && (
            <Badge tone="warning">deepseek-v4-pro 为纯文本模型，识图请改用 deepseek-flash 或自定义视觉模型</Badge>
          )}
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {showVisionPresets && (
            <div className="row" style={{ gap: 6 }}>
              <span className="tip">常用视觉预设：</span>
              {VISION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="sm"
                  onClick={() => {
                    setRole({ ...role, url: p.url, model: p.model });
                    setGradingDirty(true);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <label className="tight">
              API 地址
              <input
                placeholder="https://example.com/v1"
                autoComplete="off"
                value={role.url}
                onChange={(e) => { setRole({ ...role, url: e.target.value }); setGradingDirty(true); }}
              />
            </label>
            <label className="tight">
              模型 ID
              <input
                placeholder={showVisionPresets ? '如 qwen3-vl-plus / deepseek-flash' : '如 deepseek-flash'}
                value={role.model}
                maxLength={120}
                onChange={(e) => { setRole({ ...role, model: e.target.value }); setGradingDirty(true); }}
              />
            </label>
          </div>
          <label className="tight">
            <span>API Key {hasSavedKey && <Badge tone="success">已保存</Badge>}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasSavedKey ? '已就绪；同地址留空保留原 Key（本机 Ollama 可留空）' : '粘贴 API Key（本机 localhost 可留空）'}
              value={role.key}
              onChange={(e) => { setRole({ ...role, key: e.target.value }); setGradingDirty(true); }}
            />
          </label>
          <ModelPullPanel
            connection={connection}
            url={role.url}
            keyValue={role.key}
            fallbackRole={roleKey}
            currentModel={role.model}
            onSelect={(id) => { setRole({ ...role, model: id }); setGradingDirty(true); }}
          />
          {role.url.includes('volces.com') && (
            <span className="tip">提示：火山方舟若直接填模型名报错，请点上方「拉取可用模型」或填写控制台「推理接入点 ID（ep-...）」。</span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      title="AI 模型连接设置"
      subtitle="一次配置全站统一复用；也可在「阅卷分工与 OCR」中按阶段单独指定模型"
      wide
      onClose={leave}
      footer={
        <div className="row between" style={{ width: '100%' }}>
          <button
            type="button"
            disabled={!hasKey && !key && !gView.vision.hasKey && !gView.judge.hasKey && !gView.ocr.hasKey}
            onClick={() => {
              connection.clear();
              setKey('');
              setHasKey(false);
              setVision((v) => ({ ...v, key: '' }));
              setJudge((v) => ({ ...v, key: '' }));
              setOcr((v) => ({ ...v, key: '' }));
              setGeneralDirty(false);
              setGradingDirty(false);
              setNotice('本次会话的全部模型 Key 已清除。');
            }}
          >
            清除全部 Key
          </button>
          <div className="row">
            <button type="button" onClick={leave}>关闭</button>
            <button type="button" className="primary" onClick={save}>
              <Icon name="sparkles" size={14} />应用到本次会话
            </button>
          </div>
        </div>
      }
    >
      <div className="col">
        <div className="grid-2" role="tablist" aria-label="AI 模型设置分类">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'general'}
            className={`stage-tab ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >
            <strong>1. 工作台统一模型</strong>
            <small>{hasKey ? `已就绪 · ${model}` : '成绩册问数与阅卷默认共享'}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'grading'}
            className={`stage-tab ${tab === 'grading' ? 'active' : ''}`}
            onClick={() => setTab('grading')}
          >
            <strong>2. 智能阅卷分工与 OCR</strong>
            <small>
              识图:{vision.mode === 'inherit' ? '统一' : vision.model || '自定义'} · 采分:{judge.mode === 'inherit' ? '统一' : judge.model || '自定义'} · OCR:{ocr.mode === 'off' ? '关' : '开'}
            </small>
          </button>
        </div>

        {tab === 'general' ? (
          <div className="col">
            <div className="grid-2">
              <button type="button" className={`choice-card ${provider === 'deepseek' ? 'selected' : ''}`} aria-pressed={provider === 'deepseek'} onClick={() => pick('deepseek')}>
                <div className="row between" style={{ width: '100%' }}><strong>DeepSeek 官方</strong><Badge tone="success">推荐 · 原生多模态</Badge></div>
                <span>默认 <code>deepseek-flash</code>（即 DeepSeek-V4.1-Flash），支持问数与读图阅卷</span>
              </button>
              <button type="button" className={`choice-card ${provider === 'custom' ? 'selected' : ''}`} aria-pressed={provider === 'custom'} onClick={() => pick('custom')}>
                <div className="row between" style={{ width: '100%' }}><strong>自定义兼容接口</strong><Badge>通用</Badge></div>
                <span>支持阿里云百炼 / 硅基流动 / 智谱 / 火山方舟 / 本机 Ollama</span>
              </button>
            </div>

            {provider === 'deepseek' ? (
              <div className="soft-card col" style={{ gap: 8 }}>
                <div className="row between">
                  <div style={{ fontSize: 13 }}>
                    官方地址：<code>{DEEPSEEK_DEFAULTS.url}</code> · 推荐模型：<code>{DEEPSEEK_DEFAULTS.model}</code>
                  </div>
                  <Badge tone="success">{DEEPSEEK_DEFAULTS.displayName}</Badge>
                </div>
                <span className="tip">
                  官网 <strong>DeepSeek-V4.1-Flash</strong>（版本 1017）的官方 API 模型 ID 就是 <code>deepseek-flash</code>（原生支持图文），无需填写完整版本号。
                </span>
                <label className="tight">
                  <span>模型 ID（支持拉取账号当前全部可用模型）</span>
                  <input value={model} maxLength={120} onChange={(e) => { setModel(e.target.value); setGeneralDirty(true); }} />
                </label>
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="tip">官方兼容地址预设：</span>
                  {VISION_PRESETS.map((p) => (
                    <button key={p.id} type="button" className="sm" onClick={() => { setUrl(p.url); setModel(p.model); setGeneralDirty(true); }}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="form-row">
                  <label className="tight">API 地址<input placeholder="https://example.com/v1" autoComplete="off" value={url} onChange={(e) => { setUrl(e.target.value); setGeneralDirty(true); }} /></label>
                  <label className="tight">模型 ID<input value={model} maxLength={120} placeholder="填好地址与 Key 后可点下方拉取" onChange={(e) => { setModel(e.target.value); setGeneralDirty(true); }} /></label>
                </div>
              </div>
            )}

            <label className="tight">
              <span>API Key {hasKey && <Badge tone="success">已就绪</Badge>}</span>
              <div className="pw-wrap">
                <input
                  type={show ? 'text' : 'password'}
                  value={key}
                  maxLength={500}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? '当前会话已有 Key；同一服务留空可保留' : '粘贴服务商 API Key（本机 localhost 可留空）'}
                  onChange={(e) => { setKey(e.target.value); setGeneralDirty(true); setNotice(''); }}
                />
                <button type="button" className="ghost" aria-label={show ? '隐藏 Key' : '显示 Key'} onClick={() => setShow((v) => !v)}>
                  <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
                </button>
              </div>
            </label>

            <ModelPullPanel
              connection={connection}
              url={effectiveGeneralUrl}
              keyValue={key}
              fallbackRole="general"
              currentModel={model}
              onSelect={(id) => { setModel(id); setGeneralDirty(true); }}
            />
          </div>
        ) : (
          <div className="col">
            {renderRoleCard(
              'vision',
              '阶段一 · 盲识图多模态模型（VLM）',
              '负责无答案干扰地复原学生手写文字与公式，须支持图片输入',
              vision,
              gView.vision.hasKey,
              setVision,
              true,
            )}
            {renderRoleCard(
              'judge',
              '阶段二 · 得分点采纳模型',
              '根据复原文本对照得分点逐条采分，纯文本推理模型即可（便宜且稳）',
              judge,
              gView.judge.hasKey,
              setJudge,
              false,
            )}
            <div className="soft-card col" style={{ gap: 10 }}>
              <div className="row between">
                <div>
                  <strong style={{ fontSize: 13.5 }}>路 B · 辅助交叉核对 OCR（可选）</strong>
                  <div className="tip">独立核对数字、小数点与物理单位；开启后置信度可突破 82% 上限</div>
                </div>
                <div className="btn-group" role="group" aria-label="辅助 OCR 模式">
                  {([
                    ['off', '关闭'],
                    ['vision-model', '独立 OCR 模型'],
                    ['http-ocr', '本地 / HTTP OCR'],
                  ] as const).map(([m, lbl]) => (
                    <button
                      key={m}
                      type="button"
                      className={ocr.mode === m ? 'active' : ''}
                      onClick={() => { setOcr({ ...ocr, mode: m }); setGradingDirty(true); }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {ocr.mode === 'off' ? (
                <span className="tip">当前关闭 OCR：单 VLM 轻模式仍可正常识图打分，但客观置信度硬封顶 82% 以防数字幻觉。</span>
              ) : ocr.mode === 'vision-model' ? (
                <div className="col" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="tip">常用 OCR 预设：</span>
                    {OCR_MODEL_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="sm"
                        onClick={() => {
                          setOcr({ ...ocr, url: p.url, model: p.model });
                          setGradingDirty(true);
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="form-row">
                    <label className="tight">OCR 模型 API 地址<input placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" value={ocr.url} onChange={(e) => { setOcr({ ...ocr, url: e.target.value }); setGradingDirty(true); }} /></label>
                    <label className="tight">OCR 模型 ID<input placeholder="如 qwen-vl-ocr / deepseek-ai/DeepSeek-OCR" value={ocr.model} onChange={(e) => { setOcr({ ...ocr, model: e.target.value }); setGradingDirty(true); }} /></label>
                  </div>
                  <label className="tight">
                    <span>API Key {gView.ocr.hasKey && <Badge tone="success">已保存</Badge>}</span>
                    <input type="password" autoComplete="off" placeholder={gView.ocr.hasKey ? '留空保留原 Key' : '粘贴 OCR 模型 Key（本机 Ollama 可留空）'} value={ocr.key} onChange={(e) => { setOcr({ ...ocr, key: e.target.value }); setGradingDirty(true); }} />
                  </label>
                  <ModelPullPanel
                    connection={connection}
                    url={ocr.url}
                    keyValue={ocr.key}
                    fallbackRole="ocr"
                    currentModel={ocr.model}
                    onSelect={(id) => { setOcr({ ...ocr, model: id }); setGradingDirty(true); }}
                  />
                  {ocr.model.trim() &&
                    ocr.model.trim() === (vision.mode === 'custom' ? vision.model.trim() : model.trim()) && (
                      <div className="tip">提示：当前 OCR 与阶段一视觉模型相同，建议选用不同厂家或专用 OCR 模型（如 qwen-vl-ocr / DeepSeek-OCR），交叉防幻觉效果更佳。</div>
                    )}
                </div>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="tip">常用本机预设：</span>
                    {OCR_HTTP_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="sm"
                        onClick={() => {
                          setOcr({ ...ocr, url: p.url });
                          setGradingDirty(true);
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="form-row">
                    <label className="tight">HTTP OCR 地址（支持 Pix2Text / PaddleOCR 本机或云端接口）<input placeholder="http://127.0.0.1:8500/ocr" value={ocr.url} onChange={(e) => { setOcr({ ...ocr, url: e.target.value }); setGradingDirty(true); }} /></label>
                    <label className="tight">鉴权 Token（选填）<input type="password" autoComplete="off" placeholder="本机无鉴权可留空" value={ocr.key} onChange={(e) => { setOcr({ ...ocr, key: e.target.value }); setGradingDirty(true); }} /></label>
                  </div>
                  <span className="tip">以 JSON POST 发送 <code>{`{ image, image_base64 }`}</code>，自动解析返回体中的 <code>text / markdown / results</code>。</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="alert tone-info">
          <Icon name="shield" size={16} />
          <span>所有 API Key 仅保存在当前页面内存，刷新或关闭即清空，绝不写入数据库、导出报告或备份文件。</span>
        </div>
        <ErrorText message={error} />
        {notice && <div role="status" className="alert tone-success">{notice}</div>}
      </div>
    </Modal>
  );
}
