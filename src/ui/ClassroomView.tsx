import { useEffect, useMemo, useRef, useState } from 'react';
import type { Membership, SeatPlan, Snapshot, Student } from '../app/model';
import { Avatar } from '../scene/Art';
import { Classroom } from '../scene/Classroom';
import { Icon } from './Icons';
import { Badge, NumberStepper } from './Primitives';
import { ToolbarMenu } from './ToolbarMenu';

export function ClassroomView({
  snapshot: s,
  plans,
  plan,
  members,
  pending,
  studentMap,
  archived,
  busy,
  editing,
  selected,
  undoLabel,
  onSelectPlan,
  onPlanModal,
  onToggleEditing,
  onSelectSeat,
  onSelectMember,
  onDropSeat,
  onProfile,
  onResize,
  onSequential,
  onUndo,
  onSwap,
  onUnseat,
  onNotify,
}: {
  snapshot: Snapshot;
  plans: SeatPlan[];
  plan?: SeatPlan;
  members: Membership[];
  pending: Membership[];
  studentMap: Map<string, Student>;
  archived: boolean;
  busy: boolean;
  editing: boolean;
  selected: string | null;
  undoLabel: string | null;
  onSelectPlan: (id: string) => void;
  onPlanModal: (mode: 'plan-new' | 'plan-copy' | 'plan-rename', defaultName: string) => void;
  onToggleEditing: (next: boolean) => void;
  onSelectSeat: (memberId: string | null, row: number, col: number) => void;
  onSelectMember: (memberId: string | null) => void;
  onDropSeat: (memberId: string, row: number, col: number) => void;
  onProfile: (memberId: string) => void;
  onResize: (rows: number, cols: number) => void;
  onSequential: () => void;
  onUndo: () => void;
  onSwap: (a: string, b: string) => void;
  onUnseat: (id: string) => void;
  onNotify: (msg: string) => void;
}) {
  const [front, setFront] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitView, setFitView] = useState(false);
  const actualZoom = useRef(1);
  const [seatSearch, setSeatSearch] = useState('');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState('');
  const [rows, setRows] = useState(plan?.rows || 6);
  const [cols, setCols] = useState(plan?.cols || 8);

  useEffect(() => {
    setRows(plan?.rows || 6);
    setCols(plan?.cols || 8);
  }, [plan?.id, plan?.rows, plan?.cols]);

  useEffect(() => {
    setZoom(1);
    setFitView(false);
    setSeatSearch('');
    setHighlighted(null);
    setSwapTarget('');
  }, [plan?.id]);

  useEffect(() => {
    if (!highlighted) return;
    const t = window.setTimeout(() => setHighlighted(null), 4200);
    return () => window.clearTimeout(t);
  }, [highlighted]);

  const matches = useMemo(() => {
    const q = seatSearch.trim();
    if (!q) return [];
    return members.filter((m) => {
      const st = studentMap.get(m.studentId);
      return st?.name.includes(q) || m.rosterNo.includes(q);
    }).slice(0, 8);
  }, [seatSearch, members, studentMap]);

  function locate(m: Membership) {
    const st = studentMap.get(m.studentId);
    const pos = plan?.assignments.find((a) => a.membershipId === m.id);
    setSeatSearch('');
    if (!pos) return onNotify(`「${st?.name || ''}」暂未安排座位，进入排座后即可放入。`);
    setHighlighted(m.id);
    onNotify(`已定位到「${st?.name || ''}」：第 ${pos.row + 1} 行 第 ${pos.col + 1} 列`);
  }

  const capacity = rows * cols;
  const dimsChanged = !!plan && (rows !== plan.rows || cols !== plan.cols);
  const selectedName = selected ? studentMap.get(members.find((m) => m.id === selected)?.studentId || '')?.name || '' : '';

  return (
    <section className="classroom-section">
      <div className={`bar classroom-bar ${editing ? 'is-editing' : ''}`}>
        <div className="row">
          <label className="inline-field">
            <span>座位方案</span>
            <select value={plan?.id || ''} onChange={(e) => onSelectPlan(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <ToolbarMenu className="plan-menu" label="方案管理">
            <div className="menu-pop">
              <button type="button" disabled={archived || busy} onClick={() => onPlanModal('plan-new', '新座位方案')}>新建空白方案</button>
              <button type="button" disabled={archived || busy || !plan} onClick={() => onPlanModal('plan-copy', `${plan?.name} 副本`)}>复制当前方案</button>
              <button type="button" disabled={archived || busy || !plan} onClick={() => onPlanModal('plan-rename', plan?.name || '')}>重命名此方案</button>
            </div>
          </ToolbarMenu>
        </div>

        {!editing && members.length > 0 && (
          <div className="quick-find">
            <Icon name="search" size={14} />
            <input
              aria-label="在教室中快速查找学生"
              value={seatSearch}
              placeholder="找人：输姓名/编号定位座位"
              onChange={(e) => setSeatSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) { e.preventDefault(); locate(matches[0]); }
                if (e.key === 'Escape') setSeatSearch('');
              }}
            />
            {matches.length > 0 && (
              <div className="find-pop" role="listbox" aria-label="匹配学生">
                {matches.map((m) => {
                  const st = studentMap.get(m.studentId)!;
                  const pos = plan?.assignments.find((a) => a.membershipId === m.id);
                  return (
                    <button type="button" key={m.id} onClick={() => locate(m)}>
                      <Avatar gender={st.gender} characterId={st.characterId} size={24} />
                      <strong>{st.name}</strong>
                      <small className="muted">{pos ? `${pos.row + 1}行${pos.col + 1}列` : '未排座'}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <span className="spacer" />
        <Badge tone={pending.length > 0 ? 'warning' : 'success'}>
          {plan?.assignments.length || 0} 人就座{pending.length > 0 ? ` · ${pending.length} 人未排` : ' · 全班已就座'}
        </Badge>

        <div className="row">
          <label className="check" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={front} onChange={(e) => setFront(e.target.checked)} />正面朝前
          </label>
          <div className="btn-group" role="group" aria-label="画布缩放">
            <button type="button" aria-label="缩小画布" onClick={() => { setFitView(false); setZoom(Math.max(0.25, actualZoom.current - 0.25)); }}>
              <Icon name="zoomOut" size={14} />
            </button>
            <button type="button" onClick={() => { setZoom(1); setFitView(true); }}>
              <Icon name="maximize" size={13} />适配
            </button>
            <button type="button" aria-label="放大画布" onClick={() => { setFitView(false); setZoom(Math.min(3, actualZoom.current + 0.25)); }}>
              <Icon name="zoomIn" size={14} />
            </button>
          </div>
        </div>

        <button
          type="button"
          className={editing ? 'primary' : 'accent-outline'}
          disabled={archived || busy || !plan}
          onClick={() => { onToggleEditing(!editing); setFitView(!editing); setZoom(1); }}
        >
          <Icon name="grid" size={15} />{editing ? '完成排座' : '进入排座'}
        </button>
      </div>

      <div className="scene-layout">
        {plan ? (
          <Classroom
            snapshot={s}
            plan={plan}
            editing={editing}
            selected={selected}
            highlightedId={highlighted}
            onSelect={onSelectSeat}
            onProfile={onProfile}
            onDrop={onDropSeat}
            front={front}
            zoom={zoom}
            fitView={fitView}
            onScale={(scale) => { actualZoom.current = scale; }}
          />
        ) : (
          <div className="empty-box">请先新建一套座位方案</div>
        )}

        {editing && pending.length > 0 && (
          <aside className="waiting-list" aria-label="未安排座位学生">
            <div className="row between" style={{ padding: '10px 12px 6px' }}>
              <h3>待排学生</h3>
              <Badge tone="warning">{pending.length} 人</Badge>
            </div>
            <p className="waiting-tip">点选下方学生，再点左侧空座入座</p>
            <div className="waiting-items">
              {pending.map((m) => {
                const st = studentMap.get(m.studentId)!;
                return (
                  <button type="button" key={m.id} aria-pressed={selected === m.id} onClick={() => onSelectMember(selected === m.id ? null : m.id)}>
                    <Avatar gender={st.gender} characterId={st.characterId} size={32} />
                    <span><strong>{st.name}</strong><small>{m.rosterNo || '无编号'}</small></span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {editing && plan ? (
        <div className="bar seating-dock">
          <form className="row" onSubmit={(e) => { e.preventDefault(); onResize(rows, cols); }}>
            <NumberStepper label="行" ariaLabel="座位行数" value={rows} min={1} max={12} disabled={busy} onChange={setRows} />
            <span className="muted">×</span>
            <NumberStepper label="列" ariaLabel="座位列数" value={cols} min={1} max={16} disabled={busy} onChange={setCols} />
            <button type="submit" className={`sm ${dimsChanged ? 'primary' : ''}`} disabled={busy || !dimsChanged}>应用尺寸</button>
            <Badge tone={capacity < members.length ? 'warning' : 'neutral'}>
              {capacity} 座{capacity < members.length ? `（缺 ${members.length - capacity}）` : ''}
            </Badge>
          </form>

          <button type="button" className="sm" disabled={busy || !members.length} onClick={onSequential}>按名单顺序排座</button>
          <button type="button" className="sm" disabled={!undoLabel || busy} title={undoLabel ? `撤销：${undoLabel}` : '暂无可撤销操作'} onClick={onUndo}>
            <Icon name="undo" size={14} />{undoLabel ? `撤销（${undoLabel.slice(0, 8)}）` : '撤销'}
          </button>

          <span className={`hint-pill ${selected ? 'active' : ''}`} role="status">
            {selected ? (
              <>
                已选「{selectedName}」— 点任意座位互换/入座
                <button type="button" className="sm" onClick={() => onSelectMember(null)}>取消</button>
              </>
            ) : (
              '拖动人物，或依次点击两个座位换座'
            )}
          </span>

          <ToolbarMenu className="swap-menu" label="名单换座" icon={<Icon name="swap" size={14} />}>
            <div className="menu-pop swap-pop">
              <label className="tight">
                学生 A
                <select aria-label="选择换座学生" value={selected || ''} onChange={(e) => onSelectMember(e.target.value || null)}>
                  <option value="">请选择</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.rosterNo ? `${m.rosterNo} · ` : ''}{studentMap.get(m.studentId)!.name}</option>)}
                </select>
              </label>
              <label className="tight">
                交换对象 B
                <select aria-label="选择交换对象" value={swapTarget} onChange={(e) => setSwapTarget(e.target.value)}>
                  <option value="">请选择</option>
                  {members.filter((m) => m.id !== selected).map((m) => (
                    <option key={m.id} value={m.id}>{m.rosterNo ? `${m.rosterNo} · ` : ''}{studentMap.get(m.studentId)!.name}</option>
                  ))}
                </select>
              </label>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="sm primary" disabled={!selected || !swapTarget || busy} onClick={() => { onSwap(selected!, swapTarget); setSwapTarget(''); }}>立即互换</button>
                <button type="button" className="sm" disabled={!selected || busy} onClick={() => onUnseat(selected!)}>移出座位</button>
              </div>
            </div>
          </ToolbarMenu>
        </div>
      ) : (
        <div className="tip" style={{ paddingTop: 5 }}>小提示：点击人物查看档案或换形象 · 鼠标移到人物上会回头</div>
      )}
    </section>
  );
}
