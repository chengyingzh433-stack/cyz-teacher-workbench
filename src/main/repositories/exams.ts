import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type ClassExamTrendPoint,
  type ExamColumn,
  type ExamDetail,
  type ExamScoreCell,
  type ExamSummary,
  type KnowledgePoint,
  type ScoreAuditLog,
  type ScoreStatus,
} from '../../shared/types';
import type { CommitGradeImportPayload } from '../../shared/ipc';
import { formatScore } from '../../shared/score-policy';
import { analyzeExamColumn, cellStatusLabels } from '../../shared/gradebook/analysis';
import { withTransaction } from '../db';
import { assertClassEditable, listRoster, saveStudent } from './classes';
import { listGradingItemsForExam } from './grading';

const uid = () => crypto.randomUUID();

export function listExams(db: DatabaseSync, classId: string): ExamSummary[] {
  const rows = db
    .prepare(
      `SELECT id, class_id, title, exam_date, notes, source_file, created_at, deleted_at
       FROM exams
       WHERE class_id = ? AND deleted_at IS NULL
       ORDER BY exam_date DESC, created_at DESC`,
    )
    .all(classId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const id = String(r.id);
    const cols = db
      .prepare(
        `SELECT id, role, max_units FROM exam_columns
         WHERE exam_id = ? ORDER BY CASE WHEN role = 'total' THEN 0 ELSE 1 END, sort_order ASC`,
      )
      .all(id) as Array<{ id: string; role: string; max_units: number | null }>;
    const gItems = db
      .prepare(`SELECT COUNT(*) AS n FROM grading_items WHERE exam_id = ?`)
      .get(id) as { n: number };

    let scoredStudents = 0;
    let meanUnits: number | null = null;
    let maxUnits: number | null = null;
    if (cols[0]) {
      maxUnits = cols[0].max_units;
      const stats = db
        .prepare(
          `SELECT COUNT(*) AS cnt, AVG(units) AS avg_u FROM exam_scores
           WHERE exam_id = ? AND column_id = ? AND status = 'score' AND units IS NOT NULL`,
        )
        .get(id, cols[0].id) as { cnt: number; avg_u: number | null };
      scoredStudents = Number(stats.cnt || 0);
      meanUnits = stats.avg_u !== null && stats.avg_u !== undefined ? Number(stats.avg_u) : null;
    }

    return {
      id,
      classId: String(r.class_id),
      title: String(r.title),
      examDate: String(r.exam_date),
      notes: String(r.notes || ''),
      sourceFile: r.source_file ? String(r.source_file) : null,
      createdAt: String(r.created_at),
      deletedAt: r.deleted_at ? String(r.deleted_at) : null,
      columnCount: cols.length,
      gradingItemCount: Number(gItems.n || 0),
      scoredStudents,
      meanUnits,
      maxUnits,
    };
  });
}

export function createExam(
  db: DatabaseSync,
  input: { classId: string; title: string; examDate: string; notes?: string },
): ExamSummary {
  assertClassEditable(db, input.classId);
  const title = input.title.trim();
  if (!title) throw new AppError('VALIDATION', '考试名称不能为空');
  const examDate = input.examDate.trim() || new Date().toISOString().slice(0, 10);
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO exams (id, class_id, title, exam_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.classId, title.slice(0, 150), examDate, (input.notes || '').trim().slice(0, 1000), now);
  return listExams(db, input.classId).find((e) => e.id === id)!;
}

