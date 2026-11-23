import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';
import {
  emptyDocument,
  extractDocumentPlainText,
  hasEditableContent,
  newQuestionContent,
  normalizeEditableDocument,
  normalizeSearchText,
  type ContentMode,
  type ContentRevisionDTO,
  type EditableDocument,
  type QuestionContentDTO,
} from '../../shared/qbank/editable';
import type {
  BankQuestionDTO,
  EditableQuestionDTO,
  KnowledgePointDTO,
  QbankTaxonomyDTO,
  QuestionMetadataInput,
  SaveQuestionEditsInput,
} from '../../shared/qbank/types';
import { withTransaction } from '../db';
import { listQuestionAssets } from './assets';

export function getTaxonomy(db: DatabaseSync): QbankTaxonomyDTO {
  const types = (
    db.prepare(`SELECT id, name FROM question_types ORDER BY sort_order ASC, id ASC`).all() as Array<
      Record<string, unknown>
    >
  ).map((r) => ({ id: Number(r.id), name: String(r.name) }));

  const chapters = (
    db
      .prepare(`SELECT id, node_key, name, parent_id, sort_order FROM chapters ORDER BY sort_order ASC, id ASC`)
      .all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: Number(r.id),
    key: String(r.node_key),
    name: String(r.name),
    parentId: r.parent_id !== null && r.parent_id !== undefined ? Number(r.parent_id) : null,
    sortOrder: Number(r.sort_order || 0),
  }));

  const knowledgePoints = (
    db.prepare(`SELECT id, name FROM knowledge_points ORDER BY id ASC`).all() as Array<
      Record<string, unknown>
    >
  ).map((r) => ({ id: Number(r.id), name: String(r.name) }));

  const difficulties = (
    db.prepare(`SELECT id, level, name FROM difficulties ORDER BY level ASC`).all() as Array<
      Record<string, unknown>
    >
  ).map((r) => ({ id: Number(r.id), level: Number(r.level), name: String(r.name) }));

  return { types, chapters, knowledgePoints, difficulties };
}

export function addKnowledgePoint(db: DatabaseSync, rawName: string): KnowledgePointDTO {
  const name = rawName.trim().slice(0, 60);
  if (!name) throw new AppError('VALIDATION', '知识点名称不能为空');
  db.prepare(`INSERT OR IGNORE INTO knowledge_points (name) VALUES (?)`).run(name);
  const row = db
    .prepare(`SELECT id, name FROM knowledge_points WHERE name = ?`)
    .get(name) as { id: number; name: string };
  return { id: Number(row.id), name: String(row.name) };
}

function parseDoc(raw: unknown): EditableDocument {
  try {
    return normalizeEditableDocument(JSON.parse(String(raw || 'null')) as EditableDocument);
  } catch {
    return emptyDocument();
  }
}

export function getQuestionContent(db: DatabaseSync, questionId: number): QuestionContentDTO | null {
  const row = db
    .prepare(`SELECT * FROM question_contents WHERE question_id = ?`)
    .get(questionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    questionId: Number(row.question_id),
    schemaVersion: 1,
    questionMode: row.question_mode === 'original' ? 'original' : 'editable',
    answerMode: row.answer_mode === 'original' ? 'original' : 'editable',
    questionBody: parseDoc(row.question_body_json),
    answerBody: parseDoc(row.answer_body_json),
    revision: Number(row.revision || 1),
    updatedAt: String(row.updated_at),
  };
}

export function rebuildQuestionSearch(db: DatabaseSync, questionId: number) {
  const q = db
    .prepare(
      `SELECT q.id, q.year, q.source,
              qt.name AS type_name,
              ch.name AS chapter_name,
              d.name AS diff_name
       FROM questions q
       LEFT JOIN question_types qt ON qt.id = q.type_id
       LEFT JOIN chapters ch ON ch.id = q.chapter_id
       LEFT JOIN difficulties d ON d.id = q.difficulty_id
       WHERE q.id = ?`,
    )
    .get(questionId) as Record<string, unknown> | undefined;
  if (!q) return;

  const content = getQuestionContent(db, questionId);
  const qText = extractDocumentPlainText(content?.questionBody);
  const aText = extractDocumentPlainText(content?.answerBody);
  const kpRows = db
    .prepare(
      `SELECT kp.name FROM question_knowledge_points qkp
       JOIN knowledge_points kp ON kp.id = qkp.knowledge_point_id
       WHERE qkp.question_id = ?`,
    )
    .all(questionId) as Array<{ name: string }>;

  const metaParts = [
    q.type_name,
    q.chapter_name,
    q.diff_name,
    q.year ? String(q.year) : '',
    q.source,
    ...kpRows.map((k) => k.name),
  ]
    .filter(Boolean)
    .map(String);
  const metaText = metaParts.join(' ');
  const normalized = normalizeSearchText(`${qText}\n${aText}\n${metaText}`);

  db.prepare(
    `INSERT INTO question_search (question_id, question_text, answer_text, meta_text, normalized_text)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(question_id) DO UPDATE SET
       question_text = excluded.question_text,
       answer_text = excluded.answer_text,
       meta_text = excluded.meta_text,
       normalized_text = excluded.normalized_text`,
  ).run(questionId, qText, aText, metaText, normalized);
}

