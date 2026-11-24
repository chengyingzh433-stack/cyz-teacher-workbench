import { useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import { ArrowUpDown, Bot, Download, History, Search, UserPlus, X } from 'lucide-react';
import type { ExamDetail, ScoreStatus, StudentMember } from '../../../shared/types';
import { analyzeExamColumn, bandLabelOf, cellStatusLabels } from '../../../shared/gradebook/analysis';
import { formatScore } from '../../../shared/score-policy';
import { getTheme } from '../../themes';
import { Badge, Button, Card, Input, Select } from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';

export interface ScoreEditDraft {
  membershipId: string;
  studentName: string;
  columnId: string;
  columnLabel: string;
  status: ScoreStatus;
  value: string;
  reason: string;
}

export function ExamAnalyticsView({
  detail,
  members,
  effectiveColId,
  onSelectColumn,
  passPct,
  excPct,
  themeId,
  readonly,
  onAppendImport,
  onOpenQuickScore,
  onOpenTutor,
  onOpenExport,
  onOpenStudentProfile,
  onEditScoreCell,
}: {
  detail: ExamDetail;
  members: StudentMember[];
  effectiveColId: string;
  onSelectColumn: (columnId: string) => void;
  passPct: number;
  excPct: number;
  themeId: string;
  readonly: boolean;
  onAppendImport: () => void;
  onOpenQuickScore: () => void;
  onOpenTutor: () => void;
  onOpenExport: () => void;
  onOpenStudentProfile: (membershipId: string) => void;
  onEditScoreCell: (draft: ScoreEditDraft) => void;
}) {
  const [bandMode, setBandMode] = useState<'auto' | '10' | '5'>('auto');
  const [bandFilter, setBandFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'default' | 'desc' | 'asc'>('default');

  useEffect(() => {
    setBandFilter(null);
  }, [detail.exam.id, effectiveColId]);

  const analysis = useMemo(() => {
    if (!effectiveColId) return null;
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
    for (const s of detail.scores) map.set(`${s.membershipId}:${s.columnId}`, s);
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

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
      {/* Subject Column Picker + Export + AI Tutor */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {detail.columns.length > 0 && (
            <Select
              value={effectiveColId}
              onValueChange={(v) => {
                onSelectColumn(v);
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
          <Button size="sm" variant="ghost" disabled={readonly} onClick={onAppendImport}>
            覆盖 / 追加表格至本场
          </Button>
          {!readonly && (
            <Button size="sm" variant="soft" onClick={onOpenQuickScore}>
              <UserPlus className="w-4 h-4" /> 录分 / 加人
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="soft" onClick={onOpenTutor}>
            <Bot className="w-4 h-4" /> AI 学情对话助教
          </Button>
          <Button size="sm" onClick={onOpenExport}>
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
                  <span>
                    缺考 {analysis.statusCounts.absent} · 免考 {analysis.statusCounts.exempt} · 未录{' '}
                    {analysis.statusCounts.missing}
                  </span>
                  {analysis.maxUnits !== null && <span>· 满分 {formatScore(analysis.maxUnits)} 分</span>}
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
            {!readonly && (
              <Button size="xs" variant="soft" onClick={onOpenQuickScore}>
                <UserPlus className="w-3.5 h-3.5" /> 录分 / 加人
              </Button>
            )}
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
                              onEditScoreCell({
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
  );
}
