import { useState } from 'react';
import {
  highlightScanSegments,
  LEGIBILITY_LABELS,
  POWER_PRESETS,
  type ConfidenceBreakdown,
  type Stage1ScanResult,
} from '../../modules/grading/ai-engine';
import { Badge } from '../Primitives';
import { Icon } from '../Icons';

/** Plays a gentle two-tone chime via Web Audio API when low-confidence pause needs human review. */
export function playPauseChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.13);
      gain.gain.setValueAtTime(0.08, now + idx * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.13 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.13);
      osc.stop(now + idx * 0.13 + 0.2);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 500);
  } catch {
    // Ignore audio restrictions in muted/headless environments.
  }
}

export function PowerSlider({
  threshold,
  onChange,
  chime,
  onToggleChime,
  compact = false,
}: {
  threshold: number;
  onChange: (next: number) => void;
  chime?: boolean;
  onToggleChime?: (next: boolean) => void;
  compact?: boolean;
}) {
  const activePreset =
    POWER_PRESETS.find((p) => p.threshold === threshold) ||
    (threshold >= 100
      ? POWER_PRESETS[0]
      : threshold >= 85
        ? POWER_PRESETS[1]
        : threshold >= 75
          ? POWER_PRESETS[2]
          : POWER_PRESETS[3]);

  return (
    <div className={`power-card col ${compact ? 'compact' : ''}`} style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <Icon name="sliders" size={15} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 13 }}>半自动功率（自动打分置信度阈值）</strong>
          <Badge tone={activePreset.tone}>
            {threshold >= 100 ? '100% · 纯人工把关' : `>= ${threshold}% 自动直出`}
          </Badge>
        </div>
        {onToggleChime && (
          <label className="row" style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!chime} onChange={(e) => onToggleChime(e.target.checked)} />
            <Icon name="volume" size={13} />
            <span>停机提示音</span>
          </label>
        )}
      </div>

      <div className="row between" style={{ gap: 10 }}>
        <div className="btn-group" role="group" aria-label="半自动功率档位">
          {POWER_PRESETS.map((p) => (
            <button
              key={p.threshold}
              type="button"
              className={threshold === p.threshold ? 'active' : ''}
              onClick={() => onChange(p.threshold)}
              title={p.desc}
            >
              {p.short} {p.threshold}%
            </button>
          ))}
        </div>
        <div className="row" style={{ flex: 1, minWidth: 150, gap: 8 }}>
          <span className="tip">高功率 68%</span>
          <input
            aria-label="置信度自动阈值滑块"
            className="power-range"
            type="range"
            min={68}
            max={100}
            step={2}
            value={threshold}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="tip">保守 100%</span>
        </div>
      </div>

      <div className="tip">
        {threshold >= 100
          ? '纯人工把关：每份答卷均暂停，展示扫描内容与得分点建议，等你核对确认。'
          : `置信度达到 ${threshold}% 及以上自动填分确认；低于 ${threshold}% 或遇到「识别不了 / 疑似空白 / OCR 数值冲突 / 规则非法」立即暂停提醒人工。`}
      </div>
    </div>
  );
}

