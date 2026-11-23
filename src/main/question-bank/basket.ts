import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';
import { DEFAULT_WORD_OPTIONS, type WordExportOptions } from '../../shared/qbank/editable';
import type { PaperSetDetailDTO, PaperSetDTO, PaperSetItemDTO } from '../../shared/qbank/types';
import { withTransaction } from '../db';
import { buildBankQuestionDTO } from './content';

function parseWordOptions(raw: unknown): WordExportOptions {
  try {
    const parsed = JSON.parse(String(raw || '{}')) as Partial<WordExportOptions>;
    return {
      ...DEFAULT_WORD_OPTIONS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_WORD_OPTIONS };
  }
}

export function ensureDefaultPaperSet(db: DatabaseSync): PaperSetDTO {
  const list = listPaperSets(db);
  if (list.length > 0) return list[0];
  return createPaperSet(db, '默认组卷篮');
}

export function listPaperSets(db: DatabaseSync): PaperSetDTO[] {
  const rows = db
    .prepare(
      `SELECT ps.id, ps.title, ps.created_at, ps.updated_at,
              (SELECT COUNT(*) FROM paper_set_items psi WHERE psi.set_id = ps.id) AS item_cnt
       FROM paper_sets ps
       ORDER BY ps.id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    itemCount: Number(r.item_cnt || 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function createPaperSet(db: DatabaseSync, rawTitle: string): PaperSetDTO {
  const title = rawTitle.trim().slice(0, 120) || '新建组卷';
  const now = new Date().toISOString();
  const opts: WordExportOptions = { ...DEFAULT_WORD_OPTIONS, title };
  const res = db
    .prepare(
      `INSERT INTO paper_sets (title, word_options_json, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run(title, JSON.stringify(opts), now, now);
  return {
    id: Number(res.lastInsertRowid),
    title,
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function deletePaperSet(db: DatabaseSync, setId: number) {
  const all = listPaperSets(db);
  if (all.length <= 1) {
    throw new AppError('VALIDATION', '至少保留一个组卷篮');
  }
  db.prepare(`DELETE FROM paper_sets WHERE id = ?`).run(setId);
}

export function getPaperSetDetail(db: DatabaseSync, setId: number): PaperSetDetailDTO {
  const row = db
    .prepare(
      `SELECT ps.*, (SELECT COUNT(*) FROM paper_set_items psi WHERE psi.set_id = ps.id) AS item_cnt
       FROM paper_sets ps WHERE ps.id = ?`,
    )
    .get(setId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到对应组卷篮');

  const itemRows = db
    .prepare(
      `SELECT id, set_id, question_id, sort_order, display_number, group_header
       FROM paper_set_items
       WHERE set_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(setId) as Array<Record<string, unknown>>;

  const items: PaperSetItemDTO[] = itemRows.map((r, idx) => ({
    id: Number(r.id),
    setId: Number(r.set_id),
    questionId: Number(r.question_id),
    sortOrder: Number(r.sort_order ?? idx),
    displayNumber: String(r.display_number || '') || String(idx + 1),
    groupHeader: String(r.group_header || ''),
    question: buildBankQuestionDTO(db, Number(r.question_id)),
  }));

  return {
    set: {
      id: Number(row.id),
      title: String(row.title),
      itemCount: items.length,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    },
    items,
    wordOptions: parseWordOptions(row.word_options_json),
  };
}

export function addToPaperSet(db: DatabaseSync, setId: number, questionId: number): PaperSetDetailDTO {
  const exists = db.prepare(`SELECT id FROM questions WHERE id = ?`).get(questionId);
  if (!exists) throw new AppError('NOT_FOUND', '题目不存在');
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM paper_set_items WHERE set_id = ?`)
    .get(setId) as { m: number };
  db.prepare(
    `INSERT OR IGNORE INTO paper_set_items (set_id, question_id, sort_order, display_number, group_header)
     VALUES (?, ?, ?, '', '')`,
  ).run(setId, questionId, Number(maxRow.m) + 1);
  db.prepare(`UPDATE paper_sets SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    setId,
  );
  return getPaperSetDetail(db, setId);
}

export function removeFromPaperSet(
  db: DatabaseSync,
  setId: number,
  questionId: number,
): PaperSetDetailDTO {
  db.prepare(`DELETE FROM paper_set_items WHERE set_id = ? AND question_id = ?`).run(
    setId,
    questionId,
  );
  db.prepare(`UPDATE paper_sets SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    setId,
  );
  return getPaperSetDetail(db, setId);
}

export function clearPaperSet(db: DatabaseSync, setId: number): PaperSetDetailDTO {
  db.prepare(`DELETE FROM paper_set_items WHERE set_id = ?`).run(setId);
  db.prepare(`UPDATE paper_sets SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    setId,
  );
  return getPaperSetDetail(db, setId);
}

export function reorderPaperSetItems(
  db: DatabaseSync,
  setId: number,
  itemIds: number[],
): PaperSetDetailDTO {
  return withTransaction(db, () => {
    const stmt = db.prepare(
      `UPDATE paper_set_items SET sort_order = ? WHERE id = ? AND set_id = ?`,
    );
    itemIds.forEach((id, idx) => stmt.run(idx, id, setId));
    db.prepare(`UPDATE paper_sets SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      setId,
    );
    return getPaperSetDetail(db, setId);
  });
}

export function updatePaperSetItem(
  db: DatabaseSync,
  itemId: number,
  patch: { displayNumber?: string; groupHeader?: string },
): PaperSetDetailDTO {
  const row = db
    .prepare(`SELECT set_id, display_number, group_header FROM paper_set_items WHERE id = ?`)
    .get(itemId) as { set_id: number; display_number: string; group_header: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', '组卷篮条目不存在');
  db.prepare(
    `UPDATE paper_set_items SET display_number = ?, group_header = ? WHERE id = ?`,
  ).run(
    patch.displayNumber !== undefined ? patch.displayNumber.trim().slice(0, 20) : row.display_number,
    patch.groupHeader !== undefined ? patch.groupHeader.trim().slice(0, 120) : row.group_header,
    itemId,
  );
  return getPaperSetDetail(db, Number(row.set_id));
}

export function saveWordExportOptions(
  db: DatabaseSync,
  setId: number,
  options: WordExportOptions,
): WordExportOptions {
  const clean: WordExportOptions = {
    ...DEFAULT_WORD_OPTIONS,
    ...options,
    title: (options.title || '高三物理练习卷').trim().slice(0, 180) || '高三物理练习卷',
    subtitle: (options.subtitle || '').trim().slice(0, 300),
  };
  db.prepare(`UPDATE paper_sets SET title = ?, word_options_json = ?, updated_at = ? WHERE id = ?`).run(
    clean.title,
    JSON.stringify(clean),
    new Date().toISOString(),
    setId,
  );
  return clean;
}
