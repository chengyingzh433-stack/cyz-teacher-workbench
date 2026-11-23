import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type {
  ClassRecord,
  ExamSummary,
  Gender,
  HomeroomDashboardSummary,
  HomeroomMemo,
  StudentMember,
  TeacherProfile,
  VaultInfo,
} from '../shared/types';
import { characterPool } from '../shared/characters';
import { localTodayStr } from '../shared/homeroom-materials';
import { applyThemeToDocument, getQuickToggleThemeId } from './themes';
import { ArtRegistry, Avatar } from './features/classroom/SpriteArt';
import { ClassroomWorkspace } from './features/classroom/ClassroomWorkspace';
import { StudentProfileDrawer } from './features/classroom/StudentProfileDrawer';
import { RosterWorkspace } from './features/roster/RosterWorkspace';
import { ExamCenter } from './features/exams/ExamCenter';
import {
  HomeroomWorkspace,
  type HomeroomSubTab,
} from './features/homeroom/HomeroomWorkspace';
import { ZhixueCompanion } from './features/zhixue/ZhixueCompanion';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { TrashModal } from './components/TrashModal';
import { CommandPalette } from './components/ui/CommandPalette';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
} from './components/ui/primitives';

export type NavSpace = 'classroom' | 'roster' | 'exams' | 'homeroom' | 'zhixue';

