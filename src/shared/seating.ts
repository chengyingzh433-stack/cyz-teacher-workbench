import {
  AppError,
  type ScoreSeatingStrategy,
  type SeatAssignment,
  type SeatPlan,
  type StudentMember,
} from './types';

export function validateDimensions(rows: number, cols: number) {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows < 1 ||
    rows > 12 ||
    cols < 1 ||
    cols > 16
  ) {
    throw new AppError('VALIDATION', '请输入 1–12 行、1–16 列的整数');
  }
}

export function waitingMembers(plan: SeatPlan, members: StudentMember[]): StudentMember[] {
  const seated = new Set(plan.assignments.map((x) => x.membershipId));
  return members.filter((x) => x.status === 'active' && !seated.has(x.membershipId));
}

export function resizeAssignments(
  plan: SeatPlan,
  members: StudentMember[],
  rows: number,
  cols: number,
): SeatAssignment[] {
  validateDimensions(rows, cols);
  const active = members.filter((m) => m.status === 'active');
  const valid = new Set(active.map((x) => x.membershipId));
  const kept = plan.assignments
    .filter((x) => valid.has(x.membershipId) && x.row < rows && x.col < cols)
    .map((x) => ({ ...x }));
  const seated = new Set(kept.map((x) => x.membershipId));
  const pending = active.filter((x) => !seated.has(x.membershipId));
  const filled = new Set(kept.map((x) => `${x.row},${x.col}`));
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!filled.has(`${row},${col}`) && index < pending.length) {
        kept.push({ membershipId: pending[index++].membershipId, row, col });
      }
    }
  }
  return kept;
}

export function sequentialAssignments(
  rows: number,
  cols: number,
  members: StudentMember[],
): SeatAssignment[] {
  validateDimensions(rows, cols);
  const active = members.filter((m) => m.status === 'active');
  const result: SeatAssignment[] = [];
  let idx = 0;
  for (let row = 0; row < rows && idx < active.length; row++) {
    for (let col = 0; col < cols && idx < active.length; col++) {
      result.push({ membershipId: active[idx++].membershipId, row, col });
    }
  }
  return result;
}

export function moveSeat(
  plan: SeatPlan,
  members: StudentMember[],
  sourceMembershipId: string,
  target: { row: number; col: number } | null,
): SeatAssignment[] {
  if (!members.some((x) => x.status === 'active' && x.membershipId === sourceMembershipId)) {
    throw new AppError('VALIDATION', '该学生已不在当前在读名单');
  }
  if (
    target &&
    (!Number.isInteger(target.row) ||
      !Number.isInteger(target.col) ||
      target.row < 0 ||
      target.row >= plan.rows ||
      target.col < 0 ||
      target.col >= plan.cols)
  ) {
    throw new AppError('VALIDATION', '目标座位无效');
  }
  const from = plan.assignments.find((x) => x.membershipId === sourceMembershipId);
  const to = target
    ? plan.assignments.find((x) => x.row === target.row && x.col === target.col)
    : undefined;
  if ((from && to?.membershipId === from.membershipId) || (!from && !target)) {
    return plan.assignments.map((x) => ({ ...x }));
  }
  const next = plan.assignments
    .filter((x) => x.membershipId !== sourceMembershipId && x.membershipId !== to?.membershipId)
    .map((x) => ({ ...x }));
  if (target) next.push({ membershipId: sourceMembershipId, row: target.row, col: target.col });
  if (from && to) next.push({ membershipId: to.membershipId, row: from.row, col: from.col });
  return next;
}

export function exchangeSeats(
  plan: SeatPlan,
  members: StudentMember[],
  firstId: string,
  secondId: string,
): SeatAssignment[] {
  if (firstId === secondId) return plan.assignments.map((x) => ({ ...x }));
  const target = plan.assignments.find((x) => x.membershipId === secondId);
  if (target) return moveSeat(plan, members, firstId, { row: target.row, col: target.col });
  const source = plan.assignments.find((x) => x.membershipId === firstId);
  return source
    ? moveSeat(plan, members, secondId, { row: source.row, col: source.col })
    : plan.assignments.map((x) => ({ ...x }));
}

/** Smart seating using exam scores (S-snake, high-low desk pairs, gradient, balanced groups). */
export function arrangeByScores(params: {
  rows: number;
  cols: number;
  members: StudentMember[];
  scoreByMember: Map<string, number | null>;
  strategy: ScoreSeatingStrategy;
}): SeatAssignment[] {
  const { rows, cols, members, scoreByMember, strategy } = params;
  validateDimensions(rows, cols);
  const active = members.filter((m) => m.status === 'active');
  const sorted = [...active].sort((a, b) => {
    const sa = scoreByMember.get(a.membershipId) ?? -1;
    const sb = scoreByMember.get(b.membershipId) ?? -1;
    return sb - sa || a.sortOrder - b.sortOrder;
  });

  let ordered: StudentMember[];
  if (strategy === 'pair-help') {
    // Pair top half with bottom half so desk-mates (pairs of columns) form mutual-help pairs.
    const mid = Math.ceil(sorted.length / 2);
    const strong = sorted.slice(0, mid);
    const support = sorted.slice(mid);
    ordered = [];
    for (let i = 0; i < mid; i++) {
      if (strong[i]) ordered.push(strong[i]);
      if (support[i]) ordered.push(support[i]);
    }
  } else if (strategy === 'group-balanced') {
    // Distribute evenly across column-pairs (groups of 2 columns) in serpentine order.
    const groups = Math.max(1, Math.ceil(cols / 2));
    const buckets: StudentMember[][] = Array.from({ length: groups }, () => []);
    sorted.forEach((m, i) => {
      const round = Math.floor(i / groups);
      const gIdx = round % 2 === 0 ? i % groups : groups - 1 - (i % groups);
      buckets[gIdx].push(m);
    });
    const out: SeatAssignment[] = [];
    for (let g = 0; g < groups; g++) {
      const list = buckets[g];
      const baseCol = g * 2;
      const gCols = Math.min(2, cols - baseCol);
      let idx = 0;
      for (let r = 0; r < rows && idx < list.length; r++) {
        for (let dc = 0; dc < gCols && idx < list.length; dc++) {
          out.push({ membershipId: list[idx++].membershipId, row: r, col: baseCol + dc });
        }
      }
    }
    return out;
  } else {
    ordered = sorted;
  }

  const out: SeatAssignment[] = [];
  let idx = 0;
  for (let row = 0; row < rows && idx < ordered.length; row++) {
    const reverse = strategy === 'snake' && row % 2 === 1;
    for (let c = 0; c < cols && idx < ordered.length; c++) {
      const col = reverse ? cols - 1 - c : c;
      out.push({ membershipId: ordered[idx++].membershipId, row, col });
    }
  }
  return out;
}
