import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { WorkbenchStore } from './store';
import { AssistantConnection } from '../modules/assistant/provider';
import { AssistantSettings } from '../ui/AssistantSettings';
import { activeMembers, assertEditable, copy, id, type Membership, type SeatPlan, type Snapshot } from './model';
import { addClass, addDemo, saveStudent, setMembershipStatus } from '../modules/roster';
import { applyImport } from '../modules/roster/import';
import { exchange, move, newPlan, resize, sequential, waiting } from '../modules/seating';
import { downloadBackup } from '../modules/backup';
import { ArtRegistry, Avatar } from '../scene/Art';
import { Modal } from '../ui/Modal';
import { ClassForm } from '../ui/ClassForm';
import { StudentForm } from '../ui/StudentForm';
import { StudentProfile } from '../ui/StudentProfile';
import { ToolbarMenu } from '../ui/ToolbarMenu';
import { ImportDialog } from '../ui/ImportDialog';
import { TeacherForm } from '../ui/TeacherForm';
import { BackupDialog } from '../ui/BackupDialog';
import { Sidebar, type TabId } from '../ui/Sidebar';
import { ClassroomView } from '../ui/ClassroomView';
import { RosterView } from '../ui/RosterView';
import { GradebookCenter } from '../ui/gradebook/GradebookCenter';
import { GradingCenter } from '../ui/grading/GradingCenter';
import { Badge } from '../ui/Primitives';
import { Icon } from '../ui/Icons';

const defaultStore = new WorkbenchStore();

type ModalState =
  | null | 'class' | 'class-edit' | 'student' | 'profile' | 'import' | 'teacher'
  | 'assistant' | 'backup' | 'plan-new' | 'plan-copy' | 'plan-rename'
  | 'reload' | 'session' | 'archive' | 'remove';

function readRoute(): { classId: string; tab: TabId } {
  try {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const t = p.get('t') as TabId | null;
    return {
      classId: p.get('c') || '',
      tab: t && ['classroom', 'roster', 'gradebook', 'grading'].includes(t) ? t : 'classroom',
    };
  } catch {
    return { classId: '', tab: 'classroom' };
  }
}

