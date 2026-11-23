import { useEffect, useState } from 'react';
import {
  Check,
  Columns2,
  History,
  Plus,
  RotateCcw,
  Save,
  ScanEye,
  ShoppingBasket,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  qbankAssetUrl,
  type ContentRevisionDTO,
  type EditableDocument,
  type QuestionAssetDTO,
} from '../../../shared/qbank/editable';
import type {
  EditableQuestionDTO,
  QbankOcrJobDTO,
  QbankOcrProvider,
  QbankTaxonomyDTO,
  QuestionMetadataInput,
} from '../../../shared/qbank/types';
import { Badge, Button, Card, Input, Modal, Select } from '../../components/ui/primitives';
import { RichMathEditor } from './RichMathEditor';

/** Lazily mounted ONLY when teacher clicks "AI / OCR 识图转写" — zero passive keychain queries! */
function LazyOcrModal({
  open,
  onOpenChange,
  questionId,
  part,
  hasOriginalImage,
  onAdopted,
  onOpenAiSettings,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: number;
  part: 'question' | 'answer';
  hasOriginalImage: boolean;
  onAdopted: (updated: EditableQuestionDTO) => void;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [provider, setProvider] = useState<QbankOcrProvider>('workbench-ai');
  const [jobs, setJobs] = useState<QbankOcrJobDTO[]>([]);
  const [running, setRunning] = useState(false);
  const [customBytes, setCustomBytes] = useState<number[] | null>(null);
  const [customName, setCustomName] = useState('');
  const [doc2xReady, setDoc2xReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.workbenchApi.qbank.ocr.listJobs(questionId, part).then(setJobs);
    void window.workbenchApi.ai.getConfig().then((cfg) => setDoc2xReady(Boolean(cfg.doc2x?.ready)));
  }, [open, questionId, part]);

  async function runRecognition() {
    setRunning(true);
    try {
      const job = await window.workbenchApi.qbank.ocr.run({
        questionId,
        part,
        provider,
        imageBytes: customBytes,
      });
      setJobs((prev) => [job, ...prev.filter((x) => x.id !== job.id)]);
      if (job.status === 'ready') {
        onNotify('识图转写完成，请审核下方识别文本后再点击「采纳到编辑区」');
      } else if (job.error) {
        onNotify(job.error, 'err');
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`AI / OCR 识图转写（${part === 'answer' ? '参考答案' : '题干正文'}）`}
      subtitle="严格由教师手动触发：优先复用工作台已配置的视觉 AI 模型，也可按需选用 Doc2X 通道"
      size="lg"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-[var(--bg-muted)]/70">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">识别通道</span>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as QbankOcrProvider)}
              options={[
                { value: 'workbench-ai', label: '工作台统一 AI 视觉模型（推荐默认）' },
                {
                  value: 'doc2x',
                  label: doc2xReady ? 'Doc2X 专业版面 OCR（已就绪）' : 'Doc2X 专业版面 OCR（需先在设置配置）',
                },
              ]}
            />
          </div>
          <Button size="xs" variant="ghost" onClick={onOpenAiSettings}>
            打开 AI / Doc2X 设置
          </Button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> {customName ? `已选：${customName}` : '上传临时识别截图（可选）'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setCustomBytes(Array.from(new Uint8Array(await f.arrayBuffer())));
                  setCustomName(f.name);
                }}
              />
            </label>
            {!customBytes && (
              <span className="text-[var(--ink-muted)]">
                {hasOriginalImage ? '将使用本题已保存的原题图快照' : '本题无原图快照，请先上传截图'}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={running || (!hasOriginalImage && !customBytes)}
            onClick={() => void runRecognition()}
          >
            <Sparkles className="w-4 h-4" /> {running ? '正在识别转写…' : '确认并开始识别'}
          </Button>
        </div>

        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--ink-muted)]">
              暂无识别记录。点击上方「确认并开始识别」生成可人工审核的 Markdown + LaTeX 候选稿。
            </div>
          ) : (
            jobs.map((job) => (
              <Card key={job.id} className="p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <Badge tone={job.status === 'ready' ? 'ok' : job.status === 'failed' ? 'danger' : 'warn'}>
                      {job.status === 'ready' ? '可采纳' : job.status === 'failed' ? '失败' : job.status}
                    </Badge>
                    <span className="text-[var(--ink-muted)]">
                      {job.provider === 'doc2x' ? 'Doc2X' : '统一 AI'} · {job.createdAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  {job.status === 'ready' && job.candidateDoc && (
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={async () => {
                        const updated = await window.workbenchApi.qbank.ocr.adopt(job.id);
                        onAdopted(updated);
                        onOpenChange(false);
                        onNotify('已采纳识别结果并生成新版本，请核对公式后保存');
                      }}
                    >
                      <Check className="w-3.5 h-3.5" /> 采纳到编辑区
                    </Button>
                  )}
                </div>
                {job.error && <div className="text-xs text-[var(--danger)]">{job.error}</div>}
                {job.rawMarkdown && (
                  <pre className="p-2 rounded-lg bg-[var(--bg-muted)] text-[11.5px] whitespace-pre-wrap max-h-36 overflow-y-auto font-mono">
                    {job.rawMarkdown}
                  </pre>
                )}
                {job.issues.length > 0 && (
                  <div className="text-[11px] text-[var(--warn)]">
                    待核对提示：{job.issues.map((i) => i.message).join('；')}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export function QuestionEditorView({
  questionId,
  taxonomy,
  activeSetId,
  onTaxonomyChanged,
  onSaved,
  onBasketChanged,
  onOpenAiSettings,
  onNotify,
}: {
  questionId: number | null;
  taxonomy: QbankTaxonomyDTO;
  activeSetId: number | null;
  onTaxonomyChanged: () => Promise<void>;
  onSaved: () => Promise<void>;
  onBasketChanged: () => Promise<void>;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [data, setData] = useState<EditableQuestionDTO | null>(null);
  const [partTab, setPartTab] = useState<'question' | 'answer'>('question');
  const [qBody, setQBody] = useState<EditableDocument>({ type: 'doc', content: [{ type: 'paragraph' }] });
  const [aBody, setABody] = useState<EditableDocument>({ type: 'doc', content: [{ type: 'paragraph' }] });
  const [assets, setAssets] = useState<QuestionAssetDTO[]>([]);
  const [meta, setMeta] = useState<QuestionMetadataInput>({
    typeId: null,
    chapterId: null,
    difficultyId: null,
    knowledgePointIds: [],
    year: null,
    source: null,
  });
  const [showCompare, setShowCompare] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKpName, setNewKpName] = useState('');

  // History modal & LAZY OCR modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<ContentRevisionDTO[]>([]);
  const [ocrOpen, setOcrOpen] = useState(false);

  async function loadQuestion(qid: number) {
    const editable = await window.workbenchApi.qbank.content.getEditable(qid);
    setData(editable);
    setQBody(editable.content.questionBody);
    setABody(editable.content.answerBody);
    setAssets(editable.assets);
    setMeta(editable.metadata);
  }

  useEffect(() => {
    if (!questionId) {
      setData(null);
      return;
    }
    void loadQuestion(questionId);
  }, [questionId]);

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    try {
      const updated = await window.workbenchApi.qbank.content.saveEdits(data.question.id, {
        expectedRevision: data.content.revision,
        metadata: meta,
        content: {
          schemaVersion: 1,
          questionMode: 'editable',
          answerMode: 'editable',
          questionBody: qBody,
          answerBody: aBody,
        },
      });
      setData(updated);
      setAssets(updated.assets);
      await onSaved();
      onNotify(`题目 #${updated.question.id} 已保存（版本 v${updated.content.revision}）`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  if (!questionId || !data) {
    return (
      <Card className="h-full flex flex-col items-center justify-center p-10 text-center gap-3">
        <p className="text-sm text-[var(--ink-muted)]">
          请先在「题库检索」中点击任意题目的「校对编辑」，或在「连续录题」入库后进入校对编辑器。
        </p>
      </Card>
    );
  }

  const originalImg =
    partTab === 'answer' ? data.question.answerImageRelPath : data.question.imageRelPath;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2.5">
      {/* Top Action Strip */}
      <Card className="px-3.5 py-2 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">校对题目 #{data.question.id}</span>
          <Badge tone="accent">v{data.content.revision}</Badge>
          {data.question.source && <Badge tone="neutral">{data.question.source}</Badge>}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {originalImg && (
            <Button
              size="xs"
              variant={showCompare ? 'soft' : 'ghost'}
              onClick={() => setShowCompare((v) => !v)}
            >
              <Columns2 className="w-3.5 h-3.5" /> {showCompare ? '隐藏原图对照' : '显示原图对照'}
            </Button>
          )}
          <Button size="xs" variant="soft" onClick={() => setOcrOpen(true)}>
            <ScanEye className="w-3.5 h-3.5" /> AI / OCR 识图转写
          </Button>
          <Button
            size="xs"
            onClick={async () => {
              const revs = await window.workbenchApi.qbank.content.listRevisions(data.question.id);
              setRevisions(revs);
              setHistoryOpen(true);
            }}
          >
            <History className="w-3.5 h-3.5" /> 历史版本
          </Button>
          {activeSetId && (
            <Button
              size="xs"
              variant={data.question.inBasket ? 'soft' : 'default'}
              onClick={async () => {
                if (data.question.inBasket) {
                  await window.workbenchApi.qbank.basket.remove(activeSetId, data.question.id);
                  onNotify('已从组卷篮移出');
                } else {
                  await window.workbenchApi.qbank.basket.add(activeSetId, data.question.id);
                  onNotify('已加入当前组卷篮');
                }
                await loadQuestion(data.question.id);
                await onBasketChanged();
              }}
            >
              <ShoppingBasket className="w-3.5 h-3.5" />
              {data.question.inBasket ? '已在组卷篮' : '加入组卷篮'}
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void handleSave()}>
            <Save className="w-4 h-4" /> {saving ? '保存中…' : '保存修改'}
          </Button>
        </div>
      </Card>

      {/* Main Split Editor + Optional Original Image Compare */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-2.5 overflow-hidden">
        {showCompare && originalImg && (
          <Card className="col-span-5 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-xs font-semibold">
              原图对照区
            </div>
            <div className="flex-1 overflow-auto p-3 bg-[var(--bg-muted)]/60 flex items-start justify-center">
              <img
                src={qbankAssetUrl(originalImg)}
                alt="原题图对照"
                className="max-w-full rounded-lg shadow-sm bg-white"
              />
            </div>
          </Card>
        )}

        <div
          className={`${
            showCompare && originalImg ? 'col-span-7' : 'col-span-12'
          } flex flex-col gap-2.5 overflow-y-auto pr-1`}
        >
          {/* Question / Answer Sub-Tabs */}
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] self-start text-xs">
            <button
              type="button"
              onClick={() => setPartTab('question')}
              className={`px-3 py-1 rounded-md cursor-pointer ${
                partTab === 'question' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
              }`}
            >
              题干正文
            </button>
            <button
              type="button"
              onClick={() => setPartTab('answer')}
              className={`px-3 py-1 rounded-md cursor-pointer ${
                partTab === 'answer' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
              }`}
            >
              参考答案与解析
            </button>
          </div>

          <RichMathEditor
            key={`${data.question.id}:${partTab}`}
            value={partTab === 'answer' ? aBody : qBody}
            assets={assets}
            questionId={data.question.id}
            onChange={(doc) => (partTab === 'answer' ? setABody(doc) : setQBody(doc))}
            onAssetUploaded={(asset) => setAssets((prev) => [...prev, asset])}
            onNotify={onNotify}
          />

          {/* Metadata Panel */}
          <Card className="p-3.5 flex flex-col gap-2.5">
            <div className="text-xs font-semibold text-[var(--ink-secondary)]">题目分类与标签</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Select
                value={meta.typeId ? String(meta.typeId) : 'none'}
                onValueChange={(v) => setMeta({ ...meta, typeId: v === 'none' ? null : Number(v) })}
                options={[
                  { value: 'none', label: '未选题型' },
                  ...taxonomy.types.map((t) => ({ value: String(t.id), label: t.name })),
                ]}
              />
              <Select
                value={meta.difficultyId ? String(meta.difficultyId) : 'none'}
                onValueChange={(v) =>
                  setMeta({ ...meta, difficultyId: v === 'none' ? null : Number(v) })
                }
                options={[
                  { value: 'none', label: '未选难度' },
                  ...taxonomy.difficulties.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
              />
              <Input
                value={meta.source || ''}
                onChange={(e) => setMeta({ ...meta, source: e.target.value || null })}
                placeholder="试卷来源"
                className="h-8 text-xs"
              />
              <Input
                type="number"
                value={meta.year ?? ''}
                onChange={(e) =>
                  setMeta({ ...meta, year: e.target.value ? Number(e.target.value) : null })
                }
                placeholder="年份"
                className="h-8 text-xs tabular-nums"
              />
            </div>

            <Select
              value={meta.chapterId ? String(meta.chapterId) : 'none'}
              onValueChange={(v) => setMeta({ ...meta, chapterId: v === 'none' ? null : Number(v) })}
              className="w-full"
              options={[
                { value: 'none', label: '人教版高中物理章节（可选）' },
                ...taxonomy.chapters.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--ink-muted)]">知识点标签（点击开关）</span>
                <div className="flex items-center gap-1">
                  <Input
                    value={newKpName}
                    onChange={(e) => setNewKpName(e.target.value)}
                    placeholder="新增知识点…"
                    className="w-32 h-7 text-xs"
                  />
                  <Button
                    size="xs"
                    disabled={!newKpName.trim()}
                    onClick={async () => {
                      const created = await window.workbenchApi.qbank.taxonomy.addKnowledgePoint(
                        newKpName,
                      );
                      setNewKpName('');
                      await onTaxonomyChanged();
                      if (!meta.knowledgePointIds.includes(created.id)) {
                        setMeta({ ...meta, knowledgePointIds: [...meta.knowledgePointIds, created.id] });
                      }
                    }}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {taxonomy.knowledgePoints.map((kp) => {
                  const selected = meta.knowledgePointIds.includes(kp.id);
                  return (
                    <button
                      key={kp.id}
                      type="button"
                      onClick={() =>
                        setMeta({
                          ...meta,
                          knowledgePointIds: selected
                            ? meta.knowledgePointIds.filter((id) => id !== kp.id)
                            : [...meta.knowledgePointIds, kp.id],
                        })
                      }
                      className={`px-2 py-0.5 rounded-full text-[11.5px] border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium'
                          : 'bg-[var(--bg-muted)] border-transparent text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {kp.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Revision History Modal */}
      <Modal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={`历史版本记录 · 题目 #${data.question.id}`}
        subtitle="每次保存均追加版本快照，可随时一键回滚到任一历史版本"
        size="sm"
      >
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
          {revisions.map((rev) => (
            <div
              key={rev.revision}
              className="p-2.5 rounded-xl border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs"
            >
              <div>
                <div className="font-semibold">
                  版本 v{rev.revision}
                  {rev.revision === data.content.revision && (
                    <span className="ml-1.5 text-[var(--accent)]">（当前）</span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--ink-muted)] tabular-nums">
                  {rev.createdAt.slice(0, 19).replace('T', ' ')}
                </div>
              </div>
              {rev.revision !== data.content.revision && (
                <Button
                  size="xs"
                  onClick={async () => {
                    const restored = await window.workbenchApi.qbank.content.restoreRevision(
                      data.question.id,
                      rev.revision,
                    );
                    setData(restored);
                    setQBody(restored.content.questionBody);
                    setABody(restored.content.answerBody);
                    setHistoryOpen(false);
                    await onSaved();
                    onNotify(`已恢复至版本 v${rev.revision} 的内容（生成新版本 v${restored.content.revision}）`);
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> 恢复此版
                </Button>
              )}
            </div>
          ))}
        </div>
      </Modal>

      {/* STRICTLY LAZILY MOUNTED OCR Modal — never queries credentials unless clicked! */}
      {ocrOpen && (
        <LazyOcrModal
          open={ocrOpen}
          onOpenChange={setOcrOpen}
          questionId={data.question.id}
          part={partTab}
          hasOriginalImage={Boolean(originalImg)}
          onAdopted={(updated) => {
            setData(updated);
            setQBody(updated.content.questionBody);
            setABody(updated.content.answerBody);
            setAssets(updated.assets);
            void onSaved();
          }}
          onOpenAiSettings={onOpenAiSettings}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
