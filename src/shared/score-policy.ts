import { AppError, type Rubric } from './types';

export type ScoreInput = { criterionId: string; value: string; reason: string };

export function parsePoints(value: string): number {
  const clean = value.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(clean)) {
    throw new AppError('SCORE', '请输入非负分数，最多两位小数；不接受算式');
  }
  const [whole, fraction = ''] = clean.split('.');
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(units) || units > 1000000) {
    throw new AppError('SCORE', '分数超过 10000 分上限');
  }
  return units;
}

export function points(units: number): string {
  const rounded = Math.round(units);
  const whole = Math.floor(rounded / 100);
  const rem = rounded % 100;
  return rem ? `${whole}.${String(rem).padStart(2, '0').replace(/0$/, '')}` : String(whole);
}

export function formatScore(units: number | null | undefined): string {
  if (units === null || units === undefined || !Number.isFinite(units)) return '—';
  return (units / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

export function calculateScores(rubric: Rubric, inputs: ScoreInput[]) {
  const byId = new Map(inputs.map((s) => [s.criterionId, s]));
  if (inputs.length !== rubric.criteria.length || byId.size !== inputs.length) {
    throw new AppError('SCORE', '评分点缺失或重复');
  }
  const groups = new Set<string>();
  const totals = new Map<string, number>();
  const scores = rubric.criteria.map((c) => {
    const input = byId.get(c.id);
    if (!input) throw new AppError('SCORE', '评分点与当前细则不一致');
    const units = parsePoints(input.value);
    if (units > c.maxUnits) {
      throw new AppError('SCORE', `「${c.description}」不能超过 ${points(c.maxUnits)} 分`);
    }
    if (c.stepUnits > 0 && units % c.stepUnits !== 0) {
      const lower = units - (units % c.stepUnits);
      const higher = Math.min(c.maxUnits, lower + c.stepUnits);
      throw new AppError(
        'SCORE',
        `「${c.description}」步长为 ${points(c.stepUnits)}；原值 ${input.value}，相邻合法分为 ${points(lower)} / ${points(higher)}`,
      );
    }
    if (c.exclusiveGroup && units > 0) {
      if (groups.has(c.exclusiveGroup)) {
        throw new AppError('SCORE', `互斥组「${c.exclusiveGroup}」只能选择一个得分点`);
      }
      groups.add(c.exclusiveGroup);
    }
    totals.set(c.scoringUnitId, (totals.get(c.scoringUnitId) || 0) + units);
    return { criterionId: c.id, units, reason: input.reason.trim() };
  });
  return { scores, totals, totalUnits: scores.reduce((sum, score) => sum + score.units, 0) };
}
