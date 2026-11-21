import { useEffect } from 'react';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BarChart3,
  Globe,
  LayoutGrid,
  Moon,
  Palette,
  Settings,
  Sun,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import type { ClassRecord, ExamSummary, StudentMember } from '../../../shared/types';
import type { NavSpace } from '../../App';

export function CommandPalette({
  open,
  onOpenChange,
  classes,
  currentClassId,
  members,
  exams,
  themeId,
  onSelectClass,
  onSelectSpace,
  onSelectStudent,
  onSelectExam,
  onToggleTheme,
  onOpenSettings,
  onOpenTrash,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: ClassRecord[];
  currentClassId: string;
  members: StudentMember[];
  exams: ExamSummary[];
  themeId: string;
  onSelectClass: (classId: string) => void;
  onSelectSpace: (space: NavSpace) => void;
  onSelectStudent: (membershipId: string) => void;
  onSelectExam: (examId: string) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[16vh] -translate-x-1/2 z-50 focus:outline-none">
          <Dialog.Title className="sr-only">全局快捷命令面板</Dialog.Title>
          <Command label="快捷搜索">
            <Command.Input placeholder="搜学生姓名/学号、切班级、跳考试、换主题…" autoFocus />
            <Command.List>
              <Command.Empty>没有匹配项</Command.Empty>

              {members.length > 0 && (
                <Command.Group heading="当前班级学生（回车直达成长档案）">
                  {members.slice(0, 60).map((m) => (
                    <Command.Item
                      key={m.membershipId}
                      value={`${m.name} ${m.rosterNo} 学生 档案`}
                      onSelect={() => run(() => onSelectStudent(m.membershipId))}
                    >
                      <User className="w-4 h-4 text-[var(--ink-muted)]" />
                      <span className="font-medium">{m.name}</span>
                      {m.rosterNo && (
                        <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {m.rosterNo}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {exams.length > 0 && (
                <Command.Group heading="本班考试">
                  {exams.map((ex) => (
                    <Command.Item
                      key={ex.id}
                      value={`${ex.title} ${ex.examDate} 考试 成绩 阅卷`}
                      onSelect={() =>
                        run(() => {
                          onSelectExam(ex.id);
                          onSelectSpace('exams');
                        })
                      }
                    >
                      <BarChart3 className="w-4 h-4 text-[var(--ink-muted)]" />
                      <span className="flex-1 truncate">{ex.title}</span>
                      <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                        {ex.examDate}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {classes.length > 1 && (
                <Command.Group heading="切换班级">
                  {classes.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`${c.name} ${c.school} ${c.termLabel} 班级`}
                      onSelect={() => run(() => onSelectClass(c.id))}
                    >
                      <Users className="w-4 h-4 text-[var(--ink-muted)]" />
                      <span>{c.name}</span>
                      {c.id === currentClassId && (
                        <span className="ml-auto text-xs text-[var(--accent)]">当前</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="工作空间与系统">
                <Command.Item value="互动教室 排座 classroom" onSelect={() => run(() => onSelectSpace('classroom'))}>
                  <LayoutGrid className="w-4 h-4" /> 前往「互动教室与排座」
                </Command.Item>
                <Command.Item value="学生花名册 档案 roster" onSelect={() => run(() => onSelectSpace('roster'))}>
                  <Users className="w-4 h-4" /> 前往「学生与档案」
                </Command.Item>
                <Command.Item value="统一考试中心 成绩 阅卷 exams" onSelect={() => run(() => onSelectSpace('exams'))}>
                  <BarChart3 className="w-4 h-4" /> 前往「统一考试中心」
                </Command.Item>
                <Command.Item value="智学网 网阅伴侣 zhixue" onSelect={() => run(() => onSelectSpace('zhixue'))}>
                  <Globe className="w-4 h-4" /> 打开「智学网 / 网阅伴侣」
                </Command.Item>
                <Command.Item value="切换主题 深色 浅色 theme dark light" onSelect={() => run(onToggleTheme)}>
                  {themeId === 'studio-dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  切换外观主题（当前：{themeId === 'studio-dark' ? '深夜护眼' : '暖白工作室'}）
                </Command.Item>
                <Command.Item value="设置 AI 钥匙串 资料库 settings" onSelect={() => run(onOpenSettings)}>
                  <Settings className="w-4 h-4" /> 打开「设置（主题 / AI / 资料库）」
                </Command.Item>
                <Command.Item value="回收站 恢复 删除 trash" onSelect={() => run(onOpenTrash)}>
                  <Trash2 className="w-4 h-4" /> 打开「回收站」
                </Command.Item>
                <Command.Item value="主题引擎 外观风格 palette" onSelect={() => run(onOpenSettings)}>
                  <Palette className="w-4 h-4" /> 浏览外观主题与扩展风格
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
