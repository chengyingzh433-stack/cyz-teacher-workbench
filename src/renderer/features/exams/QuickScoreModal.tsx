import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, UserCheck, UserPlus } from 'lucide-react';
import type { ExamDetail, Gender, ScoreStatus, StudentMember } from '../../../shared/types';
import { normalizeName } from '../../../shared/gradebook/recognize';
import { cellStatusLabels } from '../../../shared/gradebook/analysis';
import { formatScore, parsePoints } from '../../../shared/score-policy';
import { Badge, Button, Input, Modal, Select } from '../../components/ui/primitives';

export function QuickScoreModal({
  open,
  onOpenChange,
  className,
  detail,
  allMembers,
  defaultColumnId,
  onRecorded,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  detail: ExamDetail;
  allMembers: StudentMember[];
  defaultColumnId: string;
  onRecorded: (updated: ExamDetail, rosterChanged: boolean) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const hasCols = detail.columns.length > 0;
  const [colMode, setColMode] = useState<'existing' | 'new'>(hasCols ? 'existing' : 'new');
  const [columnId, setColumnId] = useState(defaultColumnId || detail.columns[0]?.id || '');
  const [newColLabel, setNewColLabel] = useState('物理');
  const [newColMax, setNewColMax] = useState('100');

  const [nameInput, setNameInput] = useState('');
  const [pickedMemberId, setPickedMemberId] = useState<string | null>(null);
  const [confirmBelongsToClass, setConfirmBelongsToClass] = useState(false);
  const [newRosterNo, setNewRosterNo] = useState('');
  const [newGender, setNewGender] = useState<Gender>('unspecified');
  const [autoSeat, setAutoSeat] = useState(true);

  const [status, setStatus] = useState<ScoreStatus>('score');
  const [scoreText, setScoreText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const validCol =
      detail.columns.find((c) => c.id === defaultColumnId)?.id || detail.columns[0]?.id || '';
    setColMode(validCol ? 'existing' : 'new');
    setColumnId(validCol);
    setNewColLabel('物理');
    setNewColMax('100');
    setNameInput('');
    setPickedMemberId(null);
    setConfirmBelongsToClass(false);
    setNewRosterNo('');
    setNewGender('unspecified');
    setAutoSeat(true);
    setStatus('score');
    setScoreText('');
    setReason('');
  }, [open, detail.exam.id, defaultColumnId]);

  const cleanQuery = normalizeName(nameInput);

  const exactActiveMatches = useMemo(() => {
    if (!cleanQuery) return [];
    return allMembers.filter(
      (m) => m.status === 'active' && normalizeName(m.name) === cleanQuery,
    );
  }, [allMembers, cleanQuery]);

  const exactRemovedMatches = useMemo(() => {
    if (!cleanQuery) return [];
    return allMembers.filter(
      (m) => m.status === 'removed' && normalizeName(m.name) === cleanQuery,
    );
  }, [allMembers, cleanQuery]);

  const fuzzySuggestions = useMemo(() => {
    const q = nameInput.trim();
    if (!q || exactActiveMatches.length > 0) return [];
    return allMembers
      .filter((m) => m.status === 'active' && (m.name.includes(q) || m.rosterNo.includes(q)))
      .slice(0, 6);
  }, [allMembers, nameInput, exactActiveMatches.length]);

  const resolvedMember: StudentMember | null = useMemo(() => {
    if (pickedMemberId) {
      return allMembers.find((m) => m.membershipId === pickedMemberId) || null;
    }
    if (exactActiveMatches.length === 1) return exactActiveMatches[0];
    if (exactActiveMatches.length === 0 && exactRemovedMatches.length === 1) {
      return exactRemovedMatches[0];
    }
    return null;
  }, [pickedMemberId, allMembers, exactActiveMatches, exactRemovedMatches]);

  const ambiguous = exactActiveMatches.length > 1 && !pickedMemberId;
  const isNewStudent = Boolean(cleanQuery) && !resolvedMember && !ambiguous;

  const existingCell = useMemo(() => {
    if (!resolvedMember || colMode !== 'existing' || !columnId) return null;
    return (
      detail.scores.find(
        (s) => s.membershipId === resolvedMember.membershipId && s.columnId === columnId,
      ) || null
    );
  }, [resolvedMember, colMode, columnId, detail.scores]);

  async function submit(keepOpen: boolean) {
    if (!cleanQuery && !resolvedMember) {
      onNotify('请输入学生姓名', 'err');
      return;
    }
    if (ambiguous) {
      onNotify('本班有重名学生，请先点击下方对应的同学', 'err');
      return;
    }
    if (isNewStudent && !confirmBelongsToClass) {
      onNotify(`请先勾选确认「${nameInput.trim()}」属于「${className}」`, 'err');
      return;
    }
    if (colMode === 'new' && !newColLabel.trim()) {
      onNotify('请填写新科目列名称', 'err');
      return;
    }
    let units: number | null = null;
    if (status === 'score') {
      try {
        units = parsePoints(scoreText.trim());
      } catch (e) {
        onNotify((e as Error).message, 'err');
        return;
      }
    }
    let newMaxUnits: number | null = null;
    if (colMode === 'new' && newColMax.trim()) {
      try {
        newMaxUnits = parsePoints(newColMax.trim());
      } catch {
        onNotify('满分格式不正确，请输入如 100', 'err');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await window.workbenchApi.exams.quickRecordScore({
        examId: detail.exam.id,
        columnId: colMode === 'existing' ? columnId : undefined,
        newColumn:
          colMode === 'new'
            ? { label: newColLabel.trim(), maxUnits: newMaxUnits, role: 'score' }
            : undefined,
        membershipId: resolvedMember?.membershipId,
        restoreIfRemoved: resolvedMember?.status === 'removed',
        createStudent: isNewStudent
          ? {
              name: nameInput.trim(),
              rosterNo: newRosterNo.trim(),
              gender: newGender,
            }
          : undefined,
        autoSeat: autoSeat && (isNewStudent || resolvedMember?.status === 'removed'),
        status,
        units,
        reason: reason.trim(),
      });
      await onRecorded(res.detail, Boolean(res.createdStudent) || resolvedMember?.status === 'removed');
      if (colMode === 'new') {
        const addedCol = res.detail.columns.find((c) => c.label === newColLabel.trim());
        if (addedCol) {
          setColMode('existing');
          setColumnId(addedCol.id);
        }
      }
      const targetName = res.createdStudent?.name || resolvedMember?.name || nameInput.trim();
      onNotify(
        res.createdStudent
          ? `已新建本班学生「${targetName}」并录入成绩${res.seated ? '（已自动入座空位）' : ''}`
          : `已${existingCell ? '覆盖更新' : '录入'}「${targetName}」成绩`,
      );
      if (keepOpen) {
        setNameInput('');
        setPickedMemberId(null);
        setConfirmBelongsToClass(false);
        setNewRosterNo('');
        setNewGender('unspecified');
        setScoreText('');
        setReason('');
      } else {
        onOpenChange(false);
      }
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    Boolean(cleanQuery || resolvedMember) &&
    !ambiguous &&
    (!isNewStudent || confirmBelongsToClass) &&
    (status !== 'score' || Boolean(scoreText.trim())) &&
    (colMode === 'existing' ? Boolean(columnId) : Boolean(newColLabel.trim()));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`快捷录分 / 新增学生 · ${detail.exam.title}`}
      subtitle={`当前班级：${className}（有名字直接录入/覆盖，无名字确认本班后自动新建）`}
      size="md"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
          <Button disabled={!canSubmit} onClick={() => void submit(true)}>
            保存并继续录下一位
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit(false)}>
            {isNewStudent ? '确认新建并录分' : existingCell ? '覆盖更新成绩' : '保存成绩'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {/* Column Picker or New Column */}
        <div className="p-3 rounded-xl bg-[var(--bg-muted)]/60 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--ink-secondary)]">成绩科目列</span>
            {detail.columns.length > 0 && (
              <button
                type="button"
                onClick={() => setColMode((m) => (m === 'existing' ? 'new' : 'existing'))}
                className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
              >
                {colMode === 'existing' ? '+ 新建科目列' : '选择已有科目列'}
              </button>
            )}
          </div>
          {colMode === 'existing' && detail.columns.length > 0 ? (
            <Select
              value={columnId}
              onValueChange={setColumnId}
              className="w-full"
              options={detail.columns.map((c) => ({
                value: c.id,
                label: c.label,
                hint: c.maxUnits ? `满分 ${formatScore(c.maxUnits)}` : undefined,
              }))}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 flex flex-col gap-1 text-xs">
                科目名称 *
                <Input
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  placeholder="如：物理 / 总分"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                满分
                <Input
                  value={newColMax}
                  onChange={(e) => setNewColMax(e.target.value)}
                  placeholder="100"
                />
              </label>
            </div>
          )}
        </div>

        {/* Student Name Input + Instant Match Feedback */}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            学生姓名 *
            <Input
              autoFocus
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setPickedMemberId(null);
                setConfirmBelongsToClass(false);
              }}
              placeholder="输入姓名（自动匹配本班花名册，查无此人时可确认新建）"
            />
          </label>

          {fuzzySuggestions.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)]">本班已有：</span>
              {fuzzySuggestions.map((m) => (
                <button
                  key={m.membershipId}
                  type="button"
                  onClick={() => {
                    setNameInput(m.name);
                    setPickedMemberId(m.membershipId);
                  }}
                  className="px-2 py-0.5 rounded-full bg-[var(--bg-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] cursor-pointer transition-colors"
                >
                  {m.name}
                  {m.rosterNo ? ` · ${m.rosterNo}` : ''}
                </button>
              ))}
            </div>
          )}

          {ambiguous && (
            <div className="p-2.5 rounded-xl bg-[var(--warn-soft)]/70 border border-[var(--warn)]/40 text-xs flex flex-col gap-1.5">
              <span className="font-medium text-[var(--warn)]">
                本班有 {exactActiveMatches.length} 名同名同学，请点选具体学生：
              </span>
              <div className="flex items-center flex-wrap gap-1.5">
                {exactActiveMatches.map((m) => (
                  <Button
                    key={m.membershipId}
                    size="xs"
                    onClick={() => setPickedMemberId(m.membershipId)}
                  >
                    {m.name} ({m.rosterNo || '无学号'})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {resolvedMember && (
            <div className="px-3 py-2 rounded-xl bg-[var(--ok-soft)]/70 border border-[var(--ok)]/30 text-xs flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ok)]">
                {resolvedMember.status === 'removed' ? (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    找到曾移出的本班学生「{resolvedMember.name}」，保存后自动恢复在读
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    已匹配本班学生「{resolvedMember.name}」
                    {resolvedMember.rosterNo ? `（${resolvedMember.rosterNo}）` : ''}
                  </>
                )}
              </span>
              {existingCell && (
                <Badge tone="warn">
                  原成绩{' '}
                  {existingCell.status === 'score'
                    ? formatScore(existingCell.units)
                    : cellStatusLabels[existingCell.status]}
                  ，保存将覆盖
                </Badge>
              )}
            </div>
          )}

          {isNewStudent && (
            <div className="p-3 rounded-xl bg-[var(--warn-soft)]/60 border border-[var(--warn)]/45 flex flex-col gap-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--ink-primary)]">
                <UserPlus className="w-4 h-4 text-[var(--warn)] shrink-0" />
                <span>
                  「{nameInput.trim()}」不在「{className}」花名册中
                </span>
              </div>
              <label className="inline-flex items-center gap-2 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmBelongsToClass}
                  onChange={(e) => setConfirmBelongsToClass(e.target.checked)}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                />
                <span>
                  确认「{nameInput.trim()}」属于{' '}
                  <strong className="text-[var(--accent)]">{className}</strong>，并新建到本班花名册
                </span>
              </label>
              {confirmBelongsToClass && (
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <Input
                    value={newRosterNo}
                    onChange={(e) => setNewRosterNo(e.target.value)}
                    placeholder="学号/编号（可选）"
                    className="h-8 text-xs"
                  />
                  <Select
                    value={newGender}
                    onValueChange={(v) => setNewGender(v as Gender)}
                    options={[
                      { value: 'unspecified', label: '性别：暂不设置' },
                      { value: 'male', label: '男（自动配像素形象）' },
                      { value: 'female', label: '女（自动配像素形象）' },
                    ]}
                  />
                  <label className="col-span-2 inline-flex items-center gap-2 text-[var(--ink-secondary)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoSeat}
                      onChange={(e) => setAutoSeat(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                    />
                    <span>顺便在「互动教室」为其分配一个空座位</span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Score Entry */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 text-xs font-medium">
            成绩状态
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ScoreStatus)}
              options={[
                { value: 'score', label: '正常得分' },
                { value: 'absent', label: '缺考（不拉低均分）' },
                { value: 'exempt', label: '免考（不拉低均分）' },
              ]}
            />
          </div>
          {status === 'score' && (
            <label className="flex flex-col gap-1 text-xs font-medium">
              分数 *
              <Input
                value={scoreText}
                onChange={(e) => setScoreText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) void submit(false);
                }}
                placeholder="如 88.5"
              />
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium">
          备注原因（可选，写入改分留痕日志）
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="如：补考录入 / 订正复核"
          />
        </label>
      </div>
    </Modal>
  );
}
