import type { DatabaseSync } from 'node:sqlite';
import { addDaysToIsoDate, localTimeHHMM } from '../../../shared/homeroom-materials';
import {
  AppError,
  type HomeroomCheckinType,
  type HomeroomDashboardSummary,
  type HomeroomNoteDayGroup,
  type HomeroomNoteEntry,
  type HomeroomTask,
  type HomeroomTaskCategory,
  type HomeroomTaskPriority,
} from '../../../shared/types';
import { withTransaction } from '../../db';
import { assertClassEditable } from '../guards';
import { checkinCol, ensureDailyRow, normalizeIsoDate, parseNotesJson, uid } from './shared';

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
