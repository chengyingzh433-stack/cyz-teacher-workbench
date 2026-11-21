import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function EChart({
  option,
  height = 240,
  className = '',
  onPointClick,
}: {
  option: echarts.EChartsOption;
  height?: number;
  className?: string;
  onPointClick?: (params: { name: string; dataIndex: number; seriesName?: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    chart.on('click', (params) => {
      clickRef.current?.({
        name: String(params.name ?? ''),
        dataIndex: Number(params.dataIndex ?? 0),
        seriesName: params.seriesName ? String(params.seriesName) : undefined,
      });
    });

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} style={{ height }} className={`w-full ${className}`} />;
}
