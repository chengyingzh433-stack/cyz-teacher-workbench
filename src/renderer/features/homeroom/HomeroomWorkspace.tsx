import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpenText,
  ClipboardList,
  MessageSquareHeart,
} from 'lucide-react';
import type {
  ClassRecord,
  HomeroomCommStatus,
  HomeroomDashboardSummary,
  HomeroomMemo,
  HomeroomNoteDayGroup,
  HomeroomTask,
  HomeroomTaskCategory,
  SavedMaterialRecord,
  StudentCommRecord,
  StudentMember,
  TeacherProfile,
} from '../../../shared/types';
import { localTodayStr, timeGreeting } from '../../../shared/homeroom-materials';
import { Card } from '../../components/ui/primitives';
import { DailyPlanTab } from './DailyPlanTab';
import { CommsLedgerTab } from './CommsLedgerTab';
import { MonthlyStatsTab } from './MonthlyStatsTab';
import { MaterialsAndMemosTab } from './MaterialsAndMemosTab';

export type HomeroomSubTab = 'daily' | 'comms' | 'stats' | 'materials';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function HomeroomWorkspace({
  cls,
  teacher,
  members,
  themeId,
  aiReady,
  requestedTab,
  onClearRequestedTab,
  onHomeroomChanged,
  onJumpToClassroom,
  onOpenStudentProfile,
  onOpenAiSettings,
  onNotify,
}: {
  cls: ClassRecord;
  teacher: TeacherProfile;
  members: StudentMember[];
  themeId: string;
  aiReady: boolean;
  requestedTab?: HomeroomSubTab | null;
  onClearRequestedTab?: () => void;
  onHomeroomChanged: () => void;
  onJumpToClassroom: () => void;
  onOpenStudentProfile: (membershipId: string) => void;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<HomeroomSubTab>('daily');
  const [dailyCatFilter, setDailyCatFilter] = useState<HomeroomTaskCategory | ''>('');
  const [commStatusFilter, setCommStatusFilter] = useState<'all' | HomeroomCommStatus>('all');
  const [filterNonce, setFilterNonce] = useState(0);

  const [summary, setSummary] = useState<HomeroomDashboardSummary | null>(null);
  const [tasks, setTasks] = useState<HomeroomTask[]>([]);
  const [notes, setNotes] = useState<HomeroomNoteDayGroup[]>([]);
  const [comms, setComms] = useState<StudentCommRecord[]>([]);
  const [memos, setMemos] = useState<HomeroomMemo[]>([]);
  const [savedMaterials, setSavedMaterials] = useState<SavedMaterialRecord[]>([]);

  const readonly = cls.status === 'archived';

  useEffect(() => {
    if (requestedTab) {
      setTab(requestedTab);
      onClearRequestedTab?.();
    }
  }, [requestedTab, onClearRequestedTab]);

  const onHomeroomChangedRef = useRef(onHomeroomChanged);
  onHomeroomChangedRef.current = onHomeroomChanged;

  const reloadAll = useCallback(async () => {
    const today = localTodayStr();
    const [sum, taskList, noteList, commList, memoList, matList] = await Promise.all([
      window.workbenchApi.homeroom.getDashboard(cls.id, today),
      window.workbenchApi.homeroom.listTasks(cls.id),
      window.workbenchApi.homeroom.listNotes(cls.id, 10),
      window.workbenchApi.homeroom.listComms(cls.id),
      window.workbenchApi.homeroom.listMemos(cls.id),
      window.workbenchApi.homeroom.listSavedMaterials(cls.id),
    ]);
    setSummary(sum);
    setTasks(taskList);
    setNotes(noteList);
    setComms(commList);
    setMemos(memoList);
    setSavedMaterials(matList);
    onHomeroomChangedRef.current();
  }, [cls.id]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const now = new Date();
  const greetingText = `${timeGreeting(now)}，${teacher.name || '老师'}`;
  const dateText = `${localTodayStr(now)} 星期${WEEKDAYS[now.getDay()]} · ${cls.name}带班助手`;

  const subTabs: Array<{
    id: HomeroomSubTab;
    label: string;
    icon: typeof ClipboardList;
    badge?: number;
  }> = [
    { id: 'daily', label: '今日带班与待办', icon: ClipboardList, badge: summary?.todayTodoCount || undefined },
    { id: 'comms', label: '家校沟通台账', icon: MessageSquareHeart, badge: summary?.pendingFollowUpCount || undefined },
    { id: 'stats', label: '班级月度统计', icon: BarChart3 },
    { id: 'materials', label: '德育素材与备忘', icon: BookOpenText, badge: memos.length || undefined },
  ];

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Top Homeroom Status Header + 4 Interactive Pills */}
      <Card className="px-4 py-3 flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[15.5px] font-bold text-[var(--accent)] truncate">{greetingText}</div>
          <div className="text-xs text-[var(--ink-muted)] mt-0.5 truncate">{dateText}</div>
        </div>

        {summary && (
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDailyCatFilter('');
                setFilterNonce((n) => n + 1);
                setTab('daily');
              }}
              className="px-3 py-1 rounded-full text-xs bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--ink-secondary)] cursor-pointer transition-colors"
            >
              今日待办 <strong className="text-[var(--accent)] tabular-nums ml-0.5">{summary.todayTodoCount}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setDailyCatFilter('');
                setFilterNonce((n) => n + 1);
                setTab('daily');
              }}
              className="px-3 py-1 rounded-full text-xs bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--ink-secondary)] cursor-pointer transition-colors"
            >
              今日已办结 <strong className="text-[var(--ok)] tabular-nums ml-0.5">{summary.todayDoneCount}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setCommStatusFilter('待跟进');
                setFilterNonce((n) => n + 1);
                setTab('comms');
              }}
              className="px-3 py-1 rounded-full text-xs bg-[var(--warn-soft)] hover:brightness-95 border border-[var(--warn)]/25 text-[var(--warn)] cursor-pointer transition-colors"
            >
              待跟进家长 <strong className="tabular-nums ml-0.5">{summary.pendingFollowUpCount}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setDailyCatFilter('安全落实');
                setFilterNonce((n) => n + 1);
                setTab('daily');
              }}
              className="px-3 py-1 rounded-full text-xs bg-[var(--danger-soft)] hover:brightness-95 border border-[var(--danger)]/25 text-[var(--danger)] cursor-pointer transition-colors"
            >
              待落实安全 <strong className="tabular-nums ml-0.5">{summary.pendingSafetyTaskCount}</strong>
            </button>
          </div>
        )}
      </Card>

      {/* 4 Sub-Tab Switcher */}
      <div className="inline-flex p-1 rounded-xl bg-[var(--bg-muted)] gap-1 self-start flex-wrap shrink-0">
        {subTabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                active
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
              {Boolean(item.badge) && (
                <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Scrollable Sub-Tab Body */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {!summary ? (
          <div className="py-16 text-center text-sm text-[var(--ink-muted)]">正在载入带班数据…</div>
        ) : tab === 'daily' ? (
          <DailyPlanTab
            key={`daily-${filterNonce}`}
            cls={cls}
            readonly={readonly}
            summary={summary}
            tasks={tasks}
            notes={notes}
            initialCategoryFilter={dailyCatFilter}
            onReload={reloadAll}
            onNotify={onNotify}
          />
        ) : tab === 'comms' ? (
          <CommsLedgerTab
            key={`comms-${filterNonce}`}
            cls={cls}
            members={members}
            comms={comms}
            readonly={readonly}
            initialStatusFilter={commStatusFilter}
            onReload={reloadAll}
            onOpenStudentProfile={onOpenStudentProfile}
            onNotify={onNotify}
          />
        ) : tab === 'stats' ? (
          <MonthlyStatsTab
            cls={cls}
            members={members}
            themeId={themeId}
            readonly={readonly}
            onJumpToClassroom={onJumpToClassroom}
            onOpenStudentProfile={onOpenStudentProfile}
            onNotify={onNotify}
          />
        ) : (
          <MaterialsAndMemosTab
            cls={cls}
            readonly={readonly}
            aiReady={aiReady}
            memos={memos}
            savedMaterials={savedMaterials}
            onReload={reloadAll}
            onOpenAiSettings={onOpenAiSettings}
            onNotify={onNotify}
          />
        )}
      </div>
    </div>
  );
}