export function updateExamMeta(
  db: DatabaseSync,
  examId: string,
  input: { title: string; examDate: string; notes?: string },
): ExamSummary {
  const row = db
    .prepare(`SELECT class_id FROM exams WHERE id = ? AND deleted_at IS NULL`)
    .get(examId) as { class_id: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', '考试不存在或已移入回收站');
  assertClassEditable(db, row.class_id);
  const title = input.title.trim();
  if (!title) throw new AppError('VALIDATION', '考试名称不能为空');
  db.prepare(`UPDATE exams SET title = ?, exam_date = ?, notes = ? WHERE id = ?`).run(
    title.slice(0, 150),
    input.examDate.trim(),
    (input.notes || '').trim().slice(0, 1000),
    examId,
  );
  return listExams(db, row.class_id).find((e) => e.id === examId)!;
}

export function softDeleteExam(db: DatabaseSync, examId: string) {
  db.prepare(`UPDATE exams SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), examId);
}

export function getExamDetail(db: DatabaseSync, examId: string): ExamDetail {
  const exRow = db
    .prepare(`SELECT class_id FROM exams WHERE id = ? AND deleted_at IS NULL`)
    .get(examId) as { class_id: string } | undefined;
  if (!exRow) throw new AppError('NOT_FOUND', '考试不存在或已在回收站中');

  const exam = listExams(db, exRow.class_id).find((e) => e.id === examId)!;
  const colRows = db
    .prepare(
      `SELECT id, exam_id, col_key, label, role, source, grading_item_id, max_units, sort_order
       FROM exam_columns WHERE exam_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .all(examId) as Array<Record<string, unknown>>;

  const columns: ExamColumn[] = colRows.map((c) => ({
    id: String(c.id),
    examId: String(c.exam_id),
    key: String(c.col_key),
    label: String(c.label),
    role: c.role === 'total' ? 'total' : 'score',
    source: (c.source as ExamColumn['source']) || 'import',
    gradingItemId: c.grading_item_id ? String(c.grading_item_id) : null,
    maxUnits: c.max_units !== null && c.max_units !== undefined ? Number(c.max_units) : null,
    sortOrder: Number(c.sort_order || 0),
  }));

  const scRows = db
    .prepare(
      `SELECT id, exam_id, column_id, membership_id, status, units, raw_text, corrected_text, from_formula, updated_at
       FROM exam_scores WHERE exam_id = ?`,
    )
    .all(examId) as Array<Record<string, unknown>>;

  const scores: ExamScoreCell[] = scRows.map((s) => ({
    id: String(s.id),
    examId: String(s.exam_id),
    columnId: String(s.column_id),
    membershipId: String(s.membership_id),
    status: (s.status as ScoreStatus) || 'missing',
    units: s.units !== null && s.units !== undefined ? Number(s.units) : null,
    rawText: String(s.raw_text || ''),
    correctedText: s.corrected_text ? String(s.corrected_text) : null,
    fromFormula: Boolean(s.from_formula),
    updatedAt: String(s.updated_at),
  }));

  const kpRows = db
    .prepare(`SELECT id, exam_id, name FROM knowledge_points WHERE exam_id = ? ORDER BY name ASC`)
    .all(examId) as Array<{ id: string; exam_id: string; name: string }>;
  const knowledgePoints: KnowledgePoint[] = kpRows.map((k) => ({
    id: k.id,
    examId: k.exam_id,
    name: k.name,
  }));

  const logRows = db
    .prepare(
      `SELECT id, exam_id, membership_id, student_name, target_label, old_value, new_value, reason, created_at
       FROM score_audit_logs WHERE exam_id = ? ORDER BY created_at DESC LIMIT 200`,
    )
    .all(examId) as Array<Record<string, unknown>>;
  const auditLogs: ScoreAuditLog[] = logRows.map((l) => ({
    id: String(l.id),
    examId: String(l.exam_id),
    membershipId: String(l.membership_id),
    studentName: String(l.student_name),
    targetLabel: String(l.target_label),
    oldValue: String(l.old_value),
    newValue: String(l.new_value),
    reason: String(l.reason || ''),
    createdAt: String(l.created_at),
  }));

  const gradingItems = listGradingItemsForExam(db, examId);
  return { exam, columns, scores, gradingItems, knowledgePoints, auditLogs };
}

export function commitGradeImport(
  db: DatabaseSync,
  payload: CommitGradeImportPayload,
): ExamSummary {
  assertClassEditable(db, payload.classId);
  if (!payload.title.trim()) throw new AppError('VALIDATION', '请填写考试名称');
  if (!payload.columns.length) throw new AppError('VALIDATION', '至少需要选择一个成绩列');
  if (!payload.rows.length) throw new AppError('VALIDATION', '没有可导入的有效学生成绩行');

  const now = new Date().toISOString();
  const examId = payload.examId || uid();

  withTransaction(db, () => {
    if (payload.examId) {
      db.prepare(
        `UPDATE exams SET title = ?, exam_date = ?, notes = ?, source_file = ? WHERE id = ?`,
      ).run(
        payload.title.trim().slice(0, 150),
        payload.examDate.trim() || now.slice(0, 10),
        (payload.notes || '').trim().slice(0, 1000),
        payload.sourceFile.slice(0, 255),
        examId,
      );
    } else {
      db.prepare(
        `INSERT INTO exams (id, class_id, title, exam_date, notes, source_file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        examId,
        payload.classId,
        payload.title.trim().slice(0, 150),
        payload.examDate.trim() || now.slice(0, 10),
        (payload.notes || '').trim().slice(0, 1000),
        payload.sourceFile.slice(0, 255),
        now,
      );
    }

    const colIdByKey = new Map<string, string>();
    const existingCols = db
      .prepare(`SELECT id, col_key FROM exam_columns WHERE exam_id = ?`)
      .all(examId) as Array<{ id: string; col_key: string }>;
    for (const c of existingCols) colIdByKey.set(c.col_key, c.id);

    payload.columns.forEach((col, idx) => {
      const existingId = colIdByKey.get(col.key);
      if (existingId) {
        db.prepare(
          `UPDATE exam_columns SET label = ?, role = ?, max_units = ?, sort_order = ? WHERE id = ?`,
        ).run(col.label.trim().slice(0, 120), col.role, col.maxUnits, idx, existingId);
      } else {
        const cid = uid();
        db.prepare(
          `INSERT INTO exam_columns (id, exam_id, col_key, label, role, source, max_units, sort_order)
           VALUES (?, ?, ?, ?, ?, 'import', ?, ?)`,
        ).run(cid, examId, col.key, col.label.trim().slice(0, 120), col.role, col.maxUnits, idx);
        colIdByKey.set(col.key, cid);
      }
    });

    const upsertScore = db.prepare(
      `INSERT INTO exam_scores (id, exam_id, column_id, membership_id, status, units, raw_text, corrected_text, from_formula, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exam_id, column_id, membership_id) DO UPDATE SET
         status = excluded.status,
         units = excluded.units,
         raw_text = excluded.raw_text,
         corrected_text = excluded.corrected_text,
         from_formula = excluded.from_formula,
         updated_at = excluded.updated_at`,
    );

    for (const r of payload.rows) {
      let membershipId = r.membershipId;
      if (!membershipId && r.createStudent) {
        const created = saveStudent(db, payload.classId, {
          name: r.createStudent.name,
          rosterNo: r.createStudent.rosterNo,
          gender: 'unspecified',
        });
        membershipId = created.membershipId;
      }
      if (!membershipId) continue;

      for (const cell of r.cells) {
        const colId = colIdByKey.get(cell.columnKey);
        if (!colId) continue;
        upsertScore.run(
          uid(),
          examId,
          colId,
          membershipId,
          cell.status,
          cell.status === 'score' ? cell.units : null,
          cell.rawText.slice(0, 200),
          cell.correctedText ? cell.correctedText.slice(0, 200) : null,
          cell.fromFormula ? 1 : 0,
          now,
        );
      }
    }
  });

  return listExams(db, payload.classId).find((e) => e.id === examId)!;
}

export function updateScoreCell(
  db: DatabaseSync,
  payload: {
    examId: string;
    columnId: string;
    membershipId: string;
    status: ScoreStatus;
    units: number | null;
    reason: string;
  },
): ExamDetail {
  const ex = db
    .prepare(`SELECT class_id FROM exams WHERE id = ? AND deleted_at IS NULL`)
    .get(payload.examId) as { class_id: string } | undefined;
  if (!ex) throw new AppError('NOT_FOUND', '考试不存在');
  assertClassEditable(db, ex.class_id);

  const col = db
    .prepare(`SELECT label, max_units FROM exam_columns WHERE id = ? AND exam_id = ?`)
    .get(payload.columnId, payload.examId) as { label: string; max_units: number | null } | undefined;
  if (!col) throw new AppError('NOT_FOUND', '成绩列不存在');

  if (payload.status === 'score') {
    if (payload.units === null || !Number.isInteger(payload.units) || payload.units < 0) {
      throw new AppError('VALIDATION', '请输入合法非负分值');
    }
    if (col.max_units !== null && payload.units > col.max_units) {
      throw new AppError('VALIDATION', `分值不能超过本列满分 ${formatScore(col.max_units)}`);
    }
  }

  const stu = db
    .prepare(
      `SELECT s.name FROM memberships m JOIN students s ON s.id = m.student_id WHERE m.id = ?`,
    )
    .get(payload.membershipId) as { name: string } | undefined;
  const studentName = stu?.name || '未知学生';

  const now = new Date().toISOString();
  withTransaction(db, () => {
    const prev = db
      .prepare(
        `SELECT status, units FROM exam_scores WHERE exam_id = ? AND column_id = ? AND membership_id = ?`,
      )
      .get(payload.examId, payload.columnId, payload.membershipId) as
      | { status: ScoreStatus; units: number | null }
      | undefined;

    const oldValue = !prev
      ? '未录入'
      : prev.status === 'score'
        ? formatScore(prev.units)
        : cellStatusLabels[prev.status];
    const newValue =
      payload.status === 'score' ? formatScore(payload.units) : cellStatusLabels[payload.status];

    db.prepare(
      `INSERT INTO exam_scores (id, exam_id, column_id, membership_id, status, units, raw_text, corrected_text, from_formula, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(exam_id, column_id, membership_id) DO UPDATE SET
         status = excluded.status,
         units = excluded.units,
         corrected_text = excluded.corrected_text,
         updated_at = excluded.updated_at`,
    ).run(
      uid(),
      payload.examId,
      payload.columnId,
      payload.membershipId,
      payload.status,
      payload.status === 'score' ? payload.units : null,
      newValue,
      newValue,
      now,
    );

    if (oldValue !== newValue) {
      db.prepare(
        `INSERT INTO score_audit_logs (id, exam_id, membership_id, student_name, target_label, old_value, new_value, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uid(),
        payload.examId,
        payload.membershipId,
        studentName,
        col.label,
        oldValue,
        newValue,
        payload.reason.trim().slice(0, 300) || '手动修订成绩',
        now,
      );
    }
  });

  return getExamDetail(db, payload.examId);
}

export function getClassTrends(
  db: DatabaseSync,
  classId: string,
  subjectHint?: string,
): ClassExamTrendPoint[] {
  const exams = listExams(db, classId).slice().reverse(); // chronological order
  const members = listRoster(db, classId, false);
  const out: ClassExamTrendPoint[] = [];

  for (const ex of exams) {
    const detail = getExamDetail(db, ex.id);
    if (!detail.columns.length) continue;
    let target = detail.columns.find((c) => c.role === 'total') || detail.columns[0];
    if (subjectHint) {
      const matched = detail.columns.find((c) => c.label.includes(subjectHint));
      if (matched) target = matched;
    }
    const a = analyzeExamColumn({
      columns: detail.columns,
      scores: detail.scores,
      members,
      columnId: target.id,
    });
    out.push({
      examId: ex.id,
      title: ex.title,
      examDate: ex.examDate,
      columnLabel: target.label,
      count: a.count,
      meanUnits: a.meanUnits,
      medianUnits: a.medianUnits,
      maxUnits: a.maxUnits,
      passRate: a.count && a.passCount !== null ? (a.passCount / a.count) * 100 : null,
      excellentRate:
        a.count && a.excellentCount !== null ? (a.excellentCount / a.count) * 100 : null,
    });
  }
  return out;
}
