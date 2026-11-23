import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { localCurrentMonth, localTodayStr } from '../../../shared/homeroom-materials';
import type { HomeroomCheckinType, HomeroomNoteEntry } from '../../../shared/types';

export const uid = () => crypto.randomUUID();

export function normalizeIsoDate(raw?: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return localTodayStr();
}

export function normalizeYearMonth(raw?: string): string {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return localCurrentMonth();
}

export function checkinCol(type: HomeroomCheckinType): string {
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

export function ensureDailyRow(db: DatabaseSync, classId: string, logDate: string) {
  db.prepare(
    `INSERT OR IGNORE INTO homeroom_daily_logs
      (class_id, log_date, checkin_morning, checkin_teach, checkin_meeting, checkin_talk, focus_minutes, notes_json)
     VALUES (?, ?, 0, 0, 0, 0, 0, '[]')`,
  ).run(classId, logDate);
}

export function parseNotesJson(raw: unknown): HomeroomNoteEntry[] {
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

export function parseStringArray(raw: unknown): string[] {
  try {
    const arr = JSON.parse(String(raw || '[]')) as unknown[];
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}
