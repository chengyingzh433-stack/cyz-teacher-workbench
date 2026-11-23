import { useEffect, useState } from 'react';
import {
  BookOpen,
  Edit3,
  Folder,
  FolderPlus,
  Plus,
  Search,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';
import { qbankAssetUrl } from '../../../shared/qbank/editable';
import type {
  BankQuestionDTO,
  QbankTaxonomyDTO,
  QuestionFolderDTO,
} from '../../../shared/qbank/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui/primitives';

export function BankListView({
  taxonomy,
  activeSetId,
  refreshToken,
  onOpenEditor,
  onBasketChanged,
  onDataChanged,
  onNotify,
}: {
  taxonomy: QbankTaxonomyDTO;
  activeSetId: number | null;
  refreshToken: number;
  onOpenEditor: (questionId: number) => void;
  onBasketChanged: () => Promise<void>;
  onDataChanged: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<number | null>(null);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [difficultyId, setDifficultyId] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<number | null>(null);

  const [questions, setQuestions] = useState<BankQuestionDTO[]>([]);
  const [folders, setFolders] = useState<QuestionFolderDTO[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BankQuestionDTO | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<QuestionFolderDTO | null>(null);

  // Quick manual create modal
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQ, setManualQ] = useState('');
  const [manualA, setManualA] = useState('');
  const [manualSource, setManualSource] = useState('');

  async function loadAll() {
    const [qList, fList] = await Promise.all([
      window.workbenchApi.qbank.bank.search({
        query,
        typeId,
        chapterId,
        difficultyId,
        folderId,
      }),
      window.workbenchApi.qbank.folders.list(),
    ]);
    setQuestions(qList);
    setFolders(fList);
  }

  useEffect(() => {
    void loadAll();
  }, [query, typeId, chapterId, difficultyId, folderId, refreshToken]);

  // Top-level books & chapters for compact sidebar tree
  const books = taxonomy.chapters.filter((c) => c.parentId === null);

  return (
    <div className="flex-1 min-h-0 grid grid-cols-12 gap-2.5 h-full">
      {/* Left Sidebar: Folders + Physics Textbook Chapter Tree */}
      <Card className="col-span-3 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
          {/* Folders Section */}
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold text-[var(--ink-secondary)] flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5" /> 题目收藏夹
            </div>
            <button
              type="button"
              onClick={() => {
                setFolderId(null);
                setChapterId(null);
              }}
              className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs cursor-pointer flex items-center justify-between ${
                folderId === null && chapterId === null
                  ? 'bg-[var(--bg-active)] text-[var(--accent)] font-semibold'
                  : 'hover:bg-[var(--bg-hover)] text-[var(--ink-secondary)]'
              }`}
            >
              <span>全部题目</span>
              <span className="tabular-nums text-[11px]">{questions.length}</span>
            </button>
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-1 group">
                <button
                  type="button"
                  onClick={() => {
                    setFolderId(folderId === f.id ? null : f.id);
                    setChapterId(null);
                  }}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg text-left text-xs cursor-pointer flex items-center justify-between truncate ${
                    folderId === f.id
                      ? 'bg-[var(--bg-active)] text-[var(--accent)] font-semibold'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--ink-secondary)]'
                  }`}
                >
                  <span className="truncate">{f.name}</span>
                  <span className="tabular-nums text-[11px]">{f.questionCount}</span>
                </button>
                <button
                  type="button"
                  title="删除收藏夹"
                  onClick={() => setDeleteFolderTarget(f)}
                  className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-1 pt-1">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="新建收藏夹…"
                className="h-7 text-xs"
              />
              <Button
                size="xs"
                disabled={!newFolderName.trim()}
                onClick={async () => {
                  try {
                    await window.workbenchApi.qbank.folders.create(newFolderName);
                    setNewFolderName('');
                    await loadAll();
                    onNotify('已创建收藏夹');
                  } catch (e) {
                    onNotify((e as Error).message, 'err');
                  }
                }}
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Textbook Chapter Tree */}
          <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-3">
            <div className="text-xs font-semibold text-[var(--ink-secondary)] flex items-center gap-1.5 mb-1">
              <BookOpen className="w-3.5 h-3.5" /> 人教版高中物理章节
            </div>
            {books.map((book) => {
              const children = taxonomy.chapters.filter((c) => c.parentId === book.id);
              return (
                <details key={book.id} className="text-xs">
                  <summary className="px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer font-medium text-[var(--ink-primary)] flex items-center justify-between">
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        setChapterId(chapterId === book.id ? null : book.id);
                        setFolderId(null);
                      }}
                      className={chapterId === book.id ? 'text-[var(--accent)] font-bold' : ''}
                    >
                      {book.name}
                    </span>
                  </summary>
                  <div className="pl-3 flex flex-col gap-0.5 mt-0.5">
                    {children.map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => {
                          setChapterId(chapterId === ch.id ? null : ch.id);
                          setFolderId(null);
                        }}
                        className={`px-2 py-1 rounded-md text-left text-[11.5px] truncate cursor-pointer ${
                          chapterId === ch.id
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                            : 'text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]'
                        }`}
                      >
                        {ch.name.replace(`${book.name} / `, '')}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Main Question Cards Area */}
      <div className="col-span-9 flex flex-col gap-2.5 min-h-0">
        {/* Search & Filter Toolbar */}
        <Card className="p-3 flex items-center flex-wrap gap-2 shrink-0">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="全文搜索题干、公式 LaTeX、解析或来源…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select
            value={typeId ? String(typeId) : 'all'}
            onValueChange={(v) => setTypeId(v === 'all' ? null : Number(v))}
            options={[
              { value: 'all', label: '全部题型' },
              ...taxonomy.types.map((t) => ({ value: String(t.id), label: t.name })),
            ]}
          />
          <Select
            value={difficultyId ? String(difficultyId) : 'all'}
            onValueChange={(v) => setDifficultyId(v === 'all' ? null : Number(v))}
            options={[
              { value: 'all', label: '全部难度' },
              ...taxonomy.difficulties.map((d) => ({ value: String(d.id), label: d.name })),
            ]}
          />
          <Button size="sm" variant="primary" onClick={() => setManualOpen(true)}>
            <Plus className="w-4 h-4" /> 新建手录题
          </Button>
        </Card>

        {/* Questions List */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1">
          {questions.length === 0 ? (
            <Card className="p-10 text-center text-sm text-[var(--ink-muted)]">
              暂无匹配题目。可在「连续录题」导入试卷 PDF 录题，或点击右上角「新建手录题」。
            </Card>
          ) : (
            questions.map((q) => (
              <Card key={q.id} className="p-4 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="accent">#{q.id}</Badge>
                    {q.typeName && <Badge tone="neutral">{q.typeName}</Badge>}
                    {q.difficultyName && <Badge tone="warn">{q.difficultyName}</Badge>}
                    {q.chapterName && <Badge tone="info">{q.chapterName}</Badge>}
                    {q.source && (
                      <span className="text-xs text-[var(--ink-muted)]">
                        {q.year ? `${q.year} · ` : ''}
                        {q.source}
                      </span>
                    )}
                    {q.assetCount > 0 && <Badge tone="neutral">含 {q.assetCount} 图</Badge>}
                    {q.hasAnswer && <Badge tone="ok">有答案</Badge>}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {folders.length > 0 && (
                      <Select
                        value="none"
                        onValueChange={async (fid) => {
                          if (fid === 'none') return;
                          const id = Number(fid);
                          const has = q.folderIds.includes(id);
                          await window.workbenchApi.qbank.folders.setMembership(id, q.id, !has);
                          await loadAll();
                          onNotify(has ? '已移出收藏夹' : '已加入收藏夹');
                        }}
                        options={[
                          { value: 'none', label: '收藏夹…' },
                          ...folders.map((f) => ({
                            value: String(f.id),
                            label: `${q.folderIds.includes(f.id) ? '✓ ' : ''}${f.name}`,
                          })),
                        ]}
                      />
                    )}
                    <Button size="xs" onClick={() => onOpenEditor(q.id)}>
                      <Edit3 className="w-3.5 h-3.5" /> 校对编辑
                    </Button>
                    {activeSetId && (
                      <Button
                        size="xs"
                        variant={q.inBasket ? 'soft' : 'primary'}
                        onClick={async () => {
                          if (q.inBasket) {
                            await window.workbenchApi.qbank.basket.remove(activeSetId, q.id);
                            onNotify(`题目 #${q.id} 已移出组卷篮`);
                          } else {
                            await window.workbenchApi.qbank.basket.add(activeSetId, q.id);
                            onNotify(`题目 #${q.id} 已加入组卷篮`);
                          }
                          await loadAll();
                          await onBasketChanged();
                        }}
                      >
                        <ShoppingBasket className="w-3.5 h-3.5" />
                        {q.inBasket ? '移出组卷篮' : '加入组卷篮'}
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      title="删除题目"
                      onClick={() => setDeleteTarget(q)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 text-[13.5px] leading-relaxed text-[var(--ink-primary)] whitespace-pre-wrap">
                    {q.snippet || q.previewText || '（纯图片题目，点击校对编辑查看）'}
                  </div>
                  {q.imageRelPath && (
                    <img
                      src={qbankAssetUrl(q.imageRelPath)}
                      alt={`题目 #${q.id}`}
                      className="w-24 h-16 object-cover rounded-lg border border-[var(--border-subtle)] bg-white shrink-0"
                    />
                  )}
                </div>

                {q.knowledgePoints.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {q.knowledgePoints.map((kp) => (
                      <span
                        key={kp.id}
                        className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--bg-muted)] text-[var(--ink-secondary)]"
                      >
                        {kp.name}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Quick Manual Question Modal */}
      <Modal
        open={manualOpen}
        onOpenChange={setManualOpen}
        title="新建手录物理题"
        subtitle="快速录入文字题干，建好后可在校对编辑器插入 MathLive 公式与配图"
        size="md"
        footer={
          <>
            <Button onClick={() => setManualOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!manualQ.trim()}
              onClick={async () => {
                const created = await window.workbenchApi.qbank.bank.createManual({
                  questionText: manualQ,
                  answerText: manualA,
                  metadata: {
                    typeId: typeId,
                    chapterId: chapterId,
                    difficultyId: difficultyId,
                    knowledgePointIds: [],
                    year: new Date().getFullYear(),
                    source: manualSource.trim() || null,
                  },
                });
                setManualOpen(false);
                setManualQ('');
                setManualA('');
                setManualSource('');
                await loadAll();
                await onDataChanged();
                onNotify(`已新建题目 #${created.id}`);
              }}
            >
              创建题目
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            题干正文 *
            <Textarea
              rows={4}
              value={manualQ}
              onChange={(e) => setManualQ(e.target.value)}
              placeholder="输入题干文字…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            参考答案 / 解析（可选）
            <Textarea
              rows={2}
              value={manualA}
              onChange={(e) => setManualA(e.target.value)}
              placeholder="输入答案或解题思路…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            来源（可选）
            <Input
              value={manualSource}
              onChange={(e) => setManualSource(e.target.value)}
              placeholder="如：2026 高三物理双周测"
            />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除题目"
        description={`确定永久删除题目 #${deleteTarget?.id || ''} 及其关联配图文件吗？此操作无法撤销。`}
        confirmLabel="永久删除"
        danger
        onConfirm={async () => {
          if (!deleteTarget) return;
          await window.workbenchApi.qbank.bank.deleteQuestion(deleteTarget.id);
          setDeleteTarget(null);
          await loadAll();
          await onDataChanged();
          await onBasketChanged();
          onNotify('题目已删除');
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteFolderTarget)}
        onOpenChange={(o) => !o && setDeleteFolderTarget(null)}
        title="删除收藏夹"
        description={`确定删除收藏夹「${deleteFolderTarget?.name || ''}」吗？收藏夹内的题目本身会保留在题库中。`}
        confirmLabel="确认删除"
        danger
        onConfirm={async () => {
          if (!deleteFolderTarget) return;
          await window.workbenchApi.qbank.folders.delete(deleteFolderTarget.id);
          if (folderId === deleteFolderTarget.id) setFolderId(null);
          setDeleteFolderTarget(null);
          await loadAll();
          onNotify('已删除收藏夹');
        }}
      />
    </div>
  );
}
