import { useState } from 'react';
import type { WorkbenchStore, StoreState } from '../../app/store';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { activeMembers } from '../../app/model';
import { createExam, freezeRubric, latestSubmission, latestDecision, type Item, type Submission } from '../../modules/grading';
import { points } from '../../modules/grading/score-policy';
import { participationFor } from '../../modules/assessment';
import { ItemEditor } from './ItemEditor';
import { AnswerEditor } from './AnswerEditor';
import { ReviewEditor } from './ReviewEditor';
import { AnalysisPanel } from './AnalysisPanel';
import { AiBatchWorkbench } from './AiBatchWorkbench';
import { applyEdit, BlobImage } from './shared';
import { ErrorText, Modal } from '../Modal';
import { Badge, EmptyCard } from '../Primitives';
import { Icon } from '../Icons';

export function GradingCenter({
  store,
  state,
  classId,
  connection,
  openSettings,
}: {
  store: WorkbenchStore;
  state: StoreState;
  classId: string;
  connection: AssistantConnection;
  openSettings: (tab?: 'general' | 'grading') => void;
}) {
  const s = state.snapshot!, g = s.data.grading;
  const exams = g.exams.filter((e) => e.classId === classId);
  const gbCount = s.data.gradebook.imports.filter((x) => x.classId === classId).length;

  const [examId, setExamId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'items' | 'answers' | 'ai' | 'review' | 'analysis'>('items');
  const [threshold, setThreshold] = useState(88);
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const [answerItem, setAnswerItem] = useState<Item | null>(null);
  const [review, setReview] = useState<Submission | null>(null);

  const exam = exams.find((e) => e.id === examId) || exams[0];
  const items = g.items.filter((i) => i.examId === exam?.id);
  const members = activeMembers(s, classId);
  const readonly = s.data.classes.find((c) => c.id === classId)?.status === 'archived' || state.status === 'load-error' || state.status === 'conflict';
  const disabled = readonly || busy || state.busy;

  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const submissions = items.flatMap((item) =>
    s.data.memberships.filter((m) => m.classId === classId).flatMap((m) => {
      const a = latestSubmission(g, item.id, m.id);
      return a ? [a] : [];
    }),
  );
  const pendingPrep = submissions.filter((a) => a.completeness !== 'complete').length;
  const toGrade = submissions.filter((a) => a.completeness === 'complete' && !latestDecision(g, a.id)).length;
  const confirmed = submissions.filter((a) => latestDecision(g, a.id)).length;

  return (
    <section className="col">
      {readonly && <div className="alert tone-warning">班级已归档或不可写，阅卷资料只读。</div>}

      {!exam ? (
        <EmptyCard
          icon={<Icon name="clipboard" size={30} />}
          title="建立手写答卷阅卷与讲评任务"
          description="适合主观题/实验题：定好评分细则、上传学生手写答卷照片、逐点快捷打分，并自动统计各知识点得分率辅助讲评。"
          actions={<button type="button" className="primary" disabled={disabled} onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} />新建阅卷考试</button>}
          footer={gbCount > 0 ? `提示：本班已有 ${gbCount} 份已导入的 Excel/CSV 成绩单，可在左侧「成绩册分析」直接查看（两者独立管理）。` : '提示：若已有现成 Excel/CSV 成绩表，直接前往左侧「成绩册分析」导入更快。'}
        />
      ) : (
        <>
          <div className="bar">
            <label className="inline-field">
              <span>当前考试</span>
              <select value={exam.id} onChange={(e) => setExamId(e.target.value)}>
                {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
            <div className="spacer" />
            <div className="row">
              <Badge>{items.length} 题</Badge>
              <Badge>答卷 {submissions.length}</Badge>
              {toGrade > 0 && <Badge tone="warning">待评 {toGrade}</Badge>}
              {confirmed > 0 && <Badge tone="success">已确 {confirmed}</Badge>}
              <button type="button" className="sm" disabled={disabled} onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />新建考试</button>
            </div>
          </div>

          <ErrorText message={error} />

          <div className="grid-5" role="tablist" aria-label="阅卷五步流程">
            {([
              ['items', '1. 试题与细则', `${items.length} 题 · AI拆点`],
              ['answers', '2. 上传与整理答卷', pendingPrep ? `${pendingPrep} 份待核` : `${submissions.length} 份`],
              ['ai', '3. AI 智能批阅台', `功率阈值 ${threshold}%`],
              ['review', '4. 人工打分复核', toGrade ? `${toGrade} 份待评` : `${confirmed} 已确`],
              ['analysis', '5. 讲评与导出', '知识点统计'],
            ] as const).map(([key, label, meta]) => (
              <button type="button" key={key} role="tab" aria-selected={tab === key} className={`stage-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                <strong>{label}</strong><small>{meta}</small>
              </button>
            ))}
          </div>

          {tab === 'analysis' ? (
            <AnalysisPanel key={exam.id} store={store} state={state} examId={exam.id} readonly={readonly} onReview={setReview} />
          ) : tab === 'ai' ? (
            <AiBatchWorkbench
              key={exam.id}
              store={store}
              state={state}
              classId={classId}
              items={items}
              connection={connection}
              threshold={threshold}
              onThresholdChange={setThreshold}
              openSettings={openSettings}
              readonly={readonly}
            />
          ) : tab === 'items' ? (
            <div className="col">
              <div className="row between">
                <span className="tip">先建题并「定稿启用细则」，启用后即可上传答卷并打分。</span>
                <button type="button" className="primary" disabled={disabled} onClick={() => setEditing(null)}><Icon name="plus" size={15} />添加题目与细则</button>
              </div>
              {!items.length && <div className="card empty-box">还没有试题，请点击右上角「添加题目与细则」。</div>}
              {items.map((item) => {
                const rubric = g.rubrics.filter((r) => r.itemId === item.id).sort((a, b) => b.version - a.version)[0];
                const frozen = !!rubric?.frozenAt;
                return (
                  <article className="card col" style={{ padding: '14px 16px' }} key={item.id}>
                    <div className="row between">
                      <div className="row">
                        <h3>第 {item.label} 题 · {points(item.maxUnits)} 分</h3>
                        <Badge tone={frozen ? 'success' : 'warning'}>{frozen ? `细则 v${rubric.version} 已启用` : '草稿'}</Badge>
                        <span className="tip">{item.scoringUnits.length} 小题 · {rubric?.criteria.length || 0} 评分点</span>
                      </div>
                      <div className="row">
                        <button type="button" className="sm" disabled={disabled || frozen || g.submissions.some((a) => a.itemId === item.id)} onClick={() => setEditing(item)}><Icon name="edit" size={13} />编辑</button>
                        {!frozen ? (
                          <button type="button" className="sm primary" disabled={disabled || !rubric} onClick={() => {
                            if (!window.confirm('定稿启用后将锁定本版题目与评分点以保证评分统一，确认启用？')) return;
                            const tok = store.token();
                            void run(() => applyEdit(store, tok, (n) => freezeRubric(n, rubric!.id)));
                          }}>定稿启用</button>
                        ) : (
                          <button type="button" className="sm primary" disabled={disabled || !members.length} onClick={() => setAnswerItem(item)}><Icon name="upload" size={13} />传答卷</button>
                        )}
                      </div>
                    </div>
                    {item.prompt && <p className="preserve tip">{item.prompt}</p>}
                    <details className="subtle">
                      <summary>展开参考答案与评分点</summary>
                      <div className="col" style={{ marginTop: 8 }}>
                        {rubric?.referenceAnswer && <p className="preserve"><strong>参考答案：</strong>{rubric.referenceAnswer}</p>}
                        {item.referenceAssetIds.map((ref) => <BlobImage key={ref} blob={state.files.get(g.assets.find((a) => a.id === ref)!.hash)} label="参考图" />)}
                        {rubric?.criteria.map((c, idx) => <div key={c.id} className="diff-item">{idx + 1}. {c.description}（上限 {points(c.maxUnits)}，步长 {points(c.stepUnits)}{c.exclusiveGroup ? `，互斥 ${c.exclusiveGroup}` : ''}）</div>)}
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : tab === 'answers' ? (
            <div className="col">
              {items.map((item) => {
                const frozen = g.rubrics.some((r) => r.itemId === item.id && r.frozenAt);
                return (
                  <article className="card row between" style={{ padding: '12px 16px' }} key={item.id}>
                    <div>
                      <h3>第 {item.label} 题</h3>
                      <p className="tip">{frozen ? '按学生绑定上传答卷照片，支持旋转和框选裁剪。' : '请先在第 1 步定稿启用本题细则。'}</p>
                    </div>
                    <button type="button" className="primary" disabled={disabled || !frozen || !members.length} onClick={() => setAnswerItem(item)}><Icon name="upload" size={15} />上传 / 修订答卷</button>
                  </article>
                );
              })}
            </div>
          ) : <p className="tip">点击下方「打分复核」进入左右对照评阅台，支持快捷分值一键给分。</p>}

          {(tab === 'answers' || tab === 'review') && (
            <div className="card table-card">
              <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                <h3>已上传答卷（{submissions.length} 份）</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>学生 / 编号</th><th>题号</th><th>状态</th><th>确认得分</th><th>操作</th></tr></thead>
                  <tbody>
                    {submissions.map((a) => {
                      const m = s.data.memberships.find((x) => x.id === a.membershipId)!;
                      const st = s.data.students.find((x) => x.id === m.studentId)!;
                      const item = items.find((i) => i.id === a.itemId)!;
                      const dec = latestDecision(g, a.id);
                      const hasDraft = g.drafts.some((d) => d.submissionId === a.id);
                      const older = g.submissions.filter((v) => v.itemId === a.itemId && v.membershipId === a.membershipId && v.id !== a.id);
                      return (
                        <tr key={a.id}>
                          <td><strong>{st.name}</strong><span className="tip num" style={{ marginLeft: 7 }}>{m.rosterNo || '无编号'}{m.status === 'removed' ? '（移出）' : ''}</span></td>
                          <td>第 {item.label} 题</td>
                          <td>
                            <Badge tone={a.completeness !== 'complete' ? 'warning' : dec ? 'success' : hasDraft ? 'info' : 'neutral'}>
                              v{a.version} · {a.completeness !== 'complete' ? '待核对' : dec ? '已确认' : hasDraft ? '有草稿' : '待评'}
                            </Badge>
                          </td>
                          <td className="num">{dec ? <strong>{points(dec.scores.reduce((sum, x) => sum + x.units, 0))} 分</strong> : <span className="muted">未确认</span>}</td>
                          <td>
                            <div className="row">
                              <button type="button" className={`sm ${!dec && a.completeness === 'complete' ? 'primary' : ''}`} disabled={state.busy || !g.rubrics.some((r) => r.itemId === item.id && r.frozenAt)} onClick={() => setReview(a)}>
                                {readonly ? '查看' : dec ? '查看 / 改分' : '打分复核'}
                              </button>
                              {older.length > 0 && (
                                <details className="subtle">
                                  <summary>历史 ({older.length})</summary>
                                  <div className="row" style={{ marginTop: 4 }}>
                                    {older.map((v) => <button type="button" className="sm" key={v.id} disabled={!g.rubrics.some((r) => r.itemId === v.itemId && r.frozenAt)} onClick={() => setReview(v)}>v{v.version}</button>)}
                                  </div>
                                </details>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!submissions.length && <p className="empty-box">暂无已绑定的学生答卷。</p>}
              </div>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <Modal title="新建阅卷考试" onClose={() => setCreateOpen(false)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const tok = store.token();
            void run(async () => {
              let created = '';
              await applyEdit(store, tok, (n) => { created = createExam(n, classId, title); });
              setExamId(created); setTitle(''); setCreateOpen(false);
            });
          }}>
            <label className="tight">考试名称<input autoFocus required placeholder="如：力学单元主观题测验" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setCreateOpen(false)}>取消</button>
              <button type="submit" className="primary" disabled={disabled}>建立考试</button>
            </div>
          </form>
        </Modal>
      )}

      {exam && editing !== undefined && (
        <ItemEditor
          store={store}
          examId={exam.id}
          item={editing || undefined}
          rubric={g.rubrics.find((r) => r.itemId === editing?.id)}
          connection={connection}
          openSettings={openSettings}
          close={() => setEditing(undefined)}
        />
      )}
      {answerItem && <AnswerEditor store={store} item={answerItem} classId={classId} close={() => setAnswerItem(null)} />}
      {review && (
        <ReviewEditor
          store={store}
          submission={review}
          connection={connection}
          openSettings={openSettings}
          threshold={threshold}
          evidenceOnly={tab === 'analysis'}
          close={() => setReview(null)}
          readonly={readonly || participationFor(g, review.examId, review.membershipId)?.status === 'absent' || latestSubmission(g, review.itemId, review.membershipId)?.id !== review.id}
        />
      )}
    </section>
  );
}
