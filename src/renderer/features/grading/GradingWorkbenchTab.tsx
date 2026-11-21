import { useEffect, useMemo, useRef, useState } from 'react';
import type * as echarts from 'echarts';
import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  Lock,
  Pause,
  Play,
  Plus,
  RotateCw,
  ScanEye,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ExamDetail,
  GradingItemDetail,
  GradingSubmission,
  KnowledgeStatRow,
  StudentMember,
} from '../../../shared/types';
import {
  highlightScanSegments,
  inspectImageBlob,
  LEGIBILITY_LABELS,
  POWER_PRESETS,
  type GradingResult,
} from '../../../shared/ai-engine';
import { formatScore, parsePoints, points } from '../../../shared/score-policy';
import { getTheme } from '../../themes';
import {
  Badge,
  Button,
  Card,
  Dropzone,
  Input,
  Modal,
  Select,
  Slider,
  Textarea,
} from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';

function quickScorePills(maxUnits: number, stepUnits: number): string[] {
  if (stepUnits <= 0 || maxUnits < 0 || Math.floor(maxUnits / stepUnits) > 12) return [];
  const res: string[] = [];
  for (let u = 0; u <= maxUnits; u += stepUnits) res.push(points(u));
  return res;
}

async function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function fetchUrlAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

export function GradingWorkbenchTab({
  detail,
  members,
  themeId,
  readonly,
  onReloadExam,
  onOpenAiSettings,
  onNotify,
}: {
  detail: ExamDetail;
  members: StudentMember[];
  themeId: string;
  readonly: boolean;
  onReloadExam: () => Promise<void>;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [subTab, setSubTab] = useState<'items' | 'studio' | 'knowledge'>('items');
  const [selectedItemId, setSelectedItemId] = useState(detail.gradingItems[0]?.id || '');
  const [submissions, setSubmissions] = useState<GradingSubmission[]>([]);
  const [activeSubId, setActiveSubId] = useState('');

  // Item Editor Modal state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GradingItemDetail | null>(null);
  const [iLabel, setILabel] = useState('15');
  const [iPrompt, setIPrompt] = useState('');
  const [iRefAns, setIRefAns] = useState('');
  const [iRefImgs, setIRefImgs] = useState<string[]>([]);
  const [iCriteria, setICriteria] = useState<
    Array<{ unitLabel: string; description: string; maxScore: string; stepScore: string }>
  >([
    { unitLabel: '第 1 问', description: '正确写出核心物理规律公式', maxScore: '4', stepScore: '1' },
    { unitLabel: '第 1 问', description: '代入计算结果与单位正确', maxScore: '6', stepScore: '1' },
  ]);
  const [aiBreaking, setAiBreaking] = useState(false);

  // Studio Image & Crop state
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotate, setImgRotate] = useState(0);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Scoring & AI Batch state
  const [uploadMemberId, setUploadMemberId] = useState(members[0]?.membershipId || '');
  const [threshold, setThreshold] = useState(88);
  const [aiResult, setAiResult] = useState<GradingResult | null>(null);
  const [editableScan, setEditableScan] = useState('');
  const [scoreValues, setScoreValues] = useState<Record<string, string>>({});
  const [scoreReasons, setScoreReasons] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [countdownMs, setCountdownMs] = useState(0);
  const batchStopRef = useRef(false);

  // Knowledge points state
  const [kpInput, setKpInput] = useState('');
  const [kpStats, setKpStats] = useState<KnowledgeStatRow[]>([]);
  const [kpWeights, setKpWeights] = useState<Record<string, number>>({});

  const items = detail.gradingItems;
  const currentItem = items.find((i) => i.id === selectedItemId) || items[0] || null;
  const activeSub = submissions.find((s) => s.id === activeSubId) || submissions[0] || null;

  useEffect(() => {
    if (items.length && !items.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(items[0].id);
    }
  }, [items, selectedItemId]);

  async function loadSubmissions(itemId?: string) {
    const id = itemId || currentItem?.id;
    if (!id) {
      setSubmissions([]);
      return;
    }
    const list = await window.workbenchApi.grading.listSubmissions(detail.exam.id, id);
    setSubmissions(list);
    if (list.length && !list.some((s) => s.id === activeSubId)) {
      setActiveSubId(list[0].id);
    }
  }

  useEffect(() => {
    void loadSubmissions();
  }, [detail.exam.id, currentItem?.id]);

  useEffect(() => {
    if (subTab === 'knowledge') {
      window.workbenchApi.grading.getKnowledgeStats(detail.exam.id).then(setKpStats);
    }
  }, [subTab, detail.exam.id, detail.gradingItems]);

  // Sync score inputs when switching active submission
  useEffect(() => {
    setAiResult(null);
    setEditableScan('');
    setImgZoom(1);
    setImgRotate(0);
    setCropMode(false);
    setCropRect(null);
    if (!currentItem?.rubric) return;
    const nextVals: Record<string, string> = {};
    const nextReasons: Record<string, string> = {};
    for (const c of currentItem.rubric.criteria) {
      const dec = activeSub?.decision?.scores.find((s) => s.criterionId === c.id);
      nextVals[c.id] = dec ? points(dec.units) : '0';
      nextReasons[c.id] = dec?.reason || '';
    }
    setScoreValues(nextVals);
    setScoreReasons(nextReasons);
    setComment(activeSub?.decision?.comment || '');
  }, [activeSub?.id, currentItem?.rubric?.id]);

  // Esc emergency stop for batch countdown
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (batchRunning || countdownMs > 0)) {
        batchStopRef.current = true;
        setBatchRunning(false);
        setCountdownMs(0);
        onNotify('已按 Esc 紧急暂停批量批阅');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [batchRunning, countdownMs, onNotify]);

  function openItemEditor(item: GradingItemDetail | null) {
    setEditingItem(item);
    setILabel(item?.label || String(items.length + 1));
    setIPrompt(item?.prompt || '');
    setIRefAns(item?.rubric?.referenceAnswer || '');
    setIRefImgs([]);
    if (item?.rubric) {
      const unitMap = new Map(item.scoringUnits.map((u) => [u.id, u.label]));
      setICriteria(
        item.rubric.criteria.map((c) => ({
          unitLabel: unitMap.get(c.scoringUnitId) || '第 1 问',
          description: c.description,
          maxScore: points(c.maxUnits),
          stepScore: points(c.stepUnits),
        })),
      );
    } else {
      setICriteria([
        { unitLabel: '第 1 问', description: '正确列出公式或思路', maxScore: '4', stepScore: '1' },
        { unitLabel: '第 1 问', description: '代入计算与单位正确', maxScore: '6', stepScore: '1' },
      ]);
    }
    setItemModalOpen(true);
  }

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
        examId: detail.exam.id,
        itemId: editingItem?.id,
        label: iLabel,
        prompt: iPrompt,
        referenceAnswer: iRefAns,
        scoringUnits,
        criteria,
      });
      setSelectedItemId(saved.id);
      setItemModalOpen(false);
      await onReloadExam();
      onNotify(`已保存「第 ${saved.label} 题」并在本场成绩表中自动关联了对应成绩列`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function handleUploadStudentPhoto(files: File[], targetMemberId: string) {
    if (!currentItem || !files.length || !targetMemberId) return;
    try {
      const file = files[0];
      const buf = new Uint8Array(await file.arrayBuffer());
      const bmp = await createImageBitmap(file);
      const asset = await window.workbenchApi.grading.uploadPhoto({
        examId: detail.exam.id,
        role: 'answer',
        bytes: Array.from(buf),
        mime: file.type || 'image/jpeg',
        width: bmp.width,
        height: bmp.height,
      });
      bmp.close();
      const sub = await window.workbenchApi.grading.saveSubmission({
        examId: detail.exam.id,
        itemId: currentItem.id,
        membershipId: targetMemberId,
        assetIds: [asset.id],
      });
      await loadSubmissions(currentItem.id);
      setActiveSubId(sub.id);
      await onReloadExam();
      onNotify(`已为「${sub.studentName}」保存答卷照片至资料库 photos/ 目录`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function applyCropToActive() {
    if (!activeSub || !currentItem || !cropRect || !imgRef.current) return;
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = Math.max(0, Math.round(cropRect.x * scaleX));
    const sy = Math.max(0, Math.round(cropRect.y * scaleY));
    const sw = Math.max(20, Math.round(cropRect.w * scaleX));
    const sh = Math.max(20, Math.round(cropRect.h * scaleY));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const asset = await window.workbenchApi.grading.uploadPhoto({
      examId: detail.exam.id,
      role: 'answer',
      bytes: Array.from(buf),
      mime: 'image/jpeg',
      width: sw,
      height: sh,
    });
    await window.workbenchApi.grading.saveSubmission({
      examId: detail.exam.id,
      itemId: currentItem.id,
      membershipId: activeSub.membershipId,
      assetIds: [asset.id],
    });
    setCropMode(false);
    setCropRect(null);
    await loadSubmissions(currentItem.id);
    onNotify('已完成答卷裁剪并替换保存');
  }

  async function runAiGradeSubmission(sub: GradingSubmission): Promise<GradingResult | null> {
    if (!currentItem?.rubric) return null;
    if (!sub.assets.length) {
      onNotify('该答卷还没有照片，请先上传', 'err');
      return null;
    }
    setAiRunning(true);
    try {
      const blob = await fetchUrlAsBlob(`workbench-asset://vault/${sub.assets[0].relPath}`);
      const { dataUrl, gate } = await inspectImageBlob(blob);
      const scan = await window.workbenchApi.ai.runBlindScan({
        imageDataUrls: [dataUrl],
        imageGate: gate,
        typedText: sub.typedText,
        subjectHint: detail.exam.title,
      });
      const res = await window.workbenchApi.ai.runScoring({
        scan,
        scanText: scan.restoredText,
        rubricId: currentItem.rubric.id,
        itemPrompt: currentItem.prompt,
        threshold,
      });
      setAiResult(res);
      setEditableScan(res.scan.restoredText);
      const nextVals: Record<string, string> = {};
      const nextReasons: Record<string, string> = {};
      for (const a of res.adoptions) {
        nextVals[a.criterionId] = a.suggestedValue || '0';
        nextReasons[a.criterionId] = a.reason;
      }
      setScoreValues(nextVals);
      setScoreReasons(nextReasons);
      setComment(res.overallComment);
      return res;
    } catch (e) {
      onNotify((e as Error).message, 'err');
      return null;
    } finally {
      setAiRunning(false);
    }
  }

  async function reScoreWithEditedText() {
    if (!aiResult || !currentItem?.rubric) return;
    setAiRunning(true);
    try {
      const res = await window.workbenchApi.ai.runScoring({
        scan: aiResult.scan,
        scanText: editableScan,
        rubricId: currentItem.rubric.id,
        itemPrompt: currentItem.prompt,
        threshold,
      });
      setAiResult(res);
      const nextVals: Record<string, string> = {};
      const nextReasons: Record<string, string> = {};
      for (const a of res.adoptions) {
        nextVals[a.criterionId] = a.suggestedValue || '0';
        nextReasons[a.criterionId] = a.reason;
      }
      setScoreValues(nextVals);
      setScoreReasons(nextReasons);
      setComment(res.overallComment);
      onNotify('已按修正后的识别内容重新判定各得分点');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setAiRunning(false);
    }
  }

  async function confirmCurrentScore(source: 'manual' | 'ai-auto' | 'ai-assisted' = 'manual') {
    if (!activeSub || !currentItem?.rubric) return;
    try {
      const scores = currentItem.rubric.criteria.map((c) => ({
        criterionId: c.id,
        units: parsePoints(scoreValues[c.id] || '0'),
        reason: scoreReasons[c.id] || '',
      }));
      await window.workbenchApi.grading.confirmDecision({
        submissionId: activeSub.id,
        rubricId: currentItem.rubric.id,
        scores,
        comment,
        source,
        confidence: aiResult?.confidence.total ?? null,
      });
      await loadSubmissions(currentItem.id);
      await onReloadExam();
      onNotify(`已确认「${activeSub.studentName}」得分并实时回填进本场成绩总表！`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function startBatchAutoGrade() {
    if (!currentItem?.rubric?.frozenAt) {
      onNotify('请先在「1. 试题与细则」中点击定稿启用', 'err');
      return;
    }
    const pending = submissions.filter((s) => !s.decision && s.assets.length > 0);
    if (!pending.length) {
      onNotify('本题目没有待批阅的答卷');
      return;
    }
    batchStopRef.current = false;
    setBatchRunning(true);
    for (const sub of pending) {
      if (batchStopRef.current) break;
      setActiveSubId(sub.id);
      const res = await runAiGradeSubmission(sub);
      if (!res || batchStopRef.current) break;
      if (res.confidence.decision !== 'auto') {
        onNotify(`「${sub.studentName}」置信度 ${res.confidence.total}% 未达阈值 ${threshold}%，已暂停等待你人工把关`, 'err');
        break;
      }
      // 1.5s interceptable countdown
      for (let left = 1500; left > 0; left -= 150) {
        if (batchStopRef.current) break;
        setCountdownMs(left);
        await new Promise((r) => setTimeout(r, 150));
      }
      setCountdownMs(0);
      if (batchStopRef.current) break;
      await window.workbenchApi.grading.confirmDecision({
        submissionId: sub.id,
        rubricId: currentItem.rubric.id,
        scores: res.adoptions.map((a) => ({
          criterionId: a.criterionId,
          units: a.suggestedUnits,
          reason: a.reason,
        })),
        comment: res.overallComment || `AI 高置信自动确认 (${res.confidence.total}%)`,
        source: 'ai-auto',
        confidence: res.confidence.total,
      });
      await loadSubmissions(currentItem.id);
      await onReloadExam();
    }
    setBatchRunning(false);
    setCountdownMs(0);
  }

  // Knowledge Chart
  const theme = getTheme(themeId);
  const kpChartOption: echarts.EChartsOption | null = useMemo(() => {
    if (!kpStats.length) return null;
    const p = theme.chartPalette;
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex: number }).dataIndex;
          const row = kpStats[idx];
          return `${row.name}<br/>得分率：<b>${row.rate.toFixed(1)}%</b><br/>关联题目：${row.itemLabels.join('、') || '无'}`;
        },
      },
      grid: { top: 12, right: 32, bottom: 20, left: 110 },
      xAxis: {
        type: 'value',
        max: 100,
        axisLabel: { color: p.muted, formatter: '{value}%' },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: kpStats.map((k) => k.name),
        axisLabel: { color: p.text, fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          data: kpStats.map((k) => ({
            value: Number(k.rate.toFixed(1)),
            itemStyle: {
              borderRadius: [0, 6, 6, 0],
              color: k.rate < 60 ? '#be2d24' : k.rate < 80 ? '#d97706' : p.primary,
            },
          })),
        },
      ],
    };
  }, [kpStats, theme]);

  const currentTotalUnits = useMemo(() => {
    if (!currentItem?.rubric) return 0;
    return currentItem.rubric.criteria.reduce((sum, c) => {
      try {
        return sum + parsePoints(scoreValues[c.id] || '0');
      } catch {
        return sum;
      }
    }, 0);
  }, [currentItem?.rubric, scoreValues]);

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Sub-navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-muted)] gap-1">
          {(
            [
              ['items', `1. 试题与评分细则 (${items.length})`],
              ['studio', `2. 专业看图与 AI 批阅台`],
              ['knowledge', `3. 知识点讲评 (${detail.knowledgePoints.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSubTab(k)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-colors ${
                subTab === k
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {items.length > 0 && subTab === 'studio' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--ink-muted)]">当前阅卷题</span>
            <Select
              value={currentItem?.id || ''}
              onValueChange={setSelectedItemId}
              options={items.map((i) => ({
                value: i.id,
                label: `第 ${i.label} 题（${formatScore(i.maxUnits)} 分）`,
                hint: `已确 ${i.confirmedCount}/${i.submissionCount} 份`,
              }))}
            />
          </div>
        )}
      </div>

      {/* TAB 1: Items & Rubrics */}
      {subTab === 'items' && (
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">
              每建一道主观题，系统会自动在「成绩分析」总表中生成对应成绩列；确认打分后实时回填总表。
            </span>
            <Button size="sm" variant="primary" disabled={readonly} onClick={() => openItemEditor(null)}>
              <Plus className="w-4 h-4" /> 添加主观题与细则
            </Button>
          </div>

          {!items.length && (
            <Card className="p-10 text-center">
              <p className="text-sm text-[var(--ink-muted)] mb-4">
                本场考试还没有配置手写主观题。新建题目后支持粘贴参考答案让 AI 一键拆解评分点。
              </p>
              <Button variant="primary" disabled={readonly} onClick={() => openItemEditor(null)}>
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
                        <Button size="xs" disabled={readonly} onClick={() => openItemEditor(item)}>
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
                    <Button
                      size="xs"
                      variant="soft"
                      onClick={() => {
                        setSelectedItemId(item.id);
                        setSubTab('studio');
                      }}
                    >
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
      )}

      {/* TAB 2: Professional Dark-Canvas Studio + Light Scoring Inspector */}
      {subTab === 'studio' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2.5">
          {!currentItem ? (
            <Card className="p-10 text-center text-sm text-[var(--ink-muted)]">
              请先在第 1 步创建至少一道主观题。
            </Card>
          ) : (
            <>
              {/* Quick Upload & Batch Power Control Strip */}
              <Card className="px-3 py-2 flex items-center flex-wrap gap-2.5 shrink-0">
                <div className="flex items-center gap-1.5">
                  <Select
                    value={uploadMemberId}
                    onValueChange={setUploadMemberId}
                    placeholder="选学生传照片"
                    className="w-36"
                    options={members.map((m) => ({
                      value: m.membershipId,
                      label: m.name,
                      hint: m.rosterNo,
                    }))}
                  />
                  <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[12.5px] font-medium hover:bg-[var(--bg-hover)] cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> 传答卷照
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={readonly || !uploadMemberId}
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          void handleUploadStudentPhoto(Array.from(e.target.files), uploadMemberId);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="h-5 w-px bg-[var(--border-subtle)]" />

                {/* Semi-Auto Power Slider */}
                <div className="flex items-center gap-2 min-w-[240px]">
                  <span className="text-xs text-[var(--ink-muted)] whitespace-nowrap">半自动功率</span>
                  <div className="w-28">
                    <Slider value={threshold} min={65} max={100} step={1} onChange={setThreshold} />
                  </div>
                  <Badge tone={threshold >= 100 ? 'ok' : threshold >= 85 ? 'info' : 'warn'}>
                    {threshold >= 100 ? '纯把关' : `${threshold}%`}
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  {POWER_PRESETS.map((p) => (
                    <button
                      key={p.threshold}
                      type="button"
                      onClick={() => setThreshold(p.threshold)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                        threshold === p.threshold
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                          : 'bg-[var(--bg-muted)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {p.short}
                    </button>
                  ))}
                </div>

                <div className="flex-1" />

                {batchRunning ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      batchStopRef.current = true;
                      setBatchRunning(false);
                    }}
                  >
                    <Pause className="w-3.5 h-3.5" /> 暂停批量 (Esc)
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={readonly || aiRunning || !submissions.some((s) => !s.decision)}
                    onClick={() => void startBatchAutoGrade()}
                  >
                    <Play className="w-3.5 h-3.5" /> 批量 AI 批阅待评卷
                  </Button>
                )}
              </Card>

              {/* Main 3-Column Studio: Queue | Dark Image Canvas | Light Scoring Inspector */}
              <div className="flex-1 min-h-0 grid grid-cols-12 gap-2.5">
                {/* Queue Column */}
                <Card className="col-span-2 flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-xs font-semibold flex items-center justify-between">
                    <span>答卷队列</span>
                    <Badge>{submissions.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
                    {submissions.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setActiveSubId(sub.id)}
                        className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          activeSub?.id === sub.id
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]'
                            : 'hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[12.5px] font-medium truncate">{sub.studentName}</span>
                          {sub.decision ? (
                            <span className="text-[11px] font-bold text-[var(--ok)] tabular-nums">
                              {formatScore(sub.decision.totalUnits)}
                            </span>
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-[var(--warn)] shrink-0" />
                          )}
                        </div>
                        <div className="text-[10.5px] text-[var(--ink-muted)] truncate">
                          {sub.decision ? '已确认同步' : '待评阅'}
                        </div>
                      </button>
                    ))}
                    {!submissions.length && (
                      <div className="p-4 text-center text-xs text-[var(--ink-muted)]">
                        请在上方选学生上传答卷照
                      </div>
                    )}
                  </div>
                </Card>

                {/* Dark Immersive Image Review Canvas */}
                <div className="col-span-5 rounded-xl bg-[var(--grading-canvas)] border border-[var(--border-strong)] flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-black/40 border-b border-white/10 flex items-center justify-between text-white/85 text-xs">
                    <span className="font-medium truncate">
                      {activeSub ? `${activeSub.studentName} · 手写原图` : '暗色沉浸看图区'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="缩小"
                        onClick={() => setImgZoom((z) => Math.max(0.5, z - 0.2))}
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="tabular-nums px-1">{Math.round(imgZoom * 100)}%</span>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="放大"
                        onClick={() => setImgZoom((z) => Math.min(2.4, z + 0.2))}
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="顺时针旋转90°"
                        onClick={() => setImgRotate((r) => (r + 90) % 360)}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer ${
                          cropMode ? 'bg-emerald-500 text-black font-semibold' : 'hover:bg-white/10'
                        }`}
                        onClick={() => {
                          setCropMode((v) => !v);
                          setCropRect(null);
                        }}
                      >
                        <Crop className="w-3.5 h-3.5" /> {cropMode ? '框选中' : '框选裁剪'}
                      </button>
                      {cropRect && (
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded bg-emerald-500 text-black font-semibold cursor-pointer"
                          onClick={() => void applyCropToActive()}
                        >
                          应用裁剪
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative">
                    {activeSub?.assets[0] ? (
                      <div
                        className="relative inline-block select-none"
                        onPointerDown={(e) => {
                          if (!cropMode) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          cropStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                          setCropRect({ x: cropStartRef.current.x, y: cropStartRef.current.y, w: 0, h: 0 });
                        }}
                        onPointerMove={(e) => {
                          if (!cropMode || !cropStartRef.current) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const cx = e.clientX - rect.left;
                          const cy = e.clientY - rect.top;
                          const sx = cropStartRef.current.x;
                          const sy = cropStartRef.current.y;
                          setCropRect({
                            x: Math.min(sx, cx),
                            y: Math.min(sy, cy),
                            w: Math.abs(cx - sx),
                            h: Math.abs(cy - sy),
                          });
                        }}
                        onPointerUp={() => {
                          cropStartRef.current = null;
                        }}
                      >
                        <img
                          ref={imgRef}
                          src={`workbench-asset://vault/${activeSub.assets[0].relPath}`}
                          alt="学生答卷"
                          draggable={false}
                          style={{
                            transform: `scale(${imgZoom}) rotate(${imgRotate}deg)`,
                            transformOrigin: 'center center',
                          }}
                          className={`max-h-[58vh] object-contain transition-transform ${
                            cropMode ? 'cursor-crosshair' : ''
                          }`}
                        />
                        {cropMode && cropRect && cropRect.w > 4 && (
                          <div
                            className="absolute border-2 border-emerald-400 bg-emerald-400/15 pointer-events-none"
                            style={{
                              left: cropRect.x,
                              top: cropRect.y,
                              width: cropRect.w,
                              height: cropRect.h,
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="text-white/45 text-xs text-center">
                        暂无答卷图像
                        <br />
                        在上方选择学生并上传答卷照片
                      </div>
                    )}
                  </div>
                </div>

                {/* Light High-Speed Scoring & AI Confidence Inspector */}
                <Card className="col-span-5 flex flex-col overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold">
                        得分点判分 · 合计{' '}
                        <span className="text-[var(--accent)] tabular-nums">
                          {formatScore(currentTotalUnits)} / {formatScore(currentItem.maxUnits)}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="soft"
                        disabled={!activeSub || aiRunning}
                        onClick={() => activeSub && void runAiGradeSubmission(activeSub)}
                      >
                        <ScanEye className="w-3.5 h-3.5" /> {aiRunning ? 'AI 识图判分中…' : 'AI 盲识图判分'}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={onOpenAiSettings}>
                        模型设置
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
                    {countdownMs > 0 && (
                      <div className="p-2.5 rounded-xl bg-[var(--ok-soft)] text-[var(--ok)] text-xs font-medium flex items-center justify-between">
                        <span>高置信自动确认倒计时 {(countdownMs / 1000).toFixed(1)}s…</span>
                        <Button
                          size="xs"
                          variant="danger"
                          onClick={() => {
                            batchStopRef.current = true;
                            setCountdownMs(0);
                            setBatchRunning(false);
                          }}
                        >
                          拦截 (Esc)
                        </Button>
                      </div>
                    )}

                    {/* AI Confidence & VLM×OCR Highlight Output */}
                    {aiResult && (
                      <div className="flex flex-col gap-2">
                        <div
                          className={`p-3 rounded-xl border text-xs flex flex-col gap-1.5 ${
                            aiResult.confidence.redlines.length
                              ? 'bg-[var(--danger-soft)] border-[var(--danger)]/40 text-[var(--danger)]'
                              : aiResult.confidence.decision === 'auto'
                                ? 'bg-[var(--ok-soft)] border-[var(--ok)]/40 text-[var(--ok)]'
                                : 'bg-[var(--warn-soft)] border-[var(--warn)]/40 text-[var(--warn)]'
                          }`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="inline-flex items-center gap-1">
                              {aiResult.confidence.redlines.length ? (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              综合客观置信度 {aiResult.confidence.total}%
                            </span>
                            <span>
                              字迹：{LEGIBILITY_LABELS[aiResult.scan.legibility]} · OCR{' '}
                              {aiResult.confidence.ocrScore}/40
                            </span>
                          </div>
                          <div>{aiResult.confidence.summary}</div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]/70 border border-[var(--border-subtle)] flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span>扫描复原文本（OCR 冲突已标黄）</span>
                            <div className="flex items-center gap-1.5">
                              {aiResult.scan.ocr.conflicts.length > 0 && (
                                <Button
                                  size="xs"
                                  onClick={() => setEditableScan(aiResult.scan.ocr.ocrText)}
                                >
                                  采用 OCR 原文
                                </Button>
                              )}
                              <Button size="xs" variant="soft" disabled={aiRunning} onClick={() => void reScoreWithEditedText()}>
                                按修正重算得分点
                              </Button>
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-[var(--bg-surface)] text-[12.5px] leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
                            {highlightScanSegments(editableScan, aiResult.scan.ocr.conflicts).map(
                              (seg, i) =>
                                seg.conflict ? (
                                  <mark key={i} className="ocr-diff" title={seg.conflict.reason}>
                                    {seg.text}
                                  </mark>
                                ) : (
                                  <span key={i}>{seg.text}</span>
                                ),
                            )}
                          </div>
                          <Textarea
                            rows={2}
                            value={editableScan}
                            onChange={(e) => setEditableScan(e.target.value)}
                            className="text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* Rubric Criteria Quick Pills */}
                    {currentItem.rubric?.criteria.map((c, idx) => {
                      const pills = quickScorePills(c.maxUnits, c.stepUnits);
                      const val = scoreValues[c.id] || '0';
                      return (
                        <div
                          key={c.id}
                          className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex flex-col gap-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-medium">
                              {idx + 1}. {c.description}
                            </span>
                            <Badge tone="neutral">上限 {formatScore(c.maxUnits)}</Badge>
                          </div>
                          <div className="flex items-center flex-wrap gap-1.5">
                            {pills.map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setScoreValues({ ...scoreValues, [c.id]: p })}
                                className={`min-w-[34px] h-7 px-2 rounded-lg text-xs font-semibold tabular-nums border cursor-pointer transition-colors ${
                                  val === p
                                    ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]'
                                    : 'bg-[var(--bg-surface)] border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                                }`}
                              >
                                {p}
                              </button>
                            ))}
                            <input
                              value={val}
                              onChange={(e) => setScoreValues({ ...scoreValues, [c.id]: e.target.value })}
                              className="w-16 h-7 px-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs tabular-nums"
                            />
                          </div>
                          {scoreReasons[c.id] && (
                            <div className="text-[11.5px] text-[var(--ink-muted)]">
                              AI 理由：{scoreReasons[c.id]}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-secondary)]">
                      总评 / 改分备注（可选）
                      <Input
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="如：公式正确，最后单位漏写扣 1 分"
                        className="h-8 text-xs"
                      />
                    </label>
                  </div>

                  <div className="px-3.5 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/50 flex items-center justify-between gap-2 shrink-0">
                    {activeSub && !readonly && (
                      <Button
                        size="xs"
                        variant="danger-ghost"
                        onClick={async () => {
                          await window.workbenchApi.grading.softDeleteSubmission(activeSub.id);
                          await loadSubmissions(currentItem.id);
                          onNotify('该答卷已移入回收站');
                        }}
                      >
                        移入回收站
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={readonly || !activeSub || !currentItem.rubric}
                      onClick={() =>
                        void confirmCurrentScore(aiResult ? 'ai-assisted' : 'manual')
                      }
                    >
                      <CheckCircle2 className="w-4 h-4" /> 确认得分并回填总表
                    </Button>
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: Knowledge Points & Weakness ECharts */}
      {subTab === 'knowledge' && (
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-3 pr-1">
          <Card className="p-4 flex flex-col gap-3">
            <h4 className="text-[14px] font-semibold">本场知识点管理与权重分配</h4>
            <div className="flex gap-2">
              <Input
                value={kpInput}
                onChange={(e) => setKpInput(e.target.value)}
                placeholder="输入知识点（逗号分隔批量添加，如：牛顿第二定律, 受力分析, 图像法）"
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                variant="primary"
                disabled={readonly || !kpInput.trim()}
                onClick={async () => {
                  const nextNames = [
                    ...detail.knowledgePoints.map((k) => k.name),
                    ...kpInput.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean),
                  ];
                  await window.workbenchApi.grading.saveKnowledgePoints(detail.exam.id, nextNames);
                  setKpInput('');
                  await onReloadExam();
                  onNotify('已更新本场知识点');
                }}
              >
                添加
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detail.knowledgePoints.map((kp) => (
                <Badge key={kp.id} tone="accent">
                  {kp.name}
                </Badge>
              ))}
            </div>

            {currentItem && detail.knowledgePoints.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    为「第 {currentItem.label} 题」分配知识点权重（合计 100%）
                  </span>
                  <Button
                    size="xs"
                    onClick={() => {
                      const n = detail.knowledgePoints.length;
                      const each = Math.floor(100 / n);
                      const next: Record<string, number> = {};
                      detail.knowledgePoints.forEach((k, i) => {
                        next[k.id] = i === 0 ? 100 - each * (n - 1) : each;
                      });
                      setKpWeights(next);
                    }}
                  >
                    一键均分
                  </Button>
                </div>
                {detail.knowledgePoints.map((kp) => (
                  <div key={kp.id} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate">{kp.name}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={kpWeights[kp.id] ?? 0}
                      onChange={(e) =>
                        setKpWeights({ ...kpWeights, [kp.id]: Math.max(0, Math.min(100, Number(e.target.value))) })
                      }
                      className="w-16 h-7 px-2 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] tabular-nums"
                    />
                    <span>%</span>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={readonly}
                  onClick={async () => {
                    try {
                      const allocs = detail.knowledgePoints
                        .map((k) => ({ knowledgeId: k.id, weightBps: (kpWeights[k.id] || 0) * 100 }))
                        .filter((a) => a.weightBps > 0);
                      await window.workbenchApi.grading.saveItemKnowledgeMap(currentItem.id, allocs);
                      const st = await window.workbenchApi.grading.getKnowledgeStats(detail.exam.id);
                      setKpStats(st);
                      await onReloadExam();
                      onNotify('已保存知识点权重并刷新讲评统计');
                    } catch (e) {
                      onNotify((e as Error).message, 'err');
                    }
                  }}
                >
                  保存权重映射
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-4 flex flex-col gap-3">
            <h4 className="text-[14px] font-semibold">薄弱知识点得分率排行（讲评优先级）</h4>
            {kpChartOption ? (
              <EChart option={kpChartOption} height={260} />
            ) : (
              <div className="py-16 text-center text-xs text-[var(--ink-muted)]">
                给主观题分配知识点权重并确认至少 1 份答卷得分后，这里将自动生成薄弱点排行图。
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Item & Rubric Editor Modal (with AI Reference Breakdown!) */}
      <Modal
        open={itemModalOpen}
        onOpenChange={setItemModalOpen}
        title={editingItem ? `编辑第 ${editingItem.label} 题细则` : '新建主观题与评分细则'}
        subtitle="支持粘贴参考答案文字或上传参考答案照片，由 AI 一键拆解出得分点清单"
        size="lg"
        footer={
          <>
            <Button onClick={() => setItemModalOpen(false)}>取消</Button>
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
                const urls = await Promise.all(files.slice(0, 4).map(fileToDataUrl));
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
    </div>
  );
}