export function buildBankQuestionDTO(
  db: DatabaseSync,
  questionId: number,
  snippet: string | null = null,
): BankQuestionDTO {
  const row = db
    .prepare(
      `SELECT q.*,
              qt.name AS type_name,
              ch.name AS chapter_name,
              d.name AS diff_name,
              qc.question_mode,
              qc.answer_mode,
              qc.answer_body_json,
              qs.question_text,
              (SELECT COUNT(*) FROM question_assets qa WHERE qa.question_id = q.id) AS asset_count,
              (SELECT COUNT(*) FROM paper_set_items psi WHERE psi.question_id = q.id) AS basket_cnt
       FROM questions q
       LEFT JOIN question_types qt ON qt.id = q.type_id
       LEFT JOIN chapters ch ON ch.id = q.chapter_id
       LEFT JOIN difficulties d ON d.id = q.difficulty_id
       LEFT JOIN question_contents qc ON qc.question_id = q.id
       LEFT JOIN question_search qs ON qs.question_id = q.id
       WHERE q.id = ?`,
    )
    .get(questionId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', `未找到题目 #${questionId}`);

  const kps = (
    db
      .prepare(
        `SELECT kp.id, kp.name FROM question_knowledge_points qkp
         JOIN knowledge_points kp ON kp.id = qkp.knowledge_point_id
         WHERE qkp.question_id = ? ORDER BY kp.id ASC`,
      )
      .all(questionId) as Array<{ id: number; name: string }>
  ).map((r) => ({ id: Number(r.id), name: String(r.name) }));

  const folderIds = (
    db
      .prepare(`SELECT folder_id FROM question_folder_items WHERE question_id = ?`)
      .all(questionId) as Array<{ folder_id: number }>
  ).map((r) => Number(r.folder_id));

  const answerDoc = row.answer_body_json ? parseDoc(row.answer_body_json) : null;
  const hasAnswer = Boolean(row.answer_image_rel_path) || hasEditableContent(answerDoc);

  return {
    id: Number(row.id),
    paperId: row.paper_id !== null && row.paper_id !== undefined ? Number(row.paper_id) : null,
    imageRelPath: row.image_rel_path ? String(row.image_rel_path) : null,
    answerImageRelPath: row.answer_image_rel_path ? String(row.answer_image_rel_path) : null,
    typeId: row.type_id !== null && row.type_id !== undefined ? Number(row.type_id) : null,
    typeName: row.type_name ? String(row.type_name) : null,
    chapterId: row.chapter_id !== null && row.chapter_id !== undefined ? Number(row.chapter_id) : null,
    chapterName: row.chapter_name ? String(row.chapter_name) : null,
    difficultyId:
      row.difficulty_id !== null && row.difficulty_id !== undefined ? Number(row.difficulty_id) : null,
    difficultyName: row.diff_name ? String(row.diff_name) : null,
    knowledgePoints: kps,
    year: row.year !== null && row.year !== undefined ? Number(row.year) : null,
    source: row.source ? String(row.source) : null,
    questionMode: row.question_mode === 'original' ? 'original' : 'editable',
    answerMode: row.answer_mode === 'original' ? 'original' : 'editable',
    previewText: String(row.question_text || '').slice(0, 260),
    snippet,
    assetCount: Number(row.asset_count || 0),
    hasAnswer,
    folderIds,
    inBasket: Number(row.basket_cnt || 0) > 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getEditableQuestion(db: DatabaseSync, questionId: number): EditableQuestionDTO {
  const question = buildBankQuestionDTO(db, questionId);
  const existing = getQuestionContent(db, questionId);
  const now = new Date().toISOString();
  const content: QuestionContentDTO = existing ?? {
    ...newQuestionContent(),
    questionId,
    revision: 0,
    updatedAt: now,
  };
  const metadata: QuestionMetadataInput = {
    typeId: question.typeId,
    chapterId: question.chapterId,
    difficultyId: question.difficultyId,
    knowledgePointIds: question.knowledgePoints.map((k) => k.id),
    year: question.year,
    source: question.source,
  };
  return {
    question,
    content,
    assets: listQuestionAssets(db, questionId),
    metadata,
  };
}

export function saveQuestionEdits(
  db: DatabaseSync,
  questionId: number,
  input: SaveQuestionEditsInput,
): EditableQuestionDTO {
  return withTransaction(db, () => {
    const exists = db.prepare(`SELECT id FROM questions WHERE id = ?`).get(questionId);
    if (!exists) throw new AppError('NOT_FOUND', `未找到题目 #${questionId}`);

    const current = getQuestionContent(db, questionId);
    const currentRev = current?.revision ?? 0;
    if (input.expectedRevision !== currentRev) {
      throw new AppError('CONFLICT', '题目已被更新，请刷新后再保存');
    }

    const nextRev = currentRev + 1;
    const now = new Date().toISOString();
    const qBody = normalizeEditableDocument(input.content.questionBody);
    const aBody = normalizeEditableDocument(input.content.answerBody);
    const qMode: ContentMode = input.content.questionMode === 'original' ? 'original' : 'editable';
    const aMode: ContentMode = input.content.answerMode === 'original' ? 'original' : 'editable';

    const qJson = JSON.stringify(qBody);
    const aJson = JSON.stringify(aBody);

    db.prepare(
      `INSERT INTO question_contents
        (question_id, question_mode, answer_mode, question_body_json, answer_body_json, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         question_mode = excluded.question_mode,
         answer_mode = excluded.answer_mode,
         question_body_json = excluded.question_body_json,
         answer_body_json = excluded.answer_body_json,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).run(questionId, qMode, aMode, qJson, aJson, nextRev, now);

    db.prepare(
      `INSERT INTO question_content_revisions
        (question_id, revision, question_mode, answer_mode, question_body_json, answer_body_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(questionId, nextRev, qMode, aMode, qJson, aJson, now);

    const m = input.metadata;
    db.prepare(
      `UPDATE questions
       SET type_id = ?, chapter_id = ?, difficulty_id = ?, year = ?, source = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      m.typeId ?? null,
      m.chapterId ?? null,
      m.difficultyId ?? null,
      m.year ?? null,
      m.source?.trim() ? m.source.trim().slice(0, 200) : null,
      now,
      questionId,
    );

    db.prepare(`DELETE FROM question_knowledge_points WHERE question_id = ?`).run(questionId);
    const insertKp = db.prepare(
      `INSERT OR IGNORE INTO question_knowledge_points (question_id, knowledge_point_id) VALUES (?, ?)`,
    );
    for (const kpId of [...new Set(m.knowledgePointIds || [])]) {
      insertKp.run(questionId, kpId);
    }

    rebuildQuestionSearch(db, questionId);
    return getEditableQuestion(db, questionId);
  });
}

export function listContentRevisions(db: DatabaseSync, questionId: number): ContentRevisionDTO[] {
  const rows = db
    .prepare(
      `SELECT revision, created_at, question_mode, answer_mode
       FROM question_content_revisions
       WHERE question_id = ?
       ORDER BY revision DESC LIMIT 50`,
    )
    .all(questionId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    revision: Number(r.revision),
    createdAt: String(r.created_at),
    questionMode: r.question_mode === 'original' ? 'original' : 'editable',
    answerMode: r.answer_mode === 'original' ? 'original' : 'editable',
  }));
}

export function restoreContentRevision(
  db: DatabaseSync,
  questionId: number,
  targetRevision: number,
): EditableQuestionDTO {
  return withTransaction(db, () => {
    const revRow = db
      .prepare(
        `SELECT * FROM question_content_revisions WHERE question_id = ? AND revision = ?`,
      )
      .get(questionId, targetRevision) as Record<string, unknown> | undefined;
    if (!revRow) throw new AppError('NOT_FOUND', `未找到版本 v${targetRevision}`);

    const current = getEditableQuestion(db, questionId);
    return saveQuestionEdits(db, questionId, {
      expectedRevision: current.content.revision,
      metadata: current.metadata,
      content: {
        schemaVersion: 1,
        questionMode: revRow.question_mode === 'original' ? 'original' : 'editable',
        answerMode: revRow.answer_mode === 'original' ? 'original' : 'editable',
        questionBody: parseDoc(revRow.question_body_json),
        answerBody: parseDoc(revRow.answer_body_json),
      },
    });
  });
}
