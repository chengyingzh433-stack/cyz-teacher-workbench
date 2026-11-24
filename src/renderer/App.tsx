import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEFAULT_PINNED_SPACES,
  type ClassRecord,
  type ExamSummary,
  type HomeroomDashboardSummary,
  type HomeroomMemo,
  type NavSpace,
  type PinnableSpace,
  type StudentMember,
  type TeacherProfile,
  type UpdateState,
  type VaultInfo,
} from '../shared/types';
import { localTodayStr } from '../shared/homeroom-materials';
import { applyThemeToDocument, getQuickToggleThemeId } from './themes';
import { ArtRegistry } from './features/classroom/SpriteArt';
import { ClassroomWorkspace } from './features/classroom/ClassroomWorkspace';
import { StudentProfileDrawer } from './features/classroom/StudentProfileDrawer';
import { RosterWorkspace } from './features/roster/RosterWorkspace';
import { ExamCenter } from './features/exams/ExamCenter';
import {
  HomeroomWorkspace,
  type HomeroomSubTab,
} from './features/homeroom/HomeroomWorkspace';
import { ZhixueCompanion } from './features/zhixue/ZhixueCompanion';
import { AppsHubWorkspace } from './features/hub/AppsHubWorkspace';
import { QuestionBankWorkspace } from './features/question-bank/QuestionBankWorkspace';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { TrashModal } from './components/TrashModal';
import { OnboardingWelcome } from './components/OnboardingWelcome';
import { ClassAndTeacherModals } from './components/ClassAndTeacherModals';
import { CommandPalette } from './components/ui/CommandPalette';
import { Badge, Button, ConfirmDialog } from './components/ui/primitives';

export type { NavSpace };

