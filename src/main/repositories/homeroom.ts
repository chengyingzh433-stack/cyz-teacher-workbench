import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  addDaysToIsoDate,
  formatMaterialSavedText,
  getMoralSafetyTheme,
  localCurrentMonth,
  localTimeHHMM,
  localTodayStr,
} from '../../shared/homeroom-materials';
import {
  AppError,
  type HomeroomCheckBatch,
  type HomeroomCheckKind,
  type HomeroomCheckinType,
  type HomeroomCommStatus,
  type HomeroomCommType,
  type HomeroomDashboardSummary,
  type HomeroomMemo,
  type HomeroomMemoTag,
  type HomeroomMonthlyStatsNumbers,
  type HomeroomMonthlyStatsView,
  type HomeroomNoteDayGroup,
  type HomeroomNoteEntry,
  type HomeroomTask,
  type HomeroomTaskCategory,
  type HomeroomTaskPriority,
  type SavedMaterialRecord,
  type StudentCommRecord,
  type StudentDailySummary,
  type StudentMember,
} from '../../shared/types';
import { withTransaction } from '../db';

const uid = () => crypto.randomUUID();

function assertClassEditable(db: DatabaseSync, classId: string) {
  const row = db
    .prepare(`SELECT status, deleted_at FROM classes WHERE id = ?`)
    .get(classId) as { status: string; deleted_at: string | null } | undefined;
  if (!row || row.deleted_at) throw new AppError('NOT_FOUND', '班级不存在或已移入回收站');
  if (row.status === 'archived') throw new AppError('VALIDATION', '归档班级为只读，请先恢复班级');
}

function normalizeIsoDate(raw?: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return localTodayStr();
}

function normalizeYearMonth(raw?: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return localCurrentMonth();
}

function checkinCol(type: HomeroomCheckinType): string {
  switch (type) {
    case 'morning':
      return 'checkin_morning';
    case 'teach':
      return 'checkin_teach';
    case 'meeting':
      return 'checkin_meeting';
    case 'talk':
      return 'checkin_talk';
  }
}

function ensureDailyRow(db: DatabaseSync, classId: string, logDate: string) {
  db.prepare(
    `INSERT OR IGNORE INTO homeroom_daily_logs
      (class_id, log_date, checkin_morning, checkin_teach, checkin_meeting, checkin_talk, focus_minutes, notes_json)
     VALUES (?, ?, 0, 0, 0, 0, 0, '[]')`,
  ).run(classId, logDate);
}

function parseNotesJson(raw: unknown): HomeroomNoteEntry[] {
  try {
    const arr = JSON.parse(String(raw || '[]')) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
      .map((x) => ({
        id: String(x.id || uid()),
        time: String(x.time || '00:00'),
        text: String(x.text || ''),
      }))
      .filter((x) => x.text.length > 0);
  } catch {
    return [];
  }
}

