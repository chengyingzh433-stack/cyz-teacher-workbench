import { useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import {
  ArrowUpDown,
  BarChart3,
  Bot,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  History,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  ClassExamTrendPoint,
  ClassRecord,
  ExamDetail,
  ExamSummary,
  ScoreStatus,
  StudentMember,
} from '../../../shared/types';
import { analyzeExamColumn, bandLabelOf, cellStatusLabels } from '../../../shared/gradebook/analysis';
import { formatScore, parsePoints } from '../../../shared/score-policy';
import { getTheme } from '../../themes';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
} from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';
import { GradeImportModal } from './GradeImportModal';
import { ExamTutorDrawer } from './ExamTutorDrawer';
import { GradingWorkbenchTab } from '../grading/GradingWorkbenchTab';

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
  const [bandMode, setBandMode] = useState<'auto' | '10' | '5'>('auto');
  const [bandFilter, setBandFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'default' | 'desc' | 'asc'>('default');
  const [passPct, setPassPct] = useState(60);
  const [excPct, setExcPct] = useState(85);
  const [showTrendChart, setShowTrendChart] = useState(false);

  // Modals & Drawers
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [importOpen, setImportOpen] = useState(false);
  const [importTargetExam, setImportTargetExam] = useState<ExamSummary | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIdentified, setExportIdentified] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExamSummary | null>(null);

  // Inline score edit + audit modal
  const [editCell, setEditCell] = useState<{
    membershipId: string;
    studentName: string;
    columnId: string;
    columnLabel: string;
    status: ScoreStatus;
    value: string;
    reason: string;
  } | null>(null);

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
    setBandFilter(null);
    setColumnId('');
    void loadDetail();
  }, [activeExam?.id, cls.id]);

  const effectiveColId = useMemo(() => {
    if (!detail) return '';
    if (columnId === 'computed' || detail.columns.some((c) => c.id === columnId)) return columnId;
    return detail.columns.find((c) => c.role === 'total')?.id || detail.columns[0]?.id || 'computed';
  }, [detail, columnId]);

  const analysis = useMemo(() => {
    if (!detail || !effectiveColId) return null;
    try {
      return analyzeExamColumn({
        columns: detail.columns,
        scores: detail.scores,
        members,
        columnId: effectiveColId,
        passPercent: passPct,
        excellentPercent: excPct,
        bandMode,
      });
    } catch {
      return null;
    }
  }, [detail, members, effectiveColId, passPct, excPct, bandMode]);

  const scoreMap = useMemo(() => {
    const map = new Map<string, ExamDetail['scores'][number]>();
    if (detail) {
      for (const s of detail.scores) map.set(`${s.membershipId}:${s.columnId}`, s);
    }
    return map;
  }, [detail]);

  const filteredMembers = useMemo(() => {
    const q = search.trim();
    const list = members.filter((m) => {
      if (q && !m.name.includes(q) && !m.rosterNo.includes(q)) return false;
      if (bandFilter && analysis) {
        const val = analysis.valuesByMember.get(m.membershipId)?.units ?? null;
        if (val === null || bandLabelOf(val, analysis.maxUnits, bandMode) !== bandFilter) return false;
      }
      return true;
    });
    if (sortDir === 'default' || !analysis) return list;
    const mul = sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const va = analysis.valuesByMember.get(a.membershipId)?.units ?? null;
      const vb = analysis.valuesByMember.get(b.membershipId)?.units ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * mul;
    });
  }, [members, search, bandFilter, analysis, bandMode, sortDir]);

  const theme = getTheme(themeId);

  // Interactive ECharts Histogram
  const histOption: echarts.EChartsOption | null = useMemo(() => {
    if (!analysis || !analysis.bands.length) return null;
    const p = theme.chartPalette;
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex: number }).dataIndex;
          const b = analysis.bands[idx];
          return `<b>${b.label}</b><br/>人数：${b.count} 人（${b.pct.toFixed(1)}%）<br/><span style="opacity:0.7">点击柱条筛选下方名单</span>`;
        },
      },
      grid: { top: 18, right: 16, bottom: 28, left: 36 },
      xAxis: {
        type: 'category',
        data: analysis.bands.map((b) => b.label),
        axisLabel: { color: p.muted, fontSize: 11.5 },
        axisLine: { lineStyle: { color: p.grid } },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: p.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 42,
          data: analysis.bands.map((b, idx) => {
            const r = p.barRadius ?? 8;
            const baseColor =
              bandFilter === b.label
                ? p.accent
                : bandFilter
                  ? `${p.primary}44`
                  : theme.id === 'sakura-campus' || theme.id === 'cozy-pixel'
                    ? idx % 2 === 0
                      ? p.primary
                      : p.secondary
                    : p.barGradientTo
                      ? {
                          type: 'linear' as const,
                          x: 0,
                          y: 0,
                          x2: 0,
                          y2: 1,
                          colorStops: [
                            { offset: 0, color: p.barGradientTo },
                            { offset: 1, color: p.primary },
                          ],
                        }
                      : p.primary;
            return {
              value: b.count,
              itemStyle: {
                borderRadius: [r, r, 0, 0],
                color: baseColor,
                borderColor: theme.id === 'cozy-pixel' ? '#4a3728' : undefined,
                borderWidth: theme.id === 'cozy-pixel' ? 1.5 : 0,
              },
            };
          }),
          label: { show: true, position: 'top', color: p.text, fontSize: 11.5, formatter: '{c}人' },
        },
      ],
    };
  }, [analysis, bandFilter, theme]);

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

        <Button
          size="sm"
          disabled={readonly}
          onClick={() => {
            setNewTitle('');
            setCreateOpen(true);
          }}
        >
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
        /* Analytics + Score Matrix View */
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
          {/* Subject Column Picker + Export + AI Tutor */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {detail.columns.length > 0 && (
                <Select
                  value={effectiveColId}
                  onValueChange={(v) => {
                    setColumnId(v);
                    setBandFilter(null);
                  }}
                  options={[
                    ...detail.columns.map((c) => ({
                      value: c.id,
                      label: `${c.label}${c.source === 'grading' ? ' · 阅卷同步' : ''}`,
                      hint: c.maxUnits ? `满分 ${formatScore(c.maxUnits)}` : undefined,
                    })),
                    { value: 'computed', label: '各科目自动合计' },
                  ]}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={readonly}
                onClick={() => {
                  setImportTargetExam(activeExam);
                  setImportOpen(true);
                }}
              >
                追加导入表格至本场
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="soft" onClick={() => setTutorOpen(true)}>
                <Bot className="w-4 h-4" /> AI 学情对话助教
              </Button>
              <Button size="sm" onClick={() => setExportOpen(true)}>
                <Download className="w-4 h-4" /> 导出报告
              </Button>
            </div>
          </div>

          {/* 6 KPI Cards */}
          {analysis && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <Card className="p-3">
                  <div className="text-xs text-[var(--ink-muted)]">有效人数</div>
                  <div className="text-xl font-bold tabular-nums mt-1">
                    {analysis.count}
                    <span className="text-xs font-normal text-[var(--ink-muted)] ml-1">
                      /{analysis.totalStudents}
                    </span>
                  </div>
                </Card>
                <Card className="p-3 border-[var(--accent)]/40 bg-[var(--accent-soft)]/40">
                  <div className="text-xs text-[var(--accent)] font-medium">班级平均分</div>
                  <div className="text-xl font-bold text-[var(--accent)] tabular-nums mt-1">
                    {formatScore(analysis.meanUnits)}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-[var(--ink-muted)]">中位数</div>
                  <div className="text-xl font-bold tabular-nums mt-1">
                    {formatScore(analysis.medianUnits)}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-[var(--ink-muted)]">最高 / 最低</div>
                  <div className="text-xl font-bold tabular-nums mt-1">
                    {formatScore(analysis.maxObservedUnits)}
                    <span className="text-xs font-normal text-[var(--ink-muted)] ml-1">
                      / {formatScore(analysis.minUnits)}
                    </span>
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-[var(--ink-muted)]">及格率 (≥{passPct}%)</div>
                  <div className="text-xl font-bold tabular-nums mt-1">
                    {analysis.passCount === null || !analysis.count
                      ? '—'
                      : `${((analysis.passCount / analysis.count) * 100).toFixed(1)}%`}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-[var(--ink-muted)]">优秀率 (≥{excPct}%)</div>
                  <div className="text-xl font-bold tabular-nums mt-1">
                    {analysis.excellentCount === null || !analysis.count
                      ? '—'
                      : `${((analysis.excellentCount / analysis.count) * 100).toFixed(1)}%`}
                  </div>
                </Card>
              </div>

              {/* Apache ECharts Interactive Score Distribution */}
              <Card className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div>
                    <h3 className="text-[14px] font-semibold">
                      分数段分布（点击任意柱条直接筛选下方学生）
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--ink-muted)]">
                      <span>缺考 {analysis.statusCounts.absent} · 免考 {analysis.statusCounts.exempt} · 未录 {analysis.statusCounts.missing}</span>
                      {analysis.maxUnits !== null && (
                        <span>· 满分 {formatScore(analysis.maxUnits)} 分</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] text-xs">
                      {analysis.maxUnits !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setBandMode('auto');
                            setBandFilter(null);
                          }}
                          className={`px-2.5 py-1 rounded-md cursor-pointer ${
                            bandMode === 'auto' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
                          }`}
                        >
                          百分比
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setBandMode('10');
                          setBandFilter(null);
                        }}
                        className={`px-2.5 py-1 rounded-md cursor-pointer ${
                          bandMode === '10' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
                        }`}
                      >
                        每10分
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBandMode('5');
                          setBandFilter(null);
                        }}
                        className={`px-2.5 py-1 rounded-md cursor-pointer ${
                          bandMode === '5' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--ink-muted)]'
                        }`}
                      >
                        每5分
                      </button>
                    </div>
                  </div>
                </div>
                {histOption ? (
                  <EChart
                    option={histOption}
                    height={210}
                    onPointClick={({ name }) => setBandFilter((prev) => (prev === name ? null : name))}
                  />
                ) : (
                  <div className="py-10 text-center text-xs text-[var(--ink-muted)]">本列暂无有效成绩</div>
                )}
              </Card>
            </>
          )}

          {/* Student Score Matrix */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold">成绩明细（{filteredMembers.length} 人）</h3>
                <span className="text-xs text-[var(--ink-muted)]">点击任意分数格可修订并自动留痕</span>
                {bandFilter && (
                  <Badge tone="accent">
                    筛选：{bandFilter}
                    <button type="button" onClick={() => setBandFilter(null)} className="ml-1 cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-48">
                  <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜姓名/学号…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Button
                  size="xs"
                  onClick={() =>
                    setSortDir((d) => (d === 'default' ? 'desc' : d === 'desc' ? 'asc' : 'default'))
                  }
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {sortDir === 'desc' ? '高→低' : sortDir === 'asc' ? '低→高' : '默认序'}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[12px] text-[var(--ink-muted)] z-10">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">学生（点姓名看趋势）</th>
                    {detail.columns.map((c) => (
                      <th
                        key={c.id}
                        className={`py-2.5 px-3 font-semibold ${
                          c.id === effectiveColId ? 'text-[var(--accent)]' : ''
                        }`}
                      >
                        {c.label}
                        {c.source === 'grading' && (
                          <span className="ml-1 text-[10px] px-1 rounded bg-[var(--accent-soft)] text-[var(--accent)]">
                            阅卷
                          </span>
                        )}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 font-semibold">班内名次</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredMembers.map((m) => {
                    const rank = analysis?.valuesByMember.get(m.membershipId)?.rank;
                    return (
                      <tr key={m.membershipId} className="hover:bg-[var(--bg-hover)]/50">
                        <td className="py-2 px-4">
                          <button
                            type="button"
                            onClick={() => onOpenStudentProfile(m.membershipId)}
                            className="font-medium hover:text-[var(--accent)] cursor-pointer"
                          >
                            {m.name}
                          </button>
                          {m.rosterNo && (
                            <span className="ml-1.5 text-xs text-[var(--ink-muted)] tabular-nums">
                              {m.rosterNo}
                            </span>
                          )}
                        </td>
                        {detail.columns.map((col) => {
                          const cell = scoreMap.get(`${m.membershipId}:${col.id}`);
                          const text = !cell
                            ? '—'
                            : cell.status === 'score'
                              ? formatScore(cell.units)
                              : cellStatusLabels[cell.status];
                          return (
                            <td
                              key={col.id}
                              className={`py-2 px-3 tabular-nums ${
                                col.id === effectiveColId ? 'font-semibold bg-[var(--accent-soft)]/25' : ''
                              }`}
                            >
                              <button
                                type="button"
                                disabled={readonly}
                                title={readonly ? undefined : '点击修订该成绩并留痕'}
                                onClick={() =>
                                  setEditCell({
                                    membershipId: m.membershipId,
                                    studentName: m.name,
                                    columnId: col.id,
                                    columnLabel: col.label,
                                    status: cell?.status || 'score',
                                    value:
                                      cell?.status === 'score' && cell.units !== null
                                        ? formatScore(cell.units)
                                        : '',
                                    reason: '',
                                  })
                                }
                                className="px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer disabled:cursor-default"
                              >
                                {text}
                                {cell?.correctedText && (
                                  <span className="ml-1 text-[10px] px-1 rounded bg-[var(--info-soft)] text-[var(--info)]">
                                    改
                                  </span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 tabular-nums font-semibold">
                          {rank !== null && rank !== undefined ? `#${rank}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Lightweight Score Audit Logs */}
          {detail.auditLogs.length > 0 && (
            <Card className="p-3.5">
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-secondary)] inline-flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> 正式改分留痕日志（{detail.auditLogs.length} 条）
                </summary>
                <div className="mt-2.5 divide-y divide-[var(--border-subtle)] text-xs max-h-44 overflow-y-auto">
                  {detail.auditLogs.map((log) => (
                    <div key={log.id} className="py-1.5 flex items-center justify-between gap-2">
                      <span>
                        <strong>{log.studentName}</strong> · {log.targetLabel}：
                        <span className="line-through text-[var(--ink-muted)] mx-1">{log.oldValue}</span>→
                        <strong className="text-[var(--accent)] mx-1">{log.newValue}</strong>
                        <span className="text-[var(--ink-muted)]">（{log.reason}）</span>
                      </span>
                      <span className="text-[11px] text-[var(--ink-muted)] tabular-nums shrink-0">
                        {log.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </Card>
          )}
        </div>
      )}

      {/* Create Blank Exam Modal */}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建考试"
        subtitle="建好后既可挂载手写主观题进行 AI 阅卷，也可随时追加导入 Excel 成绩单"
        size="sm"
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!newTitle.trim()}
              onClick={async () => {
                const created = await window.workbenchApi.exams.create({
                  classId: cls.id,
                  title: newTitle.trim(),
                  examDate: newDate,
                });
                await onRefreshAll();
                onSelectExam(created.id);
                setSubTab('grading');
                setCreateOpen(false);
                onNotify(`已建立考试「${created.title}」`);
              }}
            >
              创建考试
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            考试名称 *
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="如：物理力学综合测试"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            考试日期
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
        </div>
      </Modal>

      {/* Inline Score Revision Modal (writes score_audit_logs!) */}
      <Modal
        open={Boolean(editCell)}
        onOpenChange={(o) => !o && setEditCell(null)}
        title={editCell ? `修订成绩 · ${editCell.studentName}` : ''}
        subtitle={editCell ? `科目：${editCell.columnLabel}（修改后将自动写入改分留痕日志）` : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditCell(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!editCell || !detail) return;
                try {
                  const units = editCell.status === 'score' ? parsePoints(editCell.value) : null;
                  const updated = await window.workbenchApi.exams.updateScoreCell({
                    examId: detail.exam.id,
                    columnId: editCell.columnId,
                    membershipId: editCell.membershipId,
                    status: editCell.status,
                    units,
                    reason: editCell.reason,
                  });
                  setDetail(updated);
                  setEditCell(null);
                  onNotify(`已修订「${editCell.studentName}」成绩并留痕`);
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                }
              }}
            >
              确认修订
            </Button>
          </>
        }
      >
        {editCell && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">状态</span>
              <Select
                value={editCell.status}
                onValueChange={(v) => setEditCell({ ...editCell, status: v as ScoreStatus })}
                className="w-full"
                options={[
                  { value: 'score', label: '正常得分' },
                  { value: 'absent', label: '缺考（不拉低均分）' },
                  { value: 'exempt', label: '免考（不拉低均分）' },
                  { value: 'missing', label: '未录入' },
                ]}
              />
            </div>
            {editCell.status === 'score' && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                新分值
                <Input
                  autoFocus
                  value={editCell.value}
                  onChange={(e) => setEditCell({ ...editCell, value: e.target.value })}
                  placeholder="如 86.5"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium">
              修订原因（记入日志）
              <Input
                value={editCell.reason}
                onChange={(e) => setEditCell({ ...editCell, reason: e.target.value })}
                placeholder="如：复查试卷漏加 2 分"
              />
            </label>
          </div>
        )}
      </Modal>

      {/* Export Dialog */}
      <Modal
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="导出成绩与分析报告"
        subtitle={activeExam?.title}
        size="sm"
        footer={
          <>
            <Button
              onClick={async () => {
                if (!activeExam) return;
                const res = await window.workbenchApi.exams.exportReport({
                  examId: activeExam.id,
                  format: 'csv',
                  identified: exportIdentified,
                  passPercent: passPct,
                  excellentPercent: excPct,
                });
                if (res) {
                  setExportOpen(false);
                  onNotify(`已导出 CSV 至 ${res.path}`);
                }
              }}
            >
              导出 CSV
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!activeExam) return;
                const res = await window.workbenchApi.exams.exportReport({
                  examId: activeExam.id,
                  format: 'html',
                  identified: exportIdentified,
                  passPercent: passPct,
                  excellentPercent: excPct,
                });
                if (res) {
                  setExportOpen(false);
                  onNotify(`已导出精美 HTML 报告至 ${res.path}`);
                }
              }}
            >
              导出离线 HTML 报告
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          {[
            [false, '匿名脱敏版（推荐教研分享）', '以“学生1、学生2…”替代姓名并隐藏学号'],
            [true, '完整实名版（限本人归档）', '保留完整姓名与班内学号'],
          ].map(([flag, title, desc]) => (
            <button
              key={String(flag)}
              type="button"
              onClick={() => setExportIdentified(Boolean(flag))}
              className={`p-3 rounded-xl border text-left cursor-pointer ${
                exportIdentified === flag
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="text-[13px] font-semibold">{String(title)}</div>
              <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">{String(desc)}</div>
            </button>
          ))}
        </div>
      </Modal>

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
