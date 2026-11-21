import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { askPhysicsMean, resolvePhysicsQuery } from '../../modules/assistant/physicsMean';
import type { GradeImport } from '../../modules/gradebook/model';
import { Badge } from '../Primitives';
import { Icon } from '../Icons';

export function PhysicsMeanQuery({
  className,
  batch,
  batches,
  explicitlySelected,
  selectExam,
  connection,
  openSettings,
}: {
  className: string;
  batch?: GradeImport;
  batches: GradeImport[];
  explicitlySelected: boolean;
  selectExam: (id: string) => void;
  connection: AssistantConnection;
  openSettings: () => void;
}) {
  const [asked, setAsked] = useState(false);
  const [columnKey, setColumnKey] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const task = useMemo(() => resolvePhysicsQuery(batch, batches, explicitlySelected, columnKey), [batch, batches, explicitlySelected, columnKey]);
  const service = connection.view();

  async function ask() {
    if (active.current) return;
    setAsked(true); setReply('');
    if (!batch || task.kind !== 'ready' || !service.hasKey) return;
    const ctrl = new AbortController();
    active.current = ctrl; setBusy(true);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; ctrl.abort(); }, 60000);
    try {
      const answer = await askPhysicsMean(
        connection,
        { className, exam: batch.title, date: batch.date, version: batch.version, column: task.column.label },
        () => task.summary,
        ctrl.signal,
      );
      if (active.current === ctrl) setReply(answer);
    } catch (err) {
      if (active.current === ctrl)
        setReply(timedOut ? '查询超时，请重试。' : ctrl.signal.aborted ? '已取消查询。' : err instanceof TypeError ? '连接失败，请核对网络、地址或跨域设置。' : (err as Error).message);
    } finally {
      window.clearTimeout(timer);
      if (active.current === ctrl) { active.current = null; setBusy(false); }
    }
  }

  return (
    <section className="ai-card col" aria-label="AI 只读问数助手">
      <div className="row between">
        <div className="row">
          <Icon name="sparkles" size={16} className="text-info" />
          <strong>AI 快捷问数（物理均分）</strong>
          <Badge tone={service.hasKey ? 'success' : 'neutral'}>{service.hasKey ? `已就绪 · ${service.model}` : '未填 Key'}</Badge>
        </div>
        <div className="row">
          <button type="button" className="btn-ai sm" onClick={() => void ask()} disabled={busy}>
            <Icon name="sparkles" size={14} />{busy ? '询问中…' : '问 AI：这次物理平均多少分？'}
          </button>
          {busy && <button type="button" className="sm" onClick={() => active.current?.abort()}>取消</button>}
          <button type="button" className="sm" onClick={openSettings}><Icon name="settings" size={13} />配置 Key</button>
        </div>
      </div>

      <div className="row tip">
        <Icon name="shield" size={13} />
        <span>仅发送考试标题与物理均分/人数汇总，姓名、学号与个人分数绝不离开本机。</span>
        <details className="subtle">
          <summary>发送详情</summary>
          <p className="tip" style={{ marginTop: 4 }}>
            服务：{service.endpoint}（{service.model}）。
            {batch && task.kind === 'ready' ? ` 发送内容：${className} · ${batch.title} (${batch.date} v${batch.version}) · ${task.column.label} ${task.summary.average} 分 / ${task.summary.count} 人。` : ''}
          </p>
        </details>
      </div>

      {asked && (
        <div aria-live="polite" className="col">
          {task.kind === 'exams' && (
            <label className="tight">
              有同名考试，请选择要问哪一次：
              <select defaultValue="" onChange={(e) => e.target.value && selectExam(e.target.value)}>
                <option value="">请选择考试后再点查询</option>
                {task.exams.map((b, i) => <option key={b.id} value={b.id}>{b.title} · {b.date} · v{b.version}（{b.rows.length}人 · 记录 {i + 1}）</option>)}
              </select>
            </label>
          )}
          {task.kind !== 'exams' && task.columns && task.columns.length > 1 && (
            <label className="tight">
              有多个物理成绩列，请选择：
              <select value={columnKey} disabled={busy} onChange={(e) => { setColumnKey(e.target.value); setReply(''); }}>
                <option value="">请选择物理列</option>
                {task.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
          {task.kind === 'empty' ? (
            <div className="alert tone-warning">{task.message}</div>
          ) : task.kind === 'ready' && !service.hasKey ? (
            <div className="alert tone-info row between">
              <span>请先配置本次会话的模型 Key。</span>
              <button type="button" className="sm primary" onClick={openSettings}>去配置</button>
            </div>
          ) : reply && batch ? (
            <div className="card" style={{ padding: '10px 14px', borderColor: '#c5ddf5' }}>
              <small className="muted">{batch.title} · {batch.date} · v{batch.version}</small>
              <p style={{ marginTop: 4 }}>{reply}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
