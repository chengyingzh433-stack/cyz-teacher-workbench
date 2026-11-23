import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';
import {
  emptyDocument,
  normalizeSearchText,
  textToEditableDocument,
} from '../../shared/qbank/editable';
import type {
  BankFilterInput,
  BankQuestionDTO,
  QuestionFolderDTO,
  QuestionMetadataInput,
} from '../../shared/qbank/types';
import { withTransaction } from '../db';
import { removeQbankSubdir } from './assets';
import { buildBankQuestionDTO, rebuildQuestionSearch } from './content';

function collectChapterSubtreeIds(db: DatabaseSync, rootChapterId: number): number[] {
  const rows = db.prepare(`SELECT id, parent_id FROM chapters`).all() as Array<{
    id: number;
    parent_id: number | null;
  }>;
  const childrenMap = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parent_id !== null) {
      const list = childrenMap.get(r.parent_id) || [];
      list.push(r.id);
      childrenMap.set(r.parent_id, list);
    }
  }
  const result: number[] = [];
  const queue = [rootChapterId];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const child of childrenMap.get(id) || []) queue.push(child);
  }
  return result;
}

function extractSnippet(text: string, terms: string[]): string | null {
  if (!text || !terms.length) return null;
  const norm = text.normalize('NFKC').toLowerCase();
  let hitIdx = -1;
  for (const t of terms) {
    const idx = norm.indexOf(t);
    if (idx !== -1 && (hitIdx === -1 || idx < hitIdx)) hitIdx = idx;
  }
  if (hitIdx === -1) return null;
  const start = Math.max(0, hitIdx - 28);
  const end = Math.min(text.length, hitIdx + 90);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export function searchBankQuestions(
  db: DatabaseSync,
  filter: BankFilterInput = {},
): BankQuestionDTO[] {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (filter.typeId) {
    where.push(`q.type_id = ?`);
    params.push(filter.typeId);
  }
  if (filter.difficultyId) {
    where.push(`q.difficulty_id = ?`);
    params.push(filter.difficultyId);
  }
  if (filter.year) {
    where.push(`q.year = ?`);
    params.push(filter.year);
  }
  if (filter.chapterId) {
    const ids = collectChapterSubtreeIds(db, filter.chapterId);
    where.push(`q.chapter_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (filter.knowledgePointId) {
    where.push(
      `EXISTS (SELECT 1 FROM question_knowledge_points qkp WHERE qkp.question_id = q.id AND qkp.knowledge_point_id = ?)`,
    );
    params.push(filter.knowledgePointId);
  }
  if (filter.folderId) {
    where.push(
      `EXISTS (SELECT 1 FROM question_folder_items qfi WHERE qfi.question_id = q.id AND qfi.folder_id = ?)`,
    );
    params.push(filter.folderId);
  }

  const queryTerms = normalizeSearchText(filter.query || '')
    .split(' ')
    .filter(Boolean);
  for (const term of queryTerms) {
    where.push(`COALESCE(qs.normalized_text, '') LIKE ?`);
    params.push(`%${term}%`);
  }

  const limit = Math.max(1, Math.min(500, filter.limit || 200));
  const sql = `
    SELECT q.id, qs.question_text, qs.answer_text
    FROM questions q
    LEFT JOIN question_search qs ON qs.question_id = q.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY q.updated_at DESC, q.id DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit) as Array<{
    id: number;
    question_text: string | null;
    answer_text: string | null;
  }>;

  return rows.map((r) => {
    const snippet = queryTerms.length
      ? extractSnippet(r.question_text || '', queryTerms) ||
        extractSnippet(r.answer_text || '', queryTerms)
      : null;
    return buildBankQuestionDTO(db, Number(r.id), snippet);
  });
}

export function createManualQuestion(
  db: DatabaseSync,
  input: {
    questionText: string;
    answerText?: string;
    metadata?: QuestionMetadataInput;
  },
): BankQuestionDTO {
  const qText = input.questionText.trim();
  if (!qText) throw new AppError('VALIDATION', '题干内容不能为空');

  return withTransaction(db, () => {
    const now = new Date().toISOString();
    const m = input.metadata;
    const res = db
      .prepare(
        `INSERT INTO questions (type_id, chapter_id, difficulty_id, year, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m?.typeId ?? null,
        m?.chapterId ?? null,
        m?.difficultyId ?? null,
        m?.year ?? new Date().getFullYear(),
        m?.source?.trim() || null,
        now,
        now,
      );
    const questionId = Number(res.lastInsertRowid);

    if (m?.knowledgePointIds?.length) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO question_knowledge_points (question_id, knowledge_point_id) VALUES (?, ?)`,
      );
      for (const kpId of [...new Set(m.knowledgePointIds)]) ins.run(questionId, kpId);
    }

    const qDoc = textToEditableDocument(qText);
    const aDoc = input.answerText?.trim() ? textToEditableDocument(input.answerText) : emptyDocument();
    const qJson = JSON.stringify(qDoc);
    const aJson = JSON.stringify(aDoc);

    db.prepare(
      `INSERT INTO question_contents
        (question_id, question_mode, answer_mode, question_body_json, answer_body_json, revision, updated_at)
       VALUES (?, 'editable', 'editable', ?, ?, 1, ?)`,
    ).run(questionId, qJson, aJson, now);

    db.prepare(
      `INSERT INTO question_content_revisions
        (question_id, revision, question_mode, answer_mode, question_body_json, answer_body_json, created_at)
       VALUES (?, 1, 'editable', 'editable', ?, ?, ?)`,
    ).run(questionId, qJson, aJson, now);

    rebuildQuestionSearch(db, questionId);
    return buildBankQuestionDTO(db, questionId);
  });
}

export function deleteBankQuestion(db: DatabaseSync, vaultPath: string, questionId: number) {
  db.prepare(`DELETE FROM questions WHERE id = ?`).run(questionId);
  removeQbankSubdir(vaultPath, `questions/${questionId}`);
}

// ============================================================================
// Question Folders (收藏夹)
// ============================================================================

export function listFolders(db: DatabaseSync): QuestionFolderDTO[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.created_at,
              (SELECT COUNT(*) FROM question_folder_items i WHERE i.folder_id = f.id) AS q_cnt
       FROM question_folders f
       ORDER BY f.created_at ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    questionCount: Number(r.q_cnt || 0),
    createdAt: String(r.created_at),
  }));
}

