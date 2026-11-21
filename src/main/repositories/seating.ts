import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type ScoreSeatingStrategy,
  type SeatAssignment,
  type SeatPlan,
} from '../../shared/types';
import { arrangeByScores, validateDimensions } from '../../shared/seating';
import { withTransaction } from '../db';
import { assertClassEditable, listRoster } from './classes';

const uid = () => crypto.randomUUID();

export function listSeatPlans(db: DatabaseSync, classId: string): SeatPlan[] {
  const plans = db
    .prepare(
      `SELECT id, class_id, name, rows, cols, created_at FROM seat_plans WHERE class_id = ? ORDER BY created_at ASC`,
    )
    .all(classId) as Array<Record<string, unknown>>;

  const getAssign = db.prepare(
    `SELECT membership_id, row, col FROM seat_assignments WHERE plan_id = ? ORDER BY row ASC, col ASC`,
  );

  return plans.map((p) => {
    const id = String(p.id);
    const assigns = getAssign.all(id) as Array<{ membership_id: string; row: number; col: number }>;
    return {
      id,
      classId: String(p.class_id),
      name: String(p.name),
      rows: Number(p.rows),
      cols: Number(p.cols),
      createdAt: String(p.created_at),
      assignments: assigns.map((a) => ({
        membershipId: a.membership_id,
        row: a.row,
        col: a.col,
      })),
    };
  });
}

export function createSeatPlan(
  db: DatabaseSync,
  classId: string,
  name: string,
  copyFromPlanId?: string,
): SeatPlan {
  assertClassEditable(db, classId);
  const cleanName = name.trim();
  if (!cleanName) throw new AppError('VALIDATION', '方案名称不能为空');
  const id = uid();
  const now = new Date().toISOString();

  withTransaction(db, () => {
    const src = copyFromPlanId
      ? listSeatPlans(db, classId).find((p) => p.id === copyFromPlanId)
      : undefined;
    const rows = src?.rows ?? 6;
    const cols = src?.cols ?? 8;
    db.prepare(
      `INSERT INTO seat_plans (id, class_id, name, rows, cols, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, classId, cleanName.slice(0, 120), rows, cols, now);

    if (src) {
      const ins = db.prepare(
        `INSERT INTO seat_assignments (plan_id, membership_id, row, col) VALUES (?, ?, ?, ?)`,
      );
      for (const a of src.assignments) ins.run(id, a.membershipId, a.row, a.col);
    }
  });

  return listSeatPlans(db, classId).find((p) => p.id === id)!;
}

export function renameSeatPlan(db: DatabaseSync, planId: string, name: string): SeatPlan {
  const row = db.prepare(`SELECT class_id FROM seat_plans WHERE id = ?`).get(planId) as
    | { class_id: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '座位方案不存在');
  assertClassEditable(db, row.class_id);
  const cleanName = name.trim();
  if (!cleanName) throw new AppError('VALIDATION', '方案名称不能为空');
  db.prepare(`UPDATE seat_plans SET name = ? WHERE id = ?`).run(cleanName.slice(0, 120), planId);
  return listSeatPlans(db, row.class_id).find((p) => p.id === planId)!;
}

export function deleteSeatPlan(db: DatabaseSync, planId: string) {
  const row = db.prepare(`SELECT class_id FROM seat_plans WHERE id = ?`).get(planId) as
    | { class_id: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '座位方案不存在');
  assertClassEditable(db, row.class_id);
  const count = (
    db.prepare(`SELECT COUNT(*) AS n FROM seat_plans WHERE class_id = ?`).get(row.class_id) as {
      n: number;
    }
  ).n;
  if (count <= 1) throw new AppError('VALIDATION', '每个班级至少保留一套座位方案');
  db.prepare(`DELETE FROM seat_plans WHERE id = ?`).run(planId);
}

export function saveSeatPlanLayout(
  db: DatabaseSync,
  planId: string,
  rows: number,
  cols: number,
  assignments: SeatAssignment[],
): SeatPlan {
  validateDimensions(rows, cols);
  const row = db.prepare(`SELECT class_id FROM seat_plans WHERE id = ?`).get(planId) as
    | { class_id: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '座位方案不存在');
  assertClassEditable(db, row.class_id);

  const activeSet = new Set(listRoster(db, row.class_id, false).map((m) => m.membershipId));
  const seenCoord = new Set<string>();
  const seenMember = new Set<string>();
  for (const a of assignments) {
    if (!activeSet.has(a.membershipId)) continue;
    if (a.row < 0 || a.row >= rows || a.col < 0 || a.col >= cols) {
      throw new AppError('VALIDATION', '座位坐标超出当前行列范围');
    }
    const coord = `${a.row},${a.col}`;
    if (seenCoord.has(coord) || seenMember.has(a.membershipId)) {
      throw new AppError('VALIDATION', '存在重复的座位或重复安排的学生');
    }
    seenCoord.add(coord);
    seenMember.add(a.membershipId);
  }

  withTransaction(db, () => {
    db.prepare(`UPDATE seat_plans SET rows = ?, cols = ? WHERE id = ?`).run(rows, cols, planId);
    db.prepare(`DELETE FROM seat_assignments WHERE plan_id = ?`).run(planId);
    const ins = db.prepare(
      `INSERT INTO seat_assignments (plan_id, membership_id, row, col) VALUES (?, ?, ?, ?)`,
    );
    for (const a of assignments) {
      if (activeSet.has(a.membershipId)) ins.run(planId, a.membershipId, a.row, a.col);
    }
  });

  return listSeatPlans(db, row.class_id).find((p) => p.id === planId)!;
}

export function arrangePlanByExam(
  db: DatabaseSync,
  params: {
    planId: string;
    examId: string;
    columnId?: string;
    strategy: ScoreSeatingStrategy;
  },
): SeatPlan {
  const planRow = db
    .prepare(`SELECT id, class_id, rows, cols FROM seat_plans WHERE id = ?`)
    .get(params.planId) as { id: string; class_id: string; rows: number; cols: number } | undefined;
  if (!planRow) throw new AppError('NOT_FOUND', '座位方案不存在');
  assertClassEditable(db, planRow.class_id);

  let targetColId = params.columnId;
  if (!targetColId) {
    const col = db
      .prepare(
        `SELECT id FROM exam_columns WHERE exam_id = ?
         ORDER BY CASE WHEN role = 'total' THEN 0 ELSE 1 END, sort_order ASC LIMIT 1`,
      )
      .get(params.examId) as { id: string } | undefined;
    if (!col) throw new AppError('VALIDATION', '该考试暂无可用成绩列');
    targetColId = col.id;
  }

  const scoreRows = db
    .prepare(`SELECT membership_id, status, units FROM exam_scores WHERE exam_id = ? AND column_id = ?`)
    .all(params.examId, targetColId) as Array<{
    membership_id: string;
    status: string;
    units: number | null;
  }>;

  const scoreByMember = new Map<string, number | null>();
  for (const r of scoreRows) {
    scoreByMember.set(r.membership_id, r.status === 'score' ? r.units : null);
  }

  const members = listRoster(db, planRow.class_id, false);
  const nextAssignments = arrangeByScores({
    rows: planRow.rows,
    cols: planRow.cols,
    members,
    scoreByMember,
    strategy: params.strategy,
  });

  return saveSeatPlanLayout(db, planRow.id, planRow.rows, planRow.cols, nextAssignments);
}
