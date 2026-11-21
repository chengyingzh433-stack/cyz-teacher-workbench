import {
  AppError,
  type ExamColumn,
  type ExamScoreCell,
  type ScoreStatus,
  type StudentMember,
} from '../types';

export interface ColumnAnalysis {
  columnId: string;
  label: string;
  maxUnits: number | null;
  count: number;
  totalStudents: number;
  statusCounts: { absent: number; missing: number; exempt: number };
  meanUnits: number | null;
  medianUnits: number | null;
  minUnits: number | null;
  maxObservedUnits: number | null;
  stdDevUnits: number | null;
  passCount: number | null;
  excellentCount: number | null;
  valuesByMember: Map<string, { status: ScoreStatus; units: number | null; rank: number | null }>;
  bands: Array<{ label: string; count: number; pct: number; minInclusive?: number; maxExclusive?: number }>;
}

export const cellStatusLabels: Record<ScoreStatus, string> = {
  score: '有成绩',
  missing: '未录入',
  absent: '缺考',
  exempt: '免考',
};

export function bandLabelOf(value: number, maxUnits: number | null, mode: 'auto' | '10' | '5'): string {
  if (mode === 'auto' && maxUnits !== null && maxUnits > 0) {
    const p = (value * 100) / maxUnits;
    if (p < 60) return '不足 60%';
    if (p < 70) return '60%–70%';
    if (p < 80) return '70%–80%';
    if (p < 90) return '80%–90%';
    return '90%–100%';
  }
  const pts = mode === '5' ? 5 : 10;
  const lo = Math.floor(value / (pts * 100)) * pts;
  return `${lo}–${lo + pts} 分`;
}

export function analyzeExamColumn(params: {
  columns: ExamColumn[];
  scores: ExamScoreCell[];
  members: StudentMember[];
  columnId: string; // specific columnId or 'computed'
  passPercent?: number;
  excellentPercent?: number;
  bandMode?: 'auto' | '10' | '5';
}): ColumnAnalysis {
  const {
    columns,
    scores,
    members,
    columnId,
    passPercent = 60,
    excellentPercent = 85,
    bandMode = 'auto',
  } = params;

  if (
    !Number.isFinite(passPercent) ||
    !Number.isFinite(excellentPercent) ||
    passPercent < 0 ||
    excellentPercent > 100 ||
    excellentPercent < passPercent
  ) {
    throw new AppError('GRADE_ANALYSIS', '及格/优秀比例须在 0–100 且优秀线不低于及格线');
  }

  const scoreMap = new Map<string, ExamScoreCell>();
  for (const sc of scores) scoreMap.set(`${sc.membershipId}:${sc.columnId}`, sc);

  const scoreCols = columns.filter((c) => c.role === 'score');
  const col = columns.find((c) => c.id === columnId);

  const maxUnits =
    columnId === 'computed'
      ? scoreCols.length > 0 && scoreCols.every((c) => c.maxUnits !== null)
        ? scoreCols.reduce((s, c) => s + c.maxUnits!, 0)
        : null
      : (col?.maxUnits ?? null);

  const memberIds = members.length
    ? members.map((m) => m.membershipId)
    : [...new Set(scores.map((s) => s.membershipId))];

  const rawByMember = new Map<string, { status: ScoreStatus; units: number | null }>();
  const statusCounts = { absent: 0, missing: 0, exempt: 0 };
  const validValues: number[] = [];

  for (const mid of memberIds) {
    if (columnId === 'computed') {
      if (!scoreCols.length) {
        rawByMember.set(mid, { status: 'missing', units: null });
        statusCounts.missing++;
        continue;
      }
      let sum = 0;
      let complete = true;
      let hasAbsent = false;
      for (const scCol of scoreCols) {
        const cell = scoreMap.get(`${mid}:${scCol.id}`);
        if (!cell || cell.status !== 'score' || cell.units === null) {
          complete = false;
          if (cell?.status === 'absent') hasAbsent = true;
        } else {
          sum += cell.units;
        }
      }
      if (complete) {
        rawByMember.set(mid, { status: 'score', units: sum });
        validValues.push(sum);
      } else {
        const st: ScoreStatus = hasAbsent ? 'absent' : 'missing';
        rawByMember.set(mid, { status: st, units: null });
        statusCounts[st]++;
      }
    } else {
      const cell = scoreMap.get(`${mid}:${columnId}`);
      if (cell && cell.status === 'score' && cell.units !== null) {
        rawByMember.set(mid, { status: 'score', units: cell.units });
        validValues.push(cell.units);
      } else {
        const st: ScoreStatus = cell?.status === 'absent' || cell?.status === 'exempt' ? cell.status : 'missing';
        rawByMember.set(mid, { status: st, units: null });
        statusCounts[st]++;
      }
    }
  }

  const ordered = [...validValues].sort((a, b) => a - b);
  const count = ordered.length;
  const rankMap = new Map<number, number>();
  [...ordered].reverse().forEach((val, idx) => {
    if (!rankMap.has(val)) rankMap.set(val, idx + 1);
  });

  const valuesByMember = new Map<
    string,
    { status: ScoreStatus; units: number | null; rank: number | null }
  >();
  for (const [mid, item] of rawByMember) {
    valuesByMember.set(mid, {
      ...item,
      rank: item.units !== null ? (rankMap.get(item.units) ?? null) : null,
    });
  }

  const meanUnits = count ? ordered.reduce((s, v) => s + v, 0) / count : null;
  const medianUnits = count
    ? (ordered[Math.floor((count - 1) / 2)] + ordered[Math.floor(count / 2)]) / 2
    : null;
  const stdDevUnits =
    count && meanUnits !== null
      ? Math.sqrt(ordered.reduce((s, v) => s + (v - meanUnits) ** 2, 0) / count)
      : null;

  const passCount =
    count && maxUnits !== null ? ordered.filter((v) => v * 100 >= maxUnits * passPercent).length : null;
  const excellentCount =
    count && maxUnits !== null
      ? ordered.filter((v) => v * 100 >= maxUnits * excellentPercent).length
      : null;

  const bandCounts = new Map<string, number>();
  const bandOrder =
    bandMode === 'auto' && maxUnits !== null
      ? ['90%–100%', '80%–90%', '70%–80%', '60%–70%', '不足 60%']
      : null;
  if (bandOrder) {
    for (const label of bandOrder) bandCounts.set(label, 0);
  }
  for (const v of [...ordered].reverse()) {
    const label = bandLabelOf(v, maxUnits, bandMode);
    bandCounts.set(label, (bandCounts.get(label) || 0) + 1);
  }
  const bands = [...bandCounts.entries()]
    .filter(([, c]) => bandOrder !== null || c > 0)
    .map(([label, c]) => ({ label, count: c, pct: count ? (c / count) * 100 : 0 }));

  return {
    columnId,
    label: columnId === 'computed' ? '所选科目合计' : col?.label || '未选择',
    maxUnits,
    count,
    totalStudents: memberIds.length,
    statusCounts,
    meanUnits,
    medianUnits,
    minUnits: count ? ordered[0] : null,
    maxObservedUnits: count ? ordered[count - 1] : null,
    stdDevUnits,
    passCount,
    excellentCount,
    valuesByMember,
    bands,
  };
}