export function App() {
  const isMac = window.workbenchApi.platform === 'darwin';

  const [ready, setReady] = useState(false);
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [themeId, setThemeId] = useState('studio-light');
  const [collapsed, setCollapsed] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [trashCount, setTrashCount] = useState(0);

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
  const [tName, setTName] = useState('');
  const [tGender, setTGender] = useState<Gender>('unspecified');
  const [tCharId, setTCharId] = useState<string | null>(null);

  const [classModal, setClassModal] = useState<'new' | 'edit' | null>(null);
  const [cName, setCName] = useState('');
  const [cSchool, setCSchool] = useState('');
  const [cTerm, setCTerm] = useState('');
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

  function openClassForm(mode: 'new' | 'edit') {
    if (mode === 'edit' && currentClass) {
      setCName(currentClass.name);
      setCSchool(currentClass.school);
      setCTerm(currentClass.termLabel);
    } else {
      setCName('');
      setCSchool('');
      setCTerm('2026-2027 上学期');
    }
    setClassModal(mode);
  }

  function openTeacherForm() {
    setTName(teacher.name);
    setTGender(teacher.gender);
    setTCharId(teacher.characterId);
    setTeacherOpen(true);
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
        themeId={themeId}
        aiReady={aiReady}
        trashCount={trashCount}
        homeroomBadge={
          homeroomSummary
            ? homeroomSummary.todayTodoCount + homeroomSummary.pendingFollowUpCount || undefined
            : undefined
        }
        vaultInfo={vaultInfo}
        onToggleCollapse={() => void handleToggleCollapse()}
        onOpenTeacher={openTeacherForm}
        onSelectClass={(id) => {
          setClassId(id);
          setSelectedExamId('');
        }}
        onCreateClass={() => openClassForm('new')}
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
            {space === 'zhixue' ? (
              <>
                <h1 className="text-[16px] font-bold truncate">智学网 / 网阅伴侣</h1>
                <Badge tone="accent">原生内嵌视口</Badge>
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

          {currentClass && space !== 'zhixue' && (
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
                  <Button size="xs" variant="ghost" onClick={() => openClassForm('edit')}>
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
          {space === 'zhixue' ? (
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
            /* Refined Studio Welcome Onboarding */
            <div className="h-full flex items-center justify-center overflow-y-auto">
              <div className="max-w-2xl w-full text-center flex flex-col items-center gap-5 py-8">
                <div className="flex items-center gap-4">
                  <Avatar gender="male" characterId="hashira-03" size={84} />
                  <Avatar gender="female" characterId="hashira-06" size={84} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">cyz 的教师工作台 · 桌面版</h2>
                  <p className="text-sm text-[var(--ink-muted)] mt-2 max-w-lg mx-auto leading-relaxed">
                    自适应矢量像素教室、学生成长档案曲线、Excel 成绩分析图表、手写答卷 AI 批阅与内置智学网伴侣——全部存于你的本机资料库文件夹。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
                  <button
                    type="button"
                    onClick={() => openClassForm('new')}
                    className="p-5 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)]/50 hover:bg-[var(--accent-soft)] text-left transition-all cursor-pointer flex flex-col gap-2"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="text-[15px] font-semibold">创建我的第一个班级</div>
                    <div className="text-xs text-[var(--ink-secondary)]">
                      输入班名，立即导入花名册、排座与管理考试
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const demo = await window.workbenchApi.classes.createDemo();
                      await loadBootstrap();
                      setClassId(demo.id);
                      notify('已生成 32 人演示班及 2 场物理考试样例，点击任意同学可看成绩曲线！');
                    }}
                    className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent)] text-left transition-all cursor-pointer flex flex-col gap-2 shadow-[var(--shadow-sm)]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[var(--bg-muted)] text-[var(--accent)] flex items-center justify-center">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="text-[15px] font-semibold">一键载入演示班级（推荐体验）</div>
                    <div className="text-xs text-[var(--ink-secondary)]">
                      内置 32 人矢量像素教室 + 2 场物理成绩单，即刻试玩全部图表与智能排座
                    </div>
                  </button>
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  当前资料库：<code>{vaultInfo?.path}</code>
                </div>
              </div>
            </div>
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

      {/* Class Create / Edit Modal */}
      <Modal
        open={Boolean(classModal)}
        onOpenChange={(o) => !o && setClassModal(null)}
        title={classModal === 'edit' ? '修改班级信息' : '新建班级'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setClassModal(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!cName.trim()}
              onClick={async () => {
                try {
                  if (classModal === 'edit' && currentClass) {
                    await window.workbenchApi.classes.update(currentClass.id, {
                      name: cName,
                      school: cSchool,
                      termLabel: cTerm,
                    });
                    await loadClassData(currentClass.id);
                    notify('已更新班级信息');
                  } else {
                    const created = await window.workbenchApi.classes.create({
                      name: cName,
                      school: cSchool,
                      termLabel: cTerm,
                    });
                    await loadBootstrap();
                    setClassId(created.id);
                    setSpace('classroom');
                    notify(`已创建班级「${created.name}」`);
                  }
                  setClassModal(null);
                } catch (e) {
                  notify((e as Error).message, 'err');
                }
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            班级名称 *
            <Input autoFocus value={cName} onChange={(e) => setCName(e.target.value)} placeholder="如：高二（5）班" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            学校（可选）
            <Input value={cSchool} onChange={(e) => setCSchool(e.target.value)} placeholder="如：实验中学" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            学期（可选）
            <Input value={cTerm} onChange={(e) => setCTerm(e.target.value)} placeholder="如：2026-2027 上学期" />
          </label>
        </div>
      </Modal>

      {/* Teacher Profile Modal */}
      <Modal
        open={teacherOpen}
        onOpenChange={setTeacherOpen}
        title="教师称呼与讲台像素形象"
        size="md"
        footer={
          <>
            <Button onClick={() => setTeacherOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const saved = await window.workbenchApi.teacher.save({
                  name: tName,
                  gender: tGender,
                  characterId: tGender === 'unspecified' ? null : tCharId,
                });
                setTeacher(saved);
                setTeacherOpen(false);
                notify('已更新教师形象与称呼');
              }}
            >
              保存设置
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              教师称呼
              <Input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="如：陈老师 / cyz" />
            </label>
            <div className="flex flex-col gap-1 text-[13px] font-medium">
              讲台角色性别
              <Select
                value={tGender}
                onValueChange={(v) => {
                  const g = v as Gender;
                  setTGender(g);
                  if (g === 'unspecified') setTCharId(null);
                  else {
                    const p = characterPool(g);
                    if (!p.some((c) => c.id === tCharId)) setTCharId(p[0]?.id || null);
                  }
                }}
                className="w-full h-9"
                options={[
                  { value: 'male', label: '男教师角色' },
                  { value: 'female', label: '女教师角色' },
                  { value: 'unspecified', label: '不设形象' },
                ]}
              />
            </div>
          </div>
          {tGender !== 'unspecified' && (
            <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-1">
              {characterPool(tGender).map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setTCharId(ch.id)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border cursor-pointer ${
                    tCharId === ch.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Avatar gender={tGender} characterId={ch.id} size={46} />
                  <span className="text-[11px] font-medium text-center">{ch.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

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
