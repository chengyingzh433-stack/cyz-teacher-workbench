import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  CornerDownLeft,
  Globe,
  RefreshCw,
  ScanEye,
  Settings,
} from 'lucide-react';
import type { ExamDetail, ExamSummary, ZhixueState } from '../../../shared/types';
import {
  highlightScanSegments,
  inspectImageBlob,
  LEGIBILITY_LABELS,
  type GradingResult,
} from '../../../shared/ai-engine';
import { formatScore } from '../../../shared/score-policy';
import { Badge, Button, Card, Input, Select, Slider } from '../../components/ui/primitives';

const PLATFORM_PRESETS = [
  { label: '智学网', url: 'https://www.zhixue.com/login.html' },
  { label: '七天网络', url: 'https://www.7net.cc/' },
  { label: '好分数', url: 'https://www.haofenshu.com/' },
];

async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

export function ZhixueCompanion({
  exams,
  overlayBlocked,
  onOpenAiSettings,
  onNotify,
}: {
  exams: ExamSummary[];
  /** True whenever any React modal/drawer/Cmd+K is open so native WebContentsView never covers it. */
  overlayBlocked: boolean;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [urlInput, setUrlInput] = useState('https://www.zhixue.com/login.html');
  const [viewState, setViewState] = useState<ZhixueState>({
    attached: false,
    url: 'https://www.zhixue.com/login.html',
    title: '智学网 / 网阅伴侣',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });

  // Rubric selection from unified exams
  const [examId, setExamId] = useState(exams[0]?.id || '');
  const [examDetail, setExamDetail] = useState<ExamDetail | null>(null);
  const [itemId, setItemId] = useState('');
  const [threshold, setThreshold] = useState(88);

  // Capture & AI grading state
  const [capturedUrl, setCapturedUrl] = useState('');
  const [aiResult, setAiResult] = useState<GradingResult | null>(null);
  const [manualScore, setManualScore] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = window.workbenchApi.zhixue.onStateChange((st) => {
      setViewState(st);
      if (st.url) setUrlInput(st.url);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!examId) {
      setExamDetail(null);
      return;
    }
    window.workbenchApi.exams.getDetail(examId).then((d) => {
      setExamDetail(d);
      if (d.gradingItems[0]) setItemId(d.gradingItems[0].id);
      else setItemId('');
    });
  }, [examId]);

  // Attach / Resize / Detach native Electron WebContentsView cleanly
  useEffect(() => {
    const el = hostRef.current;
    if (!el || overlayBlocked) {
      void window.workbenchApi.zhixue.detach();
      return;
    }

    const syncBounds = (attachFirst: boolean) => {
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return;
      const bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      if (attachFirst) void window.workbenchApi.zhixue.attach(bounds);
      else void window.workbenchApi.zhixue.resize(bounds);
    };

    syncBounds(true);
    const handleWindowResize = () => syncBounds(false);
    const ro = new ResizeObserver(handleWindowResize);
    ro.observe(el);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      void window.workbenchApi.zhixue.detach();
    };
  }, [overlayBlocked]);

  const currentItem = examDetail?.gradingItems.find((i) => i.id === itemId) || null;

  async function captureAndGrade() {
    setBusy(true);
    try {
      const shot = await window.workbenchApi.zhixue.captureRegion();
      setCapturedUrl(shot.dataUrl);
      if (!currentItem?.rubric) {
        onNotify('已抓取网页答卷画面！若要 AI 自动判分，请在右侧先关联一道已建细则的试题');
        return;
      }
      const blob = await dataUrlToBlob(shot.dataUrl);
      const { dataUrl, gate } = await inspectImageBlob(blob);
      const scan = await window.workbenchApi.ai.runBlindScan({
        imageDataUrls: [dataUrl],
        imageGate: gate,
        subjectHint: examDetail?.exam.title || '物理',
      });
      const res = await window.workbenchApi.ai.runScoring({
        scan,
        scanText: scan.restoredText,
        rubricId: currentItem.rubric.id,
        itemPrompt: currentItem.prompt,
        threshold,
      });
      setAiResult(res);
      setManualScore(formatScore(res.totalUnits));
      onNotify(`抓图识图完成：建议 ${formatScore(res.totalUnits)} 分（置信度 ${res.confidence.total}%）`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function fillToPage() {
    if (!manualScore.trim()) return;
    const res = await window.workbenchApi.zhixue.fillScore(manualScore.trim());
    onNotify(res.detail, res.ok ? 'ok' : 'err');
  }

  return (
    <div className="flex flex-col h-full gap-2.5 min-h-0">
      {/* Top Native Browser Navigation Bar */}
      <Card className="px-3 py-2 flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={!viewState.canGoBack}
            onClick={() => void window.workbenchApi.zhixue.goBack()}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!viewState.canGoForward}
            onClick={() => void window.workbenchApi.zhixue.goForward()}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void window.workbenchApi.zhixue.reload()}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${viewState.loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <form
          className="flex-1 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (urlInput.trim()) void window.workbenchApi.zhixue.navigate(urlInput.trim());
          }}
        >
          <Globe className="w-4 h-4 text-[var(--ink-muted)] shrink-0" />
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入智学网或任意网阅平台网址…"
            className="h-8 text-xs"
          />
          <Button size="sm" type="submit">
            打开
          </Button>
        </form>

        <div className="flex items-center gap-1">
          {PLATFORM_PRESETS.map((p) => (
            <Button
              key={p.label}
              size="xs"
              variant="soft"
              onClick={() => {
                setUrlInput(p.url);
                void window.workbenchApi.zhixue.navigate(p.url);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Main Split: Left Native WebContentsView | Right AI Companion Panel */}
      <div className="flex-1 min-h-0 flex gap-2.5">
        {/* Left Host Slot for Electron WebContentsView */}
        <div
          ref={hostRef}
          className="flex-1 min-w-0 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-muted)] flex items-center justify-center text-xs text-[var(--ink-muted)] relative overflow-hidden"
        >
          {overlayBlocked ? (
            <span>弹窗打开中，关闭弹窗后自动恢复智学网页面</span>
          ) : (
            <span>正在加载内嵌网阅浏览器（持久保持登录态，无需安装任何浏览器扩展）…</span>
          )}
        </div>

        {/* Right AI Grading Companion Panel */}
        <Card className="w-[360px] shrink-0 flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-semibold">AI 智学网阅卷伴侣</h3>
              <p className="text-[11px] text-[var(--ink-muted)]">独立原生引擎 · 零插件 · 不自动盲交</p>
            </div>
            <Button size="xs" variant="ghost" onClick={onOpenAiSettings}>
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
            {/* Bind Rubric from Unified Exam Center */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-[var(--ink-secondary)]">1. 关联本班试题评分细则</span>
              <Select
                value={examId}
                onValueChange={setExamId}
                placeholder="选择考试"
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
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--ink-muted)] whitespace-nowrap">把关阈值</span>
                <div className="flex-1">
                  <Slider value={threshold} min={65} max={100} onChange={setThreshold} />
                </div>
                <Badge tone="info">{threshold}%</Badge>
              </div>
            </div>

            {/* Capture & Grade Trigger */}
            <Button
              variant="primary"
              disabled={busy || overlayBlocked}
              onClick={() => void captureAndGrade()}
              className="w-full"
            >
              {busy ? (
                <>
                  <ScanEye className="w-4 h-4 animate-pulse" /> 正在抓图并盲识图判分…
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" /> 抓取当前答卷 → AI 识图判分
                </>
              )}
            </Button>

            {/* Captured Snapshot Preview */}
            {capturedUrl && (
              <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--grading-canvas)] p-1.5">
                <img src={capturedUrl} alt="抓取画面" className="w-full max-h-36 object-contain rounded" />
              </div>
            )}

            {/* AI Grading Result */}
            {aiResult && (
              <div className="flex flex-col gap-2.5">
                <div
                  className={`p-2.5 rounded-xl text-xs border ${
                    aiResult.confidence.redlines.length
                      ? 'bg-[var(--danger-soft)] border-[var(--danger)]/40 text-[var(--danger)]'
                      : aiResult.confidence.total >= threshold
                        ? 'bg-[var(--ok-soft)] border-[var(--ok)]/40 text-[var(--ok)]'
                        : 'bg-[var(--warn-soft)] border-[var(--warn)]/40 text-[var(--warn)]'
                  }`}
                >
                  <div className="font-semibold flex justify-between">
                    <span>客观置信度 {aiResult.confidence.total}%</span>
                    <span>{LEGIBILITY_LABELS[aiResult.scan.legibility]}</span>
                  </div>
                  <div className="mt-1">{aiResult.confidence.summary}</div>
                </div>

                <div className="p-2.5 rounded-xl bg-[var(--bg-muted)] text-xs leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {highlightScanSegments(aiResult.scan.restoredText, aiResult.scan.ocr.conflicts).map(
                    (s, i) =>
                      s.conflict ? (
                        <mark key={i} className="ocr-diff" title={s.conflict.reason}>
                          {s.text}
                        </mark>
                      ) : (
                        <span key={i}>{s.text}</span>
                      ),
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  {aiResult.adoptions.map((a, idx) => (
                    <div
                      key={a.criterionId}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex justify-between gap-2"
                    >
                      <span className="truncate">
                        点 {idx + 1}：{a.reason}
                      </span>
                      <strong className="tabular-nums text-[var(--accent)] shrink-0">
                        +{a.suggestedValue}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Score Fill Action */}
          <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/60 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={manualScore}
                onChange={(e) => setManualScore(e.target.value)}
                placeholder="建议分值"
                className="h-9 tabular-nums font-bold text-center w-24"
              />
              <Button
                variant="primary"
                className="flex-1"
                disabled={!manualScore.trim() || overlayBlocked}
                onClick={() => void fillToPage()}
              >
                <CornerDownLeft className="w-4 h-4" /> 填入左侧打分框
              </Button>
            </div>
            <div className="text-[11px] text-[var(--ink-muted)] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ok)] shrink-0" />
              先点击左侧网页打分输入框，再点按钮自动填入；最终由你确认提交。
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
