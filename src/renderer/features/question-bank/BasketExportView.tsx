import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  FileDown,
  FileText,
  Plus,
  Presentation,
  Trash2,
} from 'lucide-react';
import { DEFAULT_WORD_OPTIONS, type WordExportOptions } from '../../../shared/qbank/editable';
import type { PaperSetDetailDTO, PaperSetDTO } from '../../../shared/qbank/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Select,
} from '../../components/ui/primitives';

export function BasketExportView({
  sets,
  activeSetId,
  refreshToken,
  onSelectSet,
  onSetsChanged,
  onOpenEditor,
  onNotify,
}: {
  sets: PaperSetDTO[];
  activeSetId: number | null;
  refreshToken: number;
  onSelectSet: (setId: number) => void;
  onSetsChanged: () => Promise<void>;
  onOpenEditor: (questionId: number) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [detail, setDetail] = useState<PaperSetDetailDTO | null>(null);
  const [opts, setOpts] = useState<WordExportOptions>({ ...DEFAULT_WORD_OPTIONS });
  const [newSetTitle, setNewSetTitle] = useState('');
  const [exporting, setExporting] = useState<'docx' | 'pdf' | 'pptx' | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  async function loadDetail(sid?: number | null) {
    const id = sid ?? activeSetId;
    if (!id) {
      setDetail(null);
      return;
    }
    const d = await window.workbenchApi.qbank.basket.getSetDetail(id);
    setDetail(d);
    setOpts(d.wordOptions);
  }

  useEffect(() => {
    void loadDetail();
  }, [activeSetId, refreshToken]);

  async function moveItem(index: number, delta: -1 | 1) {
    if (!detail) return;
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= detail.items.length) return;
    const ids = detail.items.map((x) => x.id);
    [ids[index], ids[nextIdx]] = [ids[nextIdx], ids[index]];
    const updated = await window.workbenchApi.qbank.basket.reorder(detail.set.id, ids);
    setDetail(updated);
  }

  async function handleExport(format: 'docx' | 'pdf' | 'pptx') {
    if (!detail) return;
    setExporting(format);
    try {
      await window.workbenchApi.qbank.basket.saveOptions(detail.set.id, opts);
      const res = await window.workbenchApi.qbank.export[format](detail.set.id, opts);
      if (res) {
        const names = { docx: 'Word（原生公式）', pdf: 'PDF', pptx: 'PPTX 课件' };
        onNotify(`已成功导出 ${names[format]} 至：${res.path}`);
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 h-full">
      {/* Left: Basket Items Ordering & Group Headers */}
      <div className="col-span-7 flex flex-col gap-2.5 min-h-0">
        <Card className="p-3 flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {sets.length > 0 && activeSetId && (
              <Select
                value={String(activeSetId)}
                onValueChange={(v) => onSelectSet(Number(v))}
                options={sets.map((s) => ({
                  value: String(s.id),
                  label: s.title,
                  hint: `${s.itemCount} 题`,
                }))}
              />
            )}
            <div className="flex items-center gap-1">
              <Input
                value={newSetTitle}
                onChange={(e) => setNewSetTitle(e.target.value)}
                placeholder="新建试卷篮名称…"
                className="w-36 h-8 text-xs"
              />
              <Button
                size="xs"
                disabled={!newSetTitle.trim()}
                onClick={async () => {
                  const created = await window.workbenchApi.qbank.basket.createSet(newSetTitle);
                  setNewSetTitle('');
                  await onSetsChanged();
                  onSelectSet(created.id);
                  onNotify(`已新建组卷篮「${created.title}」`);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {detail && detail.items.length > 0 && (
            <Button size="xs" variant="danger-ghost" onClick={() => setClearOpen(true)}>
              清空本篮 ({detail.items.length})
            </Button>
          )}
        </Card>

        <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
          {!detail || detail.items.length === 0 ? (
            <Card className="p-10 text-center text-sm text-[var(--ink-muted)]">
              当前组卷篮为空。请在「题库检索」或「校对编辑」点击「加入组卷篮」添加题目。
            </Card>
          ) : (
            detail.items.map((item, idx) => (
              <Card key={item.id} className="p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">序 {idx + 1}</Badge>
                    <Input
                      value={item.displayNumber}
                      onChange={async (e) => {
                        const updated = await window.workbenchApi.qbank.basket.updateItem(item.id, {
                          displayNumber: e.target.value,
                        });
                        setDetail(updated);
                      }}
                      placeholder="题号"
                      className="w-16 h-7 text-xs tabular-nums"
                    />
                    <Input
                      value={item.groupHeader}
                      onChange={async (e) => {
                        const updated = await window.workbenchApi.qbank.basket.updateItem(item.id, {
                          groupHeader: e.target.value,
                        });
                        setDetail(updated);
                      }}
                      placeholder="大题分组标题（可选，如：一、选择题）"
                      className="w-56 h-7 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" disabled={idx === 0} onClick={() => void moveItem(idx, -1)}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={idx === detail.items.length - 1}
                      onClick={() => void moveItem(idx, 1)}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => onOpenEditor(item.questionId)}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      onClick={async () => {
                        const updated = await window.workbenchApi.qbank.basket.remove(
                          detail.set.id,
                          item.questionId,
                        );
                        setDetail(updated);
                        await onSetsChanged();
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-[var(--ink-secondary)] line-clamp-2">
                  {item.question.previewText || `题目 #${item.questionId}`}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Right: Export Typography Options & 3-Format Export Actions */}
      <Card className="col-span-5 p-4 flex flex-col gap-3.5 overflow-y-auto">
        <div>
          <h3 className="text-[15px] font-semibold">组卷排版与三格式导出</h3>
          <p className="text-xs text-[var(--ink-muted)] mt-0.5">
            Word 导出内置原生可编辑公式（OMML）；PDF / PPTX 内嵌中文字体与 MathLive 矢量公式。
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium">
          试卷主标题
          <Input
            value={opts.title}
            onChange={(e) => setOpts({ ...opts, title: e.target.value })}
            placeholder="如：高三物理双周测"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          副标题 / 考试说明（可选）
          <Input
            value={opts.subtitle}
            onChange={(e) => setOpts({ ...opts, subtitle: e.target.value })}
            placeholder="如：考试时间 60 分钟 · 满分 100 分"
          />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1 text-xs font-medium">
            答案排布方式
            <Select
              value={opts.answerMode}
              onValueChange={(v) =>
                setOpts({ ...opts, answerMode: v as WordExportOptions['answerMode'] })
              }
              className="w-full"
              options={[
                { value: 'none', label: '仅导出试题（不含答案）' },
                { value: 'append', label: '文末分页汇总答案' },
                { value: 'inline', label: '每题下方紧跟答案' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs font-medium">
            题目内容来源
            <Select
              value={opts.contentSource}
              onValueChange={(v) =>
                setOpts({ ...opts, contentSource: v as WordExportOptions['contentSource'] })
              }
              className="w-full"
              options={[
                { value: 'latest', label: '优先可编辑排版稿' },
                { value: 'original', label: '优先使用原题图' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            正文字号 (pt)
            <Input
              type="number"
              min={8}
              max={20}
              value={opts.fontSize}
              onChange={(e) => setOpts({ ...opts, fontSize: Number(e.target.value) || 12 })}
              className="h-8 text-xs tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            页边距 (mm)
            <Input
              type="number"
              min={10}
              max={35}
              value={opts.marginMm}
              onChange={(e) => setOpts({ ...opts, marginMm: Number(e.target.value) || 20 })}
              className="h-8 text-xs tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            题间距 (pt)
            <Input
              type="number"
              min={0}
              max={48}
              value={opts.questionSpacing}
              onChange={(e) => setOpts({ ...opts, questionSpacing: Number(e.target.value) || 12 })}
              className="h-8 text-xs tabular-nums"
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={opts.questionStartNewPage}
            onChange={(e) => setOpts({ ...opts, questionStartNewPage: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          每道题强制另起一页（适合大题专练）
        </label>

        <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2">
          <Button
            variant="primary"
            disabled={!detail?.items.length || Boolean(exporting)}
            onClick={() => void handleExport('docx')}
          >
            <FileText className="w-4 h-4" />
            {exporting === 'docx' ? '正在生成 Word…' : '导出 Word 试卷 (.docx · 原生可编辑公式)'}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={!detail?.items.length || Boolean(exporting)}
              onClick={() => void handleExport('pdf')}
            >
              <FileDown className="w-4 h-4" />
              {exporting === 'pdf' ? '生成 PDF…' : '导出 PDF (.pdf)'}
            </Button>
            <Button
              disabled={!detail?.items.length || Boolean(exporting)}
              onClick={() => void handleExport('pptx')}
            >
              <Presentation className="w-4 h-4" />
              {exporting === 'pptx' ? '生成 PPTX…' : '导出课件 (.pptx)'}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空组卷篮"
        description="确定清空当前组卷篮中的所有题目吗？题库中的原题不会被删除。"
        confirmLabel="确认清空"
        danger
        onConfirm={async () => {
          if (!detail) return;
          const cleared = await window.workbenchApi.qbank.basket.clear(detail.set.id);
          setDetail(cleared);
          setClearOpen(false);
          await onSetsChanged();
          onNotify('已清空当前组卷篮');
        }}
      />
    </div>
  );
}
