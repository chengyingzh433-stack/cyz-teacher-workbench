import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';
import {
  defaultFigureWidthPercent,
  emptyDocument,
  type EditableBlock,
  type EditableDocument,
} from '../../shared/qbank/editable';
import {
  emptyQuestionMetadata,
  type IntakeBlock,
  type IntakeDraftDTO,
  type IntakeSourceDTO,
  type IntakeSourceKind,
  type IntakeWorkspaceDTO,
  type QuestionMetadataInput,
} from '../../shared/qbank/types';
import { withTransaction } from '../db';
import {
  copyQbankProjectFile,
  readImageDimensions,
  removeQbankSubdir,
  writeQbankProjectFile,
} from './assets';
import { rebuildQuestionSearch } from './content';

function parseBlocks(raw: unknown): IntakeBlock[] {
  try {
    const arr = JSON.parse(String(raw || '[]'));
    return Array.isArray(arr) ? (arr as IntakeBlock[]) : [];
  } catch {
    return [];
  }
}

function parseMeta(raw: unknown): QuestionMetadataInput {
  try {
    const parsed = JSON.parse(String(raw || '{}')) as Partial<QuestionMetadataInput>;
    return {
      typeId: typeof parsed.typeId === 'number' ? parsed.typeId : null,
      chapterId: typeof parsed.chapterId === 'number' ? parsed.chapterId : null,
      difficultyId: typeof parsed.difficultyId === 'number' ? parsed.difficultyId : null,
      knowledgePointIds: Array.isArray(parsed.knowledgePointIds)
        ? parsed.knowledgePointIds.filter((x): x is number => typeof x === 'number')
        : [],
      year: typeof parsed.year === 'number' ? parsed.year : null,
      source: typeof parsed.source === 'string' && parsed.source.trim() ? parsed.source.trim() : null,
    };
  } catch {
    return emptyQuestionMetadata();
  }
}

function mapSource(r: Record<string, unknown>): IntakeSourceDTO {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as IntakeSourceKind,
    relPath: String(r.rel_path),
    pageCount: Number(r.page_count || 1),
    draftCount: Number(r.draft_cnt || 0),
    publishedCount: Number(r.pub_cnt || 0),
    createdAt: String(r.created_at),
  };
}

function mapDraft(r: Record<string, unknown>): IntakeDraftDTO {
  return {
    id: String(r.id),
    sourceId: String(r.source_id),
    status: r.status === 'published' ? 'published' : 'draft',
    questionId: r.question_id !== null && r.question_id !== undefined ? Number(r.question_id) : null,
    questionBlocks: parseBlocks(r.question_blocks_json),
    answerBlocks: parseBlocks(r.answer_blocks_json),
    metadata: parseMeta(r.metadata_json),
    originalRelPath: r.original_rel_path ? String(r.original_rel_path) : null,
    updatedAt: String(r.updated_at),
  };
}

export function listIntakeSources(db: DatabaseSync): IntakeSourceDTO[] {
  const rows = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM intake_drafts d WHERE d.source_id = s.id AND d.status = 'draft') AS draft_cnt,
              (SELECT COUNT(*) FROM intake_drafts d WHERE d.source_id = s.id AND d.status = 'published') AS pub_cnt
       FROM intake_sources s
       ORDER BY s.created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapSource);
}

export function importIntakeSource(
  db: DatabaseSync,
  vaultPath: string,
  input: { name: string; kind: IntakeSourceKind; bytes: Uint8Array | Buffer; pageCount?: number },
): IntakeWorkspaceDTO {
  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (!buf.length || buf.length > 100 * 1024 * 1024) {
    throw new AppError('VALIDATION', '源文件为空或超过 100 MB 限制');
  }
  const id = crypto.randomUUID();
  const ext = input.kind === 'pdf' ? '.pdf' : input.kind === 'docx' ? '.docx' : '.png';
  const relPath = `sources/${id}/source${ext}`;
  writeQbankProjectFile(vaultPath, relPath, buf);

  const now = new Date().toISOString();
  const safeName = (input.name || '未命名试卷').trim().slice(0, 180) || '未命名试卷';
  const initialMeta: QuestionMetadataInput = {
    ...emptyQuestionMetadata(),
    source: safeName.replace(/\.(pdf|docx|png|jpe?g|webp)$/i, ''),
    year: new Date().getFullYear(),
  };

  return withTransaction(db, () => {
    db.prepare(
      `INSERT INTO intake_sources (id, name, kind, rel_path, page_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, safeName, input.kind, relPath, Math.max(1, input.pageCount || 1), now);

    db.prepare(
      `INSERT INTO papers (title, kind, source_id, created_at) VALUES (?, 'intake', ?, ?)`,
    ).run(safeName, id, now);

    const draftId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO intake_drafts
        (id, source_id, status, question_blocks_json, answer_blocks_json, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'draft', '[]', '[]', ?, ?, ?)`,
    ).run(draftId, id, JSON.stringify(initialMeta), now, now);

    return getIntakeWorkspace(db, id);
  });
}

