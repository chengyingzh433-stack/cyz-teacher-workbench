import { useState } from 'react';
import type { WorkbenchStore } from '../../app/store';
import { id } from '../../app/model';
import { saveKnowledgePlan } from '../../modules/assessment';
import { parsePoints } from '../../modules/grading/score-policy';
import { Modal, ErrorText } from '../Modal';
import { Badge } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, useDraftWarning } from './shared';

export function KnowledgeEditor({ store, examId, close }: { store: WorkbenchStore; examId: string; close: () => void }) {
  const [base] = useState(() => store.getState().snapshot!);
  const [token] = useState(store.token());
  const g = base.data.grading;
  const prior = g.knowledgePlans.filter((p) => p.examId === examId).sort((a, b) => b.version - a.version)[0];

  const [rows, setRows] = useState(() =>
    g.items.filter((i) => i.examId === examId).flatMap((item) =>
      item.scoringUnits.map((unit) => {
        const m = prior?.mappings.find((x) => x.itemId === item.id && x.scoringUnitId === unit.id);
        return {
          itemId: item.id,
          scoringUnitId: unit.id,
          label: `第 ${item.label} 题 · ${unit.label}`,
          allocations: (m?.allocations || []).map((a) => ({ key: id(), name: g.knowledgePoints.find((k) => k.id === a.knowledgeId)!.name, percent: String(a.weightBps / 100) })),
        };
      }),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDraftWarning(dirty);
  const leave = () => { if (!busy && (!dirty || window.confirm('知识点映射尚未保存，确定放弃？'))) close(); };

  const patchRow = (index: number, fn: (a: typeof rows[number]['allocations']) => typeof rows[number]['allocations']) => {
    setDirty(true);
    setRows(rows.map((r, i) => (i === index ? { ...r, allocations: fn(r.allocations) } : r)));
  };

  function splitEqually(index: number) {
    patchRow(index, (list) => {
      const n = list.length;
      const basePct = Math.floor(10000 / n) / 100;
      const last = Number((100 - basePct * (n - 1)).toFixed(2));
      return list.map((a, j) => ({ ...a, percent: String(j === n - 1 ? last : basePct) }));
    });
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const inputs = rows.map((r) => ({ itemId: r.itemId, scoringUnitId: r.scoringUnitId, allocations: r.allocations.map((a) => ({ name: a.name, weightBps: parsePoints(a.percent) })) }));
      await applyEdit(store, token, (next) => saveKnowledgePlan(next, examId, inputs));
      setDirty(false); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title="配置题目知识点与权重"
      subtitle="每个小题关联知识点后，权重须合计 100%（不关联则留空）"
      wide
      onClose={leave}
      footer={
        <div className="row between" style={{ width: '100%' }}>
          <span className="tip">将保存为统计方案 v{(prior?.version || 0) + 1}（旧方案保留，不改分）</span>
          <div className="row">
            <button type="button" onClick={leave}>取消</button>
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存知识点方案'}</button>
          </div>
        </div>
      }
    >
      <fieldset className="fields col" disabled={busy}>
        <datalist id="kp-names">{g.knowledgePoints.map((k) => <option key={k.id} value={k.name} />)}</datalist>
        {rows.map((row, index) => {
          const sum = Math.round(row.allocations.reduce((acc, a) => acc + (Number.isFinite(Number(a.percent)) ? Number(a.percent) : 0), 0) * 100) / 100;
          const exact = row.allocations.length > 0 && Math.abs(sum - 100) < 0.001;
          return (
            <section className="soft-card col" key={`${row.itemId}:${row.scoringUnitId}`}>
              <div className="row between">
                <strong>{row.label}</strong>
                <div className="row">
                  <Badge tone={!row.allocations.length ? 'neutral' : exact ? 'success' : 'warning'}>
                    {!row.allocations.length ? '未关联' : exact ? '已分配 100% ✓' : `当前 ${sum}%（${sum < 100 ? `差 ${(100 - sum).toFixed(2).replace(/\.00$/, '')}%` : `超 ${(sum - 100).toFixed(2).replace(/\.00$/, '')}%`}）`}
                  </Badge>
                  {row.allocations.length > 1 && !exact && <button type="button" className="sm" onClick={() => splitEqually(index)}>一键均分</button>}
                </div>
              </div>
              {row.allocations.length > 0 && (
                <div className="progress-track">
                  <div className={`progress-fill ${exact ? 'ok' : sum > 100 ? 'danger' : 'warn'}`} style={{ width: `${Math.min(100, Math.max(0, sum))}%` }} />
                </div>
              )}
              {row.allocations.map((a) => (
                <div className="row" key={a.key}>
                  <input style={{ flex: 2 }} placeholder="知识点名称（如：受力分析）" value={a.name} list="kp-names" maxLength={120} onChange={(e) => patchRow(index, (l) => l.map((x) => (x.key === a.key ? { ...x, name: e.target.value } : x)))} />
                  <label className="compact-input">权重%<input inputMode="decimal" value={a.percent} onChange={(e) => patchRow(index, (l) => l.map((x) => (x.key === a.key ? { ...x, percent: e.target.value } : x)))} /></label>
                  <button type="button" className="sm ghost-danger" onClick={() => patchRow(index, (l) => l.filter((x) => x.key !== a.key))}><Icon name="trash" size={14} /></button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="sm"
                  disabled={row.allocations.length >= 100}
                  onClick={() => {
                    const rem = Math.max(0, Math.round((100 - sum) * 100) / 100);
                    patchRow(index, (l) => [...l, { key: id(), name: '', percent: l.length ? (rem > 0 ? String(rem) : '') : '100' }]);
                  }}
                >
                  <Icon name="plus" size={13} />添加知识点
                </button>
              </div>
            </section>
          );
        })}
        <ErrorText message={error} />
      </fieldset>
    </Modal>
  );
}
