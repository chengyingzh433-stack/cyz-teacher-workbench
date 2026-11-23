import { useEffect, useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { GradingItemDetail } from '../../../shared/types';
import { blobToDataUrl } from '../../../shared/ai-engine';
import { parsePoints, points } from '../../../shared/score-policy';
import { Button, Dropzone, Input, Modal, Textarea } from '../../components/ui/primitives';

interface CriterionDraft {
  unitLabel: string;
  description: string;
  maxScore: string;
  stepScore: string;
}

const DEFAULT_CRITERIA: CriterionDraft[] = [
  { unitLabel: '第 1 问', description: '正确列出公式或思路', maxScore: '4', stepScore: '1' },
  { unitLabel: '第 1 问', description: '代入计算与单位正确', maxScore: '6', stepScore: '1' },
];

export function GradingItemModal({
  open,
  onOpenChange,
  examId,
  editingItem,
  nextItemNumber,
  onSaved,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  editingItem: GradingItemDetail | null;
  nextItemNumber: number;
  onSaved: (savedItemId: string) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [iLabel, setILabel] = useState('15');
  const [iPrompt, setIPrompt] = useState('');
  const [iRefAns, setIRefAns] = useState('');
  const [iRefImgs, setIRefImgs] = useState<string[]>([]);
  const [iCriteria, setICriteria] = useState<CriterionDraft[]>(DEFAULT_CRITERIA);
  const [aiBreaking, setAiBreaking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setILabel(editingItem?.label || String(nextItemNumber));
    setIPrompt(editingItem?.prompt || '');
    setIRefAns(editingItem?.rubric?.referenceAnswer || '');
    setIRefImgs([]);
    if (editingItem?.rubric) {
      const unitMap = new Map(editingItem.scoringUnits.map((u) => [u.id, u.label]));
      setICriteria(
        editingItem.rubric.criteria.map((c) => ({
          unitLabel: unitMap.get(c.scoringUnitId) || '第 1 问',
          description: c.description,
          maxScore: points(c.maxUnits),
          stepScore: points(c.stepUnits),
        })),
      );
    } else {
      setICriteria(DEFAULT_CRITERIA.map((c) => ({ ...c })));
    }
  }, [open, editingItem, nextItemNumber]);

  async function runAiBreakdown() {
    setAiBreaking(true);
    try {
      const totalHint = iCriteria.reduce((s, c) => s + (Number(c.maxScore) || 0), 0);
      const res = await window.workbenchApi.ai.breakdownReference({
        prompt: iPrompt,
        referenceAnswer: iRefAns,
        referenceImageDataUrls: iRefImgs,
        totalScoreHint: totalHint > 0 ? String(totalHint) : undefined,
      });
      if (res.referenceAnswer) setIRefAns(res.referenceAnswer);
      setICriteria(
        res.criteria.map((c) => ({
          unitLabel: c.unitLabel,
          description: c.description,
          maxScore: c.maxScore,
          stepScore: c.stepScore,
        })),
      );
      onNotify(`AI 已自动拆解出 ${res.criteria.length} 条评分点，请核对后保存`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setAiBreaking(false);
    }
  }

  async function saveItem() {
    try {
      const unitNames = [...new Set(iCriteria.map((c) => c.unitLabel.trim() || '第 1 问'))];
      const scoringUnits = unitNames.map((label) => ({
        label,
        maxUnits: iCriteria
          .filter((c) => (c.unitLabel.trim() || '第 1 问') === label)
          .reduce((s, c) => s + parsePoints(c.maxScore || '0'), 0),
      }));
      const criteria = iCriteria.map((c) => ({
        scoringUnitIndex: Math.max(0, unitNames.indexOf(c.unitLabel.trim() || '第 1 问')),
        description: c.description,
        maxUnits: parsePoints(c.maxScore || '0'),
        stepUnits: Math.max(50, parsePoints(c.stepScore || '1')),
        exclusiveGroup: null,
      }));
      const saved = await window.workbenchApi.grading.saveItem({
        examId,
        itemId: editingItem?.id,
        label: iLabel,
        prompt: iPrompt,
        referenceAnswer: iRefAns,
        scoringUnits,
        criteria,
      });
      onOpenChange(false);
      await onSaved(saved.id);
      onNotify(`已保存「第 ${saved.label} 题」并在本场成绩表中自动关联了对应成绩列`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editingItem ? `编辑第 ${editingItem.label} 题细则` : '新建主观题与评分细则'}
      subtitle="支持粘贴参考答案文字或上传参考答案照片，由 AI 一键拆解出得分点清单"
      size="lg"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" onClick={() => void saveItem()}>
            保存题目与细则
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            题号 *
            <Input value={iLabel} onChange={(e) => setILabel(e.target.value)} placeholder="如 15" />
          </label>
          <label className="col-span-3 flex flex-col gap-1 text-xs font-medium">
            题干摘要（可选）
            <Input value={iPrompt} onChange={(e) => setIPrompt(e.target.value)} placeholder="简述本题情景与设问" />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">参考答案（用于 AI 自动拆点与阶段二判分）</span>
            <Button size="xs" variant="soft" disabled={aiBreaking} onClick={() => void runAiBreakdown()}>
              <Sparkles className="w-3.5 h-3.5" /> {aiBreaking ? 'AI 拆解中…' : 'AI 一键拆解得分点'}
            </Button>
          </div>
          <Textarea
            rows={3}
            value={iRefAns}
            onChange={(e) => setIRefAns(e.target.value)}
            placeholder="粘贴参考答案公式与给分步骤，或下方上传参考答案照片…"
          />
          <Dropzone
            accept="image/png,image/jpeg,image/webp"
            title="上传参考答案照片（可选，支持图文拆点）"
            fileName={iRefImgs.length ? `已添加 ${iRefImgs.length} 张参考图` : undefined}
            onFiles={async (files) => {
              const urls = await Promise.all(files.slice(0, 4).map(blobToDataUrl));
              setIRefImgs(urls);
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">得分点清单</span>
            <Button
              size="xs"
              onClick={() =>
                setICriteria([
                  ...iCriteria,
                  { unitLabel: '第 1 问', description: '', maxScore: '2', stepScore: '1' },
                ])
              }
            >
              <Plus className="w-3.5 h-3.5" /> 加一条得分点
            </Button>
          </div>
          {iCriteria.map((c, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={c.unitLabel}
                onChange={(e) => {
                  const next = [...iCriteria];
                  next[idx] = { ...c, unitLabel: e.target.value };
                  setICriteria(next);
                }}
                placeholder="小题"
                className="col-span-2 h-8 text-xs"
              />
              <Input
                value={c.description}
                onChange={(e) => {
                  const next = [...iCriteria];
                  next[idx] = { ...c, description: e.target.value };
                  setICriteria(next);
                }}
                placeholder="评分点描述（如：列出牛顿第二定律 F=ma）"
                className="col-span-6 h-8 text-xs"
              />
              <Input
                value={c.maxScore}
                onChange={(e) => {
                  const next = [...iCriteria];
                  next[idx] = { ...c, maxScore: e.target.value };
                  setICriteria(next);
                }}
                placeholder="满分"
                className="col-span-2 h-8 text-xs tabular-nums"
              />
              <Input
                value={c.stepScore}
                onChange={(e) => {
                  const next = [...iCriteria];
                  next[idx] = { ...c, stepScore: e.target.value };
                  setICriteria(next);
                }}
                placeholder="步长"
                className="col-span-1 h-8 text-xs tabular-nums"
              />
              <Button
                size="xs"
                variant="danger-ghost"
                disabled={iCriteria.length <= 1}
                onClick={() => setICriteria(iCriteria.filter((_, i) => i !== idx))}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