function parseStringArray(raw: unknown): string[] {
  try {
    const arr = JSON.parse(String(raw || '[]')) as unknown[];
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// ============================================================================
// Dashboard, Check-ins, Focus Minutes & Daily Notes
// ============================================================================

export function getDashboardSummary(
  db: DatabaseSync,
  classId: string,
  todayDate?: string,
): HomeroomDashboardSummary {
  const today = normalizeIsoDate(todayDate);

  const taskAgg = db
    .prepare(
      `SELECT
         SUM(CASE WHEN task_date = ? AND done = 0 THEN 1 ELSE 0 END) AS today_todo,
         SUM(CASE WHEN task_date = ? AND done = 1 THEN 1 ELSE 0 END) AS today_done,
         SUM(CASE WHEN category = '安全落实' AND done = 0 THEN 1 ELSE 0 END) AS pending_safety
       FROM homeroom_tasks
       WHERE class_id = ?`,
    )
    .get(today, today, classId) as Record<string, unknown> | undefined;

  const commRows = db
    .prepare(
      `SELECT id, membership_id FROM student_comms
       WHERE class_id = ? AND status = '待跟进'`,
    )
    .all(classId) as Array<{ id: string; membership_id: string | null }>;

  const followMemberSet = new Set<string>();
  for (const r of commRows) {
    if (r.membership_id) followMemberSet.add(r.membership_id);
  }

  const totalsRow = db
    .prepare(
      `SELECT
         SUM(checkin_morning) AS m_cnt,
         SUM(checkin_teach) AS t_cnt,
         SUM(checkin_meeting) AS mt_cnt,
         SUM(checkin_talk) AS tk_cnt
       FROM homeroom_daily_logs
       WHERE class_id = ?`,
    )
    .get(classId) as Record<string, unknown> | undefined;

  const todayRow = db
    .prepare(
      `SELECT checkin_morning, checkin_teach, checkin_meeting, checkin_talk, focus_minutes
       FROM homeroom_daily_logs
       WHERE class_id = ? AND log_date = ?`,
    )
    .get(classId, today) as Record<string, unknown> | undefined;

  const sevenDays: string[] = [];
  for (let i = 6; i >= 0; i--) {
    sevenDays.push(addDaysToIsoDate(today, -i));
  }
  const recentRows = db
    .prepare(
      `SELECT log_date, checkin_morning, checkin_teach, checkin_meeting, checkin_talk
       FROM homeroom_daily_logs
       WHERE class_id = ? AND log_date >= ? AND log_date <= ?`,
    )
    .all(classId, sevenDays[0], today) as Array<Record<string, unknown>>;

  const recentMap = new Map<string, Record<string, unknown>>();
  for (const r of recentRows) {
    recentMap.set(String(r.log_date), r);
  }

  return {
    todayDate: today,
    todayTodoCount: Number(taskAgg?.today_todo || 0),
    todayDoneCount: Number(taskAgg?.today_done || 0),
    pendingFollowUpCount: commRows.length,
    pendingSafetyTaskCount: Number(taskAgg?.pending_safety || 0),
    pendingFollowUpMemberIds: [...followMemberSet],
    todayFocusMinutes: Number(todayRow?.focus_minutes || 0),
    checkinTotals: {
      morning: Number(totalsRow?.m_cnt || 0),
      teach: Number(totalsRow?.t_cnt || 0),
      meeting: Number(totalsRow?.mt_cnt || 0),
      talk: Number(totalsRow?.tk_cnt || 0),
    },
    todayCheckins: {
      morning: Boolean(todayRow?.checkin_morning),
      teach: Boolean(todayRow?.checkin_teach),
      meeting: Boolean(todayRow?.checkin_meeting),
      talk: Boolean(todayRow?.checkin_talk),
    },
    recent7Days: sevenDays.map((date) => {
      const r = recentMap.get(date);
      return {
        date,
        checkins: {
          morning: Boolean(r?.checkin_morning),
          teach: Boolean(r?.checkin_teach),
          meeting: Boolean(r?.checkin_meeting),
          talk: Boolean(r?.checkin_talk),
        },
      };
    }),
  };
}

export function toggleCheckin(
  db: DatabaseSync,
  classId: string,
  type: HomeroomCheckinType,
  date?: string,
  forceValue?: boolean,
): HomeroomDashboardSummary {
  assertClassEditable(db, classId);
  const logDate = normalizeIsoDate(date);
  const col = checkinCol(type);
  withTransaction(db, () => {
    ensureDailyRow(db, classId, logDate);
    const cur = db
      .prepare(`SELECT ${col} AS val FROM homeroom_daily_logs WHERE class_id = ? AND log_date = ?`)
      .get(classId, logDate) as { val: number };
    const next = forceValue !== undefined ? (forceValue ? 1 : 0) : cur.val ? 0 : 1;
    db.prepare(
      `UPDATE homeroom_daily_logs SET ${col} = ? WHERE class_id = ? AND log_date = ?`,
    ).run(next, classId, logDate);
  });
  return getDashboardSummary(db, classId, logDate);
}

export function addFocusMinutes(
  db: DatabaseSync,
  classId: string,
  minutes: number,
  date?: string,
): { todayFocusMinutes: number } {
  assertClassEditable(db, classId);
  const delta = Math.max(0, Math.min(600, Math.floor(minutes)));
  const logDate = normalizeIsoDate(date);
  return withTransaction(db, () => {
    ensureDailyRow(db, classId, logDate);
    if (delta > 0) {
      db.prepare(
        `UPDATE homeroom_daily_logs SET focus_minutes = focus_minutes + ?
         WHERE class_id = ? AND log_date = ?`,
      ).run(delta, classId, logDate);
    }
    const row = db
      .prepare(`SELECT focus_minutes FROM homeroom_daily_logs WHERE class_id = ? AND log_date = ?`)
      .get(classId, logDate) as { focus_minutes: number };
    return { todayFocusMinutes: Number(row.focus_minutes || 0) };
  });
}

export function listNotes(
  db: DatabaseSync,
  classId: string,
  limitDays = 10,
): HomeroomNoteDayGroup[] {
  const rows = db
    .prepare(
      `SELECT log_date, notes_json FROM homeroom_daily_logs
       WHERE class_id = ? AND notes_json != '[]'
       ORDER BY log_date DESC LIMIT ?`,
    )
    .all(classId, Math.max(1, Math.min(60, limitDays))) as Array<{
    log_date: string;
    notes_json: string;
  }>;

  return rows
    .map((r) => ({
      date: r.log_date,
      entries: parseNotesJson(r.notes_json),
    }))
    .filter((g) => g.entries.length > 0);
}

export function addNote(
  db: DatabaseSync,
  classId: string,
  text: string,
  date?: string,
  time?: string,
): HomeroomNoteEntry {
  assertClassEditable(db, classId);
  const clean = text.trim();
  if (!clean) throw new AppError('VALIDATION', '带班记内容不能为空');
  const logDate = normalizeIsoDate(date);
  const entry: HomeroomNoteEntry = {
    id: uid(),
    time: (time || '').trim() || localTimeHHMM(),
    text: clean.slice(0, 2000),
  };
  withTransaction(db, () => {
    ensureDailyRow(db, classId, logDate);
    const row = db
      .prepare(`SELECT notes_json FROM homeroom_daily_logs WHERE class_id = ? AND log_date = ?`)
      .get(classId, logDate) as { notes_json: string };
    const entries = parseNotesJson(row.notes_json);
    entries.unshift(entry);
    db.prepare(
      `UPDATE homeroom_daily_logs SET notes_json = ? WHERE class_id = ? AND log_date = ?`,
    ).run(JSON.stringify(entries), classId, logDate);
  });
  return entry;
}

export function deleteNote(
  db: DatabaseSync,
  classId: string,
  date: string,
  noteId: string,
) {
  assertClassEditable(db, classId);
  const logDate = normalizeIsoDate(date);
  withTransaction(db, () => {
    const row = db
      .prepare(`SELECT notes_json FROM homeroom_daily_logs WHERE class_id = ? AND log_date = ?`)
      .get(classId, logDate) as { notes_json: string } | undefined;
    if (!row) return;
    const next = parseNotesJson(row.notes_json).filter((n) => n.id !== noteId);
    db.prepare(
      `UPDATE homeroom_daily_logs SET notes_json = ? WHERE class_id = ? AND log_date = ?`,
    ).run(JSON.stringify(next), classId, logDate);
  });
}

// ============================================================================
// Tasks (每日带班计划)
// ============================================================================

function mapTask(r: Record<string, unknown>): HomeroomTask {
  return {
    id: String(r.id),
    classId: String(r.class_id),
    title: String(r.title),
    category: String(r.category) as HomeroomTaskCategory,
    priority: String(r.priority) as HomeroomTaskPriority,
    taskDate: String(r.task_date),
    done: Boolean(r.done),
    createdAt: String(r.created_at),
  };
}

export function listTasks(db: DatabaseSync, classId: string): HomeroomTask[] {
  const rows = db
    .prepare(
      `SELECT * FROM homeroom_tasks
       WHERE class_id = ?
       ORDER BY done ASC, task_date DESC,
         CASE priority WHEN '紧急必办' THEN 0 WHEN '常规工作' THEN 1 ELSE 2 END,
         created_at DESC`,
    )
    .all(classId) as Array<Record<string, unknown>>;
  return rows.map(mapTask);
}

export function saveTask(
  db: DatabaseSync,
  payload: {
    classId: string;
    id?: string;
    title: string;
    category: HomeroomTaskCategory;
    priority: HomeroomTaskPriority;
    taskDate: string;
  },
): HomeroomTask {
  assertClassEditable(db, payload.classId);
  const title = payload.title.trim();
  if (!title) throw new AppError('VALIDATION', '任务内容不能为空');
  const taskDate = normalizeIsoDate(payload.taskDate);
  const now = new Date().toISOString();

  if (payload.id) {
    const exists = db
      .prepare(`SELECT id FROM homeroom_tasks WHERE id = ? AND class_id = ?`)
      .get(payload.id, payload.classId);
    if (!exists) throw new AppError('NOT_FOUND', '未找到对应带班任务');
    db.prepare(
      `UPDATE homeroom_tasks SET title = ?, category = ?, priority = ?, task_date = ?
       WHERE id = ?`,
    ).run(title.slice(0, 300), payload.category, payload.priority, taskDate, payload.id);
    const row = db
      .prepare(`SELECT * FROM homeroom_tasks WHERE id = ?`)
      .get(payload.id) as Record<string, unknown>;
    return mapTask(row);
  }

  const id = uid();
  db.prepare(
    `INSERT INTO homeroom_tasks (id, class_id, title, category, priority, task_date, done, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, payload.classId, title.slice(0, 300), payload.category, payload.priority, taskDate, now);
  const row = db.prepare(`SELECT * FROM homeroom_tasks WHERE id = ?`).get(id) as Record<string, unknown>;
  return mapTask(row);
}

export function toggleTask(db: DatabaseSync, taskId: string): HomeroomTask {
  const row = db
    .prepare(`SELECT * FROM homeroom_tasks WHERE id = ?`)
    .get(taskId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到对应带班任务');
  assertClassEditable(db, String(row.class_id));
  const nextDone = row.done ? 0 : 1;
  db.prepare(`UPDATE homeroom_tasks SET done = ? WHERE id = ?`).run(nextDone, taskId);
  return mapTask({ ...row, done: nextDone });
}

export function delayTask(db: DatabaseSync, taskId: string, days = 1): HomeroomTask {
  const row = db
    .prepare(`SELECT * FROM homeroom_tasks WHERE id = ?`)
    .get(taskId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到对应带班任务');
  assertClassEditable(db, String(row.class_id));
  const nextDate = addDaysToIsoDate(String(row.task_date), days);
  db.prepare(`UPDATE homeroom_tasks SET task_date = ? WHERE id = ?`).run(nextDate, taskId);
  return mapTask({ ...row, task_date: nextDate });
}

export function deleteTask(db: DatabaseSync, taskId: string) {
  const row = db
    .prepare(`SELECT class_id FROM homeroom_tasks WHERE id = ?`)
    .get(taskId) as { class_id: string } | undefined;
  if (!row) return;
  assertClassEditable(db, row.class_id);
  db.prepare(`DELETE FROM homeroom_tasks WHERE id = ?`).run(taskId);
}

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
    // Fix original HTML bug: preserve existing status when editing unless explicitly supplied!
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

// ============================================================================
// Classroom Quick-Check Batches & Monthly Stats (教室点检 + 月度自动统计)
// ============================================================================

function mapBatch(r: Record<string, unknown>): HomeroomCheckBatch {
  return {
    id: String(r.id),
    classId: String(r.class_id),
    checkDate: String(r.check_date),
    kind: String(r.kind) as HomeroomCheckKind,
    title: String(r.title),
    totalCount: Number(r.total_count || 0),
    anomalyMemberIds: parseStringArray(r.anomaly_member_ids_json),
    createdAt: String(r.created_at),
  };
}

export function listCheckBatches(
  db: DatabaseSync,
  classId: string,
  yearMonth?: string,
): HomeroomCheckBatch[] {
  const sql = yearMonth
    ? `SELECT * FROM homeroom_check_batches
       WHERE class_id = ? AND substr(check_date, 1, 7) = ?
       ORDER BY check_date DESC, created_at DESC`
    : `SELECT * FROM homeroom_check_batches
       WHERE class_id = ?
       ORDER BY check_date DESC, created_at DESC LIMIT 80`;
  const rows = (
    yearMonth
      ? db.prepare(sql).all(classId, normalizeYearMonth(yearMonth))
      : db.prepare(sql).all(classId)
  ) as Array<Record<string, unknown>>;
  return rows.map(mapBatch);
}

export function saveCheckBatch(
  db: DatabaseSync,
  payload: {
    classId: string;
    id?: string;
    checkDate: string;
    kind: HomeroomCheckKind;
    title: string;
    totalCount: number;
    anomalyMemberIds: string[];
  },
): HomeroomCheckBatch {
  assertClassEditable(db, payload.classId);
  const checkDate = normalizeIsoDate(payload.checkDate);
  const title = payload.title.trim() || `${checkDate} 点检`;
  const uniqueIds = [...new Set(payload.anomalyMemberIds.filter(Boolean))];
  const totalCount = Math.max(uniqueIds.length, Math.max(0, Math.floor(payload.totalCount)));
  const now = new Date().toISOString();

  return withTransaction(db, () => {
    let targetId = payload.id;
    if (targetId) {
      const existing = db
        .prepare(`SELECT id FROM homeroom_check_batches WHERE id = ? AND class_id = ?`)
        .get(targetId, payload.classId);
      if (!existing) throw new AppError('NOT_FOUND', '未找到对应点检记录');
      db.prepare(
        `UPDATE homeroom_check_batches
         SET check_date = ?, kind = ?, title = ?, total_count = ?, anomaly_member_ids_json = ?
         WHERE id = ?`,
      ).run(checkDate, payload.kind, title.slice(0, 200), totalCount, JSON.stringify(uniqueIds), targetId);
    } else {
      targetId = uid();
      db.prepare(
        `INSERT INTO homeroom_check_batches
          (id, class_id, check_date, kind, title, total_count, anomaly_member_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        targetId,
        payload.classId,
        checkDate,
        payload.kind,
        title.slice(0, 200),
        totalCount,
        JSON.stringify(uniqueIds),
        now,
      );
    }

    // Saving an attendance check automatically completes that day's morning check-in!
    if (payload.kind === 'attendance') {
      ensureDailyRow(db, payload.classId, checkDate);
      db.prepare(
        `UPDATE homeroom_daily_logs SET checkin_morning = 1 WHERE class_id = ? AND log_date = ?`,
      ).run(payload.classId, checkDate);
    }

    const row = db
      .prepare(`SELECT * FROM homeroom_check_batches WHERE id = ?`)
      .get(targetId) as Record<string, unknown>;
    return mapBatch(row);
  });
}

