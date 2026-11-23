import { Lock, Plus, Trash2 } from 'lucide-react';
import type { GradingItemDetail } from '../../../shared/types';
import { formatScore } from '../../../shared/score-policy';
import { Badge, Button, Card } from '../../components/ui/primitives';

export function GradingItemsTab({
  items,
  readonly,
  onOpenItemEditor,
  onEnterStudio,
  onReloadExam,
  onNotify,
}: {
  items: GradingItemDetail[];
  readonly: boolean;
  onOpenItemEditor: (item: GradingItemDetail | null) => void;
  onEnterStudio: (itemId: string) => void;
  onReloadExam: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">
          每建一道主观题，系统会自动在「成绩分析」总表中生成对应成绩列；确认打分后实时回填总表。
        </span>
        <Button size="sm" variant="primary" disabled={readonly} onClick={() => onOpenItemEditor(null)}>
          <Plus className="w-4 h-4" /> 添加主观题与细则
        </Button>
      </div>

      {!items.length && (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--ink-muted)] mb-4">
            本场考试还没有配置手写主观题。新建题目后支持粘贴参考答案让 AI 一键拆解评分点。
          </p>
          <Button variant="primary" disabled={readonly} onClick={() => onOpenItemEditor(null)}>
            <Plus className="w-4 h-4" /> 创建第一道主观题
          </Button>
        </Card>
      )}

      {items.map((item) => {
        const frozen = Boolean(item.rubric?.frozenAt);
        return (
          <Card key={item.id} className="p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h4 className="text-[15px] font-semibold">
                  第 {item.label} 题 · 满分 {formatScore(item.maxUnits)} 分
                </h4>
                <Badge tone={frozen ? 'ok' : 'warn'}>
                  {frozen ? '细则已定稿启用' : '草稿（可编辑）'}
                </Badge>
                <Badge>
                  {item.rubric?.criteria.length || 0} 个得分点 · 已批 {item.confirmedCount}/{item.submissionCount}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                {!frozen && (
                  <>
                    <Button size="xs" disabled={readonly} onClick={() => onOpenItemEditor(item)}>
                      编辑细则
                    </Button>
                    <Button
                      size="xs"
                      variant="primary"
                      disabled={readonly || !item.rubric}
                      onClick={async () => {
                        await window.workbenchApi.grading.freezeRubric(item.rubric!.id);
                        await onReloadExam();
                        onNotify(`第 ${item.label} 题细则已启用，可进入审稿台阅卷！`);
                      }}
                    >
                      <Lock className="w-3.5 h-3.5" /> 定稿启用
                    </Button>
                  </>
                )}
                <Button size="xs" variant="soft" onClick={() => onEnterStudio(item.id)}>
                  进入审稿台 →
                </Button>
                {!readonly && (
                  <Button
                    size="xs"
                    variant="danger-ghost"
                    onClick={async () => {
                      await window.workbenchApi.grading.deleteItem(item.id);
                      await onReloadExam();
                      onNotify(`已删除第 ${item.label} 题`);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {item.prompt && (
              <p className="text-[13px] text-[var(--ink-secondary)] whitespace-pre-wrap">{item.prompt}</p>
            )}
            {item.rubric && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 pt-1">
                {item.rubric.criteria.map((c, idx) => (
                  <div
                    key={c.id}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-muted)]/70 text-[12.5px] flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {idx + 1}. {c.description}
                    </span>
                    <Badge tone="accent">{formatScore(c.maxUnits)} 分</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