export function getIntakeWorkspace(db: DatabaseSync, sourceId: string): IntakeWorkspaceDTO {
  const sRow = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM intake_drafts d WHERE d.source_id = s.id AND d.status = 'draft') AS draft_cnt,
              (SELECT COUNT(*) FROM intake_drafts d WHERE d.source_id = s.id AND d.status = 'published') AS pub_cnt
       FROM intake_sources s WHERE s.id = ?`,
    )
    .get(sourceId) as Record<string, unknown> | undefined;
  if (!sRow) throw new AppError('NOT_FOUND', '未找到录题源文件');

  const draftRows = db
    .prepare(`SELECT * FROM intake_drafts WHERE source_id = ? ORDER BY created_at ASC`)
    .all(sourceId) as Array<Record<string, unknown>>;

  return {
    source: mapSource(sRow),
    drafts: draftRows.map(mapDraft),
  };
}

export function deleteIntakeSource(db: DatabaseSync, vaultPath: string, sourceId: string) {
  db.prepare(`DELETE FROM intake_sources WHERE id = ?`).run(sourceId);
  removeQbankSubdir(vaultPath, `sources/${sourceId}`);
}

export function createIntakeDraft(
  db: DatabaseSync,
  sourceId: string,
  inheritMetadata?: QuestionMetadataInput,
): IntakeDraftDTO {
  const source = db.prepare(`SELECT id, name FROM intake_sources WHERE id = ?`).get(sourceId) as
    | { id: string; name: string }
    | undefined;
  if (!source) throw new AppError('NOT_FOUND', '录题源文件不存在');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const meta: QuestionMetadataInput = inheritMetadata
    ? {
        ...inheritMetadata,
        knowledgePointIds: [...(inheritMetadata.knowledgePointIds || [])],
      }
    : {
        ...emptyQuestionMetadata(),
        source: source.name.replace(/\.(pdf|docx|png|jpe?g|webp)$/i, ''),
        year: new Date().getFullYear(),
      };

  db.prepare(
    `INSERT INTO intake_drafts
      (id, source_id, status, question_blocks_json, answer_blocks_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, 'draft', '[]', '[]', ?, ?, ?)`,
  ).run(id, sourceId, JSON.stringify(meta), now, now);

  const row = db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return mapDraft(row);
}

export function updateIntakeDraft(
  db: DatabaseSync,
  draftId: string,
  patch: {
    questionBlocks?: IntakeBlock[];
    answerBlocks?: IntakeBlock[];
    metadata?: QuestionMetadataInput;
    originalRelPath?: string | null;
  },
): IntakeDraftDTO {
  const row = db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(draftId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '未找到录题草稿');

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE intake_drafts
     SET question_blocks_json = ?, answer_blocks_json = ?, metadata_json = ?, original_rel_path = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.questionBlocks ? JSON.stringify(patch.questionBlocks) : String(row.question_blocks_json),
    patch.answerBlocks ? JSON.stringify(patch.answerBlocks) : String(row.answer_blocks_json),
    patch.metadata ? JSON.stringify(patch.metadata) : String(row.metadata_json),
    patch.originalRelPath !== undefined
      ? patch.originalRelPath
      : (row.original_rel_path as string | null),
    now,
    draftId,
  );

  const updated = db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(draftId) as Record<
    string,
    unknown
  >;
  return mapDraft(updated);
}

export function deleteIntakeDraft(db: DatabaseSync, draftId: string) {
  db.prepare(`DELETE FROM intake_drafts WHERE id = ?`).run(draftId);
}

export function saveIntakeCroppedImage(
  vaultPath: string,
  sourceId: string,
  input: { bytes: Uint8Array | Buffer; name?: string; cropWidthRatio?: number | null },
): { relPath: string; widthPx: number; heightPx: number; widthPercent: number } {
  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (!buf.length || buf.length > 30 * 1024 * 1024) {
    throw new AppError('VALIDATION', '裁剪图片为空或超出大小限制');
  }
  const { width, height } = readImageDimensions(buf);
  const id = crypto.randomUUID();
  const relPath = `sources/${sourceId}/figures/fig_${id}.png`;
  writeQbankProjectFile(vaultPath, relPath, buf);
  return {
    relPath,
    widthPx: width,
    heightPx: height,
    widthPercent: defaultFigureWidthPercent(width, height, input.cropWidthRatio),
  };
}

function buildDocFromIntake(
  db: DatabaseSync,
  vaultPath: string,
  questionId: number,
  blocks: IntakeBlock[],
): EditableDocument {
  const content: EditableBlock[] = [];
  const now = new Date().toISOString();
  const insertAsset = db.prepare(
    `INSERT INTO question_assets (id, question_id, rel_path, width_px, height_px, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const block of blocks) {
    if (block.kind === 'text') {
      const lines = block.text.replace(/\r\n/g, '\n').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          content.push({ type: 'paragraph', content: [{ type: 'text', text: trimmed }] });
        }
      }
    } else if (block.kind === 'image') {
      const assetId = crypto.randomUUID();
      const destRel = `questions/${questionId}/asset_${assetId}.png`;
      copyQbankProjectFile(vaultPath, block.relPath, destRel);
      insertAsset.run(
        assetId,
        questionId,
        destRel,
        block.widthPx,
        block.heightPx,
        block.caption || '题图',
        now,
      );
      content.push({
        type: 'image',
        attrs: {
          assetId,
          widthPercent: block.widthPercent || defaultFigureWidthPercent(block.widthPx, block.heightPx),
          align: 'center',
          caption: block.caption || '',
        },
      });
    }
  }

  return content.length > 0 ? { type: 'doc', content } : emptyDocument();
}

