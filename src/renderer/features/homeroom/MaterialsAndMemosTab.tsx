import { useMemo, useState } from 'react';
import {
  BookmarkCheck,
  BookOpenText,
  Copy,
  Edit3,
  FolderArchive,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  ClassRecord,
  HomeroomMemo,
  HomeroomMemoTag,
  SavedMaterialRecord,
} from '../../../shared/types';
import {
  formatMaterialPartBody,
  formatMaterialSavedText,
  getMoralSafetyTheme,
  HOMEROOM_MEMO_TAGS,
  MATERIAL_PART_LABELS,
  MORAL_SAFETY_THEMES,
  type MaterialPartKey,
} from '../../../shared/homeroom-materials';
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui/primitives';

const MATERIAL_PARTS: MaterialPartKey[] = ['topics', 'flow', 'script', 'letters'];

function memoTagTone(tag: HomeroomMemoTag): BadgeTone {
  if (tag === '紧急事项') return 'danger';
  if (tag === '安全回执') return 'warn';
  if (tag === '行政通知') return 'info';
  if (tag === '特殊学生档案') return 'accent';
  return 'neutral';
}

export function MaterialsAndMemosTab({
  cls,
  readonly,
  aiReady,
  memos,
  savedMaterials,
  onReload,
  onOpenAiSettings,
  onNotify,
}: {
  cls: ClassRecord;
  readonly: boolean;
  aiReady: boolean;
  memos: HomeroomMemo[];
  savedMaterials: SavedMaterialRecord[];
  onReload: () => Promise<void>;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  // Moral & Safety Materials Library state
  const [curThemeKey, setCurThemeKey] = useState(MORAL_SAFETY_THEMES[0].key);
  const curTheme = getMoralSafetyTheme(curThemeKey);

  // AI Customizer Modal state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiTargetPart, setAiTargetPart] = useState<MaterialPartKey>('script');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Work Memos state
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [memoTitle, setMemoTitle] = useState('');
  const [memoTag, setMemoTag] = useState<HomeroomMemoTag>('教学资料');
  const [memoContent, setMemoContent] = useState('');
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoSearch, setMemoSearch] = useState('');
  const [memoTagFilter, setMemoTagFilter] = useState<string>('all');

  const filteredMemos = useMemo(() => {
    const q = memoSearch.trim();
    return memos.filter((m) => {
      if (memoTagFilter !== 'all' && m.tag !== memoTagFilter) return false;
      if (q && !(m.title + m.content + m.tag).includes(q)) return false;
      return true;
    });
  }, [memos, memoSearch, memoTagFilter]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      onNotify('已复制到剪贴板');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        onNotify('已复制到剪贴板');
      } catch {
        onNotify('复制失败，请手动选择文本', 'err');
      }
      ta.remove();
    }
  }

  async function saveBlock(part: MaterialPartKey) {
    if (readonly) return;
    try {
      const shortNames: Record<MaterialPartKey, string> = {
        topics: '主题班会参考',
        flow: '班会流程结构',
        script: '家长会宣讲脚本',
        letters: '告家长书/宣传短句',
      };
      await window.workbenchApi.homeroom.saveMaterial({
        classId: cls.id,
        themeKey: curTheme.key,
        title: `${curTheme.key} · ${shortNames[part]}`,
        content: formatMaterialSavedText(curTheme, part),
      });
      await onReload();
      onNotify('素材已保存到本班资料库');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  async function handleGenerateAiMaterial() {
    if (!aiReady) {
      onOpenAiSettings();
      return;
    }
    setAiLoading(true);
    try {
      const res = await window.workbenchApi.ai.generateHomeroomMaterial({
        classId: cls.id,
        theme: curTheme.key,
        partLabel: MATERIAL_PART_LABELS[aiTargetPart],
        baseContent: formatMaterialPartBody(curTheme, aiTargetPart),
        customPrompt: aiPrompt.trim() || undefined,
      });
      setAiResult(res.content);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmitMemo() {
    if (readonly) return;
    if (!memoTitle.trim() && !memoContent.trim()) {
      onNotify('备忘标题和内容至少填一项', 'err');
      return;
    }
    setSavingMemo(true);
    try {
      await window.workbenchApi.homeroom.saveMemo({
        classId: cls.id,
        id: editingMemoId || undefined,
        title: memoTitle.trim() || '(无标题)',
        tag: memoTag,
        content: memoContent.trim(),
      });
      setEditingMemoId(null);
      setMemoTitle('');
      setMemoContent('');
      await onReload();
      onNotify(editingMemoId ? '备忘录已更新' : '备忘录已保存');
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSavingMemo(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start pb-6">
      {/* Left: Moral & Safety Materials Library (7 cols) */}
      <div className="xl:col-span-7 flex flex-col gap-4">
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-[14.5px] font-semibold flex items-center gap-1.5">
                <BookOpenText className="w-4 h-4 text-[var(--accent)]" /> 德育安全素材库
              </h3>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                内置 5 大中学高频德育安全离线模板（免联网一键复制），也可结合主进程 AI 按本班情况定制改写
              </p>
            </div>
            <Button
              size="xs"
              variant="soft"
              onClick={() => {
                setAiResult('');
                setAiPrompt('');
                setAiTargetPart('script');
                setAiModalOpen(true);
              }}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI 结合本班定制
            </Button>
          </div>

          {/* Theme Pill Tabs */}
          <div className="flex items-center flex-wrap gap-1.5">
            {MORAL_SAFETY_THEMES.map((t) => {
              const active = t.key === curThemeKey;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setCurThemeKey(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                      : 'bg-[var(--bg-muted)]/60 text-[var(--ink-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {t.key}
                </button>
              );
            })}
          </div>

          {/* 4 Structured Material Blocks */}
          <div className="flex flex-col gap-3">
            {MATERIAL_PARTS.map((part) => {
              const body = formatMaterialPartBody(curTheme, part);
              return (
                <div
                  key={part}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/45 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-[13px] font-semibold text-[var(--accent)]">
                      {MATERIAL_PART_LABELS[part]}
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <Button size="xs" onClick={() => void copyText(body)}>
                        <Copy className="w-3 h-3" /> 复制文本
                      </Button>
                      {!readonly && (
                        <Button size="xs" variant="primary" onClick={() => void saveBlock(part)}>
                          <BookmarkCheck className="w-3 h-3" /> 收藏到本地
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-[12.5px] leading-relaxed text-[var(--ink-primary)] whitespace-pre-wrap">
                    {body}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Saved Materials Collection */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
              <BookmarkCheck className="w-4 h-4 text-[var(--accent)]" /> 已收藏素材 ({savedMaterials.length})
            </h3>
          </div>
          {savedMaterials.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {savedMaterials.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-semibold truncate">{m.title}</span>
                      <Badge>{m.savedDate}</Badge>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="xs" variant="ghost" onClick={() => void copyText(m.content)}>
                        <Copy className="w-3.5 h-3.5" /> 复制
                      </Button>
                      {!readonly && (
                        <Button
                          size="xs"
                          variant="danger-ghost"
                          onClick={async () => {
                            await window.workbenchApi.homeroom.deleteMaterial(m.id);
                            await onReload();
                            onNotify('已删除收藏素材');
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs leading-relaxed text-[var(--ink-secondary)] whitespace-pre-wrap max-h-36 overflow-y-auto">
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-[var(--ink-muted)]">
              暂无收藏素材，点击上方任意板块的「收藏到本地」即可随时调取复用
            </div>
          )}
        </Card>
      </div>

      {/* Right: Work Memos (5 cols) */}
      <div className="xl:col-span-5 flex flex-col gap-4">
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[14.5px] font-semibold flex items-center gap-1.5">
                <FolderArchive className="w-4 h-4 text-[var(--accent)]" />
                {editingMemoId ? '编辑工作备忘' : '工作备忘录'}
              </h3>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                长期留存教学资料、行政通知、特殊学生档案等电子化记录
              </p>
            </div>
            {editingMemoId && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditingMemoId(null);
                  setMemoTitle('');
                  setMemoContent('');
                }}
              >
                取消编辑
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={memoTitle}
              disabled={readonly}
              onChange={(e) => setMemoTitle(e.target.value)}
              placeholder="备忘标题"
              className="flex-1 h-8 text-[13px]"
            />
            <Select
              value={memoTag}
              disabled={readonly}
              onValueChange={(v) => setMemoTag(v as HomeroomMemoTag)}
              className="w-32"
              options={HOMEROOM_MEMO_TAGS.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <Textarea
            rows={3}
            disabled={readonly}
            value={memoContent}
            onChange={(e) => setMemoContent(e.target.value)}
            placeholder="输入备忘详细内容…"
            className="text-[13px]"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              disabled={readonly || savingMemo}
              onClick={() => void handleSubmitMemo()}
            >
              <Plus className="w-3.5 h-3.5" /> {editingMemoId ? '保存修改' : '保存备忘'}
            </Button>
          </div>
        </Card>

        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[13.5px] font-semibold">备忘台账 ({filteredMemos.length})</span>
            <div className="relative flex-1 min-w-[140px] max-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={memoSearch}
                onChange={(e) => setMemoSearch(e.target.value)}
                placeholder="关键词检索备忘…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5">
            {(['all', ...HOMEROOM_MEMO_TAGS] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMemoTagFilter(t)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                  memoTagFilter === t
                    ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {t === 'all' ? '全部' : t}
              </button>
            ))}
          </div>

          {filteredMemos.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {filteredMemos.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 flex flex-col gap-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13.5px] font-semibold">{m.title}</div>
                    <Badge tone={memoTagTone(m.tag)}>{m.tag}</Badge>
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] tabular-nums">{m.memoDate}</div>
                  {m.content && (
                    <div className="text-[12.5px] leading-relaxed text-[var(--ink-secondary)] whitespace-pre-wrap">
                      {m.content}
                    </div>
                  )}
                  {!readonly && (
                    <div className="flex items-center gap-1 pt-1 border-t border-[var(--border-subtle)]">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setEditingMemoId(m.id);
                          setMemoTitle(m.title === '(无标题)' ? '' : m.title);
                          setMemoTag(m.tag);
                          setMemoContent(m.content);
                        }}
                      >
                        <Edit3 className="w-3.5 h-3.5" /> 编辑
                      </Button>
                      <Button
                        size="xs"
                        variant="danger-ghost"
                        onClick={async () => {
                          await window.workbenchApi.homeroom.deleteMemo(m.id);
                          await onReload();
                          onNotify('已删除该备忘');
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 删除
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-[var(--ink-muted)]">
              暂无匹配的工作备忘
            </div>
          )}
        </Card>
      </div>

      {/* AI Material Customization Modal */}
      <Modal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        title={`✨ AI 定制「${curTheme.key}」德育安全素材`}
        subtitle="基于本班学段与离线精品模板改写润色，绝不外发任何学生个人隐私"
        size="lg"
        footer={
          <>
            <Button onClick={() => setAiModalOpen(false)}>关闭</Button>
            {aiResult && (
              <>
                <Button onClick={() => void copyText(aiResult)}>
                  <Copy className="w-3.5 h-3.5" /> 复制结果
                </Button>
                {!readonly && (
                  <Button
                    variant="soft"
                    onClick={async () => {
                      await window.workbenchApi.homeroom.saveMaterial({
                        classId: cls.id,
                        themeKey: curTheme.key,
                        title: `${curTheme.key} · AI 定制版`,
                        content: aiResult,
                      });
                      await onReload();
                      onNotify('AI 定制素材已收藏到本班资料库');
                      setAiModalOpen(false);
                    }}
                  >
                    <BookmarkCheck className="w-3.5 h-3.5" /> 收藏到本地
                  </Button>
                )}
              </>
            )}
            <Button
              variant="primary"
              disabled={aiLoading}
              onClick={() => void handleGenerateAiMaterial()}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {!aiReady ? '先配置 AI 密钥' : aiLoading ? '正在生成…' : '立即生成定制版本'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[var(--ink-muted)]">选择要定制的板块</span>
              <Select
                value={aiTargetPart}
                onValueChange={(v) => setAiTargetPart(v as MaterialPartKey)}
                className="w-full"
                options={MATERIAL_PARTS.map((p) => ({ value: p, label: MATERIAL_PART_LABELS[p] }))}
              />
            </div>
            <div className="flex flex-col gap-1 justify-end text-xs text-[var(--ink-muted)]">
              AI 连接状态：
              <strong className={aiReady ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}>
                {aiReady ? '已就绪（主进程零跨域代理）' : '尚未配置 API Key（点击右下角前往设置）'}
              </strong>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
            补充场景要求（可选）
            <Textarea
              rows={3}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="例如：面向高二理科班，增加冬季雨雪骑行提醒与晚自习放学结伴回家要求，语气亲切简练，适合直接发微信群…"
            />
          </label>

          {aiResult && (
            <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)]/30 p-3.5">
              <div className="text-xs font-semibold text-[var(--accent)] mb-1.5">AI 生成结果</div>
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--ink-primary)]">
                {aiResult}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
