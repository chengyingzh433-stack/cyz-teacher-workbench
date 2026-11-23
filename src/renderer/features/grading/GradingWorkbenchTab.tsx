import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  Pause,
  Play,
  RotateCw,
  ScanEye,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ExamDetail,
  GradingItemDetail,
  GradingSubmission,
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
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Slider,
  Textarea,
} from '../../components/ui/primitives';
import { GradingItemsTab } from './GradingItemsTab';
import { GradingItemModal } from './GradingItemModal';
import { GradingKnowledgeTab } from './GradingKnowledgeTab';

function quickScorePills(maxUnits: number, stepUnits: number): string[] {
  if (stepUnits <= 0 || maxUnits < 0 || Math.floor(maxUnits / stepUnits) > 12) return [];
  const res: string[] = [];
  for (let u = 0; u <= maxUnits; u += stepUnits) res.push(points(u));
  return res;
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
    setItemModalOpen(true);
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
        <GradingItemsTab
          items={items}
          readonly={readonly}
          onOpenItemEditor={openItemEditor}
          onEnterStudio={(itemId) => {
            setSelectedItemId(itemId);
            setSubTab('studio');
          }}
          onReloadExam={onReloadExam}
          onNotify={onNotify}
        />
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
        <GradingKnowledgeTab
          detail={detail}
          currentItem={currentItem}
          themeId={themeId}
          readonly={readonly}
          onReloadExam={onReloadExam}
          onNotify={onNotify}
        />
      )}

      {/* Item & Rubric Editor Modal (with AI Reference Breakdown!) */}
      <GradingItemModal
        open={itemModalOpen}
        onOpenChange={setItemModalOpen}
        examId={detail.exam.id}
        editingItem={editingItem}
        nextItemNumber={items.length + 1}
        onSaved={async (savedItemId) => {
          setSelectedItemId(savedItemId);
          await onReloadExam();
        }}
        onNotify={onNotify}
      />
    </div>
  );
}
