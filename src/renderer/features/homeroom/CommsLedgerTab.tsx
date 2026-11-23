import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  MessageSquareHeart,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ClassRecord,
  HomeroomCommStatus,
  HomeroomCommType,
  StudentCommRecord,
  StudentMember,
} from '../../../shared/types';
import {
  HOMEROOM_COMM_STATUSES,
  HOMEROOM_COMM_TYPES,
  localTodayStr,
} from '../../../shared/homeroom-materials';
import { Badge, Button, Card, Input, Select, Textarea } from '../../components/ui/primitives';

export function CommsLedgerTab({
  cls,
  members,
  comms,
  readonly,
  initialStatusFilter,
  onReload,
  onOpenStudentProfile,
  onNotify,
}: {
  cls: ClassRecord;
  members: StudentMember[];
  comms: StudentCommRecord[];
  readonly: boolean;
  initialStatusFilter?: 'all' | HomeroomCommStatus;
  onReload: () => Promise<void>;
  onOpenStudentProfile: (membershipId: string) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedMid, setSelectedMid] = useState<string>(members[0]?.membershipId || '__custom__');
  const [customName, setCustomName] = useState('');
  const [commType, setCommType] = useState<HomeroomCommType>('即时电话');
  const [commDate, setCommDate] = useState(() => localTodayStr());
  const [reason, setReason] = useState('');
  const [studentPerf, setStudentPerf] = useState('');
  const [parentFeedback, setParentFeedback] = useState('');
  const [actionPlan, setActionPlan] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [status, setStatus] = useState<HomeroomCommStatus>('待跟进');
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | HomeroomCommStatus>(
    initialStatusFilter || 'all',
  );

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.membershipId, m])),
    [members],
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    return comms.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (
        q &&
        !c.studentName.includes(q) &&
        !c.reason.includes(q) &&
        !c.actionPlan.includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [comms, search, statusFilter]);

  function resetForm() {
    setEditingId(null);
    setSelectedMid(members[0]?.membershipId || '__custom__');
    setCustomName('');
    setCommType('即时电话');
    setCommDate(localTodayStr());
    setReason('');
    setStudentPerf('');
    setParentFeedback('');
    setActionPlan('');
    setFollowUpDate('');
    setStatus('待跟进');
  }

  function startEdit(c: StudentCommRecord) {
    setEditingId(c.id);
    if (c.membershipId && memberMap.has(c.membershipId)) {
      setSelectedMid(c.membershipId);
      setCustomName('');
    } else {
      setSelectedMid('__custom__');
      setCustomName(c.studentName);
    }
    setCommType(c.commType);
    setCommDate(c.commDate);
    setReason(c.reason);
    setStudentPerf(c.studentPerf);
    setParentFeedback(c.parentFeedback);
    setActionPlan(c.actionPlan);
    setFollowUpDate(c.followUpDate || '');
    setStatus(c.status);
  }

  async function handleSubmit() {
    if (readonly) return;
    const isCustom = selectedMid === '__custom__';
    const studentName = isCustom
      ? customName.trim()
      : memberMap.get(selectedMid)?.name || '';
    if (!studentName) {
      onNotify('请选择学生或填写沟通对象名称', 'err');
      return;
    }
    setSaving(true);
    try {
      await window.workbenchApi.homeroom.saveComm({
        classId: cls.id,
        id: editingId || undefined,
        membershipId: isCustom ? null : selectedMid,
        studentName,
        commType,
        commDate,
        reason,
        studentPerf,
        parentFeedback,
        actionPlan,
        followUpDate,
        status,
      });
      resetForm();
      await onReload();
      onNotify(editingId ? '家校沟通记录已更新' : '家校沟通记录已保存');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start pb-6">
      {/* Left: Structured 4-Part Form (5 cols) */}
      <Card className="xl:col-span-5 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[14.5px] font-semibold flex items-center gap-1.5">
              <MessageSquareHeart className="w-4 h-4 text-[var(--accent)]" />
              {editingId ? '编辑家校沟通记录' : '新增家校沟通记录'}
            </h3>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              自动关联花名册学生，点击教室人物即可同屏对照成绩曲线
            </p>
          </div>
          {editingId && (
            <Button size="xs" variant="ghost" onClick={resetForm}>
              取消编辑
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-muted)]">沟通对象（本班花名册）</span>
            <Select
              value={selectedMid}
              disabled={readonly}
              onValueChange={setSelectedMid}
              className="w-full"
              options={[
                ...members.map((m) => ({
                  value: m.membershipId,
                  label: m.name,
                  hint: m.rosterNo || undefined,
                })),
                { value: '__custom__', label: '其他 / 全体家长会（自定义）' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-muted)]">沟通类型</span>
            <Select
              value={commType}
              disabled={readonly}
              onValueChange={(v) => setCommType(v as HomeroomCommType)}
              className="w-full"
              options={HOMEROOM_COMM_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </div>
        </div>

        {selectedMid === '__custom__' && (
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            自定义对象名称 *
            <Input
              value={customName}
              disabled={readonly}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="如：全班家长 / 3-5人互助小组家长"
              className="h-8 text-xs"
            />
          </label>
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            沟通日期
            <input
              type="date"
              disabled={readonly}
              value={commDate}
              onChange={(e) => setCommDate(e.target.value)}
              className="h-8 px-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs text-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            后续跟进日期
            <input
              type="date"
              disabled={readonly}
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="h-8 px-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs text-[var(--ink-primary)]"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-muted)]">当前状态</span>
            <Select
              value={status}
              disabled={readonly}
              onValueChange={(v) => setStatus(v as HomeroomCommStatus)}
              className="w-full min-w-0"
              options={HOMEROOM_COMM_STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
          沟通事由
          <Input
            value={reason}
            disabled={readonly}
            onChange={(e) => setReason(e.target.value)}
            placeholder="成绩表现、作业缺交、请假、情绪波动等"
            className="h-8 text-[13px]"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            学生表现
            <Textarea
              rows={2}
              disabled={readonly}
              value={studentPerf}
              onChange={(e) => setStudentPerf(e.target.value)}
              placeholder="近期课堂、作业与纪律表现…"
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            家长反馈
            <Textarea
              rows={2}
              disabled={readonly}
              value={parentFeedback}
              onChange={(e) => setParentFeedback(e.target.value)}
              placeholder="家长在家观察与意见反馈…"
              className="text-xs"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
          共商整改方案
          <Textarea
            rows={2}
            disabled={readonly}
            value={actionPlan}
            onChange={(e) => setActionPlan(e.target.value)}
            placeholder="家校双方约定的下一步改进计划与复盘节点…"
            className="text-xs"
          />
        </label>

        <Button
          size="md"
          variant="primary"
          disabled={readonly || saving}
          onClick={() => void handleSubmit()}
        >
          <Plus className="w-4 h-4" /> {editingId ? '保存修改' : '保存沟通记录'}
        </Button>
      </Card>

      {/* Right: Communications Ledger List (7 cols) */}
      <Card className="xl:col-span-7 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            {(
              [
                ['all', `全部 (${comms.length})`],
                ['待跟进', `待跟进 (${comms.filter((c) => c.status === '待跟进').length})`],
                ['已办结', `已办结 (${comms.filter((c) => c.status === '已办结').length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                  statusFilter === k
                    ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="按学生姓名、事由检索…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {c.membershipId && memberMap.has(c.membershipId) ? (
                      <button
                        type="button"
                        onClick={() => onOpenStudentProfile(c.membershipId!)}
                        className="text-[14.5px] font-bold text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        title="点击打开该生立体成长档案与成绩曲线"
                      >
                        {c.studentName}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-[14.5px] font-bold text-[var(--ink-primary)]">
                        {c.studentName}
                      </span>
                    )}
                    <Badge tone={c.status === '待跟进' ? 'warn' : 'ok'}>{c.status}</Badge>
                    <Badge tone="info">{c.commType}</Badge>
                  </div>
                  <div className="text-xs text-[var(--ink-muted)] tabular-nums flex items-center gap-2">
                    <span>沟通 {c.commDate}</span>
                    {c.followUpDate && (
                      <span className="inline-flex items-center gap-0.5 text-[var(--warn)] font-medium">
                        <Clock className="w-3.5 h-3.5" /> 跟进 {c.followUpDate}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-[13px] leading-relaxed flex flex-col gap-1">
                  {c.reason && (
                    <div>
                      <span className="font-semibold text-[var(--ink-secondary)]">沟通事由：</span>
                      {c.reason}
                    </div>
                  )}
                  {c.studentPerf && (
                    <div>
                      <span className="font-semibold text-[var(--ink-secondary)]">学生表现：</span>
                      {c.studentPerf}
                    </div>
                  )}
                  {c.parentFeedback && (
                    <div>
                      <span className="font-semibold text-[var(--ink-secondary)]">家长反馈：</span>
                      {c.parentFeedback}
                    </div>
                  )}
                  {c.actionPlan && (
                    <div>
                      <span className="font-semibold text-[var(--ink-secondary)]">整改方案：</span>
                      {c.actionPlan}
                    </div>
                  )}
                </div>

                {!readonly && (
                  <div className="flex items-center gap-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
                    <Button
                      size="xs"
                      variant="soft"
                      onClick={async () => {
                        await window.workbenchApi.homeroom.toggleCommStatus(c.id);
                        await onReload();
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {c.status === '待跟进' ? '标记已办结' : '改为待跟进'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => startEdit(c)}>
                      <Edit3 className="w-3.5 h-3.5" /> 编辑
                    </Button>
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      onClick={async () => {
                        await window.workbenchApi.homeroom.deleteComm(c.id);
                        await onReload();
                        onNotify('已删除该条沟通记录');
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 删除
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-[var(--ink-muted)]">
            暂无符合条件的家校沟通记录
          </div>
        )}
      </Card>
    </div>
  );
}