export function deleteCheckBatch(db: DatabaseSync, batchId: string) {
  const row = db
    .prepare(`SELECT class_id FROM homeroom_check_batches WHERE id = ?`)
    .get(batchId) as { class_id: string } | undefined;
  if (!row) return;
  assertClassEditable(db, row.class_id);
  db.prepare(`DELETE FROM homeroom_check_batches WHERE id = ?`).run(batchId);
}

export function getStudentDailySummary(
  db: DatabaseSync,
  classId: string,
  membershipId: string,
): StudentDailySummary {
  const batches = listCheckBatches(db, classId);
  let attendanceAnomalies = 0;
  let homeworkMissing = 0;
  let receiptMissing = 0;
  let disciplineCount = 0;
  const recentBatches: StudentDailySummary['recentBatches'] = [];

  for (const b of batches) {
    if (!b.anomalyMemberIds.includes(membershipId)) continue;
    if (b.kind === 'attendance') attendanceAnomalies++;
    else if (b.kind === 'homework') homeworkMissing++;
    else if (b.kind === 'receipt') receiptMissing++;
    else if (b.kind === 'discipline') disciplineCount++;
    if (recentBatches.length < 12) {
      recentBatches.push({
        id: b.id,
        checkDate: b.checkDate,
        kind: b.kind,
        title: b.title,
      });
    }
  }

  return {
    attendanceAnomalies,
    homeworkMissing,
    receiptMissing,
    disciplineCount,
    recentBatches,
  };
}

