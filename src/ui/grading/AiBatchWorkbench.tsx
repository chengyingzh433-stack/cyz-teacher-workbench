import { useEffect, useRef, useState } from 'react';
import type { WorkbenchStore, StoreState } from '../../app/store';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { confirmScores, latestDecision, latestSubmission, type Item, type Submission } from '../../modules/grading';
import {
  inspectImageBlob,
  runBlindScanStage,
  runScoringStage,
  type GradingResult,
  type ImageGateResult,
  type PointAdoption,
} from '../../modules/grading/ai-engine';
import { calculateScores, points, type Rubric, type ScoreInput } from '../../modules/grading/score-policy';
import { ErrorText } from '../Modal';
import { Badge, Dropzone } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, BlobImage } from './shared';
import { ConfidenceMeter, playPauseChime, PowerSlider, ScannedContentBox } from './AiScanView';

type QuickPaper = {
  id: string;
  name: string;
  blob: Blob;
  status: 'pending' | 'auto-done' | 'manual-done' | 'skipped';
  totalUnits?: number;
  confidence?: number;
};

type ActivePaper = {
  key: string;
  label: string;
  submission?: Submission;
  blobs: Blob[];
  typedText?: string;
};

const ADOPTION_BADGE: Record<PointAdoption['status'], { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  full: { label: '✓ 命中', tone: 'success' },
  partial: { label: '△ 部分', tone: 'info' },
  none: { label: '✗ 未得', tone: 'neutral' },
  uncertain: { label: '? 存疑', tone: 'warning' },
};

function quickScores(maxUnits: number, stepUnits: number) {
  if (stepUnits <= 0 || maxUnits < 0 || Math.floor(maxUnits / stepUnits) > 10) return [];
  const res: string[] = [];
  for (let u = 0; u <= maxUnits; u += stepUnits) res.push(points(u));
  return res;
}

