import { useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import {
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type {
  ClassExamTrendPoint,
  ClassRecord,
  ExamDetail,
  ExamSummary,
  StudentMember,
} from '../../../shared/types';
import { getTheme } from '../../themes';
import { Badge, Button, Card, ConfirmDialog, Select } from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';
import { GradeImportModal } from './GradeImportModal';
import { ExamTutorDrawer } from './ExamTutorDrawer';
import { GradingWorkbenchTab } from '../grading/GradingWorkbenchTab';
import { ExamAnalyticsView, type ScoreEditDraft } from './ExamAnalyticsView';
import { ExamModals } from './ExamModals';

const DEFAULT_PASS_PCT = 60;
const DEFAULT_EXC_PCT = 85;

export function ExamCenter({
  cls,
  members,
  exams,
  selectedExamId,
  themeId,
  onSelectExam,
  onRefreshAll,
  onOpenStudentProfile,
  onOpenAiSettings,
  onNotify,
}: {
  cls: ClassRecord;
  members: StudentMember[];
  exams: ExamSummary[];
  selectedExamId: string;
  themeId: string;
  onSelectExam: (id: string) => void;
  onRefreshAll: () => Promise<void>;
  onOpenStudentProfile: (membershipId: string) => void;
  onOpenAiSettings: () => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [detail, setDetail] = useState<ExamDetail | null>(null);
  const [trends, setTrends] = useState<ClassExamTrendPoint[]>([]);
  const [subTab, setSubTab] = useState<'analytics' | 'grading'>('analytics');
  const [columnId, setColumnId] = useState('');
  const [showTrendChart, setShowTrendChart] = useState(false);

  // Modals & Drawers
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTargetExam, setImportTargetExam] = useState<ExamSummary | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExamSummary | null>(null);
  const [editCell, setEditCell] = useState<ScoreEditDraft | null>(null);

  const readonly = cls.status === 'archived';
  const activeExam = exams.find((e) => e.id === selectedExamId) || exams[0] || null;

  async function loadDetail(eid?: string) {
    const id = eid || activeExam?.id;
    if (!id) {
      setDetail(null);
      return;
    }
    const [d, tr] = await Promise.all([
      window.workbenchApi.exams.getDetail(id),
      window.workbenchApi.exams.getClassTrends(cls.id),
    ]);
    setDetail(d);
    setTrends(tr);
  }

  useEffect(() => {
    setColumnId('');
    void loadDetail();
  }, [activeExam?.id, cls.id]);

  const effectiveColId = useMemo(() => {
    if (!detail) return '';
    if (columnId === 'computed' || detail.columns.some((c) => c.id === columnId)) return columnId;
    return detail.columns.find((c) => c.role === 'total')?.id || detail.columns[0]?.id || 'computed';
  }, [detail, columnId]);

  const theme = getTheme(themeId);

  // Class Multi-Exam Trend Chart
  const trendOption: echarts.EChartsOption | null = useMemo(() => {
    if (trends.length < 2) return null;
    const p = theme.chartPalette;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
      },
      legend: { top: 0, right: 4, textStyle: { color: p.muted, fontSize: 11.5 } },
      grid: { top: 32, right: 20, bottom: 26, left: 40 },
      xAxis: {
        type: 'category',
        data: trends.map((t) => `${t.title.slice(0, 10)}`),
        axisLabel: { color: p.muted, fontSize: 11.5 },
        axisLine: { lineStyle: { color: p.grid } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: p.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      series: [
        {
          name: '班级均分',
          type: 'line',
          smooth: true,
          symbolSize: 8,
          data: trends.map((t) => (t.meanUnits !== null ? Number((t.meanUnits / 100).toFixed(2)) : null)),
          itemStyle: { color: p.primary },
          lineStyle: { width: 2.5, color: p.primary },
        },
        {
          name: '中位数',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: trends.map((t) => (t.medianUnits !== null ? Number((t.medianUnits / 100).toFixed(2)) : null)),
          itemStyle: { color: p.secondary },
          lineStyle: { width: 2, type: 'dashed', color: p.secondary },
        },
      ],
    };
  }, [trends, theme]);

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Top Unified Exam Bar */}
      <Card className="px-3.5 py-2.5 flex items-center flex-wrap gap-2.5 shrink-0">
        {exams.length > 0 ? (
          <Select
            value={activeExam?.id || ''}
            onValueChange={onSelectExam}
            className="min-w-[230px]"
            options={exams.map((ex) => ({
              value: ex.id,
              label: ex.title,
              hint: `${ex.examDate} · ${ex.columnCount}列 · ${ex.gradingItemCount}道阅卷题`,
            }))}
          />
        ) : (
          <span className="text-sm font-medium text-[var(--ink-muted)]">本班尚无考试记录</span>
        )}

        {activeExam && (
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] gap-0.5">
            <button
              type="button"
              onClick={() => setSubTab('analytics')}
              className={`px-3 py-1 rounded-md text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'analytics'
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" /> 成绩分析与明细
            </button>
            <button
              type="button"
              onClick={() => setSubTab('grading')}
              className={`px-3 py-1 rounded-md text-[12.5px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                subTab === 'grading'
                  ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> 手写阅卷与讲评
              {detail && detail.gradingItems.length > 0 && (
                <Badge tone="accent">{detail.gradingItems.length}</Badge>
              )}
            </button>
          </div>
        )}

        <div className="flex-1" />

        {trends.length >= 2 && (
          <Button
            size="sm"
            variant={showTrendChart ? 'soft' : 'ghost'}
            onClick={() => setShowTrendChart((v) => !v)}
          >
            <TrendingUp className="w-4 h-4" /> 多考趋势 ({trends.length})
          </Button>
        )}

        <Button size="sm" disabled={readonly} onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> 新建空白考试
        </Button>

        <Button
          size="sm"
          variant="primary"
          disabled={readonly}
          onClick={() => {
            setImportTargetExam(null);
            setImportOpen(true);
          }}
        >
          <FileSpreadsheet className="w-4 h-4" /> 导入 Excel 成绩单
        </Button>

        {activeExam && !readonly && (
          <Button
            size="sm"
            variant="danger-ghost"
            title="将本场考试移入回收站"
            onClick={() => setDeleteTarget(activeExam)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </Card>

      {/* Collapsible Multi-Exam Class Trend Card */}
      {showTrendChart && trendOption && (
        <Card className="p-4 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-[14px] font-semibold">全班历次考试均分与中位数走势</h3>
              <p className="text-xs text-[var(--ink-muted)]">点击节点或切换顶部考试查看单场详情</p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setShowTrendChart(false)}>
              收起
            </Button>
          </div>
          <EChart option={trendOption} height={190} />
        </Card>
      )}

      {/* Empty State */}
      {!activeExam || !detail ? (
        <Card className="flex-1 flex flex-col items-center justify-center p-10 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-semibold">欢迎来到统一考试中心</h3>
            <p className="text-sm text-[var(--ink-muted)] max-w-md mt-1">
              导入 Excel / CSV 成绩表立即生成专业分数段交互图表，或新建考试挂载手写主观题进行 AI 辅助批阅——阅卷得分自动回填本场成绩总表！
            </p>
          </div>
          <div className="flex gap-2.5">
            <Button
              variant="primary"
              disabled={readonly}
              onClick={() => {
                setImportTargetExam(null);
                setImportOpen(true);
              }}
            >
              <FileSpreadsheet className="w-4 h-4" /> 导入 Excel / CSV 成绩单
            </Button>
            <Button disabled={readonly} onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> 新建主观题阅卷考试
            </Button>
          </div>
        </Card>
      ) : subTab === 'grading' ? (
        <div className="flex-1 min-h-0">
          <GradingWorkbenchTab
            detail={detail}
            members={members}
            themeId={themeId}
            readonly={readonly}
            onReloadExam={async () => {
              await loadDetail(detail.exam.id);
              await onRefreshAll();
            }}
            onOpenAiSettings={onOpenAiSettings}
            onNotify={onNotify}
          />
        </div>
      ) : (
        <ExamAnalyticsView
          detail={detail}
          members={members}
          effectiveColId={effectiveColId}
          onSelectColumn={setColumnId}
          passPct={DEFAULT_PASS_PCT}
          excPct={DEFAULT_EXC_PCT}
          themeId={themeId}
          readonly={readonly}
          onAppendImport={() => {
            setImportTargetExam(activeExam);
            setImportOpen(true);
          }}
          onOpenTutor={() => setTutorOpen(true)}
          onOpenExport={() => setExportOpen(true)}
          onOpenStudentProfile={onOpenStudentProfile}
          onEditScoreCell={setEditCell}
        />
      )}

      <ExamModals
        classId={cls.id}
        activeExam={activeExam}
        detail={detail}
        passPct={DEFAULT_PASS_PCT}
        excPct={DEFAULT_EXC_PCT}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
        onExamCreated={async (createdId) => {
          await onRefreshAll();
          onSelectExam(createdId);
          setSubTab('grading');
        }}
        editCell={editCell}
        onEditCellChange={setEditCell}
        onDetailUpdated={setDetail}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        onNotify={onNotify}
      />

      <GradeImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        classId={cls.id}
        members={members}
        existingExam={importTargetExam}
        onImported={async (eid) => {
          await onRefreshAll();
          onSelectExam(eid);
          await loadDetail(eid);
        }}
        onNotify={onNotify}
      />

      {activeExam && (
        <ExamTutorDrawer
          open={tutorOpen}
          onOpenChange={setTutorOpen}
          examId={activeExam.id}
          examTitle={activeExam.title}
          columnId={effectiveColId}
          onOpenAiSettings={onOpenAiSettings}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="移入回收站"
        description={`将考试「${deleteTarget?.title || ''}」及其所有成绩与阅卷记录移入回收站？随时可在左下角「回收站」一键恢复。`}
        confirmLabel="移入回收站"
        danger
        onConfirm={async () => {
          if (!deleteTarget) return;
          await window.workbenchApi.exams.softDelete(deleteTarget.id);
          setDeleteTarget(null);
          await onRefreshAll();
          onNotify('考试已移入回收站，可随时恢复');
        }}
      />
    </div>
  );
}