export function App({ store = defaultStore }: { store?: WorkbenchStore }) {
  const [assistantConnection] = useState(() => new AssistantConnection());
  const [assistantRev, setAssistantRev] = useState(0);
  const [assistantTab, setAssistantTab] = useState<'general' | 'grading'>('general');
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const s = state.snapshot;

  const route = useMemo(() => readRoute(), []);
  const [classId, setClassId] = useState(route.classId);
  const [planId, setPlanId] = useState('');
  const [tab, setTab] = useState<TabId>(route.tab);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissedGuide, setDismissedGuide] = useState(false);

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ plan: SeatPlan; label: string } | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [returnToProfile, setReturnToProfile] = useState(false);
  const [editingMember, setEditingMember] = useState<Membership | undefined>();
  const [planName, setPlanName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const init = useRef(false);
  useEffect(() => {
    if (!init.current) { init.current = true; void store.load(); }
  }, [store]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const x = store.getState();
      if (x.snapshot?.data.classes.length && ['unsaved', 'saving', 'conflict'].includes(x.status)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [store]);

  const current =
    s?.data.classes.find((c) => c.id === classId) ||
    s?.data.classes.find((c) => c.status === 'active') ||
    s?.data.classes[0];
  const plans = s?.data.seatPlans.filter((p) => p.classId === current?.id) || [];
  const plan = plans.find((p) => p.id === planId) || plans[0];
  const archived = current?.status === 'archived';
  const members = useMemo(() => (s && current ? activeMembers(s, current.id) : []), [s, current]);
  const pending = useMemo(() => (plan ? waiting(plan, members) : members), [plan, members]);
  const studentMap = useMemo(() => new Map(s?.data.students.map((x) => [x.id, x])), [s]);

  const counts = useMemo(
    () => ({
      members: members.length,
      gradebook: s && current ? s.data.gradebook.imports.filter((x) => x.classId === current.id).length : 0,
      grading: s && current ? s.data.grading.exams.filter((x) => x.classId === current.id).length : 0,
    }),
    [s, current, members.length],
  );

  // Sync URL hash so refresh keeps the current class and view
  useEffect(() => {
    if (!current) return;
    try {
      const hash = `#c=${encodeURIComponent(current.id)}&t=${tab}`;
      if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    } catch {}
  }, [current, tab]);

  useEffect(() => {
    setUndo(null);
    setSelected(null);
    setEditing(false);
  }, [current?.id, plan?.id]);

  useEffect(() => {
    if (!editing || !selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, selected]);

  const closeModal = () => {
    if (state.busy) return;
    setModal(null);
    setReturnToProfile(false);
    setError('');
  };

  async function action(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }

  async function changePlan(transform: (p: SeatPlan, snapshot: Snapshot) => SeatPlan, label = '排座') {
    if (!plan) return;
    let before: SeatPlan | null = null;
    const changed = await store.edit((next) => {
      assertEditable(next, plan.classId);
      const index = next.data.seatPlans.findIndex((p) => p.id === plan.id);
      before = copy(next.data.seatPlans[index]);
      next.data.seatPlans[index] = transform(next.data.seatPlans[index], next);
    });
    if (changed && before) setUndo({ plan: before, label });
  }

  function selectSeat(memberId: string | null, row: number, col: number) {
    if (state.busy || archived) return;
    if (selected && selected !== memberId) {
      const a = studentMap.get(members.find((m) => m.id === selected)?.studentId || '')?.name;
      const b = memberId ? studentMap.get(members.find((m) => m.id === memberId)?.studentId || '')?.name : '';
      void action(async () => {
        await changePlan((p, next) => move(p, activeMembers(next, p.classId), selected, { row, col }), b ? `互换 ${a} 与 ${b}` : `移动 ${a || '学生'}`);
        setSelected(null);
      });
    } else setSelected(memberId === selected ? null : memberId);
  }

  async function exportCurrent() {
    const cur = store.getState();
    if (cur.snapshot) {
      await downloadBackup(cur.snapshot, cur.files);
      setNotice('备份文件已开始下载，请在浏览器下载列表中确认保存。');
    }
  }

  const aiReady = useMemo(() => {
    const v = assistantConnection.view(), gv = assistantConnection.gradingView();
    return v.hasKey || gv.vision.ready || gv.judge.ready;
  }, [assistantConnection, assistantRev]);
  const showGuide = !!current && !archived && !dismissedGuide && !editing && tab !== 'gradebook' && tab !== 'grading' && (members.length === 0 || (plan?.assignments.length || 0) === 0);

  return (
    <>
      <ArtRegistry />
      {modal === 'assistant' && (
        <AssistantSettings
          connection={assistantConnection}
          initialTab={assistantTab}
          close={() => { setAssistantRev((n) => n + 1); setAssistantTab('general'); setModal(null); }}
        />
      )}

      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        <Sidebar
          snapshot={s}
          current={current}
          tab={tab}
          status={state.status}
          busy={state.busy}
          collapsed={collapsed}
          aiReady={aiReady}
          counts={counts}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          onSelectClass={(cid) => { setClassId(cid); setPlanId(''); }}
          onSelectTab={(t) => { setTab(t); setEditing(false); }}
          onOpenModal={(m) => setModal(m)}
        />

        <main className={`main ${current && tab === 'classroom' ? `has-classroom ${editing ? 'seating-layout' : ''}` : ''}`}>
          <div className="notices">
            {state.message && (state.status !== 'saved' || state.message.includes('恢复未应用')) && (
              <div className={`alert ${['conflict', 'load-error'].includes(state.status) ? 'tone-danger' : 'tone-warning'}`} role="status">
                <Icon name="alert" size={16} />
                <span className="spacer">{state.message}</span>
                <div className="row">
                  {state.status === 'load-error' ? (
                    <>
                      <button disabled={state.busy} onClick={() => void store.load()}>重试读取</button>
                      <button onClick={() => setModal('backup')}>备份恢复</button>
                      <button onClick={() => setModal('session')}>临时会话</button>
                    </>
                  ) : state.status === 'conflict' ? (
                    <>
                      <button className="primary" onClick={() => void action(exportCurrent)}>先导出本页防丢</button>
                      <button onClick={() => setModal('reload')}>同步最新数据</button>
                    </>
                  ) : state.status === 'unsaved' && state.level === 'browser' && s?.data.classes.length ? (
                    <>
                      <button className="primary" disabled={state.busy} onClick={() => void action(store.retry)}>重试保存</button>
                      <button onClick={() => void action(exportCurrent)}>导出备份</button>
                    </>
                  ) : null}
                </div>
              </div>
            )}
            {error && (
              <div role="alert" className="alert tone-danger">
                <Icon name="alert" size={16} /><span className="spacer">{error}</span>
                <button type="button" className="sm" onClick={() => setError('')} aria-label="关闭错误提示">关闭</button>
              </div>
            )}
            {notice && (
              <div role="status" className="alert tone-success">
                <Icon name="checkCircle" size={16} /><span className="spacer">{notice}</span>
                <button type="button" className="sm" onClick={() => setNotice('')}>知道了</button>
              </div>
            )}
          </div>

          {!s ? (
            <section className="welcome card">
              <h1>{state.status === 'loading' ? '正在打开教师工作台…' : '本地数据暂时无法读取'}</h1>
              <p className="muted" style={{ margin: '10px 0 18px' }}>
                {state.status === 'loading' ? '请稍候，正在读取您保存在当前浏览器中的资料。' : '放心，原资料未被覆盖。请重试读取或从备份恢复。'}
              </p>
              {state.status !== 'loading' && (
                <div className="row center">
                  <button className="primary" onClick={() => void store.load()}>重试读取</button>
                  <button onClick={() => setModal('backup')}>备份与恢复</button>
                  <button onClick={() => setModal('session')}>临时会话</button>
                </div>
              )}
            </section>
          ) : !current ? (
            <section className="welcome">
              <div className="row center" style={{ marginBottom: 10 }} aria-hidden="true">
                <Avatar gender="male" characterId="hashira-03" size={88} />
                <Avatar gender="female" characterId="hashira-06" size={88} />
              </div>
              <h1>欢迎来到 cyz 的教师工作台</h1>
              <p className="muted" style={{ maxWidth: 520, margin: '8px auto 24px' }}>
                单文件离线运行的班级助手：花名册、互动排座、Excel 成绩分析与手写答卷讲评，数据全留在本机。
              </p>
              <div className="grid-2">
                <button type="button" className="choice-card primary-choice" onClick={() => setModal('class')}>
                  <span className="choice-ico"><Icon name="plus" size={20} /></span>
                  <strong>创建我的第一个班级</strong>
                  <span>输入班名即可开始粘贴名单和排座</span>
                </button>
                <button
                  type="button"
                  className="choice-card"
                  onClick={() => void action(async () => {
                    let created = '';
                    await store.edit((next) => { created = addDemo(next); });
                    setClassId(created);
                    setNotice('已创建 46 人虚构演示班，可随意体验排座和换形象！');
                  })}
                >
                  <span className="choice-ico"><Icon name="classroom" size={20} /></span>
                  <strong>先逛逛演示班级（推荐新手）</strong>
                  <span>一键载入虚构示例班，零负担试玩全部功能</span>
                </button>
              </div>
              <div className="soft-card row center" style={{ marginTop: 18 }}>
                <Icon name="shield" size={15} />
                <span className="muted">换电脑或已有备份？</span>
                <button type="button" className="text-btn" onClick={() => setModal('backup')}>从备份文件恢复工作区</button>
              </div>
            </section>
          ) : (
            <>
              <div className="topbar row between">
                <div className="row">
                  <h1>{current.name}</h1>
                  {!editing && <span className="tip">{[current.school, current.termLabel, `${members.length} 人`].filter(Boolean).join(' · ')}</span>}
                  {archived && <Badge tone="warning">已归档 · 只读</Badge>}
                  {editing && <Badge tone="success">正在排座</Badge>}
                </div>
                {archived ? (
                  <button
                    type="button"
                    className="primary sm"
                    disabled={state.busy}
                    onClick={() => void action(async () => {
                      await store.edit((next) => { next.data.classes.find((x) => x.id === current.id)!.status = 'active'; });
                      setNotice(`已恢复「${current.name}」为活跃班级。`);
                    })}
                  >
                    恢复为活跃班级
                  </button>
                ) : (
                  <ToolbarMenu label="班级管理" icon={<Icon name="settings" size={14} />}>
                    <div className="menu-pop">
                      <button type="button" onClick={() => setModal('class-edit')} disabled={state.busy}><Icon name="edit" size={14} />修改班级信息</button>
                      <button type="button" onClick={() => setModal('class')} disabled={state.busy}><Icon name="plus" size={14} />新建其他班级</button>
                      <button type="button" className="danger-item" disabled={state.busy} onClick={() => setModal('archive')}><Icon name="archive" size={14} />归档本班</button>
                    </div>
                  </ToolbarMenu>
                )}
              </div>

              {showGuide && (
                <div className="bar guide-bar" role="region" aria-label="开班快速引导">
                  <div className="row">
                    <strong style={{ fontSize: 12.5, color: 'var(--accent)' }}>新班起步</strong>
                    <button type="button" className={`pill ${members.length ? 'done' : 'active'}`} onClick={() => setModal('import')}>
                      {members.length ? <Icon name="check" size={13} /> : '1.'} {members.length ? `已录入 ${members.length} 人` : '导入学生名单'}
                    </button>
                    <span className="muted">→</span>
                    <button
                      type="button"
                      className={`pill ${(plan?.assignments.length || 0) ? 'done' : members.length ? 'active' : ''}`}
                      disabled={!members.length || !plan}
                      onClick={() => {
                        setTab('classroom');
                        void action(async () => {
                          await changePlan((p, next) => sequential(p, activeMembers(next, p.classId)), '按名单排座');
                          setNotice('已按名单顺序排好全班座位！');
                        });
                      }}
                    >
                      {(plan?.assignments.length || 0) ? <Icon name="check" size={13} /> : '2.'} 一键排座
                    </button>
                    <span className="muted">→</span>
                    <button type="button" className={`pill ${counts.gradebook ? 'done' : ''}`} onClick={() => setTab('gradebook')}>
                      {counts.gradebook ? <Icon name="check" size={13} /> : '3.'} 导入成绩单
                    </button>
                  </div>
                  <button type="button" className="ghost" aria-label="收起引导" onClick={() => setDismissedGuide(true)}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}

              {tab === 'gradebook' ? (
                <GradebookCenter
                  connection={assistantConnection}
                  openSettings={() => setModal('assistant')}
                  key={current.id + s.workspace.id + (state.stamp?.epoch || '')}
                  store={store}
                  state={state}
                  classId={current.id}
                />
              ) : tab === 'grading' ? (
                <GradingCenter
                  key={`${s.workspace.id}:${state.stamp?.epoch || 'new'}:${current.id}`}
                  store={store}
                  state={state}
                  classId={current.id}
                  connection={assistantConnection}
                  openSettings={(nextTab) => { setAssistantTab(nextTab || 'grading'); setModal('assistant'); }}
                />
              ) : tab === 'roster' ? (
                <RosterView
                  snapshot={s}
                  classId={current.id}
                  members={members}
                  studentMap={studentMap}
                  plan={plan}
                  archived={!!archived}
                  busy={state.busy}
                  onProfile={(m) => { setEditingMember(m); setModal('profile'); }}
                  onEdit={(m) => { setEditingMember(m); setModal('student'); }}
                  onAdd={() => { setEditingMember(undefined); setModal('student'); }}
                  onImport={() => setModal('import')}
                  onRemove={(m) => { setEditingMember(m); setModal('remove'); }}
                  onRestore={(m, name) => void action(async () => {
                    await store.edit((next) => setMembershipStatus(next, m.id, 'active'));
                    setUndo(null);
                    setNotice(`已恢复「${name}」到在读名单。`);
                  })}
                />
              ) : (
                <ClassroomView
                  snapshot={s}
                  plans={plans}
                  plan={plan}
                  members={members}
                  pending={pending}
                  studentMap={studentMap}
                  archived={!!archived}
                  busy={state.busy}
                  editing={editing}
                  selected={selected}
                  undoLabel={undo?.label || null}
                  onSelectPlan={(pid) => { setPlanId(pid); setUndo(null); }}
                  onPlanModal={(m, name) => { setPlanName(name); setModal(m); }}
                  onToggleEditing={(next) => { setEditing(next); setSelected(null); }}
                  onSelectSeat={selectSeat}
                  onSelectMember={setSelected}
                  onDropSeat={(memberId, row, col) => {
                    if (state.busy || archived) return;
                    const name = studentMap.get(members.find((m) => m.id === memberId)?.studentId || '')?.name;
                    void action(async () => {
                      await changePlan((p, next) => move(p, activeMembers(next, p.classId), memberId, { row, col }), `拖动 ${name || '学生'}`);
                      setSelected(null);
                    });
                  }}
                  onProfile={(mid) => { setEditingMember(members.find((m) => m.id === mid)); setModal('profile'); }}
                  onResize={(r, c) => void action(() => changePlan((p, next) => resize(p, activeMembers(next, p.classId), r, c), `${r}行×${c}列`))}
                  onSequential={() => void action(() => changePlan((p, next) => sequential(p, activeMembers(next, p.classId)), '顺序排座'))}
                  onUndo={() => void action(async () => {
                    if (!undo) return;
                    const prev = undo.plan;
                    await store.edit((next) => {
                      assertEditable(next, prev.classId);
                      const idx = next.data.seatPlans.findIndex((x) => x.id === prev.id);
                      next.data.seatPlans[idx] = copy(prev);
                    });
                    setNotice(`已撤销：${undo.label}`);
                    setUndo(null);
                    setSelected(null);
                  })}
                  onSwap={(a, b) => void action(async () => {
                    await changePlan((p, next) => exchange(p, activeMembers(next, p.classId), a, b), '互换两人');
                    setSelected(null);
                  })}
                  onUnseat={(mid) => void action(async () => {
                    await changePlan((p, next) => move(p, activeMembers(next, p.classId), mid, null), '移出座位');
                    setSelected(null);
                  })}
                  onNotify={setNotice}
                />
              )}
            </>
          )}
        </main>
      </div>

      {modal && modal !== 'assistant' && (
        <Modal
          key={modal}
          title={{
            class: '新建班级', 'class-edit': '修改班级信息', student: editingMember ? '编辑学生与形象' : '添加学生',
            profile: '学生档案', import: '批量导入学生名单', teacher: '教师资料与形象设置', backup: '数据备份与恢复中心',
            'plan-new': '新建座位方案', 'plan-copy': '复制当前方案', 'plan-rename': '重命名座位方案',
            reload: '同步最新数据', session: '进入临时会话', archive: '归档班级', remove: '移出本班名单',
          }[modal]}
          wide={['import', 'student', 'teacher'].includes(modal)}
          drawer={modal === 'backup' || modal === 'profile'}
          onClose={closeModal}
        >
          {(modal === 'class' || modal === 'class-edit') && s && (
            <ClassForm
              snapshot={s}
              current={modal === 'class-edit' ? current : undefined}
              submit={async (name, school, term) => {
                let created = '';
                await store.edit((next) => {
                  if (modal === 'class-edit' && current) {
                    assertEditable(next, current.id);
                    Object.assign(next.data.classes.find((c) => c.id === current.id)!, { name: name.trim(), school: school.trim(), termLabel: term.trim() });
                  } else created = addClass(next, name, school, term);
                });
                if (created) { setClassId(created); setDismissedGuide(false); }
                setModal(null);
              }}
            />
          )}
          {modal === 'profile' && s && editingMember && (
            <StudentProfile
              snapshot={s}
              member={s.data.memberships.find((m) => m.id === editingMember.id)!}
              plan={plan}
              readOnly={!!archived}
              disabled={state.busy}
              onEdit={() => { setReturnToProfile(true); setModal('student'); }}
            />
          )}
          {modal === 'student' && s && current && (
            <StudentForm
              snapshot={s}
              classId={current.id}
              member={editingMember}
              cancel={() => (returnToProfile ? setModal('profile') : closeModal())}
              submit={async (input) => {
                await store.edit((next) => { saveStudent(next, current.id, input, editingMember?.id); });
                setModal(returnToProfile ? 'profile' : null);
                setReturnToProfile(false);
              }}
            />
          )}
          {modal === 'import' && current && (
            <ImportDialog
              store={store}
              classId={current.id}
              submit={async (preview, excluded, updates) => {
                await store.edit((next, token) => applyImport(next, preview, token, excluded, updates));
                setUndo(null); setSelected(null); setModal(null);
                setNotice('名单已导入！进入「教室与排座」可一键按名单排座。');
              }}
            />
          )}
          {modal === 'teacher' && s && (
            <TeacherForm
              teacher={s.data.settings.teacher}
              submit={async (t) => { await store.edit((next) => { next.data.settings.teacher = t; }); setModal(null); }}
            />
          )}
          {modal === 'backup' && (
            <BackupDialog
              store={store}
              notify={setNotice}
              done={() => {
                setUndo(null); setSelected(null); setClassId(''); setPlanId(''); setModal(null);
                setNotice('已成功恢复备份！如需反悔，可在「备份与恢复」中一键回到替换前状态。');
              }}
            />
          )}
          {['plan-new', 'plan-copy', 'plan-rename'].includes(modal) && current && (
            <form onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                let nextId = plan?.id;
                await store.edit((next) => {
                  assertEditable(next, current.id);
                  if (modal === 'plan-rename') next.data.seatPlans.find((p) => p.id === plan?.id)!.name = planName.trim();
                  else {
                    const np = modal === 'plan-copy' && plan ? { ...copy(plan), id: id(), name: planName.trim() } : newPlan(current.id, planName.trim());
                    next.data.seatPlans.push(np);
                    nextId = np.id;
                  }
                });
                setPlanId(nextId || ''); setUndo(null); setModal(null);
              });
            }}>
              <label>方案名称<input required autoFocus maxLength={120} value={planName} onChange={(e) => setPlanName(e.target.value)} /></label>
              <div className="dialog-actions">
                <button type="button" onClick={closeModal}>取消</button>
                <button className="primary" disabled={state.busy}>保存方案</button>
              </div>
            </form>
          )}
          {modal === 'archive' && current && (
            <>
              <p>归档「<strong>{current.name}</strong>」后，资料完整保留但变为只读，随时可一键恢复。</p>
              <div className="dialog-actions">
                <button type="button" onClick={closeModal}>取消</button>
                <button type="button" className="primary" onClick={() => void action(async () => {
                  await store.edit((next) => { next.data.classes.find((c) => c.id === current.id)!.status = 'archived'; });
                  setEditing(false); setUndo(null); setModal(null);
                })}>确认归档</button>
              </div>
            </>
          )}
          {modal === 'remove' && editingMember && (
            <>
              <p>将「<strong>{studentMap.get(editingMember.studentId)?.name}</strong>」移出在读名单并清空座位；档案和成绩保留，随时可在「已移出」恢复。</p>
              <div className="dialog-actions">
                <button type="button" onClick={closeModal}>取消</button>
                <button type="button" className="danger" onClick={() => void action(async () => {
                  await store.edit((next) => setMembershipStatus(next, editingMember.id, 'removed'));
                  setUndo(null); setSelected(null); setModal(null);
                })}>确认移出</button>
              </div>
            </>
          )}
          {modal === 'reload' && (
            <>
              <p>同步最新数据会替换当前窗口画面，建议先导出一份备份再同步。</p>
              <div style={{ margin: '12px 0' }}><button type="button" onClick={() => void action(exportCurrent)}>先导出当前内容</button></div>
              <div className="dialog-actions">
                <button type="button" onClick={closeModal}>取消</button>
                <button type="button" className="primary" onClick={() => void action(async () => {
                  await store.load(); setUndo(null); setSelected(null); setModal(null);
                })}>确认同步</button>
              </div>
            </>
          )}
          {modal === 'session' && (
            <>
              <p>临时会话不改动原缓存，关闭页面前请务必导出备份文件。</p>
              <div className="dialog-actions">
                <button type="button" onClick={closeModal}>取消</button>
                <button type="button" className="primary" onClick={() => void action(async () => { await store.startSession(); setModal(null); })}>进入临时会话</button>
              </div>
            </>
          )}
          {error && <div role="alert" className="alert tone-danger" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}
    </>
  );
}
