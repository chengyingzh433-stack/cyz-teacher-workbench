import { AppError } from '../../app/model';
import type { GradeImport } from './model';
export function columnValues(batch: GradeImport, key: string): (number | null)[] {
  if (key === 'computed') {
    const indices = batch.columns.flatMap((c, i) => (c.role === 'score' ? [i] : []));
    return batch.rows.map((r) =>
      indices.length && indices.every((i) => r.cells[i].status === 'score')
        ? indices.reduce((sum, i) => sum + r.cells[i].units!, 0)
        : null,
    );
  }
  const index = batch.columns.findIndex((c) => c.key === key);
  if (index < 0) throw new AppError('GRADE_ANALYSIS', '请选择有效成绩列');
  return batch.rows.map((r) => (r.cells[index].status === 'score' ? r.cells[index].units : null));
}
export function analyzeGrades(
  batch: GradeImport,
  key: string,
  passPercent = 60,
  excellentPercent = 85,
) {
  if (
    !Number.isFinite(passPercent) ||
    !Number.isFinite(excellentPercent) ||
    passPercent < 0 ||
    excellentPercent > 100 ||
    excellentPercent < passPercent
  )
    throw new AppError('GRADE_ANALYSIS', '比例须为 0—100，优秀线不低于及格线');
  const values = columnValues(batch, key),
    ordered = values.filter((x): x is number => x !== null).sort((a, b) => a - b),
    count = ordered.length;
  const column = batch.columns.find((c) => c.key === key),
    subjects = batch.columns.filter((c) => c.role === 'score');
  const max =
    key === 'computed'
      ? subjects.length && subjects.every((c) => c.maxUnits !== null)
        ? subjects.reduce((sum, c) => sum + c.maxUnits!, 0)
        : null
      : column!.maxUnits;
  const ranks = new Map<number, number>();
  [...ordered].reverse().forEach((value, index) => {
    if (!ranks.has(value)) ranks.set(value, index + 1);
  });
  const histogram = new Map<string, number>();
  for (const value of ordered) {
    const band =
      max !== null
        ? (value * 100) / max < 60
          ? '不足60%'
          : (value * 100) / max < 70
            ? '60%—不足70%'
            : (value * 100) / max < 80
              ? '70%—不足80%'
              : (value * 100) / max < 90
                ? '80%—不足90%'
                : '90%—100%'
        : `${Math.floor(value / 1000) * 10}—不足${Math.floor(value / 1000) * 10 + 10}分`;
    histogram.set(band, (histogram.get(band) || 0) + 1);
  }
  const columnIndex = batch.columns.findIndex((c) => c.key === key);
  const statusCounts = { absent: 0, missing: 0, exempt: 0 };
  if (columnIndex >= 0)
    for (const row of batch.rows) {
      const status = row.cells[columnIndex].status;
      if (status !== 'score') statusCounts[status]++;
    }
  else statusCounts.missing = values.filter((v) => v === null).length;
  const mean = count ? ordered.reduce((sum, x) => sum + x, 0) / count : null;
  return {
    key,
    label: key === 'computed' ? '所选科目合计' : column!.label,
    values,
    ranks: values.map((x) => (x === null ? null : ranks.get(x)!)),
    count,
    excluded: batch.rows.length - count,
    statusCounts,
    maxUnits: max,
    meanUnits: mean,
    medianUnits: count
      ? (ordered[Math.floor((count - 1) / 2)] + ordered[Math.floor(count / 2)]) / 2
      : null,
    minUnits: count ? ordered[0] : null,
    maxObservedUnits: count ? ordered[count - 1] : null,
    pass: count && max !== null ? ordered.filter((v) => v * 100 >= max * passPercent).length : null,
    excellent:
      count && max !== null
        ? ordered.filter((v) => v * 100 >= max * excellentPercent).length
        : null,
    histogram: [...histogram].map(([label, count]) => ({ label, count })),
  };
}
export const formatScore = (units: number | null) =>
  units === null
    ? '—'
    : (units / 100)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
export const cellLabels = { score: '有成绩', missing: '未录入', absent: '缺考', exempt: '免考' };
export function totalDifferences(batch: GradeImport) {
  const sum = columnValues(batch, 'computed');
  return batch.rows.flatMap((row, index) =>
    batch.columns.flatMap((c, col) =>
      c.role === 'total' &&
      row.cells[col].status === 'score' &&
      sum[index] !== null &&
      sum[index] !== row.cells[col].units
        ? [
            {
              line: row.line,
              membershipId: row.membershipId,
              column: c.label,
              provided: row.cells[col].units!,
              computed: sum[index]!,
            },
          ]
        : [],
    ),
  );
}