export function createFolder(db: DatabaseSync, rawName: string): QuestionFolderDTO {
  const name = rawName.trim().slice(0, 60);
  if (!name) throw new AppError('VALIDATION', '收藏夹名称不能为空');
  const existing = db.prepare(`SELECT id FROM question_folders WHERE name = ?`).get(name);
  if (existing) throw new AppError('VALIDATION', `已存在同名收藏夹「${name}」`);
  const now = new Date().toISOString();
  const res = db
    .prepare(`INSERT INTO question_folders (name, created_at) VALUES (?, ?)`)
    .run(name, now);
  return { id: Number(res.lastInsertRowid), name, questionCount: 0, createdAt: now };
}

export function renameFolder(db: DatabaseSync, folderId: number, rawName: string): QuestionFolderDTO {
  const name = rawName.trim().slice(0, 60);
  if (!name) throw new AppError('VALIDATION', '收藏夹名称不能为空');
  db.prepare(`UPDATE question_folders SET name = ? WHERE id = ?`).run(name, folderId);
  const found = listFolders(db).find((f) => f.id === folderId);
  if (!found) throw new AppError('NOT_FOUND', '收藏夹不存在');
  return found;
}

export function deleteFolder(db: DatabaseSync, folderId: number) {
  db.prepare(`DELETE FROM question_folders WHERE id = ?`).run(folderId);
}

export function setQuestionFolderMembership(
  db: DatabaseSync,
  folderId: number,
  questionId: number,
  included: boolean,
) {
  if (included) {
    db.prepare(
      `INSERT OR IGNORE INTO question_folder_items (folder_id, question_id, added_at) VALUES (?, ?, ?)`,
    ).run(folderId, questionId, new Date().toISOString());
  } else {
    db.prepare(`DELETE FROM question_folder_items WHERE folder_id = ? AND question_id = ?`).run(
      folderId,
      questionId,
    );
  }
}