export function App() {
  const isMac = window.workbenchApi.platform === 'darwin';

  const [ready, setReady] = useState(false);
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [themeId, setThemeId] = useState('studio-light');
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedSpaces, setPinnedSpaces] = useState<PinnableSpace[]>(DEFAULT_PINNED_SPACES);
  const [aiReady, setAiReady] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  const [teacher, setTeacher] = useState<TeacherProfile>({
    name: '',
    gender: 'unspecified',
    characterId: null,
  });
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [classId, setClassId] = useState('');
  const [space, setSpace] = useState<NavSpace>('classroom');

  const [allMembers, setAllMembers] = useState<StudentMember[]>([]);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [homeroomSummary, setHomeroomSummary] = useState<HomeroomDashboardSummary | null>(null);
  const [homeroomMemos, setHomeroomMemos] = useState<HomeroomMemo[]>([]);
  const [requestedHomeroomTab, setRequestedHomeroomTab] = useState<HomeroomSubTab | null>(null);

  // Global overlays & modals
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'ai' | 'vault'>('theme');
  const [trashOpen, setTrashOpen] = useState(false);
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [classModal, setClassModal] = useState<'new' | 'edit' | null>(null);
  const [deleteClassTarget, setDeleteClassTarget] = useState<ClassRecord | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const notify = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const currentClass =
    classes.find((c) => c.id === classId) ||
    classes.find((c) => c.status === 'active') ||
    classes[0];
  const activeMembers = allMembers.filter((m) => m.status === 'active');

  const loadBootstrap = useCallback(async () => {
    const [prefs, vInfo, tProf, clsList, aiCfg, trash] = await Promise.all([
      window.workbenchApi.vault.getPreferences(),
      window.workbenchApi.vault.getInfo(),
      window.workbenchApi.teacher.get(),
      window.workbenchApi.classes.list(),
      window.workbenchApi.ai.getConfig(),
      window.workbenchApi.trash.list(),
    ]);
    setThemeId(prefs.themeId);
    applyThemeToDocument(prefs.themeId);
    setCollapsed(prefs.sidebarCollapsed);
    setPinnedSpaces(prefs.pinnedSpaces ?? DEFAULT_PINNED_SPACES);
    setVaultInfo(vInfo);
    setTeacher(tProf);
    setClasses(clsList);
    setAiReady(aiCfg.general.ready || aiCfg.vision.ready);
    setTrashCount(trash.length);
    setReady(true);
  }, []);

  const followUpIds = useMemo(
    () => new Set(homeroomSummary?.pendingFollowUpMemberIds || []),
    [homeroomSummary?.pendingFollowUpMemberIds],
  );

  const loadHomeroomSummary = useCallback(async (cid: string) => {
    if (!cid) {
      setHomeroomSummary(null);
      setHomeroomMemos([]);
      return;
    }
    const [sum, memos] = await Promise.all([
      window.workbenchApi.homeroom.getDashboard(cid, localTodayStr()),
      window.workbenchApi.homeroom.listMemos(cid),
    ]);
    setHomeroomSummary(sum);
    setHomeroomMemos(memos);
  }, []);

  const loadClassData = useCallback(async (cid: string) => {
    if (!cid) {
      setAllMembers([]);
      setExams([]);
      setHomeroomSummary(null);
      setHomeroomMemos([]);
      return;
    }
    const [rosterList, examList, clsList, trash, vInfo, hSum, hMemos] = await Promise.all([
      window.workbenchApi.roster.list(cid, true),
      window.workbenchApi.exams.list(cid),
      window.workbenchApi.classes.list(),
      window.workbenchApi.trash.list(),
      window.workbenchApi.vault.getInfo(),
      window.workbenchApi.homeroom.getDashboard(cid, localTodayStr()),
      window.workbenchApi.homeroom.listMemos(cid),
    ]);
    setAllMembers(rosterList);
    setExams(examList);
    setClasses(clsList);
    setTrashCount(trash.length);
    setVaultInfo(vInfo);
    setHomeroomSummary(hSum);
    setHomeroomMemos(hMemos);
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    void window.workbenchApi.updater.getState().then(setUpdateState);
    const off = window.workbenchApi.updater.onStateChange((next) => {
      setUpdateState(next);
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (currentClass) {
      void loadClassData(currentClass.id);
    } else {
      setAllMembers([]);
      setExams([]);
    }
  }, [currentClass?.id, loadClassData]);

  async function handleChangeTheme(nextId: string) {
    setThemeId(nextId);
    applyThemeToDocument(nextId);
    await window.workbenchApi.vault.updatePreferences({ themeId: nextId });
  }

  async function handleToggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    await window.workbenchApi.vault.updatePreferences({ sidebarCollapsed: next });
  }

  async function handleTogglePinSpace(target: PinnableSpace) {
    const exists = pinnedSpaces.includes(target);
    const next = exists
      ? pinnedSpaces.filter((s) => s !== target)
      : DEFAULT_PINNED_SPACES.filter((s) => pinnedSpaces.includes(s) || s === target);
    setPinnedSpaces(next);
    await window.workbenchApi.vault.updatePreferences({ pinnedSpaces: next });
    notify(exists ? '已移出左侧边栏，随时可在全部功能中心找回' : '已置顶到左侧边栏');
  }

  async function handleResetPinnedSpaces() {
    const next = [...DEFAULT_PINNED_SPACES];
    setPinnedSpaces(next);
    await window.workbenchApi.vault.updatePreferences({ pinnedSpaces: next });
    notify('已恢复默认左侧边栏置顶项');
  }

  const anyOverlayOpen =
    cmdOpen ||
    settingsOpen ||
    trashOpen ||
    Boolean(profileMemberId) ||
    teacherOpen ||
    Boolean(classModal) ||
    Boolean(deleteClassTarget);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--ink-muted)]">
        正在打开本地资料库…
      </div>
    );
  }

  return (
    <div className="theme-canvas h-full flex overflow-hidden bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
      <ArtRegistry />

      <Sidebar
        isMac={isMac}
        collapsed={collapsed}
        teacher={teacher}
        classes={classes}
        currentClass={currentClass}
        space={space}
        pinnedSpaces={pinnedSpaces}
        themeId={themeId}
        aiReady={aiReady}
        trashCount={trashCount}
        homeroomBadge={
          homeroomSummary
            ? homeroomSummary.todayTodoCount + homeroomSummary.pendingFollowUpCount || undefined
            : undefined
        }
        vaultInfo={vaultInfo}
        updateState={updateState}
        onToggleCollapse={() => void handleToggleCollapse()}
        onOpenTeacher={() => setTeacherOpen(true)}
        onSelectClass={(id) => {
          setClassId(id);
          setSelectedExamId('');
        }}
        onCreateClass={() => setClassModal('new')}
        onSelectSpace={setSpace}
        onOpenCmdK={() => setCmdOpen(true)}
        onToggleTheme={() => void handleChangeTheme(getQuickToggleThemeId(themeId))}
        onOpenTrash={() => setTrashOpen(true)}
        onOpenSettings={(tab) => {
          setSettingsTab(tab || 'theme');
          setSettingsOpen(true);
        }}
      />

      {/* Right Workspace Main Area */}
      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Top Integrated Titlebar Header */}
        <header
          className={`theme-header app-drag px-5 flex items-center justify-between gap-3 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] ${
            isMac ? 'h-12' : 'h-12'
          }`}
        >
          <div className="app-no-drag flex items-center gap-2.5 min-w-0">
            {space === 'hub' ? (
              <>
                <h1 className="text-[16px] font-bold truncate">全部功能中心</h1>
                <Badge tone="accent">工作台门户</Badge>
              </>
            ) : space === 'qbank' ? (
              <>
                <h1 className="text-[16px] font-bold truncate">物理题库</h1>
                <Badge tone="accent">独立子库 · 跨班级通用</Badge>
              </>
            ) : space === 'zhixue' ? (
              <>
                <h1 className="text-[16px] font-bold truncate">智学网伴侣 · AI 网阅中心</h1>
                <Badge tone="accent">内嵌浏览器 · 框选 · 自动/半自动</Badge>
              </>
            ) : currentClass ? (
              <>
                <h1 className="text-[16px] font-bold truncate">{currentClass.name}</h1>
                <span className="text-xs text-[var(--ink-muted)] truncate hidden sm:inline">
                  {[currentClass.school, currentClass.termLabel].filter(Boolean).join(' · ')}
                </span>
                {currentClass.status === 'archived' && <Badge tone="warn">已归档 · 只读</Badge>}
              </>
            ) : (
              <h1 className="text-[16px] font-bold">欢迎使用 cyz 的教师工作台</h1>
            )}
          </div>

          {currentClass && space !== 'zhixue' && space !== 'hub' && space !== 'qbank' && (
            <div className="app-no-drag flex items-center gap-1.5">
              {currentClass.status === 'archived' ? (
                <Button
                  size="xs"
                  variant="primary"
                  onClick={async () => {
                    await window.workbenchApi.classes.setStatus(currentClass.id, 'active');
                    await loadClassData(currentClass.id);
                    notify(`已恢复「${currentClass.name}」为活跃班级`);
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> 恢复活跃
                </Button>
              ) : (
                <>
                  <Button size="xs" variant="ghost" onClick={() => setClassModal('edit')}>
                    <Edit2 className="w-3.5 h-3.5" /> 班级信息
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      await window.workbenchApi.classes.setStatus(currentClass.id, 'archived');
                      await loadClassData(currentClass.id);
                      notify(`已归档「${currentClass.name}」为只读`);
                    }}
                  >
                    <Archive className="w-3.5 h-3.5" /> 归档
                  </Button>
                  <Button
                    size="xs"
                    variant="danger-ghost"
                    title="将班级移入回收站"
                    onClick={() => setDeleteClassTarget(currentClass)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </header>

        {/* Main View Canvas */}
        <div className="flex-1 min-h-0 p-4 overflow-hidden">
          {space === 'hub' ? (
            <AppsHubWorkspace
              currentClass={currentClass}
              pinnedSpaces={pinnedSpaces}
              vaultInfo={vaultInfo}
              onSelectSpace={setSpace}
              onTogglePin={(id) => void handleTogglePinSpace(id)}
              onResetPins={() => void handleResetPinnedSpaces()}
            />
          ) : space === 'qbank' ? (
            <QuestionBankWorkspace
              onVaultStatsChanged={async () => {
                const vInfo = await window.workbenchApi.vault.getInfo();
                setVaultInfo(vInfo);
              }}
              onOpenAiSettings={() => {
                setSettingsTab('ai');
                setSettingsOpen(true);
              }}
              onNotify={notify}
            />
          ) : space === 'zhixue' ? (
            <ZhixueCompanion
              exams={exams}
              overlayBlocked={anyOverlayOpen}
              onOpenAiSettings={() => {
                setSettingsTab('ai');
                setSettingsOpen(true);
              }}
              onNotify={notify}
            />
          ) : !currentClass ? (
            <OnboardingWelcome
              vaultPath={vaultInfo?.path}
              onCreateClass={() => setClassModal('new')}
              onLoadDemo={async () => {
                const demo = await window.workbenchApi.classes.createDemo();
                await loadBootstrap();
                setClassId(demo.id);
                notify('已生成 32 人演示班及 2 场物理考试样例，点击任意同学可看成绩曲线！');
              }}
            />
          ) : space === 'classroom' ? (
            <ClassroomWorkspace
              cls={currentClass}
              teacher={teacher}
              members={activeMembers}
              exams={exams}
              themeId={themeId}
              followUpIds={followUpIds}
              todayFocusMinutes={homeroomSummary?.todayFocusMinutes || 0}
              onHomeroomChanged={() => void loadHomeroomSummary(currentClass.id)}
              onOpenProfile={setProfileMemberId}
              onNotify={notify}
            />
          ) : space === 'roster' ? (
            <RosterWorkspace
              cls={currentClass}
              members={activeMembers}
              allMembers={allMembers}
              followUpIds={followUpIds}
              onRefresh={() => loadClassData(currentClass.id)}
              onOpenProfile={setProfileMemberId}
              onNotify={notify}
            />
          ) : space === 'homeroom' ? (
            <HomeroomWorkspace
              cls={currentClass}
              teacher={teacher}
              members={activeMembers}
              themeId={themeId}
              aiReady={aiReady}
              requestedTab={requestedHomeroomTab}
              onClearRequestedTab={() => setRequestedHomeroomTab(null)}
              onHomeroomChanged={() => void loadHomeroomSummary(currentClass.id)}
              onJumpToClassroom={() => setSpace('classroom')}
              onOpenStudentProfile={setProfileMemberId}
              onOpenAiSettings={() => {
                setSettingsTab('ai');
                setSettingsOpen(true);
              }}
              onNotify={notify}
            />
          ) : (
            <ExamCenter
              cls={currentClass}
              members={activeMembers}
              allMembers={allMembers}
              exams={exams}
              selectedExamId={selectedExamId}
              themeId={themeId}
              onSelectExam={setSelectedExamId}
              onRefreshAll={() => loadClassData(currentClass.id)}
              onOpenStudentProfile={setProfileMemberId}
              onOpenAiSettings={() => {
                setSettingsTab('ai');
                setSettingsOpen(true);
              }}
              onOpenZhixue={() => setSpace('zhixue')}
              onNotify={notify}
            />
          )}
        </div>
      </main>

      {/* Global Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl text-[13px] font-medium shadow-[var(--shadow-lg)] border ${
            toast.tone === 'err'
              ? 'bg-[var(--danger)] text-white border-[var(--danger)]'
              : 'bg-[var(--toast-bg)] text-[var(--toast-ink)] border-transparent'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Global Cmd+K Launcher */}
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        classes={classes}
        currentClassId={currentClass?.id || ''}
        members={activeMembers}
        exams={exams}
        memos={homeroomMemos}
        themeId={themeId}
        onSelectClass={(id) => {
          setClassId(id);
          setSelectedExamId('');
        }}
        onSelectSpace={setSpace}
        onSelectHomeroomTab={setRequestedHomeroomTab}
        onSelectStudent={setProfileMemberId}
        onSelectExam={(eid) => setSelectedExamId(eid)}
        onSelectTheme={(id) => void handleChangeTheme(id)}
        onOpenSettings={() => {
          setSettingsTab('theme');
          setSettingsOpen(true);
        }}
        onOpenTrash={() => setTrashOpen(true)}
      />

      {/* Student立体成长档案抽屉 */}
      <StudentProfileDrawer
        membershipId={profileMemberId}
        themeId={themeId}
        readonly={currentClass?.status === 'archived'}
        onClose={() => setProfileMemberId(null)}
        onEditStudent={() => setSpace('roster')}
        onJumpToExam={(eid) => {
          setSelectedExamId(eid);
          setSpace('exams');
        }}
        onHomeroomChanged={() => {
          if (currentClass) void loadHomeroomSummary(currentClass.id);
        }}
        onNotify={notify}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={(o) => {
          setSettingsOpen(o);
          if (!o) {
            window.workbenchApi.ai.getConfig().then((c) => setAiReady(c.general.ready || c.vision.ready));
          }
        }}
        initialTab={settingsTab}
        themeId={themeId}
        vaultInfo={vaultInfo}
        updateState={updateState}
        onChangeTheme={(id) => void handleChangeTheme(id)}
        onVaultChanged={async (nextInfo) => {
          setVaultInfo(nextInfo);
          setClassId('');
          setSelectedExamId('');
          await loadBootstrap();
        }}
        onNotify={notify}
      />

      {/* Trash Modal */}
      <TrashModal
        open={trashOpen}
        onOpenChange={setTrashOpen}
        onChanged={async () => {
          await loadBootstrap();
          if (currentClass) await loadClassData(currentClass.id);
        }}
        onNotify={notify}
      />

      {/* Class & Teacher Modals */}
      <ClassAndTeacherModals
        classModal={classModal}
        onClassModalChange={setClassModal}
        currentClass={currentClass}
        onClassCreated={async (createdId) => {
          await loadBootstrap();
          setClassId(createdId);
          setSpace('classroom');
        }}
        onClassUpdated={async (cid) => {
          await loadClassData(cid);
        }}
        teacherOpen={teacherOpen}
        onTeacherOpenChange={setTeacherOpen}
        teacher={teacher}
        onTeacherSaved={setTeacher}
        onNotify={notify}
      />

      <ConfirmDialog
        open={Boolean(deleteClassTarget)}
        onOpenChange={(o) => !o && setDeleteClassTarget(null)}
        title="移入回收站"
        description={`将班级「${deleteClassTarget?.name || ''}」移入回收站？随时可在左下角「回收站」一键恢复。`}
        confirmLabel="移入回收站"
        danger
        onConfirm={async () => {
          if (!deleteClassTarget) return;
          await window.workbenchApi.classes.softDelete(deleteClassTarget.id);
          setDeleteClassTarget(null);
          setClassId('');
          await loadBootstrap();
          notify('班级已移入回收站');
        }}
      />
    </div>
  );
}
