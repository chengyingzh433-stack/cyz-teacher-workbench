import { useRef, useState } from 'react';
import type { WorkbenchStore } from '../../app/store';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { confirmScores, saveDraft, latestDecision, latestSubmission, type Submission } from '../../modules/grading';
import {
  inspectImageBlob,
  runBlindScanStage,
  runScoringStage,
  type GradingResult,
  type ImageGateResult,
  type PointAdoption,
} from '../../modules/grading/ai-engine';
import { calculateScores, points } from '../../modules/grading/score-policy';
import { Modal, ErrorText } from '../Modal';
import { Badge } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, BlobImage, useDraftWarning } from './shared';
import { ConfidenceMeter, ScannedContentBox } from './AiScanView';

function quickScores(maxUnits: number, stepUnits: number) {
  if (stepUnits <= 0 || maxUnits < 0 || Math.floor(maxUnits / stepUnits) > 10) return [];
  const res: string[] = [];
  for (let u = 0; u <= maxUnits; u += stepUnits) res.push(points(u));
  return res;
}

const ADOPTION_BADGE: Record<PointAdoption['status'], { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }> = {
  full: { label: '✓ 明确命中', tone: 'success' },
  partial: { label: '△ 部分采纳', tone: 'info' },
  none: { label: '✗ 未命中', tone: 'neutral' },
  uncertain: { label: '? 边界存疑', tone: 'warning' },
};

