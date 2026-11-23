import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, Edit3, FileUp, ShoppingBasket } from 'lucide-react';
import type { PaperSetDTO, QbankTaxonomyDTO } from '../../../shared/qbank/types';
import { Badge } from '../../components/ui/primitives';
import { IntakeWorkspace } from './IntakeWorkspace';
import { BankListView } from './BankListView';
import { QuestionEditorView } from './QuestionEditorView';
import { BasketExportView } from './BasketExportView';

export type QbankSubTab = 'intake' | 'bank' | 'editor' | 'basket';

const EMPTY_TAXONOMY: QbankTaxonomyDTO = {
  types: [],
  chapters: [],
  knowledgePoints: [],
  difficulties: [],
};

export function QuestionBankWorkspace({
  onVaultStatsChanged,
  onOpenAiSettings,
  onNotify,
}: {
  onVaultStatsChanged: () => Promise<void>;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [subTab, setSubTab] = useState<QbankSubTab>('bank');
  const [taxonomy, setTaxonomy] = useState<QbankTaxonomyDTO>(EMPTY_TAXONOMY);
  const [sets, setSets] = useState<PaperSetDTO[]>([]);
  const [activeSetId, setActiveSetId] = useState<number | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadTaxonomy = useCallback(async () => {
    const t = await window.workbenchApi.qbank.taxonomy.get();
    setTaxonomy(t);
  }, []);

  const loadSets = useCallback(async () => {
    const list = await window.workbenchApi.qbank.basket.listSets();
    setSets(list);
    setActiveSetId((prev) => (prev && list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    void Promise.all([loadTaxonomy(), loadSets()]);
  }, [loadTaxonomy, loadSets]);

  const activeSet = sets.find((s) => s.id === activeSetId) || sets[0] || null;

  const bumpData = useCallback(async () => {
    setRefreshToken((n) => n + 1);
    await onVaultStatsChanged();
  }, [onVaultStatsChanged]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Top 4-Segment Sub-Navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-muted)] gap-1">
          {(
            [
              ['intake', '连续录题', FileUp],
              ['bank', '题库检索', BookOpenCheck],
              ['editor', '校对编辑', Edit3],
              ['basket', '组卷篮与导出', ShoppingBasket],
            ] as const
          ).map(([id, label, IconComp]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === id
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <IconComp className="w-3.5 h-3.5" />
              {label}
              {id === 'basket' && activeSet && activeSet.itemCount > 0 && (
                <Badge tone="accent">{activeSet.itemCount}</Badge>
              )}
              {id === 'editor' && editingQuestionId && (
                <span className="text-[11px] text-[var(--ink-muted)]">#{editingQuestionId}</span>
              )}
            </button>
          ))}
        </div>

        <span className="text-xs text-[var(--ink-muted)] hidden md:inline">
          数据独立存于当前资料库 <code>question-bank/</code>，支持跨班级复用与一键整库备份
        </span>
      </div>

      {/* Sub-Views */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === 'intake' && (
          <IntakeWorkspace
            taxonomy={taxonomy}
            onPublishedQuestion={bumpData}
            onOpenEditor={(qid) => {
              setEditingQuestionId(qid);
              setSubTab('editor');
            }}
            onNotify={onNotify}
          />
        )}

        {subTab === 'bank' && (
          <BankListView
            taxonomy={taxonomy}
            activeSetId={activeSetId}
            refreshToken={refreshToken}
            onOpenEditor={(qid) => {
              setEditingQuestionId(qid);
              setSubTab('editor');
            }}
            onBasketChanged={loadSets}
            onDataChanged={bumpData}
            onNotify={onNotify}
          />
        )}

        {subTab === 'editor' && (
          <QuestionEditorView
            questionId={editingQuestionId}
            taxonomy={taxonomy}
            activeSetId={activeSetId}
            onTaxonomyChanged={loadTaxonomy}
            onSaved={bumpData}
            onBasketChanged={loadSets}
            onOpenAiSettings={onOpenAiSettings}
            onNotify={onNotify}
          />
        )}

        {subTab === 'basket' && (
          <BasketExportView
            sets={sets}
            activeSetId={activeSetId}
            refreshToken={refreshToken}
            onSelectSet={setActiveSetId}
            onSetsChanged={loadSets}
            onOpenEditor={(qid) => {
              setEditingQuestionId(qid);
              setSubTab('editor');
            }}
            onNotify={onNotify}
          />
        )}
      </div>
    </div>
  );
}
