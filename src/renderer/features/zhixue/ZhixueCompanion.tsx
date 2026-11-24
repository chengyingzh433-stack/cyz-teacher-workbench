import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  CornerDownLeft,
  Crop,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Pause,
  Play,
  RefreshCw,
  ScanEye,
  Send,
  Settings,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import type {
  ExamSummary,
  ZhixueCrawledControls,
  ZhixueRoiRect,
  ZhixueSiteProfile,
  ZhixueState,
} from '../../../shared/types';
import {
  highlightScanSegments,
  inspectImageBlob,
  LEGIBILITY_LABELS,
  POWER_PRESETS,
  type GradingResult,
} from '../../../shared/ai-engine';
import { formatScore } from '../../../shared/score-policy';
import { Badge, Button, Card, Input, Slider, Textarea } from '../../components/ui/primitives';
import { ZhixueRubricCard, type ActiveZhixueRubric } from './ZhixueRubricCard';

type GradingMode = 'manual' | 'semi-auto' | 'auto';

const PLATFORM_PRESETS = [
  { label: '智学网', url: 'https://www.zhixue.com/login.html' },
  { label: '七天网络', url: 'https://www.7net.cc/' },
  { label: '好分数', url: 'https://www.haofenshu.com/' },
];

const AUTO_DELAY_PRESETS = [0.8, 1.5, 2.5, 4, 6] as const;

async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

