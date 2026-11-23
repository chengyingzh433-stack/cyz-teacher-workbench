import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui/primitives';

const TIMER_PRESETS = [
  { label: '5分 随堂测', seconds: 5 * 60 },
  { label: '15分 早读', seconds: 15 * 60 },
  { label: '25分 番茄钟', seconds: 25 * 60 },
  { label: '40分 课堂', seconds: 40 * 60 },
] as const;

function formatMMSS(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function FocusTimerWidget({
  todayFocusMinutes,
  readonly = false,
  compact = false,
  onEarnMinutes,
  onClose,
  onNotify,
}: {
  todayFocusMinutes: number;
  readonly?: boolean;
  compact?: boolean;
  onEarnMinutes: (minutes: number) => Promise<void> | void;
  onClose?: () => void;
  onNotify?: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [leftSeconds, setLeftSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);

  // Accurate incremental accumulator: never double-counts minutes across pause/resume cycles!
  const unsettledSecondsRef = useRef(0);
  const onEarnRef = useRef(onEarnMinutes);
  const onNotifyRef = useRef(onNotify);
  onEarnRef.current = onEarnMinutes;
  onNotifyRef.current = onNotify;

  function settleEarnedMinutes(notifyOnSettle = false) {
    if (readonly) {
      unsettledSecondsRef.current = 0;
      return 0;
    }
    const earned = Math.floor(unsettledSecondsRef.current / 60);
    if (earned > 0) {
      unsettledSecondsRef.current -= earned * 60;
      void onEarnRef.current(earned);
      if (notifyOnSettle) {
        onNotifyRef.current?.(`本次专注已累计计入 ${earned} 分钟`);
      }
    }
    return earned;
  }

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      unsettledSecondsRef.current += 1;
      setLeftSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          setRunning(false);
          const earned = settleEarnedMinutes(false);
          onNotifyRef.current?.(
            earned > 0
              ? `计时完成！已计入今日专注 ${earned} 分钟，记得起身活动一下`
              : '计时完成！',
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    return () => {
      // Flush any accumulated full minutes when unmounting
      const earned = Math.floor(unsettledSecondsRef.current / 60);
      if (earned > 0 && !readonly) {
        unsettledSecondsRef.current -= earned * 60;
        void onEarnRef.current(earned);
      }
    };
  }, [readonly]);

  function handleToggle() {
    if (running) {
      setRunning(false);
      settleEarnedMinutes(true);
    } else {
      if (leftSeconds <= 0) {
        setLeftSeconds(totalSeconds);
      }
      setRunning(true);
    }
  }

  function handleReset() {
    setRunning(false);
    settleEarnedMinutes(true);
    unsettledSecondsRef.current = 0;
    setLeftSeconds(totalSeconds);
  }

  function pickPreset(sec: number) {
    setRunning(false);
    settleEarnedMinutes(false);
    unsettledSecondsRef.current = 0;
    setTotalSeconds(sec);
    setLeftSeconds(sec);
  }

  const pct = totalSeconds > 0 ? Math.min(100, ((totalSeconds - leftSeconds) / totalSeconds) * 100) : 0;

  return (
    <Card className={compact ? 'p-3.5 w-80 shadow-[var(--shadow-lg)]' : 'p-4'}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Timer className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="text-[13.5px] font-semibold whitespace-nowrap">专注 / 课堂倒计时</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge tone="warn">今日 {todayFocusMinutes} 分</Badge>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭计时器"
              className="p-1 rounded-md text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Preset Chips */}
      <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
        {TIMER_PRESETS.map((p) => {
          const active = totalSeconds === p.seconds;
          return (
            <button
              key={p.seconds}
              type="button"
              onClick={() => pickPreset(p.seconds)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                active
                  ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                  : 'bg-[var(--bg-muted)]/70 border-transparent text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Clock Display */}
      <div className="my-3 text-center">
        <div className="text-[36px] leading-none font-bold tracking-wider tabular-nums text-[var(--accent)] font-mono">
          {formatMMSS(leftSeconds)}
        </div>
        <div className="mt-2.5 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-center gap-2">
        <Button size="sm" variant="primary" onClick={handleToggle} className="min-w-[88px]">
          {running ? (
            <>
              <Pause className="w-3.5 h-3.5" /> 暂停
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" /> {leftSeconds < totalSeconds && leftSeconds > 0 ? '继续' : '开始'}
            </>
          )}
        </Button>
        <Button size="sm" onClick={handleReset}>
          <RotateCcw className="w-3.5 h-3.5" /> 重置
        </Button>
      </div>
    </Card>
  );
}
