import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import {
  BarChart3,
  ClipboardCheck,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  ClassRecord,
  HomeroomCheckBatch,
  HomeroomMonthlyStatsView,
  StudentMember,
} from '../../../shared/types';
import {
  HOMEROOM_CHECK_KINDS,
  localCurrentMonth,
} from '../../../shared/homeroom-materials';
import { getTheme } from '../../themes';
import { Badge, Button, Card, Input } from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';

function calcRate(num: number, den: number): { text: string; pct: number | null; low: boolean } {
  if (den <= 0) return { text: '--', pct: null, low: false };
  const pct = Math.round((Math.max(0, num) / den) * 1000) / 10;
  return { text: `${pct}%`, pct, low: pct < 90 };
}

export function MonthlyStatsTab({
  cls,
  members,
  themeId,
  readonly,
  onJumpToClassroom,
  onOpenStudentProfile,
  onNotify,
}: {
  cls: ClassRecord;
  members: StudentMember[];
  themeId: string;
  readonly: boolean;
  onJumpToClassroom: () => void;
  onOpenStudentProfile: (membershipId: string) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [yearMonth, setYearMonth] = useState(() => localCurrentMonth());
  const [statsView, setStatsView] = useState<HomeroomMonthlyStatsView | null>(null);
  const [batches, setBatches] = useState<HomeroomCheckBatch[]>([]);
  const [saving, setSaving] = useState(false);

  // Manual form state (mirrors effective values for easy editing)
  const [fClassSize, setFClassSize] = useState('');
  const [fAttend, setFAttend] = useState('');
  const [fAbsent, setFAbsent] = useState('');
  const [fHwShould, setFHwShould] = useState('');
  const [fHwMiss, setFHwMiss] = useState('');
  const [fDiscipline, setFDiscipline] = useState('');
  const [fReceiptShould, setFReceiptShould] = useState('');
  const [fReceiptGot, setFReceiptGot] = useState('');

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.membershipId, m])),
    [members],
  );

  const loadMonth = useCallback(
    async (ym: string) => {
      const [view, list] = await Promise.all([
        window.workbenchApi.homeroom.getMonthlyStats(cls.id, ym),
        window.workbenchApi.homeroom.listCheckBatches(cls.id, ym),
      ]);
      setStatsView(view);
      setBatches(list);
      const src = view.effective;
      setFClassSize(String(src.classSize || members.length || ''));
      setFAttend(String(src.attendCount));
      setFAbsent(String(src.absentCount));
      setFHwShould(String(src.hwShould));
      setFHwMiss(String(src.hwMiss));
      setFDiscipline(String(src.disciplineCount));
      setFReceiptShould(String(src.receiptShould));
      setFReceiptGot(String(src.receiptGot));
    },
    [cls.id, members.length],
  );

  useEffect(() => {
    void loadMonth(yearMonth);
  }, [yearMonth, loadMonth]);

  const theme = getTheme(themeId);
  const eff = statsView?.effective;

  const attendRate = eff ? calcRate(eff.attendCount, eff.attendCount + eff.absentCount) : calcRate(0, 0);
  const hwRate = eff ? calcRate(eff.hwShould - eff.hwMiss, eff.hwShould) : calcRate(0, 0);
  const safeRate = eff ? calcRate(eff.receiptGot, eff.receiptShould) : calcRate(0, 0);

  const chartOption: echarts.EChartsOption | null = useMemo(() => {
    if (!eff) return null;
    const p = theme.chartPalette;
    const labels = [
      '出勤人次',
      '缺勤人次',
      '作业缺交',
      '违纪记录',
      '班会开展',
      '家校沟通',
      '回执回收',
    ];
    const values = [
      eff.attendCount,
      eff.absentCount,
      eff.hwMiss,
      eff.disciplineCount,
      eff.meetingCount,
      eff.commCount,
      eff.receiptGot,
    ];
    const colors = [p.primary, '#dc2626', '#d97706', '#7c3aed', '#2563eb', p.secondary, '#15803d'];

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
      },
      grid: { top: 14, right: 42, bottom: 18, left: 78 },
      xAxis: {
        type: 'value',
        axisLabel: { color: p.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: labels,
        axisLabel: { color: p.text, fontSize: 12 },
        axisLine: { lineStyle: { color: p.grid } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          label: {
            show: true,
            position: 'right',
            color: p.text,
            fontSize: 11.5,
            fontWeight: 600,
          },
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: colors[i],
              borderRadius: [0, 6, 6, 0],
            },
          })),
        },
      ],
    };
  }, [eff, theme]);

  async function handleSaveManual() {
    if (readonly) return;
    setSaving(true);
    try {
      await window.workbenchApi.homeroom.saveMonthlyManualStats({
        classId: cls.id,
        yearMonth,
        classSize: Number(fClassSize) || 0,
        attendCount: Number(fAttend) || 0,
        absentCount: Number(fAbsent) || 0,
        hwShould: Number(fHwShould) || 0,
        hwMiss: Number(fHwMiss) || 0,
        disciplineCount: Number(fDiscipline) || 0,
        receiptShould: Number(fReceiptShould) || 0,
        receiptGot: Number(fReceiptGot) || 0,
      });
      await loadMonth(yearMonth);
      onNotify(`${yearMonth} 月度管理数据已保存`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Month Bar & Data Source Banner */}
      <Card className="px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[13.5px] font-semibold">统计月份</span>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[13px] text-[var(--ink-primary)]"
          />
          {statsView && (
            <Badge tone={statsView.hasManualOverride ? 'warn' : 'ok'}>
              {statsView.hasManualOverride
                ? '当前：手动微调覆盖模式'
                : `当前：教室点检自动汇总（本月 ${statsView.auto.batchCount} 次点检）`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {statsView?.hasManualOverride && !readonly && (
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => {
                await window.workbenchApi.homeroom.clearMonthlyManualStats(cls.id, yearMonth);
                await loadMonth(yearMonth);
                onNotify('已恢复按教室点检记录自动汇总');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> 恢复自动汇总
            </Button>
          )}
          <Button size="xs" variant="soft" onClick={onJumpToClassroom}>
            <ClipboardCheck className="w-3.5 h-3.5" /> 去互动教室发起点检
          </Button>
        </div>
      </Card>

      {/* 3 Core Rate KPIs + 2 Auto Linked KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-3.5">
          <div className="text-xs text-[var(--ink-muted)]">月度出勤率</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 ${
              attendRate.low ? 'text-[var(--danger)]' : 'text-[var(--accent)]'
            }`}
          >
            {attendRate.text}
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] mt-1 tabular-nums">
            {eff ? `${eff.attendCount} / ${eff.attendCount + eff.absentCount} 人次` : '—'}
          </div>
        </Card>

        <Card className="p-3.5">
          <div className="text-xs text-[var(--ink-muted)]">作业完成率</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 ${
              hwRate.low ? 'text-[var(--danger)]' : 'text-[var(--accent)]'
            }`}
          >
            {hwRate.text}
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] mt-1 tabular-nums">
            {eff ? `${Math.max(0, eff.hwShould - eff.hwMiss)} / ${eff.hwShould} 人次` : '—'}
          </div>
        </Card>

        <Card className="p-3.5">
          <div className="text-xs text-[var(--ink-muted)]">安全工作落实率</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 ${
              safeRate.low ? 'text-[var(--danger)]' : 'text-[var(--accent)]'
            }`}
          >
            {safeRate.text}
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] mt-1 tabular-nums">
            {eff ? `${eff.receiptGot} / ${eff.receiptShould} 份回执` : '—'}
          </div>
        </Card>

        <Card className="p-3.5 bg-[var(--bg-muted)]/40">
          <div className="text-xs text-[var(--ink-muted)]">班会开展次数（自动）</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[var(--info)]">
            {eff?.meetingCount ?? 0}
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] mt-1">源自「班会德育打卡」</div>
        </Card>

        <Card className="p-3.5 bg-[var(--bg-muted)]/40">
          <div className="text-xs text-[var(--ink-muted)]">家校沟通次数（自动）</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-[var(--ok)]">
            {eff?.commCount ?? 0}
          </div>
          <div className="text-[11px] text-[var(--ink-muted)] mt-1">源自「家校沟通台账」</div>
        </Card>
      </div>

      {/* ECharts 7-Dimension Horizontal Bar Chart */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-[14.5px] font-semibold flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-[var(--accent)]" /> {yearMonth} 月度班级管理数据一览
            </h3>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              联动当前主题色板，方便月底复盘与班主任工作总结
            </p>
          </div>
        </div>
        {chartOption && <EChart option={chartOption} height={260} />}
      </Card>

      {/* Bottom Split: Left = Check Batches Log, Right = Manual Override Form */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-semibold">本月教室点检流水 ({batches.length})</h3>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                在互动教室点击座位即可留存点检记录，自动计入本月统计
              </p>
            </div>
          </div>

          {batches.length > 0 ? (
            <div className="flex flex-col gap-2">
              {batches.map((b) => {
                const def = HOMEROOM_CHECK_KINDS[b.kind];
                return (
                  <div
                    key={b.id}
                    className="rounded-xl border border-[var(--border-subtle)] p-3 flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge tone="accent">{def.label}</Badge>
                        <span className="text-[13.5px] font-semibold">{b.title}</span>
                        <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {b.checkDate}
                        </span>
                      </div>
                      {!readonly && (
                        <Button
                          size="xs"
                          variant="danger-ghost"
                          onClick={async () => {
                            await window.workbenchApi.homeroom.deleteCheckBatch(b.id);
                            await loadMonth(yearMonth);
                            onNotify('已删除该条点检记录');
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-[var(--ink-secondary)]">
                      总计 {b.totalCount} 人 · {def.anomalyLabel}{' '}
                      <strong className={b.anomalyMemberIds.length > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}>
                        {b.anomalyMemberIds.length} 人
                      </strong>
                    </div>
                    {b.anomalyMemberIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {b.anomalyMemberIds.map((mid) => {
                          const m = memberMap.get(mid);
                          return (
                            <button
                              key={mid}
                              type="button"
                              onClick={() => onOpenStudentProfile(mid)}
                              className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--danger-soft)] text-[var(--danger)] hover:brightness-95 cursor-pointer"
                            >
                              {m ? m.name : '已移出学生'}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-[var(--ink-muted)]">
              本月暂无教室点检记录。可前往「互动教室 → 快速点检」点选座位，或在右侧直接录入月度汇总数据。
            </div>
          )}
        </Card>

        <Card className="p-4 flex flex-col gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">月度汇总数据手动修正 / 录入</h3>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">
              如月底已有纸质统计表，可在此直接录入或微调并覆盖自动汇总值
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              ['班级人数', fClassSize, setFClassSize],
              ['当月出勤人次', fAttend, setFAttend],
              ['当月缺勤人次', fAbsent, setFAbsent],
              ['作业应交人次', fHwShould, setFHwShould],
              ['作业缺交人次', fHwMiss, setFHwMiss],
              ['学生违纪记录次数', fDiscipline, setFDiscipline],
              ['安全回执应回收', fReceiptShould, setFReceiptShould],
              ['安全回执已回收', fReceiptGot, setFReceiptGot],
            ].map(([label, val, setter]) => (
              <label key={String(label)} className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                {String(label)}
                <Input
                  type="number"
                  min={0}
                  disabled={readonly}
                  value={String(val)}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                  className="h-8 text-[13px] tabular-nums"
                />
              </label>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="primary"
              disabled={readonly || saving}
              onClick={() => void handleSaveManual()}
            >
              <Save className="w-3.5 h-3.5" /> {saving ? '保存中…' : '保存本月手动数据'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