export function publishIntakeDraft(
  db: DatabaseSync,
  vaultPath: string,
  draftId: string,
  originalBytes?: Uint8Array | Buffer | null,
): { questionId: number; draft: IntakeDraftDTO; nextDraft: IntakeDraftDTO } {
  return withTransaction(db, () => {
    const row = db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(draftId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', '未找到录题草稿');
    const draft = mapDraft(row);

    const hasQ = draft.questionBlocks.some((b) =>
      b.kind === 'image' ? true : Boolean(b.text.trim()),
    );
    if (!hasQ && !originalBytes && !draft.originalRelPath) {
      throw new AppError('VALIDATION', '请至少添加一段题干文字或裁剪一张题图再入库');
    }

    const paperRow = db
      .prepare(`SELECT id FROM papers WHERE source_id = ? LIMIT 1`)
      .get(draft.sourceId) as { id: number } | undefined;
    const now = new Date().toISOString();
    const m = draft.metadata;

    const seqRow = paperRow
      ? (db
          .prepare(`SELECT COALESCE(MAX(seq_in_paper), 0) AS m FROM questions WHERE paper_id = ?`)
          .get(paperRow.id) as { m: number })
      : { m: 0 };

    const qInsert = db
      .prepare(
        `INSERT INTO questions
          (paper_id, seq_in_paper, type_id, chapter_id, difficulty_id, year, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        paperRow?.id ?? null,
        Number(seqRow.m || 0) + 1,
        m.typeId ?? null,
        m.chapterId ?? null,
        m.difficultyId ?? null,
        m.year ?? null,
        m.source?.trim() || null,
        now,
        now,
      );
    const questionId = Number(qInsert.lastInsertRowid);

    // Optional original screenshot snapshot for side-by-side proofreading & AI/OCR
    let imageRelPath: string | null = null;
    if (originalBytes && originalBytes.length > 0) {
      imageRelPath = writeQbankProjectFile(
        vaultPath,
        `questions/${questionId}/original_q.png`,
        originalBytes,
      );
    } else if (draft.originalRelPath) {
      imageRelPath = copyQbankProjectFile(
        vaultPath,
        draft.originalRelPath,
        `questions/${questionId}/original_q.png`,
      );
    }
    if (imageRelPath) {
      db.prepare(`UPDATE questions SET image_rel_path = ? WHERE id = ?`).run(
        imageRelPath,
        questionId,
      );
    }

    const insertKp = db.prepare(
      `INSERT OR IGNORE INTO question_knowledge_points (question_id, knowledge_point_id) VALUES (?, ?)`,
    );
    for (const kpId of [...new Set(m.knowledgePointIds || [])]) {
      insertKp.run(questionId, kpId);
    }

    const qDoc = buildDocFromIntake(db, vaultPath, questionId, draft.questionBlocks);
    const aDoc = buildDocFromIntake(db, vaultPath, questionId, draft.answerBlocks);
    const qMode = hasQ ? 'editable' : 'original';
    const qJson = JSON.stringify(qDoc);
    const aJson = JSON.stringify(aDoc);

    db.prepare(
      `INSERT INTO question_contents
        (question_id, question_mode, answer_mode, question_body_json, answer_body_json, revision, updated_at)
       VALUES (?, ?, 'editable', ?, ?, 1, ?)`,
    ).run(questionId, qMode, qJson, aJson, now);

    db.prepare(
      `INSERT INTO question_content_revisions
        (question_id, revision, question_mode, answer_mode, question_body_json, answer_body_json, created_at)
       VALUES (?, 1, ?, 'editable', ?, ?, ?)`,
    ).run(questionId, qMode, qJson, aJson, now);

    rebuildQuestionSearch(db, questionId);

    db.prepare(
      `UPDATE intake_drafts SET status = 'published', question_id = ?, updated_at = ? WHERE id = ?`,
    ).run(questionId, now, draftId);

    const publishedDraft = mapDraft(
      db.prepare(`SELECT * FROM intake_drafts WHERE id = ?`).get(draftId) as Record<string, unknown>,
    );
    // Auto-create next continuous draft inheriting metadata (type, chapter, difficulty, year, source)
    const nextDraft = createIntakeDraft(db, draft.sourceId, draft.metadata);

    return { questionId, draft: publishedDraft, nextDraft };
  });
}