function playGentleAlert() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    setTimeout(() => void ctx.close().catch(() => {}), 300);
  } catch {
    // ignore in muted/headless environments
  }
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

  // Site profile (ROI + custom calibrated selectors + auto submit delay)
  const [profile, setProfile] = useState<ZhixueSiteProfile>({
    origin: 'default',
    roi: null,
    autoDelaySec: 1.5,
  });
  const [showRoiFrame, setShowRoiFrame] = useState(true);
  const [pickingRoi, setPickingRoi] = useState(false);
  const [pickingRole, setPickingRole] = useState<'score-group' | 'submit' | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [controls, setControls] = useState<ZhixueCrawledControls | null>(null);

  // Grading mode & automation controls
  const [mode, setMode] = useState<GradingMode>('semi-auto');
  const [threshold, setThreshold] = useState(88);
  const [autoDelaySec, setAutoDelaySec] = useState(1.5);
  const [autoDelayInput, setAutoDelayInput] = useState('1.5');
  const [semiPreselect, setSemiPreselect] = useState(true);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopStatus, setLoopStatus] = useState('');
  const [countdownMs, setCountdownMs] = useState(0);
  const [gradedCount, setGradedCount] = useState(0);

  // Active rubric (inline quick rubric or bound ExamCenter rubric)
  const [activeRubric, setActiveRubric] = useState<ActiveZhixueRubric>({
    source: 'quick',
    rubric: null,
    prompt: '',
    summary: '',
  });

  // Capture, recognition & scoring result
  const [capturedUrl, setCapturedUrl] = useState('');
  const [expandShot, setExpandShot] = useState(false);
  const [aiResult, setAiResult] = useState<GradingResult | null>(null);
  const [editableScan, setEditableScan] = useState('');
  const [manualScore, setManualScore] = useState('');
  const [busy, setBusy] = useState(false);

  // Live refs for safe async loop execution
  const loopStopRef = useRef(false);
  const loopRunningRef = useRef(false);
  const modeRef = useRef<GradingMode>(mode);
  const thresholdRef = useRef(threshold);
  const autoDelaySecRef = useRef(autoDelaySec);
  const semiPreselectRef = useRef(semiPreselect);
  const profileRef = useRef(profile);
  const activeRubricRef = useRef(activeRubric);
  const overlayBlockedRef = useRef(overlayBlocked);

  modeRef.current = mode;
  thresholdRef.current = threshold;
  autoDelaySecRef.current = autoDelaySec;
  semiPreselectRef.current = semiPreselect;
  profileRef.current = profile;
  activeRubricRef.current = activeRubric;
  overlayBlockedRef.current = overlayBlocked;

  const stopLoop = useCallback(
    (reason?: string) => {
      loopStopRef.current = true;
      loopRunningRef.current = false;
      setLoopRunning(false);
      setCountdownMs(0);
      setLoopStatus(reason || '');
    },
    [],
  );

  // Listen to WebContentsView navigation & Escape emergency-stop events
  useEffect(() => {
    const unsubState = window.workbenchApi.zhixue.onStateChange((st) => {
      setViewState(st);
      if (st.url) setUrlInput(st.url);
    });
    const unsubEsc = window.workbenchApi.zhixue.onEscapePressed(() => {
      if (loopRunningRef.current) {
        stopLoop('已按 Esc 紧急暂停');
        onNotify('已按 Esc 紧急暂停自动/半自动阅卷');
      }
    });
    return () => {
      unsubState();
      unsubEsc();
    };
  }, [stopLoop, onNotify]);

  // Also listen to Esc when focus is in the parent renderer window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (loopRunningRef.current || countdownMs > 0)) {
        stopLoop('已按 Esc 紧急暂停');
        onNotify('已按 Esc 紧急暂停自动/半自动阅卷');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [countdownMs, stopLoop, onNotify]);

  // Load persisted site profile when origin changes
  const currentOrigin = (() => {
    try {
      return new URL(viewState.url).origin;
    } catch {
      return 'default';
    }
  })();

  useEffect(() => {
    window.workbenchApi.zhixue.getSiteProfile(viewState.url).then((p) => {
      setProfile(p);
      const delay = p.autoDelaySec ?? 1.5;
      setAutoDelaySec(delay);
      setAutoDelayInput(String(delay));
    });
  }, [currentOrigin]);

  // Sync dashed ROI frame inside webpage after load or profile toggle
  useEffect(() => {
    if (!viewState.attached || viewState.loading || overlayBlocked || pickingRoi || pickingRole) return;
    void window.workbenchApi.zhixue.setRoiHighlight(profile.roi, showRoiFrame);
  }, [viewState.attached, viewState.loading, viewState.url, overlayBlocked, profile.roi, showRoiFrame, pickingRoi, pickingRole]);

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
      loopStopRef.current = true;
      loopRunningRef.current = false;
      void window.workbenchApi.zhixue.detach();
    };
  }, [overlayBlocked]);

  async function updateAutoDelay(sec: number) {
    const clamped = Math.round(Math.max(0.5, Math.min(15, sec)) * 10) / 10;
    setAutoDelaySec(clamped);
    setAutoDelayInput(String(clamped));
    const saved = await window.workbenchApi.zhixue.saveSiteProfile({
      url: viewState.url,
      autoDelaySec: clamped,
    });
    setProfile(saved);
  }

  async function handlePickRegion() {
    if (pickingRoi) {
      await window.workbenchApi.zhixue.cancelPickRegion();
      setPickingRoi(false);
      return;
    }
    stopLoop();
    setPickingRoi(true);
    try {
      await window.workbenchApi.zhixue.setRoiHighlight(null, false);
      const rect = await window.workbenchApi.zhixue.pickRegion();
      if (rect) {
        const saved = await window.workbenchApi.zhixue.saveSiteProfile({
          url: viewState.url,
          roi: rect,
        });
        setProfile(saved);
        setShowRoiFrame(true);
        await window.workbenchApi.zhixue.setRoiHighlight(rect, true);
        const preview = await window.workbenchApi.zhixue.captureRegion(rect);
        setCapturedUrl(preview.dataUrl);
        onNotify(`已设置阅卷读取区域：${rect.width} × ${rect.height} px`);
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setPickingRoi(false);
    }
  }

  async function handleClearRegion() {
    const saved = await window.workbenchApi.zhixue.saveSiteProfile({
      url: viewState.url,
      roi: null,
    });
    setProfile(saved);
    await window.workbenchApi.zhixue.setRoiHighlight(null, false);
    onNotify('已清除自定义读取区域，将默认截取整个网页视口');
  }

  async function handleCrawlControls(overrideHints?: {
    scoreGroupSelector?: string;
    submitSelector?: string;
  }) {
    setCrawling(true);
    try {
      const res = await window.workbenchApi.zhixue.crawlControls({
        scoreGroupSelector: overrideHints?.scoreGroupSelector ?? profileRef.current.scoreGroupSelector,
        submitSelector: overrideHints?.submitSelector ?? profileRef.current.submitSelector,
      });
      setControls(res);
      onNotify(res.summary, res.scoreOptions.length || res.scoreInputs.length ? 'ok' : 'err');
      return res;
    } catch (e) {
      onNotify((e as Error).message, 'err');
      return null;
    } finally {
      setCrawling(false);
    }
  }

  async function handlePickElement(role: 'score-group' | 'submit') {
    if (pickingRole === role) {
      await window.workbenchApi.zhixue.cancelPickElement();
      setPickingRole(null);
      return;
    }
    stopLoop();
    setPickingRole(role);
    try {
      const picked = await window.workbenchApi.zhixue.pickElement(role);
      if (picked) {
        const patch =
          role === 'score-group'
            ? { url: viewState.url, scoreGroupSelector: picked.selector }
            : { url: viewState.url, submitSelector: picked.selector };
        const saved = await window.workbenchApi.zhixue.saveSiteProfile(patch);
        setProfile(saved);
        onNotify(
          role === 'score-group'
            ? `已校准得分选项区（${picked.label}），正在重新探测…`
            : `已校准提交按钮「${picked.label}」`,
        );
        await handleCrawlControls({
          scoreGroupSelector: saved.scoreGroupSelector,
          submitSelector: saved.submitSelector,
        });
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setPickingRole(null);
    }
  }

  async function gradeCurrentPaper(): Promise<GradingResult | null> {
    setBusy(true);
    try {
      const roi: ZhixueRoiRect | undefined = profileRef.current.roi || undefined;
      const shot = await window.workbenchApi.zhixue.captureRegion(roi);
      setCapturedUrl(shot.dataUrl);
      const rubricState = activeRubricRef.current;
      if (!rubricState.rubric) {
        onNotify('已抓取答卷画面！请先在右侧「本题评分细则」填写参考答案或满分再 AI 判分');
        return null;
      }
      const blob = await dataUrlToBlob(shot.dataUrl);
      const { dataUrl, gate } = await inspectImageBlob(blob);
      const scan = await window.workbenchApi.ai.runBlindScan({
        imageDataUrls: [dataUrl],
        imageGate: gate,
        subjectHint: rubricState.prompt || '高中物理主观题',
      });
      const res = await window.workbenchApi.ai.runScoring({
        scan,
        scanText: scan.restoredText,
        rubricId: rubricState.source === 'exam' ? rubricState.rubricId : undefined,
        inlineRubric: rubricState.source === 'quick' ? rubricState.rubric : undefined,
        itemPrompt: rubricState.prompt,
        threshold: thresholdRef.current,
      });
      setAiResult(res);
      setEditableScan(res.scan.restoredText);
      setManualScore(formatScore(res.totalUnits));
      return res;
    } catch (e) {
      onNotify((e as Error).message, 'err');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reScoreWithEditedText() {
    const rubricState = activeRubricRef.current;
    if (!aiResult || !rubricState.rubric) return;
    setBusy(true);
    try {
      const res = await window.workbenchApi.ai.runScoring({
        scan: aiResult.scan,
        scanText: editableScan,
        rubricId: rubricState.source === 'exam' ? rubricState.rubricId : undefined,
        inlineRubric: rubricState.source === 'quick' ? rubricState.rubric : undefined,
        itemPrompt: rubricState.prompt,
        threshold: thresholdRef.current,
      });
      setAiResult(res);
      setManualScore(formatScore(res.totalUnits));
      onNotify(`已按修正内容重算：建议 ${formatScore(res.totalUnits)} 分（置信度 ${res.confidence.total}%）`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function applyScoreToPage(opts: { scoreText: string; optionId?: string; autoSubmit: boolean }) {
    const text = opts.scoreText.trim();
    if (!text && !opts.optionId) return null;
    const res = await window.workbenchApi.zhixue.applyScore({
      scoreText: text,
      optionId: opts.optionId,
      autoSubmit: opts.autoSubmit,
      scoreGroupSelector: profileRef.current.scoreGroupSelector,
      submitSelector: profileRef.current.submitSelector,
    });
    if (res.ok && res.submitted) {
      setGradedCount((c) => c + 1);
    }
    onNotify(res.detail, res.ok ? 'ok' : 'err');
    return res;
  }

  async function startAutomationLoop() {
    if (!activeRubricRef.current.rubric) {
      onNotify('请先在下方「本题评分细则」填写参考答案或满分再开启', 'err');
      return;
    }
    if (overlayBlockedRef.current) return;

    // Auto-crawl score controls once if not crawled yet
    if (!controls || (!controls.scoreOptions.length && !controls.scoreInputs.length)) {
      await handleCrawlControls();
    }

    loopStopRef.current = false;
    loopRunningRef.current = true;
    setLoopRunning(true);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const roi = () => profileRef.current.roi || undefined;

    try {
      while (!loopStopRef.current && !overlayBlockedRef.current) {
        const currentMode = modeRef.current;
        setLoopStatus(currentMode === 'auto' ? '自动模式：正在抓图识图判分…' : '半自动模式：正在识图判分…');
        const res = await gradeCurrentPaper();
        if (!res || loopStopRef.current) {
          stopLoop('已停止');
          break;
        }

        // Snapshot baseline of current paper so we can detect when next paper loads
        await window.workbenchApi.zhixue.markPaperBaseline(roi());
        const suggested = formatScore(res.totalUnits);

        if (currentMode === 'semi-auto') {
          if (semiPreselectRef.current && res.confidence.redlines.length === 0) {
            await window.workbenchApi.zhixue.applyScore({
              scoreText: suggested,
              autoSubmit: false,
              scoreGroupSelector: profileRef.current.scoreGroupSelector,
              submitSelector: profileRef.current.submitSelector,
            });
          } else if (res.confidence.redlines.length > 0) {
            playGentleAlert();
          }
          setLoopStatus(
            res.confidence.redlines.length
              ? `半自动提醒：触发红线，请人工核对并提交（换新卷后自动继续）`
              : `半自动就绪：建议 ${suggested} 分（置信度 ${res.confidence.total}%），请确认提交，换新卷后自动识图`,
          );

          // Wait until teacher submits and next paper appears
          while (!loopStopRef.current && !overlayBlockedRef.current && modeRef.current === 'semi-auto') {
            await sleep(750);
            if (loopStopRef.current) break;
            const ch = await window.workbenchApi.zhixue.checkPaperChanged(roi());
            if (ch.stableChanged) {
              await sleep(250);
              break;
            }
          }
          if (modeRef.current !== 'semi-auto') continue;
          continue;
        }

        // AUTO MODE: strictly gated by 4-dim objective confidence + 4 redlines + 0 OCR conflicts
        if (res.confidence.decision !== 'auto') {
          playGentleAlert();
          const reason = `置信度 ${res.confidence.total}% 未达阈值 ${thresholdRef.current}%（或触发红线/OCR冲突），已暂停等待人工接管`;
          stopLoop(reason);
          onNotify(reason, 'err');
          break;
        }

        // Interceptable countdown with user-selected interval!
        const totalMs = Math.max(500, Math.round(autoDelaySecRef.current * 1000));
        setLoopStatus(`高置信 ${res.confidence.total}% · 倒计时自动给 ${suggested} 分并提交（Esc 急停）`);
        for (let left = totalMs; left > 0; left -= 100) {
          if (loopStopRef.current || overlayBlockedRef.current || modeRef.current !== 'auto') break;
          setCountdownMs(left);
          await sleep(Math.min(100, left));
        }
        setCountdownMs(0);
        if (loopStopRef.current || overlayBlockedRef.current || modeRef.current !== 'auto') break;

        const applied = await window.workbenchApi.zhixue.applyScore({
          scoreText: suggested,
          autoSubmit: true,
          scoreGroupSelector: profileRef.current.scoreGroupSelector,
          submitSelector: profileRef.current.submitSelector,
        });
        if (!applied.ok || !applied.submitted) {
          playGentleAlert();
          stopLoop(applied.detail);
          onNotify(applied.detail, 'err');
          break;
        }

        setGradedCount((c) => c + 1);
        setLoopStatus(`已自动给 ${suggested} 分并提交，等待下一份答卷加载…`);

        // Wait up to 15s for the next student's answer sheet to render cleanly
        const deadline = Date.now() + 15_000;
        let changed = false;
        while (!loopStopRef.current && Date.now() < deadline) {
          await sleep(650);
          if (loopStopRef.current) break;
          const ch = await window.workbenchApi.zhixue.checkPaperChanged(roi());
          if (ch.stableChanged) {
            changed = true;
            await sleep(250);
            break;
          }
        }
        if (!changed && !loopStopRef.current) {
          playGentleAlert();
          stopLoop('15 秒内未检测到新答卷（可能已批完本批），已自动暂停');
          onNotify('未检测到下一份答卷，已自动暂停');
          break;
        }
      }
    } finally {
      if (loopStopRef.current) {
        setLoopRunning(false);
        setCountdownMs(0);
      }
    }
  }

  const aiSuggestedNum = aiResult ? Number(formatScore(aiResult.totalUnits)) : null;

  return (
    <div className="flex flex-col h-full gap-2 min-h-0">
      {/* Row 1: Browser Navigation + Platform Shortcuts */}
      <Card className="px-3 py-1.5 flex items-center gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-0.5 shrink-0">
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
          className="flex-1 min-w-[200px] flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (urlInput.trim()) void window.workbenchApi.zhixue.navigate(urlInput.trim());
          }}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入智学网或任意网阅平台网址…"
            className="h-7 text-xs"
          />
          <Button size="xs" type="submit">
            打开
          </Button>
        </form>

        <div className="flex items-center gap-1 shrink-0">
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

      {/* Row 2: Dedicated Marking Capture & Calibration Bar */}
      <Card className="px-3 py-1.5 flex items-center justify-between gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            size="xs"
            variant={pickingRoi ? 'danger' : profile.roi ? 'soft' : 'primary'}
            disabled={overlayBlocked}
            onClick={() => void handlePickRegion()}
          >
            <Crop className="w-3.5 h-3.5" />
            {pickingRoi ? '取消框选' : profile.roi ? '重设读取区域' : '设置读取区域'}
          </Button>
          {profile.roi && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--ok-soft)] text-[var(--ok)] text-[11px] font-medium">
              <span>
                读取区 {profile.roi.width}×{profile.roi.height}
              </span>
              <button
                type="button"
                title={showRoiFrame ? '隐藏网页虚线框' : '显示网页虚线框'}
                onClick={() => setShowRoiFrame((v) => !v)}
                className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
              >
                {showRoiFrame ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <button
                type="button"
                title="清除读取区域"
                onClick={() => void handleClearRegion()}
                className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="h-4 w-px bg-[var(--border-subtle)] mx-0.5" />

          <Button
            size="xs"
            variant="soft"
            disabled={crawling || overlayBlocked}
            onClick={() => void handleCrawlControls()}
          >
            <Target className={`w-3.5 h-3.5 ${crawling ? 'animate-spin' : ''}`} />
            {crawling ? '探测中…' : '自动爬取得分选项'}
          </Button>

          <Button
            size="xs"
            variant={pickingRole === 'score-group' ? 'danger' : 'ghost'}
            disabled={overlayBlocked}
            title="当自动探测未识别到分值按钮时，手动点击网页分值区锁定"
            onClick={() => void handlePickElement('score-group')}
          >
            <Crosshair className="w-3.5 h-3.5" />
            {pickingRole === 'score-group' ? '取消拾取' : '拾取得分区'}
          </Button>
          <Button
            size="xs"
            variant={pickingRole === 'submit' ? 'danger' : 'ghost'}
            disabled={overlayBlocked}
            title="手动点击网页里的提交/下一份按钮锁定选择器"
            onClick={() => void handlePickElement('submit')}
          >
            <Send className="w-3.5 h-3.5" />
            {pickingRole === 'submit' ? '取消拾取' : '拾取提交键'}
          </Button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {controls && (
            <Badge tone={controls.scoreOptions.length || controls.scoreInputs.length ? 'ok' : 'warn'}>
              {controls.scoreOptions.length
                ? `已爬取 ${controls.scoreOptions.length} 个分值`
                : controls.scoreInputs.length
                  ? `${controls.scoreInputs.length} 个输入框`
                  : '待探测'}
            </Badge>
          )}
          <Button size="xs" variant="ghost" onClick={onOpenAiSettings}>
            <Settings className="w-3.5 h-3.5" /> 统一 AI 模型设置
          </Button>
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
            <span>弹窗打开中，关闭弹窗后自动恢复网阅页面</span>
          ) : (
            <span>正在加载内嵌网阅浏览器（持久保持登录态，无需安装任何浏览器扩展）…</span>
          )}
        </div>

        {/* Right AI Grading Companion Panel */}
        <Card className="w-[420px] shrink-0 flex flex-col overflow-hidden">
          {/* Panel Header + Mode Switcher */}
          <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <h3 className="text-[13.5px] font-semibold truncate">AI 网阅控制台</h3>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {gradedCount > 0 && <Badge tone="ok">已批 {gradedCount} 份</Badge>}
                <Badge tone={profile.roi ? 'ok' : 'neutral'}>
                  {profile.roi ? '已设读取区' : '整页模式'}
                </Badge>
              </div>
            </div>

            {/* Mode Segmented Switch: Manual / Semi-Auto / Auto */}
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[var(--bg-muted)]">
              {(
                [
                  ['manual', '手动模式'],
                  ['semi-auto', '半自动模式'],
                  ['auto', '自动模式'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (loopRunningRef.current && k === 'manual') stopLoop('已切回手动模式');
                    setMode(k);
                  }}
                  className={`py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    mode === k
                      ? 'bg-[var(--bg-surface)] text-[var(--accent)] shadow-[var(--shadow-sm)] font-semibold'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
            {/* Mode-Specific Controls (Semi-Auto & Auto) */}
            {mode !== 'manual' && (
              <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
                {/* Confidence Power Threshold + 4 Presets */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--ink-muted)] whitespace-nowrap">把关阈值</span>
                  <div className="flex-1">
                    <Slider value={threshold} min={65} max={100} onChange={setThreshold} />
                  </div>
                  <Badge tone={threshold >= 100 ? 'ok' : threshold >= 85 ? 'info' : 'warn'}>
                    {threshold >= 100 ? '纯把关' : `${threshold}%`}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {POWER_PRESETS.map((p) => (
                    <button
                      key={p.threshold}
                      type="button"
                      onClick={() => setThreshold(p.threshold)}
                      title={p.desc}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                        threshold === p.threshold
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                          : 'bg-[var(--bg-muted)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {p.short}
                    </button>
                  ))}
                </div>

                {/* User-Selectable Auto-Submit Interval (Auto Mode) */}
                {mode === 'auto' ? (
                  <div className="pt-1.5 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--ink-secondary)] font-medium">自动提交间隔（可按 Esc 拦截）</span>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0.5}
                          max={15}
                          step={0.1}
                          value={autoDelayInput}
                          onChange={(e) => {
                            setAutoDelayInput(e.target.value);
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 0.5 && v <= 15) {
                              void updateAutoDelay(v);
                            }
                          }}
                          className="h-6 w-14 text-xs text-center tabular-nums"
                        />
                        <span className="text-[11px] text-[var(--ink-muted)]">秒</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {AUTO_DELAY_PRESETS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => void updateAutoDelay(sec)}
                          className={`px-2 py-0.5 rounded text-[11px] tabular-nums cursor-pointer ${
                            Math.abs(autoDelaySec - sec) < 0.05
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)] font-semibold'
                              : 'bg-[var(--bg-muted)] text-[var(--ink-secondary)] border border-transparent hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <label className="pt-1 border-t border-[var(--border-subtle)] flex items-center gap-2 text-xs text-[var(--ink-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={semiPreselect}
                      onChange={(e) => setSemiPreselect(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    识图完成后自动在左侧预选分值（绝不自动提交，换卷自动续扫）
                  </label>
                )}

                {/* Start / Stop Automation Button */}
                <div className="flex items-center gap-2 pt-0.5">
                  {loopRunning ? (
                    <Button
                      size="sm"
                      variant="danger"
                      className="w-full"
                      onClick={() => {
                        stopLoop('已手动暂停');
                        onNotify('已暂停自动/半自动阅卷');
                      }}
                    >
                      <Pause className="w-3.5 h-3.5" /> 紧急暂停 (Esc)
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      className="w-full"
                      disabled={busy || overlayBlocked}
                      onClick={() => void startAutomationLoop()}
                    >
                      <Play className="w-3.5 h-3.5" />
                      {mode === 'auto'
                        ? `开始自动批阅（${autoDelaySec}s 倒计时提交）`
                        : '开始半自动监听（换卷自动识图）'}
                    </Button>
                  )}
                </div>

                {loopStatus && (
                  <div className="text-[11px] text-[var(--ink-secondary)] bg-[var(--bg-muted)] px-2 py-1 rounded-lg leading-snug">
                    {loopStatus}
                  </div>
                )}
              </div>
            )}

            {/* Auto-Submit Interceptable Countdown Banner */}
            {countdownMs > 0 && (
              <div className="p-2.5 rounded-xl bg-[var(--ok-soft)] border border-[var(--ok)]/40 text-[var(--ok)] text-xs font-semibold flex items-center justify-between gap-2">
                <span>
                  高置信自动提交倒计时 {(countdownMs / 1000).toFixed(1)}s…
                </span>
                <Button
                  size="xs"
                  variant="danger"
                  onClick={() => {
                    stopLoop('已拦截本次自动提交');
                    onNotify('已拦截自动提交，改为人工把关');
                  }}
                >
                  拦截 (Esc)
                </Button>
              </div>
            )}

            {/* Collapsible Rubric Builder (Quick Inline OR ExamCenter) */}
            <ZhixueRubricCard
              exams={exams}
              inferredMax={controls?.inferredMax ?? null}
              inferredStep={controls?.inferredStep ?? null}
              onChange={setActiveRubric}
              onNotify={onNotify}
            />

            {/* Crawled Webpage Score Options Panel */}
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">网页得分选项</span>
                <span className="text-[11px] text-[var(--ink-muted)] truncate">
                  {controls?.submitButton
                    ? `提交键：「${controls.submitButton.label}」`
                    : '未定位提交键'}
                </span>
              </div>

              {controls && controls.scoreOptions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {controls.scoreOptions.map((opt) => {
                    const isAiPick =
                      aiSuggestedNum !== null &&
                      opt.value !== null &&
                      Math.round(opt.value * 100) === Math.round(aiSuggestedNum * 100);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={overlayBlocked}
                        onClick={() => {
                          if (opt.value !== null) setManualScore(String(opt.value));
                          void applyScoreToPage({
                            scoreText: opt.value !== null ? String(opt.value) : opt.label,
                            optionId: opt.id,
                            autoSubmit: false,
                          });
                        }}
                        className={`min-w-[34px] h-7 px-2 rounded-lg text-xs font-semibold tabular-nums border cursor-pointer transition-all ${
                          isAiPick
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
                            : 'bg-[var(--bg-surface)] text-[var(--ink-primary)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11.5px] text-[var(--ink-muted)] leading-relaxed flex items-center justify-between gap-2">
                  <span>进入阅卷页后点击「自动爬取得分选项」，即可在此同步点击网页分值按钮。</span>
                </div>
              )}
            </div>

            {/* Always-Visible Recognition Content & Snapshot Verification Box */}
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">识别内容与核对框</span>
                <div className="flex items-center gap-1">
                  {aiResult && aiResult.scan.ocr.conflicts.length > 0 && (
                    <Button
                      size="xs"
                      onClick={() => setEditableScan(aiResult.scan.ocr.ocrText)}
                    >
                      采用 OCR 原文
                    </Button>
                  )}
                  {aiResult && (
                    <Button
                      size="xs"
                      variant="soft"
                      disabled={busy}
                      onClick={() => void reScoreWithEditedText()}
                    >
                      按修正重算
                    </Button>
                  )}
                </div>
              </div>

              {/* Captured ROI Preview */}
              {capturedUrl ? (
                <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--grading-canvas)] p-1 relative">
                  <img
                    src={capturedUrl}
                    alt="截取答卷区"
                    onClick={() => setExpandShot((v) => !v)}
                    title="点击展开/收起原图预览"
                    className={`w-full object-contain rounded cursor-pointer transition-all ${
                      expandShot ? 'max-h-72' : 'max-h-28'
                    }`}
                  />
                </div>
              ) : (
                <div className="px-2.5 py-3 rounded-lg border border-dashed border-[var(--border-strong)] text-[11.5px] text-[var(--ink-muted)] text-center">
                  点击上方「设置读取区域」框选学生作答区，再点「抓图识图」查看截取画面
                </div>
              )}

              {/* Objective Confidence Banner */}
              {aiResult && (
                <div
                  className={`p-2 rounded-lg text-xs border ${
                    aiResult.confidence.redlines.length
                      ? 'bg-[var(--danger-soft)] border-[var(--danger)]/40 text-[var(--danger)]'
                      : aiResult.confidence.decision === 'auto'
                        ? 'bg-[var(--ok-soft)] border-[var(--ok)]/40 text-[var(--ok)]'
                        : 'bg-[var(--warn-soft)] border-[var(--warn)]/40 text-[var(--warn)]'
                  }`}
                >
                  <div className="font-semibold flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1">
                      {aiResult.confidence.redlines.length ? (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      )}
                      客观置信度 {aiResult.confidence.total}%
                    </span>
                    <span className="text-[11px]">
                      {LEGIBILITY_LABELS[aiResult.scan.legibility]} · OCR {aiResult.confidence.ocrScore}/40
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px]">{aiResult.confidence.summary}</div>
                </div>
              )}

              {/* OCR Conflict Highlight Strip (when AI result exists) */}
              {aiResult && aiResult.scan.ocr.conflicts.length > 0 && (
                <div className="p-2 rounded-lg bg-[var(--bg-muted)] text-xs leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto">
                  {highlightScanSegments(editableScan, aiResult.scan.ocr.conflicts).map((s, i) =>
                    s.conflict ? (
                      <mark key={i} className="ocr-diff" title={s.conflict.reason}>
                        {s.text}
                      </mark>
                    ) : (
                      <span key={i}>{s.text}</span>
                    ),
                  )}
                </div>
              )}

              {/* Always-Present Editable Recognition Text Box */}
              <Textarea
                value={editableScan}
                onChange={(e) => setEditableScan(e.target.value)}
                placeholder="AI 识图后将在此实时显示学生手写文字与公式；如有识别误差可直接修改后点「按修正重算」…"
                className="min-h-[84px] text-xs leading-relaxed"
              />

              {/* Per-Criterion Reasons */}
              {aiResult && aiResult.adoptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  {aiResult.adoptions.map((a, idx) => (
                    <div
                      key={a.criterionId}
                      className="text-[11.5px] px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex justify-between gap-2"
                    >
                      <span className="min-w-0 leading-snug">
                        <strong>点 {idx + 1}：</strong>
                        {a.reason || a.quote || '—'}
                      </span>
                      <strong className="tabular-nums text-[var(--accent)] shrink-0">
                        +{a.suggestedValue}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Fixed Bottom Action Bar */}
          <div className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/60 flex flex-col gap-2 shrink-0">
            <Button
              size="sm"
              variant="soft"
              disabled={busy || overlayBlocked}
              onClick={() => void gradeCurrentPaper()}
              className="w-full"
            >
              {busy ? (
                <>
                  <ScanEye className="w-4 h-4 animate-pulse" /> 正在抓取读取区并 AI 识图判分…
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" /> 单次抓图 → AI 识图判分
                </>
              )}
            </Button>

            <div className="flex items-center gap-1.5">
              <Input
                value={manualScore}
                onChange={(e) => setManualScore(e.target.value)}
                placeholder="分值"
                className="h-8 tabular-nums font-bold text-center w-20 shrink-0"
              />
              <Button
                size="sm"
                className="flex-1"
                disabled={!manualScore.trim() || overlayBlocked}
                onClick={() =>
                  void applyScoreToPage({ scoreText: manualScore, autoSubmit: false })
                }
              >
                <CornerDownLeft className="w-3.5 h-3.5" /> 选分/填分
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={!manualScore.trim() || overlayBlocked}
                onClick={() =>
                  void applyScoreToPage({ scoreText: manualScore, autoSubmit: true })
                }
              >
                <Send className="w-3.5 h-3.5" /> 打分并提交
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