export function ConfidenceMeter({ confidence }: { confidence: ConfidenceBreakdown }) {
  const tone =
    confidence.redlines.length > 0
      ? 'danger'
      : confidence.decision === 'auto'
        ? 'success'
        : confidence.total >= 75
          ? 'warning'
          : 'danger';

  return (
    <div className={`conf-box tone-${tone} col`} style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <strong className="num" style={{ fontSize: 18 }}>
            客观置信度 {confidence.total}%
          </strong>
          <Badge tone={tone}>
            {confidence.redlines.length > 0
              ? '触发硬红线 · 必须人工'
              : confidence.decision === 'auto'
                ? `>= ${confidence.threshold}% · 可自动直出`
                : confidence.threshold >= 100
                  ? '纯人工把关'
                  : `< ${confidence.threshold}% · 暂停待核`}
          </Badge>
        </div>
        <span className="tip">{confidence.summary}</span>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <Badge tone={confidence.ocrScore >= 32 ? 'success' : confidence.ocrScore >= 25 ? 'info' : 'warning'}>
          OCR核对 {confidence.ocrScore}/40
        </Badge>
        <Badge tone={confidence.clarityScore >= 16 ? 'success' : confidence.clarityScore >= 10 ? 'warning' : 'danger'}>
          笔迹清晰 {confidence.clarityScore}/20
        </Badge>
        <Badge tone={confidence.adoptionScore >= 20 ? 'success' : 'warning'}>
          采分锚定 {confidence.adoptionScore}/25
        </Badge>
        <Badge tone={confidence.ruleScore === 15 ? 'success' : 'danger'}>
          规则校验 {confidence.ruleScore}/15
        </Badge>
        {confidence.cappedBy && <span className="tip">封顶原因：{confidence.cappedBy}</span>}
      </div>

      {confidence.redlines.length > 0 && (
        <div className="alert tone-danger" role="alert">
          <Icon name="alert" size={16} />
          <div className="col" style={{ gap: 2 }}>
            {confidence.redlines.map((r, i) => (
              <span key={i}>{r}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ScannedContentBox({
  scan,
  scanText,
  onChangeText,
  onRescore,
  busy = false,
}: {
  scan: Stage1ScanResult;
  scanText: string;
  onChangeText: (next: string) => void;
  onRescore?: () => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const edited = scanText.trim() !== scan.restoredText.trim();
  const segments = highlightScanSegments(scanText, scan.ocr.conflicts);

  return (
    <section className="scan-box col" style={{ gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <Icon name="scan" size={15} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 13.5 }}>扫描内容输出区（盲识图复原）</strong>
          <Badge tone={scan.legibility === 'clear' ? 'success' : scan.legibility === 'minor_edits' ? 'info' : 'warning'}>
            {LEGIBILITY_LABELS[scan.legibility]}
          </Badge>
          {scan.ocr.enabled ? (
            <Badge tone={scan.ocr.hasCriticalConflict ? 'warning' : 'success'}>
              {scan.ocr.hasCriticalConflict ? `OCR 标黄 ${scan.ocr.conflicts.length} 处` : 'OCR 核对一致'}
            </Badge>
          ) : (
            <Badge tone="neutral">单 VLM 模式</Badge>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="sm" disabled={busy} onClick={() => setEditing((v) => !v)}>
            <Icon name="edit" size={13} />
            {editing ? '完成编辑' : '手动修正'}
          </button>
          {onRescore && (edited || editing) && (
            <button
              type="button"
              className="sm primary"
              disabled={busy || !scanText.trim()}
              onClick={() => {
                setEditing(false);
                onRescore();
              }}
            >
              <Icon name="refresh" size={13} />
              按修正内容重算得分点
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          rows={5}
          value={scanText}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="若发现识错字或公式，可直接修改后点击「按修正内容重算得分点」…"
        />
      ) : (
        <div className="scan-output preserve">
          {scanText.trim() ? (
            segments.map((seg, i) =>
              seg.conflict ? (
                <mark key={i} className="ocr-diff" title={seg.conflict.reason}>
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )
          ) : (
            <span className="muted">（未识别到有效文字内容，请直接查看学生原图人工判分）</span>
          )}
        </div>
      )}

      {scan.ocr.conflicts.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          {scan.ocr.conflicts.map((c, idx) => (
            <div key={idx} className="diff-item warn-box row between">
              <span>
                <strong>黄标核对 {idx + 1}：</strong>
                {c.reason}
              </span>
              {c.ocr !== '（未出现）' && c.vlm !== '（未出现）' && (
                <button
                  type="button"
                  className="sm"
                  disabled={busy}
                  onClick={() => {
                    onChangeText(scanText.replace(c.vlm, c.ocr));
                    setEditing(true);
                  }}
                >
                  采用 OCR「{c.ocr}」
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row between">
        <span className="tip">
          {scan.legibilityNote} · {scan.ocr.summary}
          {scan.imageGate.inkRatio !== null && ` · 黑像素 ${(scan.imageGate.inkRatio * 100).toFixed(2)}%`}
        </span>
      </div>

      {scan.ocr.enabled && scan.ocr.ocrText && (
        <details className="subtle">
          <summary>展开独立 OCR 识别原文（对照用）</summary>
          <p className="preserve tip" style={{ marginTop: 6 }}>
            {scan.ocr.ocrText}
          </p>
        </details>
      )}
    </section>
  );
}
