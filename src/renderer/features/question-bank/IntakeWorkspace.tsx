import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileUp,
  Plus,
  Trash2,
} from 'lucide-react';
import { qbankAssetUrl } from '../../../shared/qbank/editable';
import type {
  IntakeBlock,
  IntakeDraftDTO,
  IntakeSourceDTO,
  IntakeWorkspaceDTO,
  QbankTaxonomyDTO,
} from '../../../shared/qbank/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Select,
  Textarea,
} from '../../components/ui/primitives';
import { PdfSourceViewer } from './PdfSourceViewer';

export function IntakeWorkspace({
  taxonomy,
  onPublishedQuestion,
  onOpenEditor,
  onNotify,
}: {
  taxonomy: QbankTaxonomyDTO;
  onPublishedQuestion: () => Promise<void>;
  onOpenEditor: (questionId: number) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [sources, setSources] = useState<IntakeSourceDTO[]>([]);
  const [workspace, setWorkspace] = useState<IntakeWorkspaceDTO | null>(null);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [partTab, setPartTab] = useState<'question' | 'answer'>('question');
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<IntakeSourceDTO | null>(null);
  const [publishing, setPublishing] = useState(false);

  const activeDraft: IntakeDraftDTO | null =
    workspace?.drafts.find((d) => d.id === activeDraftId) ||
    workspace?.drafts.find((d) => d.status === 'draft') ||
    workspace?.drafts[0] ||
    null;

  async function refreshSources(selectSourceId?: string) {
    const list = await window.workbenchApi.qbank.intake.listSources();
    setSources(list);
    const targetId = selectSourceId || workspace?.source.id || list[0]?.id;
    if (targetId && list.some((s) => s.id === targetId)) {
      const ws = await window.workbenchApi.qbank.intake.getWorkspace(targetId);
      setWorkspace(ws);
      const nextDraft = ws.drafts.find((d) => d.status === 'draft') || ws.drafts[0];
      setActiveDraftId(nextDraft?.id || '');
    } else {
      setWorkspace(null);
      setActiveDraftId('');
    }
  }

  useEffect(() => {
    void refreshSources();
  }, []);

  async function handlePickSource() {
    try {
      const ws = await window.workbenchApi.qbank.intake.pickAndImport();
      if (!ws) return;
      await refreshSources(ws.source.id);
      onNotify(`已导入试卷源文件「${ws.source.name}」`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function patchActiveDraft(patch: Parameters<typeof window.workbenchApi.qbank.intake.updateDraft>[1]) {
    if (!activeDraft || !workspace) return;
    const updated = await window.workbenchApi.qbank.intake.updateDraft(activeDraft.id, patch);
    setWorkspace({
      ...workspace,
      drafts: workspace.drafts.map((d) => (d.id === updated.id ? updated : d)),
    });
  }

  function currentBlocks(): IntakeBlock[] {
    if (!activeDraft) return [];
    return partTab === 'answer' ? activeDraft.answerBlocks : activeDraft.questionBlocks;
  }

  async function setBlocks(next: IntakeBlock[]) {
    if (partTab === 'answer') await patchActiveDraft({ answerBlocks: next });
    else await patchActiveDraft({ questionBlocks: next });
  }

  async function appendTextBlock(text: string) {
    const block: IntakeBlock = { id: crypto.randomUUID(), kind: 'text', text };
    await setBlocks([...currentBlocks(), block]);
  }

  async function handleCroppedImage(payload: {
    bytes: number[];
    cropWidthRatio: number;
    asOriginal: boolean;
  }) {
    if (!workspace || !activeDraft) return;
    const saved = await window.workbenchApi.qbank.intake.saveCroppedImage(workspace.source.id, {
      bytes: payload.bytes,
      cropWidthRatio: payload.cropWidthRatio,
    });
    if (payload.asOriginal) {
      await patchActiveDraft({ originalRelPath: saved.relPath });
      onNotify('已关联当前题目的原题图快照');
      return;
    }
    const block: IntakeBlock = {
      id: crypto.randomUUID(),
      kind: 'image',
      relPath: saved.relPath,
      widthPx: saved.widthPx,
      heightPx: saved.heightPx,
      widthPercent: saved.widthPercent,
      caption: '',
    };
    await setBlocks([...currentBlocks(), block]);
  }

  async function handlePublish(openAfter = false) {
    if (!activeDraft || !workspace) return;
    setPublishing(true);
    try {
      const res = await window.workbenchApi.qbank.intake.publishDraft(activeDraft.id);
      await refreshSources(workspace.source.id);
      setActiveDraftId(res.nextDraft.id);
      setPartTab('question');
      await onPublishedQuestion();
      onNotify(`题目 #${res.questionId} 已入库，并自动继承标签创建下一题草稿`);
      if (openAfter) onOpenEditor(res.questionId);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setPublishing(false);
    }
  }

  const blocks = currentBlocks();

  return (
    <div className="flex flex-col h-full min-h-0 gap-2.5">
      {/* Top Source Bar */}
      <Card className="px-3.5 py-2 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="primary" onClick={() => void handlePickSource()}>
            <FileUp className="w-4 h-4" /> 导入试卷 PDF / DOCX / 图片
          </Button>
          {sources.length > 0 && (
            <Select
              value={workspace?.source.id || ''}
              onValueChange={(id) => void refreshSources(id)}
              className="min-w-[220px]"
              options={sources.map((s) => ({
                value: s.id,
                label: s.name,
                hint: `已入库 ${s.publishedCount} 题 · 草稿 ${s.draftCount}`,
              }))}
            />
          )}
          {workspace && (
            <Button
              size="xs"
              variant="danger-ghost"
              title="删除当前源文件与未入库草稿"
              onClick={() => setDeleteSourceTarget(workspace.source)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {workspace && (
          <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Badge tone="ok">本卷已入库 {workspace.source.publishedCount} 题</Badge>
          </div>
        )}
      </Card>

      {!workspace ? (
        <Card className="flex-1 flex flex-col items-center justify-center p-10 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
            <FileUp className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-semibold">连续录题工作台</h3>
            <p className="text-sm text-[var(--ink-muted)] max-w-md mt-1">
              导入物理试卷 PDF、DOCX 或图片后，在左侧直接框选提字（自动消除中文标点多余空格）与框选配图（小图自适应宽比），右侧连续入库并自动继承章节/来源标签。
            </p>
          </div>
          <Button variant="primary" onClick={() => void handlePickSource()}>
            <FileUp className="w-4 h-4" /> 选择本地试卷开始录题
          </Button>
        </Card>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-2.5">
          {/* Left: PDF / DOCX / Image Interactive Viewer */}
          <Card className="col-span-7 flex flex-col overflow-hidden min-h-0">
            <PdfSourceViewer
              source={workspace.source}
              onExtractedText={(text) => void appendTextBlock(text)}
              onCroppedImage={handleCroppedImage}
            />
          </Card>

          {/* Right: Continuous Draft Builder */}
          <Card className="col-span-5 flex flex-col overflow-hidden min-h-0">
            <div className="px-3.5 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {workspace.drafts.map((d, idx) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveDraftId(d.id)}
                    className={`px-2 py-1 rounded-lg text-xs font-medium shrink-0 cursor-pointer transition-colors ${
                      activeDraft?.id === d.id
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : d.status === 'published'
                          ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
                          : 'bg-[var(--bg-muted)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    #{idx + 1} {d.status === 'published' ? '✓' : '草稿'}
                  </button>
                ))}
                <button
                  type="button"
                  title="新建空白草稿"
                  onClick={async () => {
                    const next = await window.workbenchApi.qbank.intake.createDraft(
                      workspace.source.id,
                      activeDraft?.metadata,
                    );
                    setWorkspace({ ...workspace, drafts: [...workspace.drafts, next] });
                    setActiveDraftId(next.id);
                  }}
                  className="p-1 rounded-lg bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] text-[var(--ink-secondary)] cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {activeDraft?.questionId && (
                <Button size="xs" variant="soft" onClick={() => onOpenEditor(activeDraft.questionId!)}>
                  去校对 #{activeDraft.questionId} →
                </Button>
              )}
            </div>

            {activeDraft && (
              <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
                {/* Part switcher */}
                <div className="flex items-center justify-between">
                  <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] text-xs">
                    <button
                      type="button"
                      onClick={() => setPartTab('question')}
                      className={`px-2.5 py-1 rounded-md cursor-pointer ${
                        partTab === 'question' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
                      }`}
                    >
                      题干内容 ({activeDraft.questionBlocks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartTab('answer')}
                      className={`px-2.5 py-1 rounded-md cursor-pointer ${
                        partTab === 'answer' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
                      }`}
                    >
                      参考答案 ({activeDraft.answerBlocks.length})
                    </button>
                  </div>
                  <Button size="xs" onClick={() => void appendTextBlock('')}>
                    <Plus className="w-3.5 h-3.5" /> 加文字段
                  </Button>
                </div>

                {/* Original snapshot preview pill */}
                {activeDraft.originalRelPath && (
                  <div className="p-2 rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={qbankAssetUrl(activeDraft.originalRelPath)}
                        alt="原题图快照"
                        className="w-10 h-10 object-cover rounded border border-[var(--border-subtle)] bg-white"
                      />
                      <span className="truncate text-[var(--ink-secondary)]">已绑定原题图快照（入库后可对照）</span>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void patchActiveDraft({ originalRelPath: null })}
                    >
                      清除
                    </Button>
                  </div>
                )}

                {/* Blocks list */}
                {blocks.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-[var(--border-strong)] text-center text-xs text-[var(--ink-muted)]">
                    在左侧试卷上拖拽框选即可自动追加{partTab === 'answer' ? '答案' : '题干'}文字或插图，也可点右上角「加文字段」手动输入。
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {blocks.map((b, idx) => (
                      <div
                        key={b.id}
                        className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                          <span>
                            {b.kind === 'text' ? `文字段 #${idx + 1}` : `配图 #${idx + 1} (${b.widthPx}×${b.heightPx})`}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                const next = [...blocks];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                void setBlocks(next);
                              }}
                              className="p-0.5 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === blocks.length - 1}
                              onClick={() => {
                                const next = [...blocks];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                void setBlocks(next);
                              }}
                              className="p-0.5 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void setBlocks(blocks.filter((x) => x.id !== b.id))}
                              className="p-0.5 rounded text-[var(--danger)] hover:bg-[var(--danger-soft)] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {b.kind === 'text' ? (
                          <Textarea
                            rows={3}
                            value={b.text}
                            onChange={(e) => {
                              const next = blocks.map((x) =>
                                x.id === b.id && x.kind === 'text' ? { ...x, text: e.target.value } : x,
                              );
                              void setBlocks(next);
                            }}
                            placeholder="输入题干文字…"
                            className="text-xs"
                          />
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            <div className="p-2 rounded-lg bg-white border border-[var(--border-subtle)] flex justify-center">
                              <img
                                src={qbankAssetUrl(b.relPath)}
                                alt="裁剪配图"
                                style={{ width: `${b.widthPercent}%` }}
                                className="max-h-40 object-contain"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-[var(--ink-muted)] shrink-0">图宽 {b.widthPercent}%</span>
                              <input
                                type="range"
                                min={20}
                                max={100}
                                step={5}
                                value={b.widthPercent}
                                onChange={(e) => {
                                  const w = Number(e.target.value);
                                  const next = blocks.map((x) =>
                                    x.id === b.id && x.kind === 'image' ? { ...x, widthPercent: w } : x,
                                  );
                                  void setBlocks(next);
                                }}
                                className="flex-1 accent-[var(--accent)]"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Inheritable Metadata */}
                <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="text-xs font-semibold text-[var(--ink-secondary)]">
                    题目标签（入库下一题自动继承）
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={activeDraft.metadata.typeId ? String(activeDraft.metadata.typeId) : 'none'}
                      onValueChange={(v) =>
                        void patchActiveDraft({
                          metadata: { ...activeDraft.metadata, typeId: v === 'none' ? null : Number(v) },
                        })
                      }
                      options={[
                        { value: 'none', label: '选择题型' },
                        ...taxonomy.types.map((t) => ({ value: String(t.id), label: t.name })),
                      ]}
                    />
                    <Select
                      value={activeDraft.metadata.difficultyId ? String(activeDraft.metadata.difficultyId) : 'none'}
                      onValueChange={(v) =>
                        void patchActiveDraft({
                          metadata: { ...activeDraft.metadata, difficultyId: v === 'none' ? null : Number(v) },
                        })
                      }
                      options={[
                        { value: 'none', label: '选择难度' },
                        ...taxonomy.difficulties.map((d) => ({ value: String(d.id), label: d.name })),
                      ]}
                    />
                  </div>
                  <Select
                    value={activeDraft.metadata.chapterId ? String(activeDraft.metadata.chapterId) : 'none'}
                    onValueChange={(v) =>
                      void patchActiveDraft({
                        metadata: { ...activeDraft.metadata, chapterId: v === 'none' ? null : Number(v) },
                      })
                    }
                    className="w-full"
                    options={[
                      { value: 'none', label: '选择人教版物理章节（可选）' },
                      ...taxonomy.chapters.map((c) => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={activeDraft.metadata.source || ''}
                      onChange={(e) =>
                        void patchActiveDraft({
                          metadata: { ...activeDraft.metadata, source: e.target.value || null },
                        })
                      }
                      placeholder="来源（如 26.11 双周测）"
                      className="col-span-2 h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={activeDraft.metadata.year ?? ''}
                      onChange={(e) =>
                        void patchActiveDraft({
                          metadata: {
                            ...activeDraft.metadata,
                            year: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                      placeholder="年份"
                      className="h-8 text-xs tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Publish Footer */}
            {activeDraft && activeDraft.status === 'draft' && (
              <div className="px-3.5 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/50 flex items-center justify-end gap-2 shrink-0">
                <Button size="sm" disabled={publishing} onClick={() => void handlePublish(true)}>
                  入库并校对公式
                </Button>
                <Button size="sm" variant="primary" disabled={publishing} onClick={() => void handlePublish(false)}>
                  <CheckCircle2 className="w-4 h-4" /> 保存入库并下一题
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteSourceTarget)}
        onOpenChange={(o) => !o && setDeleteSourceTarget(null)}
        title="删除录题源文件"
        description={`确定删除源文件「${deleteSourceTarget?.name || ''}」及其未入库草稿吗？已入库的正式题目不会被删除。`}
        confirmLabel="确认删除"
        danger
        onConfirm={async () => {
          if (!deleteSourceTarget) return;
          await window.workbenchApi.qbank.intake.deleteSource(deleteSourceTarget.id);
          setDeleteSourceTarget(null);
          await refreshSources();
          onNotify('已删除录题源文件');
        }}
      />
    </div>
  );
}
