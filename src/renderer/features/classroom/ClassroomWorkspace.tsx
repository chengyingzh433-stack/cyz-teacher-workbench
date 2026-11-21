import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Dices,
  Edit2,
  Grid2x2,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Undo2,
  UserMinus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ClassRecord,
  ExamSummary,
  ScoreSeatingStrategy,
  SeatAssignment,
  SeatPlan,
  StudentMember,
  TeacherProfile,
} from '../../../shared/types';
import {
  moveSeat,
  resizeAssignments,
  sequentialAssignments,
  waitingMembers,
} from '../../../shared/seating';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  NumberStepper,
  Select,
  Switch,
} from '../../components/ui/primitives';
import { Avatar } from './SpriteArt';
import { VectorClassroom } from './VectorClassroom';

export function ClassroomWorkspace({
  cls,
  teacher,
  members,
  exams,
  onOpenProfile,
  onNotify,
}: {
  cls: ClassRecord;
  teacher: TeacherProfile;
  members: StudentMember[];
  exams: ExamSummary[];
  onOpenProfile: (membershipId: string) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [plans, setPlans] = useState<SeatPlan[]>([]);
  const [planId, setPlanId] = useState('');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [front, setFront] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitView, setFitView] = useState(true);
  const scaleRef = useRef(1);
  const [search, setSearch] = useState('');
  const [undo, setUndo] = useState<{ rows: number; cols: number; assignments: SeatAssignment[]; label: string } | null>(null);

  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(8);
  const [rolling, setRolling] = useState(false);

  // Plan modal & Smart-score-seating modal
  const [planModal, setPlanModal] = useState<'new' | 'copy' | 'rename' | null>(null);
  const [planNameInput, setPlanNameInput] = useState('');
  const [smartOpen, setSmartOpen] = useState(false);
  const [smartExamId, setSmartExamId] = useState('');
  const [smartStrategy, setSmartStrategy] = useState<ScoreSeatingStrategy>('pair-help');
  const [busy, setBusy] = useState(false);

  const readonly = cls.status === 'archived';

  async function refreshPlans(preferId?: string) {
    const list = await window.workbenchApi.seating.listPlans(cls.id);
    setPlans(list);
    if (preferId && list.some((p) => p.id === preferId)) setPlanId(preferId);
    else if (!list.some((p) => p.id === planId) && list[0]) setPlanId(list[0].id);
  }

  useEffect(() => {
    setEditing(false);
    setSelected(null);
    setUndo(null);
    setHighlighted(null);
    void refreshPlans();
  }, [cls.id]);

  const plan = plans.find((p) => p.id === planId) || plans[0];

  useEffect(() => {
    if (plan) {
      setRows(plan.rows);
      setCols(plan.cols);
    }
  }, [plan?.id, plan?.rows, plan?.cols]);

  useEffect(() => {
    if (!highlighted || rolling) return;
    const t = window.setTimeout(() => setHighlighted(null), 4500);
    return () => window.clearTimeout(t);
  }, [highlighted, rolling]);

  const pending = useMemo(() => (plan ? waitingMembers(plan, members) : []), [plan, members]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.membershipId, m])), [members]);

  const searchMatches = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    return members.filter((m) => m.name.includes(q) || m.rosterNo.includes(q)).slice(0, 7);
  }, [search, members]);

  async function commitLayout(
    nextRows: number,
    nextCols: number,
    nextAssignments: SeatAssignment[],
    label: string,
  ) {
    if (!plan) return;
    setBusy(true);
    try {
      const prev = { rows: plan.rows, cols: plan.cols, assignments: plan.assignments, label };
      const updated = await window.workbenchApi.seating.savePlanLayout(
        plan.id,
        nextRows,
        nextCols,
        nextAssignments,
      );
      setPlans((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      setUndo(prev);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  function handleSelectSeat(mid: string | null, row: number, col: number) {
    if (!plan || readonly || busy) return;
    if (selected && selected !== mid) {
      const next = moveSeat(plan, members, selected, { row, col });
      const a = memberMap.get(selected)?.name || '学生';
      const b = mid ? memberMap.get(mid)?.name : '';
      void commitLayout(plan.rows, plan.cols, next, b ? `互换 ${a} 与 ${b}` : `移动 ${a}`);
      setSelected(null);
    } else {
      setSelected(mid === selected ? null : mid);
    }
  }

  function handleDropSeat(mid: string, row: number, col: number) {
    if (!plan || readonly || busy) return;
    const next = moveSeat(plan, members, mid, { row, col });
    const name = memberMap.get(mid)?.name || '学生';
    void commitLayout(plan.rows, plan.cols, next, `拖动 ${name}`);
    setSelected(null);
  }

  function startRandomPick() {
    if (!plan || !plan.assignments.length || rolling) return;
    setRolling(true);
    const pool = plan.assignments.map((a) => a.membershipId);
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks++;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setHighlighted(pick);
      if (ticks >= 14) {
        window.clearInterval(timer);
        setRolling(false);
        const st = memberMap.get(pick);
        if (st) onNotify(`随机点名选中：「${st.name}」`);
      }
    }, 85);
  }

  const dimsChanged = Boolean(plan && (rows !== plan.rows || cols !== plan.cols));
  const capacity = rows * cols;
  const selectedName = selected ? memberMap.get(selected)?.name || '' : '';

  return (
    <div className="flex flex-col h-full gap-2.5 min-h-0">
      {/* Top Floating Studio Toolbar */}
      <Card className="px-3 py-2 flex items-center flex-wrap gap-2 shrink-0">
        <Select
          value={plan?.id || ''}
          onValueChange={(v) => {
            setPlanId(v);
            setUndo(null);
            setSelected(null);
          }}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="座位方案"
          className="w-40"
        />

        {!readonly && (
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              title="新建座位方案"
              onClick={() => {
                setPlanNameInput(`新座位方案 ${plans.length + 1}`);
                setPlanModal('new');
              }}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              title="复制当前方案"
              disabled={!plan}
              onClick={() => {
                setPlanNameInput(`${plan?.name || ''} 副本`);
                setPlanModal('copy');
              }}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              title="重命名方案"
              disabled={!plan}
              onClick={() => {
                setPlanNameInput(plan?.name || '');
                setPlanModal('rename');
              }}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Quick Find Student */}
        {!editing && members.length > 0 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchMatches[0]) {
                  setHighlighted(searchMatches[0].membershipId);
                  setSearch('');
                }
                if (e.key === 'Escape') setSearch('');
              }}
              placeholder="找人定位座位…"
              className="h-8 pl-8 pr-3 w-44 rounded-lg bg-[var(--bg-muted)] border border-transparent focus:bg-[var(--bg-surface)] focus:border-[var(--accent)] text-[12.5px] focus:outline-none transition-all"
            />
            {searchMatches.length > 0 && (
              <div className="absolute left-0 top-full mt-1.5 z-30 w-56 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-[var(--shadow-lg)] p-1">
                {searchMatches.map((m) => {
                  const pos = plan?.assignments.find((a) => a.membershipId === m.membershipId);
                  return (
                    <button
                      key={m.membershipId}
                      type="button"
                      onClick={() => {
                        setSearch('');
                        if (!pos) onNotify(`「${m.name}」暂未入座`);
                        else setHighlighted(m.membershipId);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--accent-soft)] text-left text-[12.5px] cursor-pointer"
                    >
                      <Avatar gender={m.gender} characterId={m.characterId} size={22} />
                      <span className="font-medium flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-[var(--ink-muted)] tabular-nums">
                        {pos ? `${pos.row + 1}行${pos.col + 1}列` : '未排'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        <Badge tone={pending.length > 0 ? 'warn' : 'ok'}>
          {plan?.assignments.length || 0} 人就座{pending.length > 0 ? ` · ${pending.length} 待排` : ''}
        </Badge>

        {!editing && (
          <Button
            size="sm"
            variant="soft"
            disabled={!plan?.assignments.length || rolling}
            onClick={startRandomPick}
          >
            <Dices className="w-4 h-4" /> {rolling ? '抽签中…' : '随机点名'}
          </Button>
        )}

        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--ink-secondary)] cursor-pointer select-none px-1">
          <Switch checked={front} onCheckedChange={setFront} />
          正面朝前
        </label>

        <div className="inline-flex items-center rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden">
          <button
            type="button"
            className="h-7 px-2 hover:bg-[var(--bg-hover)] cursor-pointer"
            title="缩小"
            onClick={() => {
              setFitView(false);
              setZoom(Math.max(0.4, scaleRef.current - 0.15));
            }}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="h-7 px-2 text-xs border-x border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] cursor-pointer"
            onClick={() => {
              setZoom(1);
              setFitView(true);
            }}
          >
            <Maximize2 className="w-3 h-3 inline mr-1" />
            适配
          </button>
          <button
            type="button"
            className="h-7 px-2 hover:bg-[var(--bg-hover)] cursor-pointer"
            title="放大"
            onClick={() => {
              setFitView(false);
              setZoom(Math.min(2.2, scaleRef.current + 0.15));
            }}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <Button
          size="sm"
          variant={editing ? 'primary' : 'default'}
          disabled={readonly || !plan}
          onClick={() => {
            setEditing((v) => !v);
            setSelected(null);
            setFitView(true);
            setZoom(1);
          }}
        >
          <Grid2x2 className="w-4 h-4" /> {editing ? '完成排座' : '进入排座'}
        </Button>
      </Card>

      {/* Main Classroom Stage + Optional Waiting Students Drawer */}
      <div className="flex-1 min-h-0 flex gap-2.5">
        {plan ? (
          <VectorClassroom
            cls={cls}
            teacher={teacher}
            plan={plan}
            members={members}
            editing={editing}
            selected={selected}
            highlightedId={highlighted}
            front={front}
            zoom={zoom}
            fitView={fitView}
            onScale={(s) => {
              scaleRef.current = s;
            }}
            onSelectSeat={handleSelectSeat}
            onDropSeat={handleDropSeat}
            onOpenProfile={onOpenProfile}
          />
        ) : (
          <Card className="flex-1 flex items-center justify-center text-[var(--ink-muted)]">
            请先新建座位方案
          </Card>
        )}

        {editing && pending.length > 0 && (
          <Card className="w-52 shrink-0 flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[13px] font-semibold">待排学生</span>
              <Badge tone="warn">{pending.length} 人</Badge>
            </div>
            <p className="px-3 py-1.5 text-[11.5px] text-[var(--ink-muted)] bg-[var(--bg-muted)]/60">
              点选学生，再点击左侧空座入座
            </p>
            <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
              {pending.map((m) => (
                <button
                  key={m.membershipId}
                  type="button"
                  onClick={() => setSelected(selected === m.membershipId ? null : m.membershipId)}
                  className={`w-full flex items-center gap-2 p-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    selected === m.membershipId
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]'
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Avatar gender={m.gender} characterId={m.characterId} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{m.name}</div>
                    <div className="text-[11px] text-[var(--ink-muted)] tabular-nums truncate">
                      {m.rosterNo || '无编号'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Bottom Studio Dock when Editing Seating */}
      {editing && plan ? (
        <Card className="px-3 py-2 flex items-center flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <NumberStepper label="行" value={rows} min={1} max={12} disabled={busy} onChange={setRows} />
            <span className="text-[var(--ink-muted)] text-xs">×</span>
            <NumberStepper label="列" value={cols} min={1} max={16} disabled={busy} onChange={setCols} />
            <Button
              size="sm"
              variant={dimsChanged ? 'primary' : 'default'}
              disabled={!dimsChanged || busy}
              onClick={() =>
                void commitLayout(
                  rows,
                  cols,
                  resizeAssignments(plan, members, rows, cols),
                  `调整为 ${rows}×${cols}`,
                )
              }
            >
              应用尺寸
            </Button>
            <Badge tone={capacity < members.length ? 'warn' : 'neutral'}>
              {capacity} 座{capacity < members.length ? `（缺 ${members.length - capacity}）` : ''}
            </Badge>
          </div>

          <div className="h-5 w-px bg-[var(--border-subtle)] mx-1" />

          <Button
            size="sm"
            disabled={!members.length || busy}
            onClick={() =>
              void commitLayout(
                plan.rows,
                plan.cols,
                sequentialAssignments(plan.rows, plan.cols, members),
                '按名单顺序排座',
              )
            }
          >
            顺序排座
          </Button>

          <Button
            size="sm"
            variant="soft"
            disabled={!exams.length || !members.length || busy}
            title={exams.length ? '根据历史考试成绩智能排座' : '请先在考试中心导入成绩'}
            onClick={() => {
              setSmartExamId(exams[0]?.id || '');
              setSmartOpen(true);
            }}
          >
            <Sparkles className="w-3.5 h-3.5" /> 参考成绩排座
          </Button>

          {selected && (
            <Button
              size="sm"
              variant="danger-ghost"
              disabled={busy}
              onClick={() => {
                const next = moveSeat(plan, members, selected, null);
                void commitLayout(plan.rows, plan.cols, next, `移出 ${selectedName}`);
                setSelected(null);
              }}
            >
              <UserMinus className="w-3.5 h-3.5" /> 移出「{selectedName}」
            </Button>
          )}

          <div className="flex-1 text-xs text-[var(--ink-muted)] truncate px-1">
            {selected
              ? `已选「${selectedName}」— 点击任意座位即可互换或入座`
              : '直接拖拽人物，或依次点击两个座位互换'}
          </div>

          <Button
            size="sm"
            variant="ghost"
            disabled={!undo || busy}
            onClick={() => {
              if (!undo) return;
              const u = undo;
              setUndo(null);
              void window.workbenchApi.seating
                .savePlanLayout(plan.id, u.rows, u.cols, u.assignments)
                .then((updated) => {
                  setPlans((list) => list.map((p) => (p.id === updated.id ? updated : p)));
                  onNotify(`已撤销：${u.label}`);
                });
            }}
          >
            <Undo2 className="w-3.5 h-3.5" /> {undo ? `撤销（${undo.label.slice(0, 8)}）` : '撤销'}
          </Button>
        </Card>
      ) : (
        <div className="text-[12px] text-[var(--ink-muted)] flex items-center justify-between px-1 shrink-0">
          <span>提示：点击教室里任意同学打开成长档案与成绩趋势 · 悬停人物会回头打招呼</span>
          <span className="tabular-nums">⌘K 全局快速找人 / 切考试</span>
        </div>
      )}

      {/* Plan Create / Copy / Rename Modal */}
      <Modal
        open={Boolean(planModal)}
        onOpenChange={(o) => !o && setPlanModal(null)}
        title={
          planModal === 'new' ? '新建座位方案' : planModal === 'copy' ? '复制当前方案' : '重命名座位方案'
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setPlanModal(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!planNameInput.trim() || busy}
              onClick={async () => {
                if (!planModal) return;
                setBusy(true);
                try {
                  if (planModal === 'rename' && plan) {
                    const updated = await window.workbenchApi.seating.renamePlan(
                      plan.id,
                      planNameInput.trim(),
                    );
                    await refreshPlans(updated.id);
                  } else {
                    const created = await window.workbenchApi.seating.createPlan(
                      cls.id,
                      planNameInput.trim(),
                      planModal === 'copy' ? plan?.id : undefined,
                    );
                    await refreshPlans(created.id);
                  }
                  setPlanModal(null);
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          方案名称
          <Input
            autoFocus
            value={planNameInput}
            onChange={(e) => setPlanNameInput(e.target.value)}
            placeholder="例如：期中后互助座位"
          />
        </label>
      </Modal>

      {/* Smart Score-Based Seating Modal */}
      <Modal
        open={smartOpen}
        onOpenChange={setSmartOpen}
        title="参考考试成绩智能排座"
        subtitle="基于本班某场考试成绩一键生成座位，生成后可随时微调或撤销"
        size="sm"
        footer={
          <>
            <Button onClick={() => setSmartOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!smartExamId || !plan || busy}
              onClick={async () => {
                if (!plan || !smartExamId) return;
                setBusy(true);
                try {
                  const prev = {
                    rows: plan.rows,
                    cols: plan.cols,
                    assignments: plan.assignments,
                    label: '智能成绩排座',
                  };
                  const updated = await window.workbenchApi.seating.arrangeByExam({
                    planId: plan.id,
                    examId: smartExamId,
                    strategy: smartStrategy,
                  });
                  setPlans((list) => list.map((p) => (p.id === updated.id ? updated : p)));
                  setUndo(prev);
                  setSmartOpen(false);
                  onNotify('已按成绩策略排好座位（不满意可点击底栏「撤销」）');
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                } finally {
                  setBusy(false);
                }
              }}
            >
              立即排座
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">参考哪一场考试</span>
            <Select
              value={smartExamId}
              onValueChange={setSmartExamId}
              className="w-full"
              options={exams.map((e) => ({
                value: e.id,
                label: e.title,
                hint: `${e.examDate} · ${e.scoredStudents} 人有成绩`,
              }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">排座策略</span>
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  ['pair-help', '强弱互助同桌（推荐）', '前半段与后半段结对坐同桌，利于日常一帮一'],
                  ['group-balanced', '大组均衡分布', '各列双人小组综合实力均衡，适合小组讨论与竞赛'],
                  ['snake', 'S 形蛇形排座', '按名次奇数行从左到右、偶数行从右到左分布'],
                  ['high-front', '成绩顺序梯度', '按成绩从高到低依次排布'],
                ] as const
              ).map(([key, title, desc]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSmartStrategy(key)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    smartStrategy === key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="text-[13px] font-semibold">{title}</div>
                  <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
