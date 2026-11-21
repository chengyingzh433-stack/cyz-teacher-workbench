import { AppError, copy, id, type Membership, type SeatPlan } from '../../app/model';
export function dimensions(rows: number, cols: number) {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows < 1 ||
    rows > 12 ||
    cols < 1 ||
    cols > 16
  )
    throw new AppError('VALIDATION', '请输入 1–12 行、1–16 列的整数');
}
export function newPlan(classId: string, name = '默认方案'): SeatPlan {
  return { id: id(), classId, name, rows: 6, cols: 8, assignments: [] };
}
export function waiting(plan: SeatPlan, members: Membership[]) {
  const seated = new Set(plan.assignments.map((x) => x.membershipId));
  return members.filter((x) => !seated.has(x.id));
}
export function resize(
  plan: SeatPlan,
  members: Membership[],
  rows: number,
  cols: number,
): SeatPlan {
  dimensions(rows, cols);
  const valid = new Set(members.map((x) => x.id));
  const next = {
    ...copy(plan),
    rows,
    cols,
    assignments: plan.assignments
      .filter((x) => valid.has(x.membershipId) && x.row < rows && x.col < cols)
      .map((x) => ({ ...x })),
  };
  const pending = waiting(next, members);
  let index = 0;
  const filled = new Set(next.assignments.map((x) => `${x.row},${x.col}`));
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      if (!filled.has(`${row},${col}`) && index < pending.length)
        next.assignments.push({ membershipId: pending[index++].id, row, col });
  return next;
}
export const sequential = (plan: SeatPlan, members: Membership[]) =>
  resize({ ...plan, assignments: [] }, members, plan.rows, plan.cols);
export function move(
  plan: SeatPlan,
  members: Membership[],
  source: string,
  target: { row: number; col: number } | null,
): SeatPlan {
  if (!members.some((x) => x.id === source))
    throw new AppError('VALIDATION', '该学生已不在当前名单');
  if (
    target &&
    (!Number.isInteger(target.row) ||
      !Number.isInteger(target.col) ||
      target.row < 0 ||
      target.row >= plan.rows ||
      target.col < 0 ||
      target.col >= plan.cols)
  )
    throw new AppError('VALIDATION', '目标座位无效');
  const from = plan.assignments.find((x) => x.membershipId === source);
  const to = target
    ? plan.assignments.find((x) => x.row === target.row && x.col === target.col)
    : undefined;
  if ((from && to?.membershipId === from.membershipId) || (!from && !target)) return plan;
  const next = copy(plan);
  next.assignments = next.assignments.filter(
    (x) => x.membershipId !== source && x.membershipId !== to?.membershipId,
  );
  // A target may be an Assignment. Copy coordinates explicitly so its membershipId cannot win.
  if (target) next.assignments.push({ membershipId: source, row: target.row, col: target.col });
  if (from && to)
    next.assignments.push({ membershipId: to.membershipId, row: from.row, col: from.col });
  return next;
}
export function exchange(
  plan: SeatPlan,
  members: Membership[],
  first: string,
  second: string,
): SeatPlan {
  if (first === second) return plan;
  if (!members.some((x) => x.id === second))
    throw new AppError('VALIDATION', '目标学生不在当前班级');
  const target = plan.assignments.find((x) => x.membershipId === second);
  if (target) return move(plan, members, first, target);
  const source = plan.assignments.find((x) => x.membershipId === first);
  return source ? move(plan, members, second, source) : plan;
}