export function ReviewEditor({
  store,
  submission,
  connection,
  openSettings,
  threshold = 88,
  close,
  readonly = false,
  evidenceOnly = false,
}: {
  store: WorkbenchStore;
  submission: Submission;
  connection: AssistantConnection;
  openSettings: (tab?: 'general' | 'grading') => void;
  threshold?: number;
  close: () => void;
  readonly?: boolean;
  evidenceOnly?: boolean;
}) {
  const [base] = useState(() => store.getState());
  const [token, setToken] = useState(store.token());
  const s = base.snapshot!, g = s.data.grading;
  const item = g.items.find((i) => i.id === submission.itemId)!;
  const decision = latestDecision(g, submission.id);
  const draft = evidenceOnly ? undefined : g.drafts.find((d) => d.submissionId === submission.id);
  const rubric =
    g.rubrics.find((r) => r.id === (draft?.rubricVersionId || decision?.rubricVersionId)) ||
    g.rubrics.filter((r) => r.itemId === item.id && r.frozenAt).sort((a, b) => b.version - a.version)[0];

  const [inputs, setInputs] = useState(() =>
    rubric.criteria.map((c) => {
      const d = draft?.scores.find((x) => x.criterionId === c.id), p = decision?.scores.find((x) => x.criterionId === c.id);
      return { criterionId: c.id, value: d?.value ?? (p ? points(p.units) : ''), reason: d?.reason ?? p?.reason ?? '' };
    }),
  );
  const [reason, setReason] = useState(draft?.reason || (evidenceOnly ? decision?.reason || '' : ''));
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStage, setAiStage] = useState('');
  const [aiResult, setAiResult] = useState<GradingResult | null>(null);
  const [scanText, setScanText] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const editable = !readonly && !evidenceOnly && submission.completeness === 'complete' && latestSubmission(g, submission.itemId, submission.membershipId)?.id === submission.id;
  let calc: ReturnType<typeof calculateScores> | null = null, calcErr = '';
  try { calc = calculateScores(rubric, inputs); } catch (e) { calcErr = (e as Error).message; }

  useDraftWarning(dirty);
  const leave = () => {
    abortRef.current?.abort();
    if (!busy && (!dirty || window.confirm('打分尚未保存，确定放弃？'))) close();
  };

  const setField = (cid: string, patch: { value?: string; reason?: string }) => {
    setInputs(inputs.map((x) => (x.criterionId === cid ? { ...x, ...patch } : x)));
    setDirty(true); setConfirmed(false);
  };

  function applyAiResult(res: GradingResult) {
    setAiResult(res);
    setScanText(res.scan.restoredText);
    if (res.confidence.redlines.length === 0) {
      setInputs(
        rubric.criteria.map((c) => {
          const a = res.adoptions.find((x) => x.criterionId === c.id);
          return {
            criterionId: c.id,
            value: a?.suggestedValue ?? '0',
            reason: a ? [a.reason, a.quote ? `依据：「${a.quote}」` : ''].filter(Boolean).join(' · ') : '',
          };
        }),
      );
      if (res.overallComment && !reason.trim()) setReason(res.overallComment);
      setDirty(true);
      setConfirmed(false);
    }
  }

  async function runAiReview() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiBusy(true);
    setError('');
    setMessage('');
    try {
      setAiStage('1/2 本地预检与盲识图 + OCR 核对中…');
      const inspected: Array<{ dataUrl: string; gate: ImageGateResult }> = [];
      for (const aid of submission.assetIds) {
        const ast = g.assets.find((x) => x.id === aid);
        const blob = ast ? base.files.get(ast.hash) : undefined;
        if (blob) inspected.push(await inspectImageBlob(blob));
      }
      const combinedGate: ImageGateResult =
        inspected.find((x) => !x.gate.ok) ?.gate ||
        (inspected.length > 0 && inspected.every((x) => x.gate.blankSuspected)
          ? inspected[0].gate
          : inspected[0]?.gate || { ok: true, width: 0, height: 0, inkRatio: null, blankSuspected: false, reason: '纯文字作答' });

      const scan = await runBlindScanStage(
        connection,
        {
          imageDataUrls: inspected.map((x) => x.dataUrl),
          imageGate: combinedGate,
          typedText: submission.text,
          subjectHint: item.prompt.slice(0, 60),
        },
        ctrl.signal,
      );
      setAiStage('2/2 对照得分点采纳与置信度核算中…');
      const result = await runScoringStage(
        connection,
        { scan, scanText: scan.restoredText, rubric, itemPrompt: item.prompt, threshold },
        ctrl.signal,
      );
      applyAiResult(result);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setAiBusy(false);
      setAiStage('');
    }
  }

  async function rescoreWithEditedScan() {
    if (!aiResult) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiBusy(true);
    setError('');
    setAiStage('正在按修正后的扫描内容重算得分点…');
    try {
      const updated = await runScoringStage(
        connection,
        { scan: aiResult.scan, scanText, rubric, itemPrompt: item.prompt, threshold },
        ctrl.signal,
      );
      applyAiResult(updated);
      setMessage('已按修正后的扫描内容更新各得分点建议分值。');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setAiBusy(false);
      setAiStage('');
    }
  }

  async function save(confirm: boolean) {
    setBusy(true); setError('');
    try {
      await applyEdit(store, token, (next) => {
        if (confirm) confirmScores(next, submission.id, rubric.id, inputs, reason, decision?.id || null);
        else saveDraft(next, submission.id, rubric.id, inputs, reason);
      });
      setDirty(false); setToken(store.token());
      setMessage(store.getState().status === 'saved' ? '草稿已保存（确认成绩后生效）' : '草稿已进入当前会话');
      if (confirm) close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const asset = g.assets.find((a) => a.id === submission.assetIds[page]);
  const member = s.data.memberships.find((m) => m.id === submission.membershipId)!;
  const student = s.data.students.find((x) => x.id === member.studentId)!;
  const gv = connection.gradingView();

  return (
    <Modal
      title={`${student.name}（${member.rosterNo || '无编号'}）· 第 ${item.label} 题`}
      subtitle={`答卷 v${submission.version} · 细则 v${rubric.version} · 满分 ${points(item.maxUnits)} 分`}
      extraWide
      onClose={leave}
      footer={
        <div className="row between" style={{ width: '100%' }}>
          {calc ? (
            <div className="row">
              <strong>合计 {points(calc.totalUnits)} / {points(item.maxUnits)} 分</strong>
              <span className="tip">（{item.scoringUnits.map((u) => `${u.label} ${points(calc!.totals.get(u.id) || 0)}/${points(u.maxUnits)}`).join(' · ')}）</span>
            </div>
          ) : <span className="text-warn" style={{ fontSize: 13 }}>待补全：{calcErr}</span>}
          {editable ? (
            <div className="row">
              <button type="button" disabled={busy || aiBusy} onClick={() => void save(false)}>暂存草稿</button>
              <button type="button" className="primary" disabled={!confirmed || !calc || busy || aiBusy} onClick={() => void save(true)}>
                {busy ? '提交中…' : decision ? '确认改分并留记录' : '确认正式成绩'}
              </button>
            </div>
          ) : <button type="button" onClick={leave}>关闭</button>}
        </div>
      }
    >
      <div className="review-grid">
        <section className="col">
          <div className="row between">
            <h3>学生作答原图</h3>
            <Badge tone={submission.completeness === 'complete' ? 'success' : 'warning'}>{submission.completeness === 'complete' ? '已核对完整' : '待处理'}</Badge>
          </div>
          {submission.text && <div className="soft-card"><small className="muted">文字作答</small><p className="preserve">{submission.text}</p></div>}
          {submission.assetIds.length > 0 && (
            <>
              {submission.assetIds.length > 1 && (
                <div className="row">{submission.assetIds.map((a, i) => <button type="button" key={a} className={`pill ${page === i ? 'active' : ''}`} onClick={() => setPage(i)}>第 {i + 1} 页</button>)}</div>
              )}
              <BlobImage blob={asset ? base.files.get(asset.hash) : undefined} label="学生答卷" />
              {asset?.originalId && (
                <details className="subtle"><summary>查看拍摄原图</summary><BlobImage blob={base.files.get(g.assets.find((a) => a.id === asset.originalId)!.hash)} label="原图" /></details>
              )}
            </>
          )}

          {aiResult && (
            <ScannedContentBox
              scan={aiResult.scan}
              scanText={scanText}
              onChangeText={setScanText}
              onRescore={editable ? () => void rescoreWithEditedScan() : undefined}
              busy={aiBusy || busy}
            />
          )}

          <details className="subtle">
            <summary>对照题干与参考答案</summary>
            <div className="col" style={{ marginTop: 6 }}>
              {item.prompt && <p className="preserve">{item.prompt}</p>}
              {rubric.referenceAnswer && <p className="preserve"><strong>参考答案：</strong>{rubric.referenceAnswer}</p>}
              {item.referenceAssetIds.map((ref) => <BlobImage key={ref} blob={base.files.get(g.assets.find((a) => a.id === ref)!.hash)} label="参考图" />)}
            </div>
          </details>
        </section>

        <section className="col">
          <div className="row between">
            <h3>{editable ? '逐点采纳打分' : '评分依据（只读）'}</h3>
            {decision && <Badge tone="success">已确认 {points(decision.scores.reduce((sum, x) => sum + x.units, 0))} 分</Badge>}
          </div>

          {editable && (
            <div className="ai-card col" style={{ gap: 8 }}>
              <div className="row between">
                <div className="row" style={{ gap: 6 }}>
                  <Icon name="sparkles" size={15} style={{ color: 'var(--info)' }} />
                  <strong style={{ fontSize: 13 }}>AI 盲识图 + OCR 辅助初评</strong>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="sm" onClick={() => openSettings('grading')}>
                    <Icon name="settings" size={12} />模型设置
                  </button>
                  <button type="button" className="sm primary" disabled={aiBusy || busy} onClick={() => void runAiReview()}>
                    <Icon name="zap" size={13} />
                    {aiBusy ? '识别采分中…' : aiResult ? '重新 AI 识图' : 'AI 盲识图初评'}
                  </button>
                </div>
              </div>
              <div className="tip">
                {aiStage || `识图：${gv.vision.effectiveLabel} · 采分：${gv.judge.effectiveLabel} · OCR：${gv.ocr.effectiveLabel}`}
              </div>
            </div>
          )}

          {aiResult && <ConfidenceMeter confidence={aiResult.confidence} />}
          {draft && <div className="alert tone-warning">正在编辑评分草稿，点击底部「确认正式成绩」后生效。</div>}

          <fieldset className="fields col" disabled={!editable || busy || aiBusy}>
            {rubric.criteria.map((c) => {
              const inp = inputs.find((x) => x.criterionId === c.id)!;
              const pills = quickScores(c.maxUnits, c.stepUnits);
              const adopt = aiResult?.adoptions.find((a) => a.criterionId === c.id);
              return (
                <div className={`soft-card col ${adopt?.status === 'uncertain' ? 'warn-box' : ''}`} key={c.id}>
                  <div className="row between">
                    <div className="row" style={{ gap: 6 }}>
                      <Badge>{item.scoringUnits.find((u) => u.id === c.scoringUnitId)?.label}</Badge>
                      {adopt && <Badge tone={ADOPTION_BADGE[adopt.status].tone}>{ADOPTION_BADGE[adopt.status].label}</Badge>}
                      {adopt && adopt.suggestedUnits > 0 && !adopt.quoteVerified && (
                        <Badge tone="danger">原文未锚定</Badge>
                      )}
                    </div>
                    <span className="tip">上限 {points(c.maxUnits)} · 步长 {points(c.stepUnits)}{c.exclusiveGroup ? ` · 互斥 ${c.exclusiveGroup}` : ''}</span>
                  </div>
                  <p style={{ fontSize: 13.5 }}>{c.description}</p>
                  {adopt && (adopt.quote || adopt.reason) && (
                    <div className="diff-item">
                      {adopt.quote && <span><strong>引用学生作答：</strong>「{adopt.quote}」</span>}
                      {adopt.reason && <span className="tip" style={{ marginLeft: adopt.quote ? 6 : 0 }}>{adopt.reason}</span>}
                    </div>
                  )}
                  <div className="row between">
                    {pills.length > 0 && editable && (
                      <div className="row" style={{ gap: 4 }}>
                        {pills.map((v) => <button type="button" key={v} className={`score-pill ${inp.value === v ? 'active' : ''}`} onClick={() => setField(c.id, { value: v })}>{v}</button>)}
                      </div>
                    )}
                    <label className="compact-input">得分<input inputMode="decimal" value={inp.value} maxLength={40} onChange={(e) => setField(c.id, { value: e.target.value })} /></label>
                  </div>
                  <details className="subtle">
                    <summary>{inp.reason ? '已填给分备注' : '添加给分/扣分备注（选填）'}</summary>
                    <textarea rows={2} style={{ marginTop: 6 }} value={inp.reason} maxLength={20000} onChange={(e) => setField(c.id, { reason: e.target.value })} />
                  </details>
                </div>
              );
            })}
            <label className="tight">{decision ? '本次改分原因（必填）' : '整题评语（选填）'}<textarea rows={2} value={reason} maxLength={20000} onChange={(e) => { setReason(e.target.value); setDirty(true); setConfirmed(false); }} /></label>
            {editable && (
              <label className="confirm-box">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>我已核对答卷与各评分点，确认以上分数</span>
              </label>
            )}
          </fieldset>
          <ErrorText message={error} />
          {message && <div role="status" className="alert tone-success">{message}</div>}
          {g.decisions.some((d) => d.submissionId === submission.id) && (
            <details className="subtle">
              <summary>历史打分记录</summary>
              <div className="diff-list" style={{ marginTop: 6 }}>
                {g.decisions.filter((d) => d.submissionId === submission.id).map((d) => (
                  <div key={d.id}>{d.confirmedAt} · <strong>{points(d.scores.reduce((sum, x) => sum + x.units, 0))}分</strong> · {d.reason || '无说明'}</div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </Modal>
  );
}
