import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  Globe,
  LayoutGrid,
  Pin,
  PinOff,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  DEFAULT_PINNED_SPACES,
  type ClassRecord,
  type NavSpace,
  type PinnableSpace,
  type VaultInfo,
} from '../../../shared/types';
import { Badge, Button, Card } from '../../components/ui/primitives';

interface HubAppCard {
  id: PinnableSpace;
  title: string;
  subtitle: string;
  description: string;
  group: 'class' | 'global';
  icon: typeof LayoutGrid;
}

const HUB_APPS: HubAppCard[] = [
  {
    id: 'classroom',
    title: '互动教室',
    subtitle: '矢量像素教室 · 智能排座 · 课堂点检',
    description: '支持按成绩蛇形/互助排座、随机点名、专注倒计时与一键发起晨检考勤/作业收交点检。',
    group: 'class',
    icon: LayoutGrid,
  },
  {
    id: 'roster',
    title: '学生与档案',
    subtitle: '班级花名册 · 立体成长轨迹',
    description: '管理学生学号、角色形象，点开任意学生即可查看历次成绩曲线、手写答卷与家校沟通记录。',
    group: 'class',
    icon: Users,
  },
  {
    id: 'exams',
    title: '统一考试中心',
    subtitle: 'Excel 成绩分析 · ECharts · 学情助教',
    description: '导入成绩单生成交互分数段直方图与多考走势对比，内置隐私透明的只读 AI 学情对话助教。',
    group: 'class',
    icon: BarChart3,
  },
  {
    id: 'homeroom',
    title: '带班工作台',
    subtitle: '每日计划 · 家校台账 · 德育素材',
    description: '班主任 4 项打卡、待办计划、家校跟进台账、月度自动统计与离线德育安全宣讲素材库。',
    group: 'class',
    icon: ClipboardList,
  },
  {
    id: 'qbank',
    title: '物理题库',
    subtitle: '连续录题 · 公式校对 · 检索 · 三格式组卷',
    description: '导入试卷 PDF/DOCX 选字裁图连续录题，支持 TipTap + MathLive 公式编排及 Word/PDF/PPTX 导出。',
    group: 'global',
    icon: BookOpenCheck,
  },
  {
    id: 'zhixue',
    title: '智学网伴侣',
    subtitle: '内置网阅浏览器 · 框选区域 · 自动/半自动 AI 阅卷',
    description: '内嵌智学网/七天网络/好分数，支持框选读取区域、自动爬取得分选项、自选间隔自动提交与实时识别核对框。',
    group: 'global',
    icon: Globe,
  },
];

export function AppsHubWorkspace({
  currentClass,
  pinnedSpaces,
  vaultInfo,
  onSelectSpace,
  onTogglePin,
  onResetPins,
}: {
  currentClass?: ClassRecord;
  pinnedSpaces: PinnableSpace[];
  vaultInfo: VaultInfo | null;
  onSelectSpace: (space: NavSpace) => void;
  onTogglePin: (space: PinnableSpace) => void;
  onResetPins: () => void;
}) {
  const pinnedSet = new Set(pinnedSpaces);

  const renderCard = (item: HubAppCard) => {
    const IconComp = item.icon;
    const pinned = pinnedSet.has(item.id);
    const needsClass = item.group === 'class' && !currentClass;

    let statBadge: string | null = null;
    if (item.id === 'roster' && currentClass) statBadge = `${currentClass.memberCount} 人`;
    if (item.id === 'exams' && currentClass) statBadge = `${currentClass.examCount} 场考试`;
    if (item.id === 'qbank' && vaultInfo) statBadge = `${vaultInfo.qbankQuestionCount} 道题`;

    return (
      <Card
        key={item.id}
        className="p-4 flex flex-col gap-3 hover:border-[var(--accent)]/60 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectSpace(item.id)}
            className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0 group-hover:scale-[1.03] transition-transform">
              <IconComp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-semibold group-hover:text-[var(--accent)] transition-colors">
                  {item.title}
                </span>
                {statBadge && <Badge tone="neutral">{statBadge}</Badge>}
                {needsClass && <Badge tone="warn">需先选班</Badge>}
              </div>
              <div className="text-[12px] text-[var(--ink-muted)] truncate mt-0.5">
                {item.subtitle}
              </div>
            </div>
          </button>

          <button
            type="button"
            title={pinned ? '移出左侧边栏' : '置顶到左侧边栏'}
            aria-label={`${pinned ? '取消置顶' : '置顶'}${item.title}`}
            onClick={() => onTogglePin(item.id)}
            className={`px-2 py-1 rounded-lg text-[11.5px] font-medium inline-flex items-center gap-1 border shrink-0 cursor-pointer transition-colors ${
              pinned
                ? 'bg-[var(--accent-soft)] border-[var(--accent)]/40 text-[var(--accent)]'
                : 'bg-[var(--bg-muted)] border-transparent text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            {pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            {pinned ? '已置顶' : '置顶'}
          </button>
        </div>

        <p className="text-[12.5px] text-[var(--ink-secondary)] leading-relaxed flex-1">
          {item.description}
        </p>

        <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
          <span className="text-[11px] text-[var(--ink-muted)]">
            {item.group === 'global'
              ? '跨班级通用 · 数据随当前资料库自动切换'
              : currentClass
                ? `当前班级：${currentClass.name}`
                : '创建或载入班级后即可使用'}
          </span>
          <Button size="xs" variant="soft" onClick={() => onSelectSpace(item.id)}>
            进入模块 →
          </Button>
        </div>
      </Card>
    );
  };

  const isDefaultPins =
    pinnedSpaces.length === DEFAULT_PINNED_SPACES.length &&
    DEFAULT_PINNED_SPACES.every((id) => pinnedSet.has(id));

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col gap-5">
      <Card className="p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-bold">全部功能中心</h2>
          <p className="text-xs text-[var(--ink-muted)] mt-0.5">
            点击卡片右上角图钉可自定义左侧边栏常驻入口；取消置顶的模块仍可随时在此或按 ⌘K / Ctrl+K 直达。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="accent">已置顶 {pinnedSpaces.length} / {HUB_APPS.length} 项</Badge>
          {!isDefaultPins && (
            <Button size="xs" variant="ghost" onClick={onResetPins}>
              <RotateCcw className="w-3.5 h-3.5" /> 恢复默认侧栏
            </Button>
          )}
        </div>
      </Card>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--ink-secondary)]">
            跨班级通用工具（无需创建班级即开即用）
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HUB_APPS.filter((a) => a.group === 'global').map(renderCard)}
        </div>
      </section>

      <section className="flex flex-col gap-2.5 pb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--ink-secondary)]">
            班级工作空间
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HUB_APPS.filter((a) => a.group === 'class').map(renderCard)}
        </div>
      </section>
    </div>
  );
}
