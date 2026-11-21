import { useState } from 'react';
import type { WorkbenchStore, StoreState } from '../../app/store';
import { buildExamReport, recordParticipation, rateText, statusLabels, weightedPoints, type ExamReport, type GradeRow } from '../../modules/assessment';
import { encodeGradeCsv, encodeReportHtml, downloadReport, type ExportOptions } from '../../modules/assessment/export';
import { points } from '../../modules/grading/score-policy';
import type { Submission } from '../../modules/grading';
import { KnowledgeEditor } from './KnowledgeEditor';
import { Modal, ErrorText } from '../Modal';
import { Badge, Pager } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, useDraftWarning } from './shared';

const SAVE_LABELS: Record<StoreState['status'], string> = {
  saved: '已保存的工作区快照', unsaved: '未持久保存的工作副本', saving: '保存进行中的工作副本',
  conflict: '存在版本冲突的工作副本', loading: '读取中', 'load-error': '读取失败后的保留副本',
};

function ParticipationEditor({ store, examId, row, close }: { store: WorkbenchStore; examId: string; row: GradeRow; close: () => void }) {
  const [token] = useState(store.token());
  const [status, setStatus] = useState<'present' | 'absent'>(row.attendance?.status || 'present');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDraftWarning(dirty);
  const leave = () => { if (!busy && (!dirty || window.confirm('参测状态尚未保存，确定放弃？'))) close(); };

  async function save() {
    setBusy(true);
    try {
      await applyEdit(store, token, (next) => recordParticipation(next, examId, row.membershipId, status, reason));
      setDirty(false); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const history = store.getState().snapshot!.data.grading.participation.filter((p) => p.examId === examId && p.membershipId === row.membershipId).sort((a, b) => b.version - a.version);

  return (
    <Modal title={`参测状态 · ${row.name}`} onClose={leave}>
      <fieldset className="fields col" disabled={busy}>
        <label className="tight">
          本场参测情况
          <select value={status} onChange={(e) => { setStatus(e.target.value as 'present' | 'absent'); setDirty(true); setConfirmed(false); }}>
            <option value="present">正常参测</option>
            <option value="absent">缺考（不计零分、不拉低均分）</option>
          </select>
        </label>
        <label className="tight">
          {status === 'absent' ? '缺考原因（必填）' : '更正说明（选填）'}
          <textarea rows={2} maxLength={20000} value={reason} onChange={(e) => { setReason(e.target.value); setDirty(true); setConfirmed(false); }} />
        </label>
        <label className="confirm-box">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>确认以上学生与参测状态</span>
        </label>
        <ErrorText message={error} />
        <div className="dialog-actions">
          <button type="button" onClick={leave}>取消</button>
          <button type="button" className="primary" disabled={!confirmed} onClick={() => void save()}>保存状态</button>
        </div>
        {history.length > 0 && (
          <details className="subtle">
            <summary>变更历史（{history.length}）</summary>
            <div className="diff-list" style={{ marginTop: 6 }}>{history.map((p) => <div key={p.id}>{p.createdAt} · {p.status === 'absent' ? '缺考' : '参测'} · {p.reason || '无说明'}</div>)}</div>
          </details>
        )}
      </fieldset>
    </Modal>
  );
}

export function AnalysisPanel({ store, state, examId, readonly, onReview }: { store: WorkbenchStore; state: StoreState; examId: string; readonly: boolean; onReview: (s: Submission) => void }) {
  const s = state.snapshot!, g = s.data.grading;
  const plans = g.knowledgePlans.filter((p) => p.examId === examId).sort((a, b) => b.version - a.version);

  const [planId, setPlanId] = useState('');
  const [mapping, setMapping] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [participation, setParticipation] = useState<GradeRow | null>(null);
  const [topicId, setTopicId] = useState('');
  const [page, setPage] = useState(0);
  const [evPage, setEvPage] = useState(0);
  const [identified, setIdentified] = useState(false);
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  let report: ExamReport | null = null, reportError = '';
  try { report = buildExamReport(s, examId, planId || undefined); } catch (e) { reportError = (e as Error).message; }

  const topic = report?.topics.find((t) => t.knowledgeId === topicId);
  const curPage = Math.min(page, Math.max(0, Math.ceil((report?.rows.length || 0) / 50) - 1));
  const curEvPage = Math.min(evPage, Math.max(0, Math.ceil((topic?.evidence.length || 0) / 50) - 1));

  async function exportFile(format: 'csv' | 'html') {
    setBusy(true); setError(''); setNotice('');
    try {
      const cur = store.getState();
      if (!cur.snapshot) throw new Error('工作区尚未读取');
      const opts: ExportOptions = { identified, includeImages: images && identified, saveLabel: SAVE_LABELS[cur.status], exportedAt: new Date().toISOString() };
      const out = format === 'csv'
        ? encodeGradeCsv(buildExamReport(cur.snapshot, examId, planId || undefined), opts)
        : await encodeReportHtml(cur.snapshot, cur.files, examId, planId || undefined, opts);
      downloadReport(out, format);
      setExportOpen(false);
      setNotice('讲评报告已开始下载。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="col">
      <div className="bar">
        <label className="inline-field">
          <span>知识点方案</span>
          <select value={planId} onChange={(e) => { setPlanId(e.target.value); setTopicId(''); setEvPage(0); }}>
            <option value="">最新方案{plans[0] ? `（v${plans[0].version}）` : '（未配置）'}</option>
            {plans.map((p) => <option key={p.id} value={p.id}>v{p.version} · {p.createdAt.slice(0, 16).replace('T', ' ')}</option>)}
          </select>
        </label>
        <div className="spacer" />
        <div className="row">
          <button type="button" disabled={readonly || state.busy || busy || !g.items.some((i) => i.examId === examId)} onClick={() => setMapping(true)}>
            <Icon name="edit" size={14} />配置知识点映射
          </button>
          <button type="button" className="primary" disabled={busy || state.busy || !report} onClick={() => setExportOpen(true)}>
            <Icon name="download" size={14} />导出讲评报告
          </button>
        </div>
      </div>

      {notice && <div role="status" className="alert tone-success row between"><span>{notice}</span><button type="button" className="sm" onClick={() => setNotice('')}>知道了</button></div>}
      <ErrorText message={reportError || error} />

      {report && (
        <>
          <div className="grid-4">
            <div className="kpi card"><span>整卷满分</span><strong>{points(report.maxUnits)} 分</strong></div>
            <div className="kpi card"><span>全题已确认</span><strong>{report.completeCount} 人</strong></div>
            <div className="kpi card accent"><span>完整成绩均分</span><strong>{report.averageUnits === null ? '—' : (report.averageUnits / 100).toFixed(2)}</strong></div>
            <div className="kpi card"><span>未确认草稿</span><strong>{report.draftCount} 份</strong></div>
          </div>

          <div className="card col" style={{ padding: '14px 16px' }}>
            <div className="row between">
              <div>
                <h3>知识点得分率（讲评参考）</h3>
                <p className="tip">已确认总可得分 {points(report.confirmedPossibleUnits)} 分（未映射 {points(report.unmappedUnits)} 分）</p>
              </div>
              {!report.plan && (
                <button type="button" className="sm primary" disabled={readonly || state.busy || !g.items.some((i) => i.examId === examId)} onClick={() => setMapping(true)}>去配置知识点</button>
              )}
            </div>
            {!report.plan ? (
              <p className="tip">尚未配置知识点映射；配置后自动统计薄弱知识点排行。</p>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {report.topics.map((t) => {
                  const pct = t.possibleWeighted > 0 ? (t.earnedWeighted / t.possibleWeighted) * 100 : 0;
                  const tone = pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'danger';
                  return (
                    <div className="topic-row" key={t.knowledgeId}>
                      <div>
                        <strong>{t.name}</strong>
                        <div className="tip">{t.itemCount}题 · {t.studentCount}人{t.itemCount < 3 || t.studentCount < 5 ? '（样本偏少）' : ''}</div>
                      </div>
                      <div className="row">
                        <div className="progress-track" style={{ flex: 1 }}><div className={`progress-fill ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
                        <strong className="num" style={{ width: 58, textAlign: 'right' }}>{rateText(t.earnedWeighted, t.possibleWeighted)}</strong>
                      </div>
                      <span className="tip num">{weightedPoints(t.earnedWeighted)}/{weightedPoints(t.possibleWeighted)}</span>
                      <button type="button" className="sm" disabled={!t.evidence.length} onClick={() => { setTopicId(t.knowledgeId); setEvPage(0); }}>明细</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card table-card">
            <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              <h3>学生逐题确认成绩（{report.rows.length} 人）</h3>
              <span className="tip">点击分数可回看答卷与打分依据</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>学生 / 编号</th>
                    {report.items.map((i) => <th key={i.id}>第 {i.label} 题</th>)}
                    <th>已确认小计</th>
                    <th>整卷总分</th>
                    <th>参测状态</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.slice(curPage * 50, (curPage + 1) * 50).map((row) => (
                    <tr key={row.membershipId}>
                      <td><strong>{row.name}</strong><span className="tip num" style={{ marginLeft: 6 }}>{row.rosterNo || '无编号'}{row.removed ? '（移出）' : ''}</span></td>
                      {row.cells.map((cell) => (
                        <td key={cell.item.id} className="num">
                          {cell.submission && g.rubrics.some((r) => r.itemId === cell.item.id && r.frozenAt) ? (
                            <button type="button" className="text-btn" onClick={() => onReview(cell.submission!)}>
                              {cell.scoreUnits === null ? statusLabels[cell.status] : points(cell.scoreUnits)}
                            </button>
                          ) : <span className="muted">{statusLabels[cell.status]}</span>}
                        </td>
                      ))}
                      <td className="num">{row.cells.some((c) => c.status === 'confirmed') ? `${points(row.confirmedUnits)}/${points(row.confirmedMaxUnits)}` : '—'}</td>
                      <td className="num">{row.totalUnits === null ? <span className="muted">未全评</span> : <strong>{points(row.totalUnits)}</strong>}</td>
                      <td>
                        <div className="row">
                          <Badge tone={row.attendance?.status === 'absent' ? 'danger' : 'neutral'}>{row.attendance?.status === 'absent' ? '缺考' : '正常'}</Badge>
                          <button type="button" className="sm" disabled={readonly || state.busy || busy} onClick={() => setParticipation(row)}>标记</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={curPage} total={report.rows.length} pageSize={50} onChange={setPage} />
          </div>
        </>
      )}

      {topic && report && (
        <Modal title={`${topic.name} · 得分明细`} subtitle={`共 ${topic.evidence.length} 条记录`} drawer onClose={() => setTopicId('')}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>学生</th><th>题目 / 权重</th><th>加权得分</th><th>答卷</th></tr></thead>
              <tbody>
                {topic.evidence.slice(curEvPage * 50, (curEvPage + 1) * 50).map((e) => {
                  const row = report!.rows.find((r) => r.membershipId === e.membershipId)!;
                  const item = report!.items.find((i) => i.id === e.itemId)!;
                  const sub = g.submissions.find((a) => a.id === e.submissionId)!;
                  return (
                    <tr key={`${e.membershipId}:${e.itemId}:${e.scoringUnitId}`}>
                      <td><strong>{row.name}</strong><div className="tip">{row.rosterNo || '无编号'}</div></td>
                      <td>第{item.label}题·{item.scoringUnits.find((u) => u.id === e.scoringUnitId)!.label}<div className="tip">权重 {e.weightBps / 100}%</div></td>
                      <td className="num">{weightedPoints(e.earnedWeighted)}/{weightedPoints(e.possibleWeighted)}</td>
                      <td><button type="button" className="sm" onClick={() => onReview(sub)}>看 v{sub.version}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={curEvPage} total={topic.evidence.length} pageSize={50} unit="条" onChange={setEvPage} />
        </Modal>
      )}

      {exportOpen && (
        <Modal title="导出阅卷与讲评报告" onClose={() => setExportOpen(false)}>
          <div className="col">
            <label className="confirm-box" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={identified} onChange={(e) => { setIdentified(e.target.checked); if (!e.target.checked) setImages(false); }} />
              <span>包含学生真名与编号（HTML 同时含试题、作答文字与依据）</span>
            </label>
            <label className="confirm-box" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={images} disabled={!identified} onChange={(e) => setImages(e.target.checked)} />
              <span>HTML 内嵌手写答卷照片与参考图（文件较大）</span>
            </label>
            <div className="dialog-actions">
              <button type="button" disabled={busy || state.busy} onClick={() => void exportFile('csv')}><Icon name="sheet" size={15} />导出 CSV</button>
              <button type="button" className="primary" disabled={busy || state.busy} onClick={() => void exportFile('html')}><Icon name="download" size={15} />导出离线 HTML</button>
            </div>
          </div>
        </Modal>
      )}

      {mapping && <KnowledgeEditor store={store} examId={examId} close={() => setMapping(false)} />}
      {participation && <ParticipationEditor store={store} examId={examId} row={participation} close={() => setParticipation(null)} />}
    </section>
  );
}
