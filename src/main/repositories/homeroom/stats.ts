import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type HomeroomCheckBatch,
  type HomeroomCheckKind,
  type HomeroomMonthlyStatsNumbers,
  type HomeroomMonthlyStatsView,
  type StudentDailySummary,
} from '../../../shared/types';
import { withTransaction } from '../../db';
import { assertClassEditable } from '../guards';
import { ensureDailyRow, normalizeIsoDate, normalizeYearMonth, parseStringArray, uid } from './shared';

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
