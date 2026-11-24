import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ExamDetail, ExamSummary, Rubric } from '../../../shared/types';
import { formatScore, parsePoints } from '../../../shared/score-policy';
import { Badge, Button, Input, Select, Textarea } from '../../components/ui/primitives';

export interface QuickCriterionDraft {
  id: string;
  description: string;
  maxScore: string;
  stepScore: string;
}

export interface ActiveZhixueRubric {
  source: 'quick' | 'exam';
  rubric: Rubric | null;
  rubricId?: string;
  prompt: string;
  summary: string;
}

export function ZhixueRubricCard({
  exams,
  inferredMax,
  inferredStep,
  onChange,
  onNotify,
}: {
  exams: ExamSummary[];
  inferredMax: number | null;
  inferredStep: number | null;
  onChange: (active: ActiveZhixueRubric) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState<'quick' | 'exam'>('quick');

  // Quick inline rubric (works immediately without creating an ExamCenter exam)
  const [prompt, setPrompt] = useState('');
  const [refAnswer, setRefAnswer] = useState('');
  const [maxScore, setMaxScore] = useState('6');
  const [stepScore, setStepScore] = useState('1');
  const [criteria, setCriteria] = useState<QuickCriterionDraft[]>([]);
  const [breakingDown, setBreakingDown] = useState(false);

  // Optional binding to existing ExamCenter rubric
  const [examId, setExamId] = useState(exams[0]?.id || '');
  const [examDetail, setExamDetail] = useState<ExamDetail | null>(null);
  const [itemId, setItemId] = useState('');

  useEffect(() => {
    if (source !== 'exam' || !examId) {
      setExamDetail(null);
      return;
    }
    window.workbenchApi.exams.getDetail(examId).then((d) => {
      setExamDetail(d);
      if (d.gradingItems[0]) setItemId(d.gradingItems[0].id);
      else setItemId('');
    });
  }, [source, examId]);

  const activeExamItem = examDetail?.gradingItems.find((i) => i.id === itemId) || null;

  // Build valid inline Rubric from quick settings
  const quickRubric = useMemo<Rubric | null>(() => {
    const parseSafeUnits = (val: string, fallback: number) => {
      try {
        const u = parsePoints(val);
        return u > 0 ? u : fallback;
      } catch {
        return fallback;
      }
    };
    const fallbackMax = parseSafeUnits(maxScore, 600);
    const fallbackStep = Math.min(fallbackMax, parseSafeUnits(stepScore, 100));

    if (criteria.length > 0) {
      const built = criteria
        .map((c, idx) => {
          const maxU = parseSafeUnits(c.maxScore, 100);
          const stepU = Math.min(maxU, parseSafeUnits(c.stepScore, fallbackStep));
          return {
            id: c.id || `quick-c-${idx + 1}`,
            scoringUnitId: 'quick-u1',
            description: c.description.trim() || `得分点 ${idx + 1}`,
            maxUnits: maxU,
            stepUnits: stepU,
            exclusiveGroup: null,
          };
        })
        .filter((c) => c.maxUnits > 0);
      if (built.length) {
        return {
          id: 'zhixue-inline-rubric',
          itemId: 'zhixue-inline-item',
          version: 1,
          referenceAnswer: refAnswer.trim(),
          frozenAt: new Date().toISOString(),
          criteria: built,
          createdAt: new Date().toISOString(),
        };
      }
    }

    // Even with zero split points, allow immediate grading as a single holistic criterion
    if (!refAnswer.trim() && !prompt.trim() && fallbackMax <= 0) return null;
    return {
      id: 'zhixue-inline-rubric',
      itemId: 'zhixue-inline-item',
      version: 1,
      referenceAnswer: refAnswer.trim(),
      frozenAt: new Date().toISOString(),
      criteria: [
        {
          id: 'quick-c-all',
          scoringUnitId: 'quick-u1',
          description: refAnswer.trim()
            ? `对照参考答案整体按步长给分（满分 ${formatScore(fallbackMax)} 分）`
            : `根据本题作答完整性与物理正确性给分（满分 ${formatScore(fallbackMax)} 分）`,
          maxUnits: fallbackMax,
          stepUnits: fallbackStep,
          exclusiveGroup: null,
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }, [criteria, maxScore, stepScore, refAnswer, prompt]);

  const activeState = useMemo<ActiveZhixueRubric>(() => {
    if (source === 'exam') {
      if (activeExamItem?.rubric) {
        return {
          source: 'exam',
          rubric: activeExamItem.rubric,
          rubricId: activeExamItem.rubric.id,
          prompt: activeExamItem.prompt,
          summary: `复用：第 ${activeExamItem.label} 题（满分 ${formatScore(activeExamItem.maxUnits)} 分）`,
        };
      }
      return {
        source: 'exam',
        rubric: null,
        prompt: '',
        summary: '未选择考试中心细则',
      };
    }
    const totalU = quickRubric ? quickRubric.criteria.reduce((s, c) => s + c.maxUnits, 0) : 0;
    const ptsCount = quickRubric?.criteria.length || 0;
    return {
      source: 'quick',
      rubric: quickRubric,
      prompt: prompt.trim(),
      summary: quickRubric
        ? `现场细则 · 满分 ${formatScore(totalU)} 分 · ${criteria.length ? `${ptsCount} 个得分点` : '综合按步长给分'}`
        : '请填满分与参考答案',
    };
  }, [source, activeExamItem, quickRubric, prompt, criteria.length]);

  useEffect(() => {
    onChange(activeState);
  }, [activeState, onChange]);

  async function handleAiBreakdown() {
    if (!refAnswer.trim() && !prompt.trim()) {
      onNotify('请先输入参考答案或题干，再使用 AI 一键拆得分点', 'err');
      return;
    }
    setBreakingDown(true);
    try {
      const res = await window.workbenchApi.ai.breakdownReference({
        prompt: prompt.trim(),
        referenceAnswer: refAnswer.trim(),
        referenceImageDataUrls: [],
        totalScoreHint: maxScore.trim() || undefined,
      });
      if (res.criteria.length) {
        setCriteria(
          res.criteria.map((c, idx) => ({
            id: `quick-c-${Date.now()}-${idx}`,
            description: c.description,
            maxScore: c.maxScore || '1',
            stepScore: c.stepScore || stepScore || '1',
          })),
        );
        if (res.referenceAnswer && !refAnswer.trim()) setRefAnswer(res.referenceAnswer);
        onNotify(`已自动拆解 ${res.criteria.length} 个得分点，可直接开批！`);
      } else {
        onNotify('AI 未返回有效得分点，请手动添加', 'err');
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBreakingDown(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--bg-hover)]/60 cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
          )}
          <span className="text-xs font-semibold shrink-0">本题评分细则</span>
          <span className="text-[11px] text-[var(--ink-muted)] truncate">{activeState.summary}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-[var(--accent)] font-medium">
            {expanded ? '收起' : '设答案/细则'}
          </span>
          <Badge tone={activeState.rubric ? 'ok' : 'warn'}>
            {activeState.rubric ? '已就绪' : '待配置'}
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1.5 border-t border-[var(--border-subtle)] flex flex-col gap-2">
          {/* Quick vs ExamCenter toggle */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-muted)]">
            <button
              type="button"
              onClick={() => setSource('quick')}
              className={`flex-1 py-1 rounded-md text-[11.5px] font-medium cursor-pointer transition-colors ${
                source === 'quick'
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              快速现场细则（即开即用）
            </button>
            <button
              type="button"
              onClick={() => setSource('exam')}
              className={`flex-1 py-1 rounded-md text-[11.5px] font-medium cursor-pointer transition-colors ${
                source === 'exam'
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              复用考试中心细则
            </button>
          </div>

          {source === 'quick' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex-1 min-w-[90px] flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)]">
                  <span className="shrink-0 whitespace-nowrap">满分</span>
                  <Input
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    className="h-7 text-xs tabular-nums"
                  />
                </label>
                <label className="flex-1 min-w-[90px] flex items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)]">
                  <span className="shrink-0 whitespace-nowrap">步长</span>
                  <Input
                    value={stepScore}
                    onChange={(e) => setStepScore(e.target.value)}
                    className="h-7 text-xs tabular-nums"
                  />
                </label>
                {inferredMax !== null && (
                  <Button
                    size="xs"
                    variant="soft"
                    className="shrink-0"
                    title="从左侧网页探测到的得分选项自动填入满分与步长"
                    onClick={() => {
                      setMaxScore(String(inferredMax));
                      if (inferredStep !== null) setStepScore(String(inferredStep));
                      onNotify(`已同步网页分值：满分 ${inferredMax}，步长 ${inferredStep ?? 1}`);
                    }}
                  >
                    同步满分({inferredMax})
                  </Button>
                )}
              </div>

              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="题干/科目提示（选填，如：高二物理 动能定理计算题）"
                className="h-7 text-xs"
              />

              <Textarea
                value={refAnswer}
                onChange={(e) => setRefAnswer(e.target.value)}
                placeholder="粘贴参考答案与给分标准（例如：写出 F=ma 得 2 分；代入求得 a=2 m/s² 得 2 分；最终结果 10 N 得 2 分）…"
                className="min-h-[62px] text-xs"
              />

              <div className="flex items-center justify-between gap-1.5">
                <Button
                  size="xs"
                  variant="soft"
                  disabled={breakingDown}
                  onClick={() => void handleAiBreakdown()}
                >
                  <Sparkles className="w-3 h-3" />
                  {breakingDown ? 'AI 拆点中…' : 'AI 一键拆得分点'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setCriteria((prev) => [
                      ...prev,
                      {
                        id: `quick-c-${Date.now()}`,
                        description: '',
                        maxScore: stepScore || '2',
                        stepScore: stepScore || '1',
                      },
                    ])
                  }
                >
                  <Plus className="w-3 h-3" /> 手动加得分点
                </Button>
              </div>

              {criteria.length > 0 && (
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-0.5">
                  {criteria.map((c, idx) => (
                    <div key={c.id} className="flex items-center gap-1">
                      <span className="text-[10.5px] text-[var(--ink-muted)] w-4 shrink-0 tabular-nums">
                        {idx + 1}.
                      </span>
                      <Input
                        value={c.description}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((row) =>
                              row.id === c.id ? { ...row, description: e.target.value } : row,
                            ),
                          )
                        }
                        placeholder="得分点说明"
                        className="h-6 text-[11px] flex-1"
                      />
                      <Input
                        value={c.maxScore}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((row) =>
                              row.id === c.id ? { ...row, maxScore: e.target.value } : row,
                            ),
                          )
                        }
                        title="满分"
                        className="h-6 text-[11px] w-11 text-center tabular-nums"
                      />
                      <button
                        type="button"
                        title="删除得分点"
                        onClick={() => setCriteria((prev) => prev.filter((row) => row.id !== c.id))}
                        className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Select
                value={examId}
                onValueChange={setExamId}
                placeholder={exams.length ? '选择考试' : '暂无已建考试（请使用上方快速现场细则）'}
                className="w-full"
                options={exams.map((e) => ({ value: e.id, label: e.title }))}
              />
              {examDetail && (
                <Select
                  value={itemId}
                  onValueChange={setItemId}
                  placeholder={examDetail.gradingItems.length ? '选择试题细则' : '该考试暂未建主观题细则'}
                  className="w-full"
                  options={examDetail.gradingItems.map((i) => ({
                    value: i.id,
                    label: `第 ${i.label} 题（${formatScore(i.maxUnits)} 分）`,
                  }))}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