export function AiBatchWorkbench({
  store,
  state,
  classId,
  items,
  connection,
  threshold,
  onThresholdChange,
  openSettings,
  readonly,
}: {
  store: WorkbenchStore;
  state: StoreState;
  classId: string;
  items: Item[];
  connection: AssistantConnection;
  threshold: number;
  onThresholdChange: (next: number) => void;
  openSettings: (tab?: 'general' | 'grading') => void;
  readonly: boolean;
}) {
  const s = state.snapshot!, g = s.data.grading;
  const readyItems = items.filter((item) => g.rubrics.some((r) => r.itemId === item.id && r.frozenAt));
  const [itemId, setItemId] = useState(readyItems[0]?.id || items[0]?.id || '');
  const selectedItem = items.find((i) => i.id === itemId) || readyItems[0] || items[0];
  const rubric: Rubric | undefined = selectedItem
    ? g.rubrics.filter((r) => r.itemId === selectedItem.id).sort((a, b) => b.version - a.version)[0]
    : undefined;
  const isFrozen = !!rubric?.frozenAt;

  const [sourceMode, setSourceMode] = useState<'submissions' | 'quick'>('quick');
  const [quickQueue, setQuickQueue] = useState<QuickPaper[]>([]);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [chime, setChime] = useState(true);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stageText, setStageText] = useState('');
  const [countdownMs, setCountdownMs] = useState(0);
  const [error, setError] = useState('');

  const [active, setActive] = useState<ActivePaper | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [scanText, setScanText] = useState('');
  const [inputs, setInputs] = useState<ScoreInput[]>([]);
  const [comment, setComment] = useState('');
  const [stats, setStats] = useState({ auto: 0, manual: 0, skipped: 0 });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const thresholdRef = useRef(threshold);
  const chimeRef = useRef(chime);
  const processedRef = useRef<Set<string>>(new Set());
  thresholdRef.current = threshold;
  chimeRef.current = chime;

  // Pending class submissions for selected item
  const pendingSubmissions: Submission[] = selectedItem
    ? s.data.memberships
        .filter((m) => m.classId === classId)
        .flatMap((m) => {
          const sub = latestSubmission(g, selectedItem.id, m.id);
          if (!sub || sub.completeness !== 'complete' || latestDecision(g, sub.id) || skippedIds.has(sub.id)) return [];
          return [sub];
        })
    : [];

  const pendingQuick = quickQueue.filter((q) => q.status === 'pending');
  const quickQueueRef = useRef(quickQueue);
  const pendingSubRef = useRef(pendingSubmissions);
  const sourceModeRef = useRef(sourceMode);
  quickQueueRef.current = quickQueue;
  pendingSubRef.current = pendingSubmissions;
  sourceModeRef.current = sourceMode;

  // Switch automatically to submissions mode if there are pending class submissions and no quick files yet
  useEffect(() => {
    if (pendingSubmissions.length > 0 && quickQueue.length === 0) setSourceMode('submissions');
  }, [selectedItem?.id]);

  // Support Ctrl/Cmd+V image paste directly into quick test queue!
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (sourceMode !== 'quick') return;
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (!files.length) return;
      e.preventDefault();
      addQuickFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sourceMode]);

  // Esc emergency stop for countdown / batch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (running || countdownMs > 0)) {
        stopBatch('已按 Esc 紧急暂停');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, countdownMs]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  function addQuickFiles(files: File[]) {
    const added: QuickPaper[] = files
      .filter((f) => f.type.startsWith('image/'))
      .map((f, idx) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${idx}`,
        name: f.name || `粘贴截图 ${quickQueue.length + idx + 1}`,
        blob: f,
        status: 'pending',
      }));
    if (added.length) setQuickQueue((prev) => [...prev, ...added]);
  }

  function clearTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdownMs(0);
  }

  function stopBatch(msg = '') {
    abortRef.current?.abort();
    clearTimer();
    setRunning(false);
    setPaused(true);
    setStageText(msg);
  }

  function buildNextPaper(excludeKey?: string): ActivePaper | null {
    const done = processedRef.current;
    if (sourceModeRef.current === 'submissions') {
      const next = pendingSubRef.current.find((sub) => sub.id !== excludeKey && !done.has(sub.id));
      if (!next) return null;
      const curState = store.getState();
      const snap = curState.snapshot!;
      const m = snap.data.memberships.find((x) => x.id === next.membershipId);
      const st = snap.data.students.find((x) => x.id === m?.studentId);
      const blobs = next.assetIds
        .map((aid) => {
          const ast = snap.data.grading.assets.find((x) => x.id === aid);
          return ast ? curState.files.get(ast.hash) : undefined;
        })
        .filter((b): b is Blob => !!b);
      return {
        key: next.id,
        label: `${st?.name || '学生'}（${m?.rosterNo || '无编号'}）`,
        submission: next,
        blobs,
        typedText: next.text,
      };
    }
    const next = quickQueueRef.current.find((q) => q.status === 'pending' && q.id !== excludeKey && !done.has(q.id));
    if (!next) return null;
    return { key: next.id, label: next.name, blobs: [next.blob] };
  }

  async function commitPaper(
    paper: ActivePaper,
    scoreInputs: ScoreInput[],
    overallReason: string,
    mode: 'auto' | 'manual',
    confTotal: number,
  ) {
    if (!rubric) return;
    const calc = calculateScores(rubric, scoreInputs);
    if (paper.submission) {
      if (readonly) throw new Error('班级已归档或不可写，无法提交正式成绩');
      if (!isFrozen) throw new Error('请先在第 1 步「定稿启用」本题细则，再提交正式成绩');
      const tok = store.token();
      const prev = latestDecision(store.getState().snapshot!.data.grading, paper.submission.id);
      await applyEdit(store, tok, (next) => {
        confirmScores(
          next,
          paper.submission!.id,
          rubric.id,
          scoreInputs,
          overallReason || (mode === 'auto' ? `AI 高置信自动确认（${confTotal}%）` : 'AI 辅助人工核对确认'),
          prev?.id || null,
        );
      });
    } else {
      setQuickQueue((prev) =>
        prev.map((q) =>
          q.id === paper.key
            ? { ...q, status: mode === 'auto' ? 'auto-done' : 'manual-done', totalUnits: calc.totalUnits, confidence: confTotal }
            : q,
        ),
      );
    }
    processedRef.current.add(paper.key);
    setStats((st) => ({
      ...st,
      auto: st.auto + (mode === 'auto' ? 1 : 0),
      manual: st.manual + (mode === 'manual' ? 1 : 0),
    }));
  }

  async function evaluateOne(paper: ActivePaper) {
    if (!selectedItem || !rubric) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    clearTimer();
    setActive(paper);
    setResult(null);
    setError('');
    setPaused(false);
    setRunning(true);

    try {
      setStageText(`正在处理「${paper.label}」· 1/2 本地预检 + 盲识图与 OCR 交叉比对…`);
      const inspected: Array<{ dataUrl: string; gate: ImageGateResult }> = [];
      for (const blob of paper.blobs) inspected.push(await inspectImageBlob(blob));
      const gate: ImageGateResult =
        inspected.find((x) => !x.gate.ok)?.gate ||
        (inspected.length > 0 && inspected.every((x) => x.gate.blankSuspected)
          ? inspected[0].gate
          : inspected[0]?.gate || { ok: true, width: 0, height: 0, inkRatio: null, blankSuspected: false, reason: '纯文字作答' });

      const scan = await runBlindScanStage(
        connection,
        {
          imageDataUrls: inspected.map((x) => x.dataUrl),
          imageGate: gate,
          typedText: paper.typedText,
          subjectHint: selectedItem.prompt.slice(0, 60),
        },
        ctrl.signal,
      );

      setStageText(`正在处理「${paper.label}」· 2/2 得分点采纳 + 客观置信度核算…`);
      const res = await runScoringStage(
        connection,
        {
          scan,
          scanText: scan.restoredText,
          rubric,
          itemPrompt: selectedItem.prompt,
          threshold: thresholdRef.current,
        },
        ctrl.signal,
      );

      const nextInputs: ScoreInput[] = rubric.criteria.map((c) => {
        const a = res.adoptions.find((x) => x.criterionId === c.id);
        return {
          criterionId: c.id,
          value: res.confidence.redlines.length ? '' : a?.suggestedValue ?? '0',
          reason: a ? [a.reason, a.quote ? `依据：「${a.quote}」` : ''].filter(Boolean).join(' · ') : '',
        };
      });
      setResult(res);
      setScanText(res.scan.restoredText);
      setInputs(nextInputs);
      setComment(res.overallComment);
      setStageText('');

      if (res.confidence.decision === 'auto' && (!paper.submission || (isFrozen && !readonly))) {
        // 1.5s cancelable countdown before auto-confirm + advancing!
        let remain = 1500;
        setCountdownMs(remain);
        timerRef.current = window.setInterval(() => {
          remain -= 100;
          if (remain <= 0) {
            clearTimer();
            void (async () => {
              try {
                await commitPaper(paper, nextInputs, res.overallComment, 'auto', res.confidence.total);
                const next = buildNextPaper(paper.key);
                if (next) void evaluateOne(next);
                else {
                  setRunning(false);
                  setStageText('当前队列已全部处理完成！');
                }
              } catch (e) {
                setRunning(false);
                setPaused(true);
                setError((e as Error).message);
              }
            })();
          } else {
            setCountdownMs(remain);
          }
        }, 100);
      } else {
        // Low confidence, pure-manual mode, or hard redline -> PAUSE and notify teacher!
        setRunning(false);
        setPaused(true);
        if (chimeRef.current && (thresholdRef.current < 100 || res.confidence.redlines.length > 0)) {
          playPauseChime();
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setRunning(false);
        setPaused(true);
        setStageText('');
        setError((e as Error).message);
      }
    }
  }

  async function rescoreActive() {
    if (!active || !result || !selectedItem || !rubric) return;
    setRunning(true);
    setError('');
    setStageText('正在按修正后的扫描内容重算得分点…');
    try {
      const updated = await runScoringStage(
        connection,
        { scan: result.scan, scanText, rubric, itemPrompt: selectedItem.prompt, threshold: thresholdRef.current },
      );
      setResult(updated);
      setInputs(
        rubric.criteria.map((c) => {
          const a = updated.adoptions.find((x) => x.criterionId === c.id);
          return {
            criterionId: c.id,
            value: a?.suggestedValue ?? '0',
            reason: a ? [a.reason, a.quote ? `依据：「${a.quote}」` : ''].filter(Boolean).join(' · ') : '',
          };
        }),
      );
      setComment(updated.overallComment);
      setStageText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setPaused(true);
    }
  }

  async function confirmCurrentAndNext() {
    if (!active || !rubric) return;
    setError('');
    try {
      await commitPaper(active, inputs, comment, 'manual', result?.confidence.total ?? 0);
      const next = buildNextPaper(active.key);
      if (next) void evaluateOne(next);
      else {
        setPaused(false);
        setRunning(false);
        setStageText('队列中的答卷已全部批阅完成！');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function skipCurrentAndNext() {
    if (!active) return;
    clearTimer();
    processedRef.current.add(active.key);
    if (active.submission) {
      setSkippedIds((prev) => new Set(prev).add(active.key));
    } else {
      setQuickQueue((prev) => prev.map((q) => (q.id === active.key ? { ...q, status: 'skipped' } : q)));
    }
    setStats((st) => ({ ...st, skipped: st.skipped + 1 }));
    const next = buildNextPaper(active.key);
    if (next) void evaluateOne(next);
    else {
      setPaused(false);
      setRunning(false);
      setStageText('已处理到队列末尾。');
    }
  }

  const gv = connection.gradingView();
  let calc: ReturnType<typeof calculateScores> | null = null;
  let calcErr = '';
  if (rubric && inputs.length) {
    try { calc = calculateScores(rubric, inputs); } catch (e) { calcErr = (e as Error).message; }
  }
  const totalProcessed = stats.auto + stats.manual + stats.skipped;
  const remainingCount = sourceMode === 'submissions' ? pendingSubmissions.length : pendingQuick.length;

  return (
    <div className="col" style={{ gap: 12 }}>
      {!items.length ? (
        <div className="card empty-box">请先在第 1 步「试题与细则」里添加一道题目并配置参考答案与得分点，即可启动 AI 智能批阅。</div>
      ) : (
        <>
          {/* Top Control Panel */}
          <div className="card col" style={{ padding: '14px 16px', gap: 12 }}>
            <div className="row between">
              <div className="row" style={{ gap: 10 }}>
                <label className="inline-field">
                  <span>批阅题目</span>
                  <select value={selectedItem?.id || ''} disabled={running} onChange={(e) => { setItemId(e.target.value); setActive(null); setResult(null); }}>
                    {items.map((it) => {
                      const fr = g.rubrics.some((r) => r.itemId === it.id && r.frozenAt);
                      return (
                        <option key={it.id} value={it.id}>
                          第 {it.label} 题（{points(it.maxUnits)} 分{fr ? '' : ' · 草稿'}）
                        </option>
                      );
                    })}
                  </select>
                </label>

                <div className="btn-group" role="group" aria-label="批阅来源">
                  <button type="button" className={sourceMode === 'quick' ? 'active' : ''} disabled={running} onClick={() => setSourceMode('quick')}>
                    快速照片试测（{pendingQuick.length}）
                  </button>
                  <button type="button" className={sourceMode === 'submissions' ? 'active' : ''} disabled={running} onClick={() => setSourceMode('submissions')}>
                    本班待评答卷（{pendingSubmissions.length}）
                  </button>
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="sm" onClick={() => openSettings('grading')}>
                  <Icon name="settings" size={13} />
                  {gv.vision.ready ? `模型已就绪 · ${gv.ocr.mode === 'off' ? '无OCR' : 'OCR已开'}` : '配置阅卷模型'}
                </button>
                {running || countdownMs > 0 ? (
                  <button type="button" className="sm danger" onClick={() => stopBatch('已手动暂停批阅')}>
                    <Icon name="pause" size={13} />暂停（Esc）
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    disabled={!rubric || remainingCount === 0}
                    onClick={() => {
                      const next = buildNextPaper();
                      if (next) void evaluateOne(next);
                    }}
                  >
                    <Icon name="play" size={14} />
                    {paused && active ? '继续下一份' : `开始按功率批阅（待批 ${remainingCount} 份）`}
                  </button>
                )}
              </div>
            </div>

            <PowerSlider
              threshold={threshold}
              onChange={onThresholdChange}
              chime={chime}
              onToggleChime={setChime}
            />

            <div className="row between">
              <div className="row" style={{ gap: 6 }}>
                <Badge tone="info">视觉：{gv.vision.effectiveLabel}</Badge>
                <Badge tone="neutral">采分：{gv.judge.effectiveLabel}</Badge>
                <Badge tone={gv.ocr.ready ? 'success' : 'warning'}>OCR：{gv.ocr.effectiveLabel}</Badge>
              </div>
              {totalProcessed > 0 && (
                <span className="tip num">
                  本次已批 <strong>{totalProcessed}</strong> 份 · 自动直出 <strong>{stats.auto}</strong> 份（
                  {Math.round((stats.auto / totalProcessed) * 100)}%）· 人工接管 <strong>{stats.manual}</strong> 份
                  {stats.skipped > 0 ? ` · 跳过 ${stats.skipped} 份` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Quick Photo Dropzone */}
          {sourceMode === 'quick' && (
            <div className="card col" style={{ padding: '12px 16px', gap: 10 }}>
              <Dropzone
                accept="image/*"
                multiple
                disabled={running}
                title="拖入多张学生手写答卷照片，或直接按 Ctrl/Cmd + V 粘贴截图"
                hint="免绑花名册，即刻实测「盲识图复原 → OCR 标黄比对 → 得分点采纳 → 半自动功率分流」"
                onFiles={addQuickFiles}
              />
              {quickQueue.length > 0 && (
                <div className="row between">
                  <div className="row" style={{ gap: 6 }}>
                    {quickQueue.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className={`pill ${active?.key === q.id ? 'active' : ''} ${q.status === 'auto-done' || q.status === 'manual-done' ? 'done' : ''}`}
                        disabled={running}
                        onClick={() => {
                          processedRef.current.delete(q.id);
                          void evaluateOne({ key: q.id, label: q.name, blobs: [q.blob] });
                        }}
                      >
                        {q.name.slice(0, 14)}
                        {q.status === 'auto-done' && ` · 自动 ${points(q.totalUnits || 0)}分`}
                        {q.status === 'manual-done' && ` · 人工 ${points(q.totalUnits || 0)}分`}
                        {q.status === 'skipped' && ' · 跳过'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="sm"
                    disabled={running}
                    onClick={() => { processedRef.current.clear(); setQuickQueue([]); setActive(null); setResult(null); }}
                  >
                    清空试测队列
                  </button>
                </div>
              )}
            </div>
          )}

          {sourceMode === 'submissions' && !isFrozen && (
            <div className="alert tone-warning">
              <Icon name="alert" size={16} />
              <span>当前选中题目尚未「定稿启用」，批量试算可查看结果，但正式入库需先在第 1 步点击「定稿启用」。</span>
            </div>
          )}

          {stageText && (
            <div role="status" className="alert tone-info">
              <Icon name="sparkles" size={16} />
              <span>{stageText}</span>
            </div>
          )}

          {countdownMs > 0 && active && result && (
            <div className="alert tone-success row between" role="status">
              <div className="row" style={{ gap: 8 }}>
                <Icon name="zap" size={16} />
                <strong>
                  「{active.label}」置信度 {result.confidence.total}% ≥ {threshold}%，将在 {(countdownMs / 1000).toFixed(1)} 秒后自动确认 {points(result.totalUnits)} 分并进入下一份
                </strong>
              </div>
              <button type="button" className="sm danger" onClick={() => stopBatch('已拦截自动提交，转为人工核对')}>
                立即拦截改人工（Esc）
              </button>
            </div>
          )}

          <ErrorText message={error} />

          {/* Live Split Grading Workspace */}
          {active && rubric && (
            <div className="card review-grid" style={{ padding: 16 }}>
              {/* Left: Original Student Image + Scanned Content Box */}
              <section className="col" style={{ gap: 12 }}>
                <div className="row between">
                  <h3>当前答卷：{active.label}</h3>
                  <Badge tone={paused ? 'warning' : running ? 'info' : 'success'}>
                    {running ? 'AI 分析中' : countdownMs > 0 ? '即将自动提交' : paused ? '已暂停待人工核对' : '就绪'}
                  </Badge>
                </div>
                {active.blobs.map((b, i) => (
                  <BlobImage key={`${active.key}-${i}`} blob={b} label={active.blobs.length > 1 ? `学生答卷 第 ${i + 1} 页` : '学生手写原图'} />
                ))}
                {result && (
                  <ScannedContentBox
                    scan={result.scan}
                    scanText={scanText}
                    onChangeText={setScanText}
                    onRescore={() => void rescoreActive()}
                    busy={running}
                  />
                )}
              </section>

              {/* Right: Objective Confidence Meter + Scoring Point Adoption Cards */}
              <section className="col" style={{ gap: 10 }}>
                <div className="row between">
                  <h3>得分点采纳与人工接管</h3>
                  {calc ? (
                    <strong className="num" style={{ fontSize: 17, color: 'var(--accent)' }}>
                      合计 {points(calc.totalUnits)} / {points(selectedItem.maxUnits)} 分
                    </strong>
                  ) : (
                    <span className="text-warn" style={{ fontSize: 12.5 }}>{calcErr || '请补全各得分点分值'}</span>
                  )}
                </div>

                {result && <ConfidenceMeter confidence={result.confidence} />}

                <div className="col" style={{ gap: 8 }}>
                  {rubric.criteria.map((c) => {
                    const inp = inputs.find((x) => x.criterionId === c.id) || { criterionId: c.id, value: '', reason: '' };
                    const adopt = result?.adoptions.find((a) => a.criterionId === c.id);
                    const pills = quickScores(c.maxUnits, c.stepUnits);
                    return (
                      <div className={`soft-card col ${adopt?.status === 'uncertain' ? 'warn-box' : ''}`} key={c.id} style={{ gap: 6 }}>
                        <div className="row between">
                          <div className="row" style={{ gap: 6 }}>
                            <Badge>{selectedItem.scoringUnits.find((u) => u.id === c.scoringUnitId)?.label}</Badge>
                            {adopt && <Badge tone={ADOPTION_BADGE[adopt.status].tone}>{ADOPTION_BADGE[adopt.status].label}</Badge>}
                            {adopt && adopt.suggestedUnits > 0 && !adopt.quoteVerified && <Badge tone="danger">原文未锚定</Badge>}
                          </div>
                          <span className="tip">上限 {points(c.maxUnits)} · 步长 {points(c.stepUnits)}</span>
                        </div>
                        <p style={{ fontSize: 13 }}>{c.description}</p>
                        {adopt && (adopt.quote || adopt.reason) && (
                          <div className="diff-item">
                            {adopt.quote && <strong>「{adopt.quote}」</strong>}
                            {adopt.reason && <span className="tip" style={{ marginLeft: adopt.quote ? 6 : 0 }}>{adopt.reason}</span>}
                          </div>
                        )}
                        <div className="row between">
                          <div className="row" style={{ gap: 4 }}>
                            {pills.map((v) => (
                              <button
                                key={v}
                                type="button"
                                className={`score-pill ${inp.value === v ? 'active' : ''}`}
                                disabled={running}
                                onClick={() => setInputs((prev) => prev.map((x) => (x.criterionId === c.id ? { ...x, value: v } : x)))}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                          <label className="compact-input">
                            得分
                            <input
                              inputMode="decimal"
                              value={inp.value}
                              disabled={running}
                              onChange={(e) => setInputs((prev) => prev.map((x) => (x.criterionId === c.id ? { ...x, value: e.target.value } : x)))}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="row between" style={{ marginTop: 4 }}>
                  <button type="button" disabled={running} onClick={skipCurrentAndNext}>
                    跳过此份
                  </button>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={running || !calc || (!!active.submission && (!isFrozen || readonly))}
                      onClick={() => void confirmCurrentAndNext()}
                    >
                      <Icon name="check" size={14} />
                      {active.submission ? '人工确认正式成绩并继续' : '人工采纳得分并继续下一份'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