export function getMonthlyStats(
  db: DatabaseSync,
  classId: string,
  yearMonth: string,
): HomeroomMonthlyStatsView {
  const ym = normalizeYearMonth(yearMonth);
  const memberCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM memberships WHERE class_id = ? AND status = 'active'`)
    .get(classId) as { cnt: number };
  const activeClassSize = Number(memberCountRow?.cnt || 0);

  const batches = listCheckBatches(db, classId, ym);
  let attendCount = 0;
  let absentCount = 0;
  let hwShould = 0;
  let hwMiss = 0;
  let disciplineCount = 0;
  let receiptShould = 0;
  let receiptGot = 0;

  for (const b of batches) {
    const anom = b.anomalyMemberIds.length;
    if (b.kind === 'attendance') {
      absentCount += anom;
      attendCount += Math.max(0, b.totalCount - anom);
    } else if (b.kind === 'homework') {
      hwShould += b.totalCount;
      hwMiss += anom;
    } else if (b.kind === 'receipt') {
      receiptShould += b.totalCount;
      receiptGot += Math.max(0, b.totalCount - anom);
    } else if (b.kind === 'discipline') {
      disciplineCount += anom;
    }
  }

  const meetingRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM homeroom_daily_logs
       WHERE class_id = ? AND substr(log_date, 1, 7) = ? AND checkin_meeting = 1`,
    )
    .get(classId, ym) as { cnt: number };
  const commRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM student_comms
       WHERE class_id = ? AND substr(comm_date, 1, 7) = ?`,
    )
    .get(classId, ym) as { cnt: number };

  const meetingCount = Number(meetingRow?.cnt || 0);
  const commCount = Number(commRow?.cnt || 0);

  const auto = {
    classSize: activeClassSize,
    attendCount,
    absentCount,
    hwShould,
    hwMiss,
    disciplineCount,
    receiptShould,
    receiptGot,
    meetingCount,
    commCount,
    batchCount: batches.length,
  };

  const manualRow = db
    .prepare(`SELECT * FROM homeroom_monthly_stats WHERE class_id = ? AND year_month = ?`)
    .get(classId, ym) as Record<string, unknown> | undefined;

  const manual = manualRow
    ? {
        classSize: Number(manualRow.class_size || 0),
        attendCount: Number(manualRow.attend_count || 0),
        absentCount: Number(manualRow.absent_count || 0),
        hwShould: Number(manualRow.hw_should || 0),
        hwMiss: Number(manualRow.hw_miss || 0),
        disciplineCount: Number(manualRow.discipline_count || 0),
        receiptShould: Number(manualRow.receipt_should || 0),
        receiptGot: Number(manualRow.receipt_got || 0),
        updatedAt: String(manualRow.updated_at),
      }
    : null;

  const effective = manual
    ? {
        classSize: manual.classSize,
        attendCount: manual.attendCount,
        absentCount: manual.absentCount,
        hwShould: manual.hwShould,
        hwMiss: manual.hwMiss,
        disciplineCount: manual.disciplineCount,
        receiptShould: manual.receiptShould,
        receiptGot: manual.receiptGot,
        meetingCount,
        commCount,
      }
    : {
        classSize: auto.classSize,
        attendCount: auto.attendCount,
        absentCount: auto.absentCount,
        hwShould: auto.hwShould,
        hwMiss: auto.hwMiss,
        disciplineCount: auto.disciplineCount,
        receiptShould: auto.receiptShould,
        receiptGot: auto.receiptGot,
        meetingCount,
        commCount,
      };

  return {
    yearMonth: ym,
    hasManualOverride: Boolean(manual),
    manual,
    auto,
    effective,
  };
}

export function saveMonthlyManualStats(
  db: DatabaseSync,
  payload: HomeroomMonthlyStatsNumbers & { classId: string; yearMonth: string },
): HomeroomMonthlyStatsView {
  assertClassEditable(db, payload.classId);
  const ym = normalizeYearMonth(payload.yearMonth);
  const now = new Date().toISOString();
  const clean = (n: number) => Math.max(0, Math.floor(Number(n) || 0));

  db.prepare(
    `INSERT INTO homeroom_monthly_stats
      (class_id, year_month, class_size, attend_count, absent_count, hw_should, hw_miss,
       discipline_count, receipt_should, receipt_got, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(class_id, year_month) DO UPDATE SET
       class_size = excluded.class_size,
       attend_count = excluded.attend_count,
       absent_count = excluded.absent_count,
       hw_should = excluded.hw_should,
       hw_miss = excluded.hw_miss,
       discipline_count = excluded.discipline_count,
       receipt_should = excluded.receipt_should,
       receipt_got = excluded.receipt_got,
       updated_at = excluded.updated_at`,
  ).run(
    payload.classId,
    ym,
    clean(payload.classSize),
    clean(payload.attendCount),
    clean(payload.absentCount),
    clean(payload.hwShould),
    clean(payload.hwMiss),
    clean(payload.disciplineCount),
    clean(payload.receiptShould),
    clean(payload.receiptGot),
    now,
  );
  return getMonthlyStats(db, payload.classId, ym);
}

export function clearMonthlyManualStats(
  db: DatabaseSync,
  classId: string,
  yearMonth: string,
): HomeroomMonthlyStatsView {
  assertClassEditable(db, classId);
  const ym = normalizeYearMonth(yearMonth);
  db.prepare(`DELETE FROM homeroom_monthly_stats WHERE class_id = ? AND year_month = ?`).run(
    classId,
    ym,
  );
  return getMonthlyStats(db, classId, ym);
}

// ============================================================================
// Demo Class Homeroom Seed
// ============================================================================

export function seedDemoHomeroomData(
  db: DatabaseSync,
  classId: string,
  members: StudentMember[],
) {
  const today = localTodayStr();
  const yesterday = addDaysToIsoDate(today, -1);
  const twoDaysAgo = addDaysToIsoDate(today, -2);
  const tomorrow = addDaysToIsoDate(today, 1);

  // 1. Recent check-ins, focus minutes & daily journal notes
  ensureDailyRow(db, classId, twoDaysAgo);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, checkin_teach = 1, checkin_meeting = 1, focus_minutes = 50
     WHERE class_id = ? AND log_date = ?`,
  ).run(classId, twoDaysAgo);

  ensureDailyRow(db, classId, yesterday);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, checkin_teach = 1, checkin_talk = 1, focus_minutes = 25, notes_json = ?
     WHERE class_id = ? AND log_date = ?`,
  ).run(
    JSON.stringify([
      {
        id: uid(),
        time: '17:20',
        text: '物理期中讲评后找前排与后排互助小组交流了笔记方法，晚自习秩序明显提升。',
      },
    ]),
    classId,
    yesterday,
  );

  ensureDailyRow(db, classId, today);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, focus_minutes = 25, notes_json = ?
     WHERE class_id = ? AND log_date = ?`,
  ).run(
    JSON.stringify([
      {
        id: uid(),
        time: '08:05',
        text: '早读全班状态不错，1 名同学感冒请假已与家长电话确认。',
      },
    ]),
    classId,
    today,
  );

  // 2. Sample daily tasks
  const t1 = saveTask(db, {
    classId,
    title: '晨检查看考勤并确认请假条',
    category: '班级晨检',
    priority: '常规工作',
    taskDate: today,
  });
  toggleTask(db, t1.id);

  saveTask(db, {
    classId,
    title: '收齐《冬季交通与防欺凌安全告家长书》回执',
    category: '安全落实',
    priority: '紧急必办',
    taskDate: today,
  });
  saveTask(db, {
    classId,
    title: '批改牛顿第二定律专题练习并登记缺交名单',
    category: '学科教学',
    priority: '常规工作',
    taskDate: today,
  });
  saveTask(db, {
    classId,
    title: '筹备下周一「考前心理疏导」主题班会课件',
    category: '班级管理',
    priority: '延后跟进',
    taskDate: tomorrow,
  });

  // 3. Sample parent-teacher comms linked to real demo students
  const m0 = members[0];
  const m2 = members[2];
  const m5 = members[5];

  if (m0) {
    saveComm(db, {
      classId,
      membershipId: m0.membershipId,
      studentName: m0.name,
      commType: '即时电话',
      commDate: today,
      reason: '期中物理压轴题进步明显，同步表彰并约定竞赛拓展计划',
      studentPerf: '课堂专注度高，实验题步骤规范，近期作业全勤。',
      parentFeedback: '家长非常高兴，希望老师推荐几道受力分析拔高题供周末练习。',
      actionPlan: '周五前发放受力分析专题小卷，下周复盘错题整理本。',
      followUpDate: addDaysToIsoDate(today, 5),
      status: '待跟进',
    });
  }
  if (m2) {
    saveComm(db, {
      classId,
      membershipId: m2.membershipId,
      studentName: m2.name,
      commType: '一对一单独面谈',
      commDate: yesterday,
      reason: '本周物理练习册缺交 1 次，晚自习偶有分心',
      studentPerf: '思维敏捷但计算步骤跳步较多，导致主观题扣分。',
      parentFeedback: '家长反馈近期在家写作业偏晚，愿意配合收管晚间电子设备。',
      actionPlan: '与同桌建立每日作业互查打卡，连续两周按时提交后给予表扬。',
      followUpDate: addDaysToIsoDate(today, 3),
      status: '待跟进',
    });
  }
  if (m5) {
    saveComm(db, {
      classId,
      membershipId: m5.membershipId,
      studentName: m5.name,
      commType: '3-5人小组家长会',
      commDate: twoDaysAgo,
      reason: '考前心态微调与作息规律沟通',
      studentPerf: '基础知识扎实，考前偶有紧张情绪。',
      parentFeedback: '家长表示已调整为鼓励式沟通，不再晚间加压刷题。',
      actionPlan: '考前一周保持 22:40 前入睡，班会带领练习腹式呼吸放松法。',
      followUpDate: '',
      status: '已办结',
    });
  }

  // 4. Sample classroom check batches in current month (auto-populates Monthly Stats ECharts!)
  const classSize = members.length || 32;
  saveCheckBatch(db, {
    classId,
    checkDate: twoDaysAgo,
    kind: 'attendance',
    title: '早读晨检考勤',
    totalCount: classSize,
    anomalyMemberIds: m2 ? [m2.membershipId] : [],
  });
  saveCheckBatch(db, {
    classId,
    checkDate: yesterday,
    kind: 'homework',
    title: '牛顿定律巩固作业',
    totalCount: classSize,
    anomalyMemberIds: m2 ? [m2.membershipId] : [],
  });
  saveCheckBatch(db, {
    classId,
    checkDate: today,
    kind: 'receipt',
    title: '安全教育告家长书回执',
    totalCount: classSize,
    anomalyMemberIds: m2 && members[7] ? [m2.membershipId, members[7].membershipId] : [],
  });

  // 5. Sample work memos & saved moral material
  saveMemo(db, {
    classId,
    title: '高二年级期中家长会流程与座位贴准备',
    tag: '行政通知',
    content: '周五 18:30 召开家长会：1) 打印本班物理成绩分布图；2) 提前张贴最新互助座位表；3) 准备签到表与告家长书回执。',
    memoDate: today,
  });
  saveMemo(db, {
    classId,
    title: '过敏体质与体育免测学生名单备查',
    tag: '特殊学生档案',
    content: '长跑体测前务必再次确认免测证明原件归档，运动会期间安排后勤记录岗位。',
    memoDate: yesterday,
  });

  const sampleTheme = getMoralSafetyTheme('考前心理疏导');
  saveMaterial(db, {
    classId,
    themeKey: sampleTheme.key,
    title: `${sampleTheme.key} · 家长会宣讲脚本`,
    content: formatMaterialSavedText(sampleTheme, 'script'),
    savedDate: today,
  });
}
