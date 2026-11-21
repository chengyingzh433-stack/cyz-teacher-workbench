import type { DatabaseSync } from 'node:sqlite';
import type { TrashItem } from '../../shared/types';
import { withTransaction } from '../db';
import { gcOrphanPhotos } from '../photo-store';

export function listTrash(db: DatabaseSync): TrashItem[] {
  const out: TrashItem[] = [];

  const classes = db
    .prepare(`SELECT id, name, school, term_label, deleted_at FROM classes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
    .all() as Array<Record<string, unknown>>;
  for (const c of classes) {
    const stats = db
      .prepare(
        `SELECT COUNT(pa.id) AS cnt, COALESCE(SUM(pa.bytes), 0) AS bytes
         FROM photo_assets pa JOIN exams e ON e.id = pa.exam_id WHERE e.class_id = ?`,
      )
      .get(String(c.id)) as { cnt: number; bytes: number };
    out.push({
      kind: 'class',
      id: String(c.id),
      title: String(c.name),
      subtitle: [c.school, c.term_label].filter(Boolean).join(' · ') || '班级资料',
      deletedAt: String(c.deleted_at),
      photoCount: Number(stats.cnt || 0),
      photoBytes: Number(stats.bytes || 0),
    });
  }

  const exams = db
    .prepare(
      `SELECT e.id, e.title, e.exam_date, e.deleted_at, c.name AS class_name
       FROM exams e JOIN classes c ON c.id = e.class_id
       WHERE e.deleted_at IS NOT NULL AND c.deleted_at IS NULL
       ORDER BY e.deleted_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const e of exams) {
    const stats = db
      .prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(bytes), 0) AS bytes FROM photo_assets WHERE exam_id = ?`)
      .get(String(e.id)) as { cnt: number; bytes: number };
    out.push({
      kind: 'exam',
      id: String(e.id),
      title: String(e.title),
      subtitle: `${String(e.class_name)} · ${String(e.exam_date)}`,
      deletedAt: String(e.deleted_at),
      photoCount: Number(stats.cnt || 0),
      photoBytes: Number(stats.bytes || 0),
    });
  }

  const subs = db
    .prepare(
      `SELECT gs.id, gs.deleted_at, gs.asset_ids_json, s.name AS student_name, gi.label AS item_label, e.title AS exam_title
       FROM grading_submissions gs
       JOIN memberships m ON m.id = gs.membership_id
       JOIN students s ON s.id = m.student_id
       JOIN grading_items gi ON gi.id = gs.item_id
       JOIN exams e ON e.id = gs.exam_id
       WHERE gs.deleted_at IS NOT NULL AND e.deleted_at IS NULL
       ORDER BY gs.deleted_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const sub of subs) {
    const assetIds = JSON.parse(String(sub.asset_ids_json || '[]')) as string[];
    let bytes = 0;
    for (const aid of assetIds) {
      const a = db.prepare(`SELECT bytes FROM photo_assets WHERE id = ?`).get(aid) as
        | { bytes: number }
        | undefined;
      if (a) bytes += a.bytes;
    }
    out.push({
      kind: 'submission',
      id: String(sub.id),
      title: `${String(sub.student_name)} · 第 ${String(sub.item_label)} 题答卷`,
      subtitle: String(sub.exam_title),
      deletedAt: String(sub.deleted_at),
      photoCount: assetIds.length,
      photoBytes: bytes,
    });
  }

  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function restoreTrashItem(db: DatabaseSync, kind: TrashItem['kind'], id: string) {
  if (kind === 'class') db.prepare(`UPDATE classes SET deleted_at = NULL WHERE id = ?`).run(id);
  else if (kind === 'exam') db.prepare(`UPDATE exams SET deleted_at = NULL WHERE id = ?`).run(id);
  else db.prepare(`UPDATE grading_submissions SET deleted_at = NULL WHERE id = ?`).run(id);
}

function collectActivePhotoRelPaths(db: DatabaseSync): Set<string> {
  // Remove photo_assets rows no longer referenced by any item or submission, then collect remaining disk paths.
  const referencedIds = new Set<string>();
  const items = db.prepare(`SELECT reference_asset_ids_json FROM grading_items`).all() as Array<{
    reference_asset_ids_json: string;
  }>;
  for (const r of items) {
    for (const id of JSON.parse(r.reference_asset_ids_json || '[]') as string[]) referencedIds.add(id);
  }
  const subs = db.prepare(`SELECT asset_ids_json FROM grading_submissions`).all() as Array<{
    asset_ids_json: string;
  }>;
  for (const r of subs) {
    for (const id of JSON.parse(r.asset_ids_json || '[]') as string[]) referencedIds.add(id);
  }

  const allAssets = db.prepare(`SELECT id, rel_path FROM photo_assets`).all() as Array<{
    id: string;
    rel_path: string;
  }>;
  const delAsset = db.prepare(`DELETE FROM photo_assets WHERE id = ?`);
  const activeRelPaths = new Set<string>();
  for (const a of allAssets) {
    if (!referencedIds.has(a.id)) delAsset.run(a.id);
    else activeRelPaths.add(a.rel_path);
  }
  return activeRelPaths;
}

export function purgeTrashItem(
  db: DatabaseSync,
  vaultPath: string,
  kind: TrashItem['kind'],
  id: string,
): { freedBytes: number } {
  const activeRelPaths = withTransaction(db, () => {
    if (kind === 'class') db.prepare(`DELETE FROM classes WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
    else if (kind === 'exam') db.prepare(`DELETE FROM exams WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
    else db.prepare(`DELETE FROM grading_submissions WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
    return collectActivePhotoRelPaths(db);
  });
  return { freedBytes: gcOrphanPhotos(vaultPath, activeRelPaths) };
}

export function emptyAllTrash(db: DatabaseSync, vaultPath: string): { freedBytes: number } {
  const activeRelPaths = withTransaction(db, () => {
    db.prepare(`DELETE FROM grading_submissions WHERE deleted_at IS NOT NULL`).run();
    db.prepare(`DELETE FROM exams WHERE deleted_at IS NOT NULL`).run();
    db.prepare(`DELETE FROM classes WHERE deleted_at IS NOT NULL`).run();
    return collectActivePhotoRelPaths(db);
  });
  return { freedBytes: gcOrphanPhotos(vaultPath, activeRelPaths) };
}
