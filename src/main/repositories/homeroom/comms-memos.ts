import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type HomeroomCommStatus,
  type HomeroomCommType,
  type HomeroomMemo,
  type HomeroomMemoTag,
  type SavedMaterialRecord,
  type StudentCommRecord,
} from '../../../shared/types';
import { assertClassEditable } from '../guards';
import { normalizeIsoDate, uid } from './shared';

// ============================================================================
// Parent-Teacher Communications (家校沟通台账)
// ============================================================================

function mapComm(r: Record<string, unknown>): StudentCommRecord {
  return {
    id: String(r.id),
    classId: String(r.class_id),
    membershipId: r.membership_id ? String(r.membership_id) : null,
    studentName: String(r.student_name),
    commType: String(r.comm_type) as HomeroomCommType,
    commDate: String(r.comm_date),
    reason: String(r.reason || ''),
    studentPerf: String(r.student_perf || ''),
    parentFeedback: String(r.parent_feedback || ''),
    actionPlan: String(r.action_plan || ''),
    followUpDate: String(r.follow_up_date || ''),
    status: r.status === '已办结' ? '已办结' : '待跟进',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listComms(
  db: DatabaseSync,
  classId: string,
  membershipId?: string,
): StudentCommRecord[] {
  const sql = membershipId
    ? `SELECT * FROM student_comms WHERE class_id = ? AND membership_id = ?
       ORDER BY comm_date DESC, created_at DESC`
    : `SELECT * FROM student_comms WHERE class_id = ?
       ORDER BY CASE WHEN status = '待跟进' THEN 0 ELSE 1 END, comm_date DESC, created_at DESC`;
  const rows = (
    membershipId ? db.prepare(sql).all(classId, membershipId) : db.prepare(sql).all(classId)
  ) as Array<Record<string, unknown>>;
  return rows.map(mapComm);
}

export function saveComm(
  db: DatabaseSync,
  payload: {
    classId: string;
    id?: string;
    membershipId?: string | null;
    studentName: string;
    commType: HomeroomCommType;
    commDate?: string;
    reason: string;
    studentPerf: string;
    parentFeedback: string;
    actionPlan: string;
    followUpDate?: string;
    status?: HomeroomCommStatus;
  },
): StudentCommRecord {
  assertClassEditable(db, payload.classId);

  let membershipId: string | null = payload.membershipId || null;
  let studentName = payload.studentName.trim();

  if (membershipId) {
    const memberRow = db
      .prepare(
        `SELECT s.name FROM memberships m JOIN students s ON s.id = m.student_id
         WHERE m.id = ? AND m.class_id = ?`,
      )
      .get(membershipId, payload.classId) as { name: string } | undefined;
    if (memberRow) {
      if (!studentName) studentName = memberRow.name;
    } else {
      membershipId = null;
    }
  }
  if (!studentName) throw new AppError('VALIDATION', '请选择学生或填写沟通对象姓名');

  const now = new Date().toISOString();
  const commDate = normalizeIsoDate(payload.commDate);
  const followUpDate = (payload.followUpDate || '').trim();

  if (payload.id) {
    const existing = db
      .prepare(`SELECT * FROM student_comms WHERE id = ? AND class_id = ?`)
      .get(payload.id, payload.classId) as Record<string, unknown> | undefined;
    if (!existing) throw new AppError('NOT_FOUND', '未找到对应家校沟通记录');
    const nextStatus: HomeroomCommStatus =
      payload.status || (existing.status === '已办结' ? '已办结' : '待跟进');
    db.prepare(
      `UPDATE student_comms
       SET membership_id = ?, student_name = ?, comm_type = ?, comm_date = ?,
           reason = ?, student_perf = ?, parent_feedback = ?, action_plan = ?,
           follow_up_date = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      membershipId,
      studentName.slice(0, 120),
      payload.commType,
      payload.commDate ? commDate : String(existing.comm_date),
      payload.reason.trim().slice(0, 1000),
      payload.studentPerf.trim().slice(0, 2000),
      payload.parentFeedback.trim().slice(0, 2000),
      payload.actionPlan.trim().slice(0, 2000),
      followUpDate,
      nextStatus,
      now,
      payload.id,
    );
    const row = db
      .prepare(`SELECT * FROM student_comms WHERE id = ?`)
      .get(payload.id) as Record<string, unknown>;
    return mapComm(row);
  }

  const id = uid();
  const status: HomeroomCommStatus = payload.status || '待跟进';
  db.prepare(
    `INSERT INTO student_comms
      (id, class_id, membership_id, student_name, comm_type, comm_date, reason, student_perf,
       parent_feedback, action_plan, follow_up_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    payload.classId,
    membershipId,
    studentName.slice(0, 120),
    payload.commType,
    commDate,
    payload.reason.trim().slice(0, 1000),
    payload.studentPerf.trim().slice(0, 2000),
    payload.parentFeedback.trim().slice(0, 2000),
    payload.actionPlan.trim().slice(0, 2000),
    followUpDate,
    status,
    now,
    now,
  );
  const row = db.prepare(`SELECT * FROM student_comms WHERE id = ?`).get(id) as Record<string, unknown>;
  return mapComm(row);
}

export function toggleCommStatus(db: DatabaseSync, commId: string): StudentCommRecord {
  const row = db
    .prepare(`SELECT * FROM student_comms WHERE id = ?`)
    .get(commId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到对应家校沟通记录');
  assertClassEditable(db, String(row.class_id));
  const nextStatus: HomeroomCommStatus = row.status === '待跟进' ? '已办结' : '待跟进';
  const now = new Date().toISOString();
  db.prepare(`UPDATE student_comms SET status = ?, updated_at = ? WHERE id = ?`).run(
    nextStatus,
    now,
    commId,
  );
  return mapComm({ ...row, status: nextStatus, updated_at: now });
}

export function deleteComm(db: DatabaseSync, commId: string) {
  const row = db
    .prepare(`SELECT class_id FROM student_comms WHERE id = ?`)
    .get(commId) as { class_id: string } | undefined;
  if (!row) return;
  assertClassEditable(db, row.class_id);
  db.prepare(`DELETE FROM student_comms WHERE id = ?`).run(commId);
}

// ============================================================================
// Work Memos (工作备忘录)
// ============================================================================

function mapMemo(r: Record<string, unknown>): HomeroomMemo {
  return {
    id: String(r.id),
    classId: String(r.class_id),
    title: String(r.title),
    tag: String(r.tag) as HomeroomMemoTag,
    content: String(r.content || ''),
    memoDate: String(r.memo_date),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listMemos(db: DatabaseSync, classId: string): HomeroomMemo[] {
  const rows = db
    .prepare(`SELECT * FROM homeroom_memos WHERE class_id = ? ORDER BY updated_at DESC`)
    .all(classId) as Array<Record<string, unknown>>;
  return rows.map(mapMemo);
}

export function saveMemo(
  db: DatabaseSync,
  payload: {
    classId: string;
    id?: string;
    title: string;
    tag: HomeroomMemoTag;
    content: string;
    memoDate?: string;
  },
): HomeroomMemo {
  assertClassEditable(db, payload.classId);
  const title = payload.title.trim();
  const content = payload.content.trim();
  if (!title && !content) throw new AppError('VALIDATION', '备忘标题和内容至少填一项');

  const now = new Date().toISOString();
  const memoDate = normalizeIsoDate(payload.memoDate);

  if (payload.id) {
    const existing = db
      .prepare(`SELECT id FROM homeroom_memos WHERE id = ? AND class_id = ?`)
      .get(payload.id, payload.classId);
    if (!existing) throw new AppError('NOT_FOUND', '未找到对应工作备忘');
    db.prepare(
      `UPDATE homeroom_memos SET title = ?, tag = ?, content = ?, updated_at = ? WHERE id = ?`,
    ).run((title || '(无标题)').slice(0, 200), payload.tag, content.slice(0, 10000), now, payload.id);
    const row = db
      .prepare(`SELECT * FROM homeroom_memos WHERE id = ?`)
      .get(payload.id) as Record<string, unknown>;
    return mapMemo(row);
  }

  const id = uid();
  db.prepare(
    `INSERT INTO homeroom_memos (id, class_id, title, tag, content, memo_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    payload.classId,
    (title || '(无标题)').slice(0, 200),
    payload.tag,
    content.slice(0, 10000),
    memoDate,
    now,
    now,
  );
  const row = db.prepare(`SELECT * FROM homeroom_memos WHERE id = ?`).get(id) as Record<string, unknown>;
  return mapMemo(row);
}

export function deleteMemo(db: DatabaseSync, memoId: string) {
  const row = db
    .prepare(`SELECT class_id FROM homeroom_memos WHERE id = ?`)
    .get(memoId) as { class_id: string } | undefined;
  if (!row) return;
  assertClassEditable(db, row.class_id);
  db.prepare(`DELETE FROM homeroom_memos WHERE id = ?`).run(memoId);
}

// ============================================================================
// Saved Moral & Safety Materials (德育安全素材收藏)
// ============================================================================

function mapMaterial(r: Record<string, unknown>): SavedMaterialRecord {
  return {
    id: String(r.id),
    classId: String(r.class_id),
    themeKey: String(r.theme_key),
    title: String(r.title),
    content: String(r.content),
    savedDate: String(r.saved_date),
    createdAt: String(r.created_at),
  };
}

export function listSavedMaterials(db: DatabaseSync, classId: string): SavedMaterialRecord[] {
  const rows = db
    .prepare(`SELECT * FROM saved_materials WHERE class_id = ? ORDER BY created_at DESC`)
    .all(classId) as Array<Record<string, unknown>>;
  return rows.map(mapMaterial);
}

export function saveMaterial(
  db: DatabaseSync,
  payload: {
    classId: string;
    themeKey: string;
    title: string;
    content: string;
    savedDate?: string;
  },
): SavedMaterialRecord {
  assertClassEditable(db, payload.classId);
  const title = payload.title.trim();
  const content = payload.content.trim();
  if (!content) throw new AppError('VALIDATION', '素材内容不能为空');
  const id = uid();
  const now = new Date().toISOString();
  const savedDate = normalizeIsoDate(payload.savedDate);
  db.prepare(
    `INSERT INTO saved_materials (id, class_id, theme_key, title, content, saved_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    payload.classId,
    payload.themeKey.trim().slice(0, 80) || '自定义主题',
    (title || payload.themeKey).slice(0, 200),
    content.slice(0, 20000),
    savedDate,
    now,
  );
  const row = db.prepare(`SELECT * FROM saved_materials WHERE id = ?`).get(id) as Record<string, unknown>;
  return mapMaterial(row);
}

export function deleteMaterial(db: DatabaseSync, materialId: string) {
  const row = db
    .prepare(`SELECT class_id FROM saved_materials WHERE id = ?`)
    .get(materialId) as { class_id: string } | undefined;
  if (!row) return;
  assertClassEditable(db, row.class_id);
  db.prepare(`DELETE FROM saved_materials WHERE id = ?`).run(materialId);
}
