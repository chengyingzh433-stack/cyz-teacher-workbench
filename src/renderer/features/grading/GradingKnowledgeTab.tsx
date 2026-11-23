import { useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import type { ExamDetail, GradingItemDetail, KnowledgeStatRow } from '../../../shared/types';
import { getTheme } from '../../themes';
import { Badge, Button, Card, Input } from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';

export function GradingKnowledgeTab({
  detail,
  currentItem,
  themeId,
  readonly,
  onReloadExam,
  onNotify,
}: {
  detail: ExamDetail;
  currentItem: GradingItemDetail | null;
  themeId: string;
  readonly: boolean;
  onReloadExam: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [kpInput, setKpInput] = useState('');
  const [kpStats, setKpStats] = useState<KnowledgeStatRow[]>([]);
  const [kpWeights, setKpWeights] = useState<Record<string, number>>({});

  useEffect(() => {
    window.workbenchApi.grading.getKnowledgeStats(detail.exam.id).then(setKpStats);
  }, [detail.exam.id, detail.gradingItems]);

  const theme = getTheme(themeId);
  const kpChartOption: echarts.EChartsOption | null = useMemo(() => {
    if (!kpStats.length) return null;
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
          const row = kpStats[idx];
          return `${row.name}<br/>得分率：<b>${row.rate.toFixed(1)}%</b><br/>关联题目：${row.itemLabels.join('、') || '无'}`;
        },
      },
      grid: { top: 12, right: 32, bottom: 20, left: 110 },
      xAxis: {
        type: 'value',
        max: 100,
        axisLabel: { color: p.muted, formatter: '{value}%' },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: kpStats.map((k) => k.name),
        axisLabel: { color: p.text, fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          data: kpStats.map((k) => ({
            value: Number(k.rate.toFixed(1)),
            itemStyle: {
              borderRadius: [0, 6, 6, 0],
              color: k.rate < 60 ? '#be2d24' : k.rate < 80 ? '#d97706' : p.primary,
            },
          })),
        },
      ],
    };
  }, [kpStats, theme]);

  return (
    <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-3 pr-1">
      <Card className="p-4 flex flex-col gap-3">
        <h4 className="text-[14px] font-semibold">本场知识点管理与权重分配</h4>
        <div className="flex gap-2">
          <Input
            value={kpInput}
            onChange={(e) => setKpInput(e.target.value)}
            placeholder="输入知识点（逗号分隔批量添加，如：牛顿第二定律, 受力分析, 图像法）"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={readonly || !kpInput.trim()}
            onClick={async () => {
              const nextNames = [
                ...detail.knowledgePoints.map((k) => k.name),
                ...kpInput.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean),
              ];
              await window.workbenchApi.grading.saveKnowledgePoints(detail.exam.id, nextNames);
              setKpInput('');
              await onReloadExam();
              onNotify('已更新本场知识点');
            }}
          >
            添加
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {detail.knowledgePoints.map((kp) => (
            <Badge key={kp.id} tone="accent">
              {kp.name}
            </Badge>
          ))}
        </div>

        {currentItem && detail.knowledgePoints.length > 0 && (
          <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                为「第 {currentItem.label} 题」分配知识点权重（合计 100%）
              </span>
              <Button
                size="xs"
                onClick={() => {
                  const n = detail.knowledgePoints.length;
                  const each = Math.floor(100 / n);
                  const next: Record<string, number> = {};
                  detail.knowledgePoints.forEach((k, i) => {
                    next[k.id] = i === 0 ? 100 - each * (n - 1) : each;
                  });
                  setKpWeights(next);
                }}
              >
                一键均分
              </Button>
            </div>
            {detail.knowledgePoints.map((kp) => (
              <div key={kp.id} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate">{kp.name}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={kpWeights[kp.id] ?? 0}
                  onChange={(e) =>
                    setKpWeights({ ...kpWeights, [kp.id]: Math.max(0, Math.min(100, Number(e.target.value))) })
                  }
                  className="w-16 h-7 px-2 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] tabular-nums"
                />
                <span>%</span>
              </div>
            ))}
            <Button
              size="sm"
              variant="primary"
              disabled={readonly}
              onClick={async () => {
                try {
                  const allocs = detail.knowledgePoints
                    .map((k) => ({ knowledgeId: k.id, weightBps: (kpWeights[k.id] || 0) * 100 }))
                    .filter((a) => a.weightBps > 0);
                  await window.workbenchApi.grading.saveItemKnowledgeMap(currentItem.id, allocs);
                  const st = await window.workbenchApi.grading.getKnowledgeStats(detail.exam.id);
                  setKpStats(st);
                  await onReloadExam();
                  onNotify('已保存知识点权重并刷新讲评统计');
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                }
              }}
            >
              保存权重映射
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <h4 className="text-[14px] font-semibold">薄弱知识点得分率排行（讲评优先级）</h4>
        {kpChartOption ? (
          <EChart option={kpChartOption} height={260} />
        ) : (
          <div className="py-16 text-center text-xs text-[var(--ink-muted)]">
            给主观题分配知识点权重并确认至少 1 份答卷得分后，这里将自动生成薄弱点排行图。
          </div>
        )}
      </Card>
    </div>
  );
}
