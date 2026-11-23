import { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  MessageCircleHeart,
  NotebookPen,
  Plus,
  Search,
  Sunrise,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  ClassRecord,
  HomeroomCheckinType,
  HomeroomDashboardSummary,
  HomeroomNoteDayGroup,
  HomeroomTask,
  HomeroomTaskCategory,
  HomeroomTaskPriority,
} from '../../../shared/types';
import {
  HOMEROOM_CHECKIN_DEFS,
  HOMEROOM_TASK_CATEGORIES,
  HOMEROOM_TASK_PRIORITIES,
  HOMEROOM_TASK_TEMPLATES,
  localTodayStr,
  weekDateRange,
} from '../../../shared/homeroom-materials';
import { Badge, Button, Card, Input, Select, Textarea } from '../../components/ui/primitives';
import { FocusTimerWidget } from '../classroom/FocusTimerWidget';

const CHECKIN_ICONS: Record<HomeroomCheckinType, typeof Sunrise> = {
  morning: Sunrise,
  teach: BookOpen,
  meeting: Users,
  talk: MessageCircleHeart,
};

export function DailyPlanTab({
  cls,
  readonly,
  summary,
  tasks,
  notes,
  initialCategoryFilter,
  onReload,
  onNotify,
}: {
  cls: ClassRecord;
  readonly: boolean;
  summary: HomeroomDashboardSummary;
  tasks: HomeroomTask[];
  notes: HomeroomNoteDayGroup[];
  initialCategoryFilter?: HomeroomTaskCategory | '';
  onReload: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const today = localTodayStr();
  const [showMatrix, setShowMatrix] = useState(false);

  // Task create / edit form
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCat, setTaskCat] = useState<HomeroomTaskCategory>('班级管理');
  const [taskPriority, setTaskPriority] = useState<HomeroomTaskPriority>('常规工作');
  const [taskDate, setTaskDate] = useState(today);
  const [savingTask, setSavingTask] = useState(false);

  // Task filters
  const [filterCat, setFilterCat] = useState<string>(initialCategoryFilter || 'all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'todo' | 'done'>('all');
  const [filterKw, setFilterKw] = useState('');

  // Daily journal note
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const todayTasks = useMemo(() => tasks.filter((t) => t.taskDate === today), [tasks, today]);
  const todayDone = useMemo(() => todayTasks.filter((t) => t.done).length, [todayTasks]);

  const weekStats = useMemo(() => {
    const wk = weekDateRange(today);
    const list = tasks.filter((t) => t.taskDate >= wk.start && t.taskDate <= wk.end);
    return { total: list.length, done: list.filter((t) => t.done).length };
  }, [tasks, today]);

  const filteredTasks = useMemo(() => {
    const kw = filterKw.trim();
    return tasks.filter((t) => {
      if (filterCat !== 'all' && t.category !== filterCat) return false;
      if (filterStatus === 'todo' && t.done) return false;
      if (filterStatus === 'done' && !t.done) return false;
      if (kw && !t.title.includes(kw) && !t.category.includes(kw)) return false;
      return true;
    });
  }, [tasks, filterCat, filterStatus, filterKw]);

  async function handleToggleCheckin(type: HomeroomCheckinType) {
    if (readonly) return;
    try {
      const wasDone = summary.todayCheckins[type];
      await window.workbenchApi.homeroom.toggleCheckin(cls.id, type, today);
      await onReload();
      onNotify(
        wasDone
          ? `已取消今日「${HOMEROOM_CHECKIN_DEFS[type].name}」`
          : `「${HOMEROOM_CHECKIN_DEFS[type].name}」成功`,
      );
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function handleSubmitTask() {
    if (readonly) return;
    if (!taskTitle.trim()) {
      onNotify('请输入带班任务内容', 'err');
      return;
    }
    setSavingTask(true);
    try {
      await window.workbenchApi.homeroom.saveTask({
        classId: cls.id,
        id: editingTaskId || undefined,
        title: taskTitle.trim(),
        category: taskCat,
        priority: taskPriority,
        taskDate,
      });
      setEditingTaskId(null);
      setTaskTitle('');
      setTaskDate(today);
      await onReload();
      onNotify(editingTaskId ? '任务已更新' : '带班任务已添加');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleSaveNote() {
    if (readonly || !noteInput.trim()) return;
    setSavingNote(true);
    try {
      await window.workbenchApi.homeroom.addNote(cls.id, noteInput.trim(), today);
      setNoteInput('');
      await onReload();
      onNotify('今日带班记已保存');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSavingNote(false);
    }
  }

  const priorityTone = (p: HomeroomTaskPriority) =>
    p === '紧急必办' ? 'danger' : p === '延后跟进' ? 'warn' : 'info';

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* 4 Daily Check-in Cards + Collapsible 7-Day Matrix */}
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.keys(HOMEROOM_CHECKIN_DEFS) as HomeroomCheckinType[]).map((key) => {
            const def = HOMEROOM_CHECKIN_DEFS[key];
            const Icon = CHECKIN_ICONS[key];
            const done = summary.todayCheckins[key];
            const total = summary.checkinTotals[key];
            return (
              <Card key={key} className="p-3.5 flex flex-col justify-between gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <Icon className="w-4 h-4 text-[var(--accent)] shrink-0" />
                      <span className="truncate">{def.name}</span>
                    </div>
                    <div className="text-[11px] text-[var(--ink-muted)] mt-0.5 truncate">
                      {def.desc}
                    </div>
                  </div>
                  <Badge tone={done ? 'ok' : 'neutral'}>{done ? '今日已打卡' : '未打卡'}</Badge>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-[var(--accent)] leading-none">
                      {total}
                    </div>
                    <div className="text-[11px] text-[var(--ink-muted)] mt-1">累计天数</div>
                  </div>
                  <Button
                    size="xs"
                    variant={done ? 'soft' : 'primary'}
                    disabled={readonly}
                    onClick={() => void handleToggleCheckin(key)}
                  >
                    {done ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> 已打卡
                      </>
                    ) : (
                      '立即打卡'
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowMatrix((v) => !v)}
            className="text-xs text-[var(--ink-muted)] hover:text-[var(--accent)] inline-flex items-center gap-1 cursor-pointer px-1"
          >
            {showMatrix ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showMatrix ? '收起近 7 天打卡记录表' : '展开近 7 天打卡记录表'}
          </button>

          {showMatrix && (
            <Card className="mt-2 p-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[var(--ink-muted)] border-b border-[var(--border-subtle)]">
                    <th className="py-1.5 px-2 text-left font-medium">日期</th>
                    {(Object.keys(HOMEROOM_CHECKIN_DEFS) as HomeroomCheckinType[]).map((k) => (
                      <th key={k} className="py-1.5 px-2 text-center font-medium">
                        {HOMEROOM_CHECKIN_DEFS[k].shortName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {summary.recent7Days.map((day) => (
                    <tr key={day.date} className={day.date === today ? 'bg-[var(--accent-soft)]/35' : ''}>
                      <td className="py-1.5 px-2 tabular-nums font-medium">
                        {day.date}
                        {day.date === today && (
                          <span className="ml-1.5 text-[10.5px] text-[var(--accent)]">今天</span>
                        )}
                      </td>
                      {(Object.keys(HOMEROOM_CHECKIN_DEFS) as HomeroomCheckinType[]).map((k) => (
                        <td key={k} className="py-1.5 px-2 text-center">
                          {day.checkins[k] ? (
                            <span className="text-[var(--ok)] font-bold">✔</span>
                          ) : (
                            <span className="text-[var(--ink-muted)]/40">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {/* Main Split: Left = Tasks Plan (2/3), Right = Focus Timer + Daily Journal Notes (1/3) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 flex flex-col gap-3.5">
          {/* Add / Edit Task Card */}
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-[14.5px] font-semibold">
                  {editingTaskId ? '编辑带班任务' : '每日带班计划'}
                </h3>
                <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                  支持一键填充常用班务模板，任务存于本机资料库
                </p>
              </div>
              {editingTaskId && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEditingTaskId(null);
                    setTaskTitle('');
                    setTaskDate(today);
                  }}
                >
                  取消编辑
                </Button>
              )}
            </div>

            {/* Quick Template Chips */}
            {!readonly && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-xs text-[var(--ink-muted)] mr-0.5">常用模板：</span>
                {HOMEROOM_TASK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setTaskTitle(tpl.title);
                      setTaskCat(tpl.category);
                      if (tpl.priority) setTaskPriority(tpl.priority);
                    }}
                    className="px-2.5 py-1 rounded-full text-[11.5px] bg-[var(--bg-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] text-[var(--ink-secondary)] transition-colors cursor-pointer"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}

            {/* Form Inputs */}
            <div className="flex items-center flex-wrap gap-2">
              <Input
                value={taskTitle}
                disabled={readonly}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitTask();
                }}
                placeholder="输入今日带班任务，如：整理回收安全教育回执…"
                className="flex-1 min-w-[200px] h-8 text-[13px]"
              />
              <Select
                value={taskCat}
                disabled={readonly}
                onValueChange={(v) => setTaskCat(v as HomeroomTaskCategory)}
                options={HOMEROOM_TASK_CATEGORIES.map((c) => ({ value: c, label: c }))}
                className="w-28"
              />
              <Select
                value={taskPriority}
                disabled={readonly}
                onValueChange={(v) => setTaskPriority(v as HomeroomTaskPriority)}
                options={HOMEROOM_TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
                className="w-28"
              />
              <input
                type="date"
                disabled={readonly}
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs text-[var(--ink-primary)]"
              />
              <Button
                size="sm"
                variant="primary"
                disabled={readonly || savingTask || !taskTitle.trim()}
                onClick={() => void handleSubmitTask()}
              >
                <Plus className="w-3.5 h-3.5" /> {editingTaskId ? '保存修改' : '添加任务'}
              </Button>
            </div>

            {/* Today & Week Progress Bars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="rounded-lg bg-[var(--bg-muted)]/60 p-2.5">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-[var(--ink-secondary)] font-medium">今日任务进度</span>
                  <span className="tabular-nums font-semibold text-[var(--accent)]">
                    {todayDone} / {todayTasks.length}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{
                      width: `${todayTasks.length ? (todayDone / todayTasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="rounded-lg bg-[var(--bg-muted)]/60 p-2.5">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-[var(--ink-secondary)] font-medium">本周任务进度</span>
                  <span className="tabular-nums font-semibold text-[var(--info)]">
                    {weekStats.done} / {weekStats.total}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--info)] transition-[width] duration-300"
                    style={{
                      width: `${weekStats.total ? (weekStats.done / weekStats.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Filter & Task List Card */}
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={filterCat}
                  onValueChange={setFilterCat}
                  className="w-28"
                  options={[
                    { value: 'all', label: '全部分类' },
                    ...HOMEROOM_TASK_CATEGORIES.map((c) => ({ value: c, label: c })),
                  ]}
                />
                <Select
                  value={filterStatus}
                  onValueChange={(v) => setFilterStatus(v as 'all' | 'todo' | 'done')}
                  className="w-24"
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'todo', label: '待办' },
                    { value: 'done', label: '已完成' },
                  ]}
                />
              </div>
              <div className="relative w-48">
                <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={filterKw}
                  onChange={(e) => setFilterKw(e.target.value)}
                  placeholder="搜索任务关键词…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            {filteredTasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                {filteredTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`rounded-xl border border-[var(--border-subtle)] p-3 flex items-start justify-between gap-3 transition-colors ${
                      t.done ? 'bg-[var(--bg-muted)]/40 opacity-65' : 'bg-[var(--bg-surface)]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={readonly}
                        onClick={async () => {
                          await window.workbenchApi.homeroom.toggleTask(t.id);
                          await onReload();
                        }}
                        aria-label={t.done ? '标记未完成' : '标记完成'}
                        className={`mt-0.5 w-4.5 h-4.5 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                          t.done
                            ? 'bg-[var(--ok)] border-[var(--ok)] text-white'
                            : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
                        }`}
                      >
                        {t.done && <Check className="w-3 h-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-[13.5px] font-medium ${
                            t.done ? 'line-through text-[var(--ink-muted)]' : 'text-[var(--ink-primary)]'
                          }`}
                        >
                          {t.title}
                        </div>
                        <div className="mt-1.5 flex items-center flex-wrap gap-1.5 text-xs">
                          <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                          <Badge tone="accent">{t.category}</Badge>
                          <span className="text-[var(--ink-muted)] tabular-nums">
                            {t.taskDate}
                            {t.taskDate === today && (
                              <strong className="ml-1 text-[var(--accent)]">今天</strong>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!readonly && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="xs"
                          variant="ghost"
                          title="编辑"
                          onClick={() => {
                            setEditingTaskId(t.id);
                            setTaskTitle(t.title);
                            setTaskCat(t.category);
                            setTaskPriority(t.priority);
                            setTaskDate(t.taskDate);
                          }}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        {!t.done && (
                          <Button
                            size="xs"
                            variant="ghost"
                            title="延后一天"
                            onClick={async () => {
                              const updated = await window.workbenchApi.homeroom.delayTask(t.id, 1);
                              await onReload();
                              onNotify(`已延后至 ${updated.taskDate}`);
                            }}
                          >
                            <CalendarClock className="w-3.5 h-3.5" /> 延后一天
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="danger-ghost"
                          title="删除"
                          onClick={async () => {
                            await window.workbenchApi.homeroom.deleteTask(t.id);
                            await onReload();
                            onNotify('已删除该任务');
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-[var(--ink-muted)]">
                暂无匹配的带班任务，点击上方模板即可一键添加
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Focus Timer + Today's Homeroom Journal */}
        <div className="flex flex-col gap-3.5">
          <FocusTimerWidget
            readonly={readonly}
            todayFocusMinutes={summary.todayFocusMinutes}
            onEarnMinutes={async (mins) => {
              if (readonly || mins <= 0) return;
              await window.workbenchApi.homeroom.addFocusMinutes(cls.id, mins, today);
              await onReload();
            }}
            onNotify={onNotify}
          />

          <Card className="p-4 flex flex-col gap-3">
            <div>
              <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                <NotebookPen className="w-4 h-4 text-[var(--accent)]" /> 今日带班记
              </h3>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                随手记录当日突发学生情况、班级临时问题或带班感悟
              </p>
            </div>
            <Textarea
              rows={3}
              disabled={readonly}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="记录今天带班中的点滴…（自动按日期+时间分条保存）"
              className="text-[13px]"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={readonly || savingNote || !noteInput.trim()}
                onClick={() => void handleSaveNote()}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> 保存带班记
              </Button>
            </div>

            {notes.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pt-1">
                {notes.map((day) =>
                  day.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg bg-[var(--bg-muted)]/60 border border-[var(--border-subtle)] p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-[var(--ink-muted)] mb-1">
                        <span className="tabular-nums font-medium">
                          {day.date} {entry.time}
                        </span>
                        {!readonly && (
                          <button
                            type="button"
                            onClick={async () => {
                              await window.workbenchApi.homeroom.deleteNote(cls.id, day.date, entry.id);
                              await onReload();
                            }}
                            className="text-[var(--ink-muted)] hover:text-[var(--danger)] cursor-pointer"
                            title="删除该条带班记"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="text-[12.5px] leading-relaxed text-[var(--ink-primary)] whitespace-pre-wrap">
                        {entry.text}
                      </div>
                    </div>
                  )),
                )}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-[var(--ink-muted)]">
                暂无带班记，写下今天第一条观察吧
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
