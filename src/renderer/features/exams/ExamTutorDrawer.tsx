import { useState } from 'react';
import { Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { AiChatMessage } from '../../../shared/types';
import { Badge, Button, Drawer, Textarea } from '../../components/ui/primitives';

const QUICK_PROMPTS = [
  '诊断本场考试的整体难度、均分与分数段两极分化情况',
  '给出一份 10 分钟的课堂试卷讲评提纲和分层辅导建议',
  '对比本次客观题与主观题（或各科目）的得分短板在哪里？',
];

export function ExamTutorDrawer({
  open,
  onOpenChange,
  examId,
  examTitle,
  columnId,
  onOpenAiSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  examTitle: string;
  columnId?: string;
  onOpenAiSettings: () => void;
}) {
  const [privacyMode, setPrivacyMode] = useState<'summary-only' | 'anonymized-rows'>('summary-only');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastPayload, setLastPayload] = useState('');

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    const nextHistory: AiChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(nextHistory);
    setInput('');
    setError('');
    setLoading(true);
    try {
      const res = await window.workbenchApi.ai.chatExamTutor({
        examId,
        columnId: columnId === 'computed' ? undefined : columnId,
        privacyMode,
        messages: nextHistory,
      });
      setMessages([...nextHistory, { role: 'assistant', content: res.reply }]);
      setLastPayload(res.sentPreview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="AI 学情分析助教（只读）"
      subtitle={`${examTitle} · 桌面端后台直连，绝不篡改任何成绩`}
      width="max-w-[520px]"
    >
      <div className="flex flex-col h-full gap-3">
        {/* Privacy Control Strip */}
        <div className="p-3 rounded-xl bg-[var(--info-soft)] border border-[var(--info)]/25 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--info)] inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> 外发隐私边界（真实姓名/学号始终留在本机）
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPrivacyMode('summary-only')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                privacyMode === 'summary-only'
                  ? 'bg-[var(--info)] text-white'
                  : 'bg-[var(--bg-surface)] text-[var(--ink-secondary)]'
              }`}
            >
              仅发统计摘要（最严格）
            </button>
            <button
              type="button"
              onClick={() => setPrivacyMode('anonymized-rows')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                privacyMode === 'anonymized-rows'
                  ? 'bg-[var(--info)] text-white'
                  : 'bg-[var(--bg-surface)] text-[var(--ink-secondary)]'
              }`}
            >
              匿名脱敏明细（学生1、2…）
            </button>
          </div>
          {lastPayload && (
            <details className="text-[11.5px] text-[var(--ink-secondary)]">
              <summary className="cursor-pointer font-medium">查看刚才实际发送给 AI 的上下文</summary>
              <pre className="mt-1.5 p-2 rounded-lg bg-[var(--bg-surface)] overflow-auto max-h-36 text-[11px] whitespace-pre-wrap">
                {lastPayload}
              </pre>
            </details>
          )}
        </div>

        {/* Conversation Area */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
          {!messages.length && (
            <div className="flex flex-col gap-2 py-4">
              <div className="text-xs text-[var(--ink-muted)] font-medium">点击快捷问题直接开始：</div>
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void ask(q)}
                  className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/50 text-left text-[13px] transition-colors cursor-pointer flex items-start gap-2"
                >
                  <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                  <span>{q}</span>
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] self-end max-w-[88%]'
                  : 'bg-[var(--bg-muted)] text-[var(--ink-primary)] self-start max-w-[96%]'
              }`}
            >
              {m.content}
            </div>
          ))}

          {loading && (
            <div className="p-3 rounded-xl bg-[var(--bg-muted)] text-[var(--ink-muted)] text-xs self-start">
              正在结合本场真实统计数据分析中…
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] text-xs flex items-center justify-between gap-2">
              <span>{error}</span>
              <Button size="xs" onClick={onOpenAiSettings}>
                去配 AI Key
              </Button>
            </div>
          )}
        </div>

        {/* Input Box */}
        <div className="pt-2 border-t border-[var(--border-subtle)] flex gap-2 items-end">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            placeholder="自由提问，例如：哪些分数段人数最多？物理和总分相关性如何？"
            className="flex-1"
          />
          <Button variant="primary" disabled={!input.trim() || loading} onClick={() => void ask(input)}>
            <Send className="w-4 h-4" /> 发送
          </Button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {messages.length > 0 && (
            <button
              type="button"
              className="underline cursor-pointer"
              onClick={() => {
                setMessages([]);
                setLastPayload('');
              }}
            >
              清空对话
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}
