import { Plus, Sparkles } from 'lucide-react';
import { Avatar } from '../features/classroom/SpriteArt';

export function OnboardingWelcome({
  vaultPath,
  onCreateClass,
  onLoadDemo,
}: {
  vaultPath?: string;
  onCreateClass: () => void;
  onLoadDemo: () => Promise<void>;
}) {
  return (
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
            onClick={onCreateClass}
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
            onClick={() => void onLoadDemo()}
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
          当前资料库：<code>{vaultPath}</code>
        </div>
      </div>
    </div>
  );
}
