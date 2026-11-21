import type { ClassRecord, Snapshot } from '../app/model';
import type { SaveState } from '../app/store';
import { Avatar } from '../scene/Art';
import { Icon, type IconName } from './Icons';

export type TabId = 'classroom' | 'roster' | 'gradebook' | 'grading';

const SAVE_LABELS: Record<SaveState, string> = {
  loading: '正在打开…',
  saved: '已自动保存',
  saving: '正在保存…',
  unsaved: '有未保存的改动',
  conflict: '其他窗口已更新',
  'load-error': '数据无法读取',
};

const SAVE_TITLES: Record<SaveState, string> = {
  loading: '正在读取本机浏览器数据',
  saved: '已自动保存在当前浏览器；换电脑或升级请导出备份',
  saving: '正在写入本机浏览器',
  unsaved: '当前修改暂未持久保存，点击查看或导出备份',
  conflict: '其他窗口已更新数据，请先导出本页再同步',
  'load-error': '无法读取本地缓存，原数据未覆盖，请重试或从备份恢复',
};

export function Sidebar({
  snapshot: s,
  current,
  tab,
  status,
  busy,
  collapsed,
  aiReady,
  counts,
  onToggleCollapse,
  onSelectClass,
  onSelectTab,
  onOpenModal,
}: {
  snapshot: Snapshot | null;
  current?: ClassRecord;
  tab: TabId;
  status: SaveState;
  busy: boolean;
  collapsed: boolean;
  aiReady: boolean;
  counts: { members: number; gradebook: number; grading: number };
  onToggleCollapse: () => void;
  onSelectClass: (id: string) => void;
  onSelectTab: (tab: TabId) => void;
  onOpenModal: (m: 'teacher' | 'class' | 'backup' | 'assistant') => void;
}) {
  const teacher = s?.data.settings.teacher;
  const nav: { id: TabId; label: string; hint: string; icon: IconName; count?: number }[] = [
    { id: 'classroom', label: '教室与排座', hint: '互动教室 · 调换座位', icon: 'classroom' },
    { id: 'roster', label: '学生花名册', hint: '名单管理 · 角色形象', icon: 'users', count: counts.members },
    { id: 'gradebook', label: '成绩册分析', hint: 'Excel / CSV 统计', icon: 'chart', count: counts.gradebook },
    { id: 'grading', label: '答卷阅卷与讲评', hint: '手写照片 · 逐点打分', icon: 'clipboard', count: counts.grading },
  ];

  return (
    <aside className="sidebar" aria-label="工作台导航">
      <div className="sidebar-brand">
        <button
          type="button"
          className="teacher-card"
          aria-label={`教师头像：${teacher?.name || '未设置'}，打开教师设置`}
          disabled={!s || busy || status === 'load-error'}
          onClick={() => onOpenModal('teacher')}
          data-character-id={teacher?.characterId || ''}
          title="修改教师称呼与像素形象"
        >
          <span className="teacher-avatar-wrap">
            <Avatar gender={teacher?.gender || 'unspecified'} characterId={teacher?.characterId || null} size={36} />
          </span>
          {!collapsed && (
            <span className="teacher-meta">
              <strong>{teacher?.name || 'cyz的教师工作台'}</strong>
              <small>{teacher?.name ? 'cyz的教师工作台 · 设置' : '点击设置教师形象'}</small>
            </span>
          )}
          {!collapsed && <Icon name="settings" size={14} className="gear" />}
        </button>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开左侧导航栏' : '收起左侧导航栏'}
          title={collapsed ? '展开侧栏' : '收起侧栏（扩大画布）'}
        >
          <Icon name="panel" size={16} />
        </button>
      </div>

      {!collapsed && s && (
        <div className="sidebar-classes">
          <div className="sidebar-label">
            <span>当前班级</span>
            <button
              type="button"
              className="mini-add"
              disabled={busy || status === 'load-error'}
              onClick={() => onOpenModal('class')}
              aria-label="创建班级"
            >
              <Icon name="plus" size={13} />新建
            </button>
          </div>
          {s.data.classes.length > 0 ? (
            <div className="class-list" role="navigation" aria-label="班级切换">
              {s.data.classes.map((c) => {
                const n = s.data.memberships.filter((x) => x.classId === c.id && x.status === 'active').length;
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={`class-item ${c.id === current?.id ? 'active' : ''}`}
                    aria-current={c.id === current?.id ? 'page' : undefined}
                    onClick={() => onSelectClass(c.id)}
                  >
                    <span className="row between" style={{ width: '100%' }}>
                      <strong>{c.name}</strong>
                      {c.status === 'archived' && <span className="mini-tag">归档</span>}
                    </span>
                    <small>{n} 名学生{c.termLabel ? ` · ${c.termLabel}` : ''}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <button type="button" className="class-empty" disabled={busy || status === 'load-error'} onClick={() => onOpenModal('class')}>
              <Icon name="plus" size={14} />创建第一个班级
            </button>
          )}
        </div>
      )}

      {current && (
        <nav className="sidebar-nav" role="tablist" aria-label="功能模块">
          {!collapsed && <div className="sidebar-label">工作模块</div>}
          {nav.map((item) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              title={collapsed ? `${item.label}（${item.hint}）` : undefined}
              onClick={() => onSelectTab(item.id)}
            >
              <Icon name={item.icon} size={18} />
              {!collapsed && (
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              )}
              {!collapsed && !!item.count && <span className="nav-count">{item.count}</span>}
            </button>
          ))}
        </nav>
      )}

      <div className="sidebar-foot">
        <button type="button" className={`save-pill ${status}`} role="status" title={SAVE_TITLES[status]} onClick={() => onOpenModal('backup')}>
          <span className="dot" />
          {!collapsed && <span>{SAVE_LABELS[status]}</span>}
        </button>
        <div className="sidebar-tools">
          <button type="button" onClick={() => onOpenModal('backup')} title="备份与恢复">
            <Icon name="shield" size={16} />{!collapsed && <span>备份与恢复</span>}
          </button>
          <button type="button" onClick={() => onOpenModal('assistant')} title="AI 助手设置">
            <Icon name="sparkles" size={16} />{!collapsed && <span>AI 助手设置</span>}
            <span className={`ai-dot ${aiReady ? 'ready' : ''}`} title={aiReady ? '本会话已配置 Key' : '未配置 Key'} />
          </button>
        </div>
        {!collapsed && <div className="version">本地离线版 · v0.5.2</div>}
      </div>
    </aside>
  );
}
