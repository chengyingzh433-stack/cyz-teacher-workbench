import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  Compass,
  Globe,
  HardDrive,
  LayoutGrid,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import type { ClassRecord, NavSpace, PinnableSpace, TeacherProfile, VaultInfo } from '../../shared/types';
import { getTheme } from '../themes';
import { Avatar } from '../features/classroom/SpriteArt';

export function Sidebar({
  isMac,
  collapsed,
  teacher,
  classes,
  currentClass,
  space,
  pinnedSpaces,
  themeId,
  aiReady,
  trashCount,
  homeroomBadge,
  vaultInfo,
  onToggleCollapse,
  onOpenTeacher,
  onSelectClass,
  onCreateClass,
  onSelectSpace,
  onOpenCmdK,
  onToggleTheme,
  onOpenTrash,
  onOpenSettings,
}: {
  isMac: boolean;
  collapsed: boolean;
  teacher: TeacherProfile;
  classes: ClassRecord[];
  currentClass?: ClassRecord;
  space: NavSpace;
  pinnedSpaces: PinnableSpace[];
  themeId: string;
  aiReady: boolean;
  trashCount: number;
  homeroomBadge?: number;
  vaultInfo: VaultInfo | null;
  onToggleCollapse: () => void;
  onOpenTeacher: () => void;
  onSelectClass: (id: string) => void;
  onCreateClass: () => void;
  onSelectSpace: (space: NavSpace) => void;
  onOpenCmdK: () => void;
  onToggleTheme: () => void;
  onOpenTrash: () => void;
  onOpenSettings: (tab?: 'theme' | 'ai' | 'vault') => void;
}) {
  const pinnedSet = new Set<PinnableSpace>(pinnedSpaces);
  const classNavItems: Array<{
    id: PinnableSpace;
    label: string;
    hint: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }> = [
    { id: 'classroom', label: '互动教室', hint: '矢量教室 · 智能排座', icon: LayoutGrid },
    {
      id: 'roster',
      label: '学生与档案',
      hint: '花名册 · 成长轨迹',
      icon: Users,
      badge: currentClass?.memberCount,
    },
    {
      id: 'exams',
      label: '统一考试中心',
      hint: '成绩图表 · AI 阅卷',
      icon: BarChart3,
      badge: currentClass?.examCount,
    },
    {
      id: 'homeroom',
      label: '带班工作台',
      hint: '班务计划 · 家校 · 素材',
      icon: ClipboardList,
      badge: homeroomBadge,
    },
  ];
  const visibleClassNav = classNavItems.filter((item) => pinnedSet.has(item.id));
  const globalNavItems: Array<{
    id: PinnableSpace;
    label: string;
    hint: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }> = [
    {
      id: 'qbank',
      label: '物理题库',
      hint: '录题 · 校对 · 组卷',
      icon: BookOpenCheck,
      badge: vaultInfo?.qbankQuestionCount || undefined,
    },
    {
      id: 'zhixue',
      label: '智学网伴侣',
      hint: '内置网页 · AI 抓图填分',
      icon: Globe,
    },
  ];
  const visibleGlobalNav = globalNavItems.filter((item) => pinnedSet.has(item.id));

  return (
    <aside
      className={`theme-sidebar h-full shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col select-none transition-[width] duration-150 ${
        collapsed ? 'w-[68px]' : 'w-[244px]'
      }`}
    >
      {/* macOS Traffic Lights Safe Drag Bar */}
      <div
        className={`app-drag flex items-center justify-end px-2.5 shrink-0 ${
          isMac ? 'h-10' : 'h-3'
        }`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          className="app-no-drag p-1.5 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)] cursor-pointer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Teacher Profile Card */}
      <div className="px-2.5 pb-2.5">
        <button
          type="button"
          onClick={onOpenTeacher}
          title="设置教师称呼与形象"
          className={`w-full flex items-center gap-2.5 p-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors cursor-pointer ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center shrink-0 overflow-hidden">
            <Avatar gender={teacher.gender} characterId={teacher.characterId} size={34} />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[13px] font-semibold truncate text-[var(--ink-primary)]">
                {teacher.name || 'cyz的教师工作台'}
              </div>
              <div className="text-[11px] text-[var(--ink-muted)] truncate">
                {vaultInfo?.name || '本地资料库'} · 设置形象
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Global Cmd+K Search Trigger */}
      {!collapsed && (
        <div className="px-2.5 pb-3">
          <button
            type="button"
            onClick={onOpenCmdK}
            className="w-full h-8 px-2.5 rounded-lg bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] text-[var(--ink-muted)] text-[12.5px] flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">快速找人 / 搜考试…</span>
            <kbd className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </button>
        </div>
      )}

      {/* Class Switcher */}
      {!collapsed && (
        <div className="px-2.5 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between px-1.5 mb-1.5">
            <span className="text-[11px] font-semibold text-[var(--ink-muted)] tracking-wide">
              当前班级
            </span>
            <button
              type="button"
              onClick={onCreateClass}
              className="text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] text-[var(--ink-secondary)] inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" /> 新建
            </button>
          </div>
          <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
            {classes.map((c) => {
              const active = c.id === currentClass?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectClass(c.id)}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--bg-active)] text-[var(--accent)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[13px] font-medium truncate">{c.name}</span>
                    {c.status === 'archived' && (
                      <span className="text-[10px] px-1 rounded bg-[var(--warn-soft)] text-[var(--warn)]">
                        归档
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] truncate">
                    {c.memberCount} 人 · {c.examCount} 场考试
                  </div>
                </button>
              );
            })}
            {!classes.length && (
              <button
                type="button"
                onClick={onCreateClass}
                className="w-full py-2 rounded-lg border border-dashed border-[var(--border-strong)] text-xs text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer"
              >
                + 创建第一个班级
              </button>
            )}
          </div>
        </div>
      )}

      {/* Core Navigation Spaces */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-1">
        <button
          type="button"
          title={collapsed ? '全部功能中心' : undefined}
          onClick={() => onSelectSpace('hub')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
            collapsed ? 'justify-center' : ''
          } ${
            space === 'hub'
              ? 'bg-[var(--bg-active)] text-[var(--accent)] font-semibold'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]'
          }`}
        >
          <Compass className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[13.5px] leading-tight">全部功能中心</div>
              <div className="text-[11px] text-[var(--ink-muted)] font-normal truncate">
                应用总览 · 自选置顶侧栏
              </div>
            </div>
          )}
        </button>

        {currentClass && visibleClassNav.length > 0 && (
          <>
            <div className="my-1.5 border-t border-[var(--border-subtle)]" />
            {!collapsed && (
              <div className="px-2 pb-1 text-[11px] font-semibold text-[var(--ink-muted)]">
                班级工作空间
              </div>
            )}
            {visibleClassNav.map((item) => {
              const IconComp = item.icon;
              const active = space === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={collapsed ? item.label : undefined}
                  onClick={() => onSelectSpace(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
                    collapsed ? 'justify-center' : ''
                  } ${
                    active
                      ? 'bg-[var(--bg-active)] text-[var(--accent)] font-semibold'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]'
                  }`}
                >
                  <IconComp className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && (
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[13.5px] leading-tight">{item.label}</div>
                      <div className="text-[11px] text-[var(--ink-muted)] font-normal truncate">
                        {item.hint}
                      </div>
                    </div>
                  )}
                  {!collapsed && Boolean(item.badge) && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--ink-secondary)] tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}

        {visibleGlobalNav.length > 0 && (
          <>
            <div className="my-1.5 border-t border-[var(--border-subtle)]" />
            {!collapsed && (
              <div className="px-2 pb-1 text-[11px] font-semibold text-[var(--ink-muted)]">
                通用工具与网阅
              </div>
            )}
            {visibleGlobalNav.map((item) => {
              const IconComp = item.icon;
              const active = space === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={collapsed ? item.label : undefined}
                  onClick={() => onSelectSpace(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors cursor-pointer ${
                    collapsed ? 'justify-center' : ''
                  } ${
                    active
                      ? 'bg-[var(--bg-active)] text-[var(--accent)] font-semibold'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]'
                  }`}
                >
                  <IconComp className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && (
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[13.5px] leading-tight">{item.label}</div>
                      <div className="text-[11px] text-[var(--ink-muted)] font-normal truncate">
                        {item.hint}
                      </div>
                    </div>
                  )}
                  {!collapsed && Boolean(item.badge) && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--ink-secondary)] tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Bottom Utility Footer */}
      <div className="p-2.5 border-t border-[var(--border-subtle)] flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpenTrash}
          title="回收站"
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Trash2 className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">回收站</span>}
          {!collapsed && trashCount > 0 && (
            <span className="text-[11px] px-1.5 rounded-full bg-[var(--warn-soft)] text-[var(--warn)] tabular-nums">
              {trashCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings('vault')}
          title="本地资料库与备份"
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <HardDrive className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">本地资料库</span>}
        </button>

        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
          <button
            type="button"
            onClick={() => onOpenSettings('ai')}
            title="AI 模型、钥匙串与主题设置"
            className={`flex-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer ${
              collapsed ? 'justify-center w-full' : ''
            }`}
          >
            <Settings className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="flex-1 text-left">设置</span>}
            {!collapsed && (
              <span
                className={`w-2 h-2 rounded-full ${aiReady ? 'bg-[var(--ok)]' : 'bg-[var(--border-strong)]'}`}
                title={aiReady ? 'AI 密钥已就绪' : '尚未配置 AI Key'}
              />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            title="一键切换浅色/深色主题"
            className="p-1.5 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            {getTheme(themeId).isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
