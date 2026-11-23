import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';

export function assertClassEditable(db: DatabaseSync, classId: string) {
  const row = db
    .prepare(`SELECT status, deleted_at FROM classes WHERE id = ?`)
    .get(classId) as { status: string; deleted_at: string | null } | undefined;
  if (!row || row.deleted_at) throw new AppError('NOT_FOUND', '班级不存在或已移入回收站');
  if (row.status === 'archived') throw new AppError('VALIDATION', '归档班级为只读，请先恢复班级');
}
