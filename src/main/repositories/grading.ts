import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type GradingDecision,
  type GradingItemDetail,
  type GradingSubmission,
  type KnowledgeAllocation,
  type KnowledgePoint,
  type KnowledgeStatRow,
  type PhotoAsset,
  type Rubric,
  type RubricCriterion,
  type ScoringUnit,
} from '../../shared/types';
import type { SaveGradingItemPayload } from '../../shared/ipc';
import { formatScore } from '../../shared/score-policy';
import { withTransaction } from '../db';
import { savePhotoToVault } from '../photo-store';
import { assertClassEditable } from './classes';

const uid = () => crypto.randomUUID();

function loadAssetsByIds(db: DatabaseSync, ids: string[]): PhotoAsset[] {
  if (!ids.length) return [];
  const stmt = db.prepare(
    `SELECT id, exam_id, hash, rel_path, mime, bytes, width, height, role, created_at
     FROM photo_assets WHERE id = ?`,
  );
  const out: PhotoAsset[] = [];
  for (const id of ids) {
    const r = stmt.get(id) as Record<string, unknown> | undefined;
    if (r) {
      out.push({
        id: String(r.id),
        examId: String(r.exam_id),
        hash: String(r.hash),
        relPath: String(r.rel_path),
        mime: String(r.mime),
        bytes: Number(r.bytes),
        width: Number(r.width),
        height: Number(r.height),
        role: r.role === 'reference' ? 'reference' : 'answer',
        createdAt: String(r.created_at),
      });
    }
  }
  return out;
}

export function getRubricById(db: DatabaseSync, rubricId: string): Rubric {
  const r = db
    .prepare(
      `SELECT id, item_id, version, reference_answer, frozen_at, criteria_json, created_at
       FROM grading_rubrics WHERE id = ?`,
    )
    .get(rubricId) as Record<string, unknown> | undefined;
  if (!r) throw new AppError('NOT_FOUND', '评分细则不存在');
  return {
    id: String(r.id),
    itemId: String(r.item_id),
    version: Number(r.version),
    referenceAnswer: String(r.reference_answer || ''),
    frozenAt: r.frozen_at ? String(r.frozen_at) : null,
    criteria: JSON.parse(String(r.criteria_json || '[]')) as RubricCriterion[],
    createdAt: String(r.created_at),
  };
}

export function listGradingItemsForExam(db: DatabaseSync, examId: string): GradingItemDetail[] {
  const rows = db
    .prepare(
      `SELECT id, exam_id, label, prompt, max_units, scoring_units_json, reference_asset_ids_json, linked_column_id
       FROM grading_items WHERE exam_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(examId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const itemId = String(r.id);
    const rubRow = db
      .prepare(
        `SELECT id, item_id, version, reference_answer, frozen_at, criteria_json, created_at
         FROM grading_rubrics WHERE item_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(itemId) as Record<string, unknown> | undefined;

    const rubric: Rubric | null = rubRow
      ? {
          id: String(rubRow.id),
          itemId,
          version: Number(rubRow.version),
          referenceAnswer: String(rubRow.reference_answer || ''),
          frozenAt: rubRow.frozen_at ? String(rubRow.frozen_at) : null,
          criteria: JSON.parse(String(rubRow.criteria_json || '[]')) as RubricCriterion[],
          createdAt: String(rubRow.created_at),
        }
      : null;

    const subStats = db
      .prepare(
        `SELECT COUNT(gs.id) AS total, COUNT(gd.id) AS confirmed
         FROM grading_submissions gs
         LEFT JOIN grading_decisions gd ON gd.submission_id = gs.id
         WHERE gs.item_id = ? AND gs.deleted_at IS NULL`,
      )
      .get(itemId) as { total: number; confirmed: number };

    const mapRows = db
      .prepare(
        `SELECT km.knowledge_id, kp.name AS knowledge_name, km.weight_bps
         FROM knowledge_mappings km JOIN knowledge_points kp ON kp.id = km.knowledge_id
         WHERE km.item_id = ? ORDER BY km.weight_bps DESC`,
      )
      .all(itemId) as Array<{ knowledge_id: string; knowledge_name: string; weight_bps: number }>;

    const knowledgeMappings: KnowledgeAllocation[] = mapRows.map((m) => ({
      knowledgeId: m.knowledge_id,
      knowledgeName: m.knowledge_name,
      weightBps: m.weight_bps,
    }));

    const refIds = JSON.parse(String(r.reference_asset_ids_json || '[]')) as string[];

    return {
      id: itemId,
      examId: String(r.exam_id),
      label: String(r.label),
      prompt: String(r.prompt || ''),
      maxUnits: Number(r.max_units),
      referenceAssets: loadAssetsByIds(db, refIds),
      scoringUnits: JSON.parse(String(r.scoring_units_json || '[]')) as ScoringUnit[],
      rubric,
      submissionCount: Number(subStats.total || 0),
      confirmedCount: Number(subStats.confirmed || 0),
      linkedColumnId: r.linked_column_id ? String(r.linked_column_id) : null,
      knowledgeMappings,
    };
  });
}

export function saveGradingItem(
  db: DatabaseSync,
  payload: SaveGradingItemPayload,
): GradingItemDetail {
  const ex = db
    .prepare(`SELECT class_id FROM exams WHERE id = ? AND deleted_at IS NULL`)
    .get(payload.examId) as { class_id: string } | undefined;
  if (!ex) throw new AppError('NOT_FOUND', '考试不存在');
  assertClassEditable(db, ex.class_id);

  const label = payload.label.trim();
  if (!label) throw new AppError('VALIDATION', '请填写题号或题目标签（如 14）');
  if (!payload.scoringUnits.length) throw new AppError('VALIDATION', '至少需要 1 个小题/得分模块');
  if (!payload.criteria.length) throw new AppError('VALIDATION', '至少需要 1 个评分点');

  const units: ScoringUnit[] = payload.scoringUnits.map((u, i) => ({
    id: u.id || uid(),
    label: u.label.trim() || `第 ${i + 1} 小题`,
    maxUnits: Math.max(0, Math.round(u.maxUnits)),
  }));
  const maxUnits = units.reduce((s, u) => s + u.maxUnits, 0);
  const criteria: RubricCriterion[] = payload.criteria.map((c) => {
    const su = units[c.scoringUnitIndex] || units[0];
    return {
      id: c.id || uid(),
      scoringUnitId: su.id,
      description: c.description.trim() || '得分点',
      maxUnits: Math.max(0, Math.round(c.maxUnits)),
      stepUnits: Math.max(1, Math.round(c.stepUnits)),
      exclusiveGroup: c.exclusiveGroup?.trim() || null,
    };
  });

  const now = new Date().toISOString();
  const itemId = payload.itemId || uid();

  withTransaction(db, () => {
    const colLabel = `第 ${label} 题（阅卷）`;
    const colKey = `grading_${itemId.slice(0, 8)}`;

    if (payload.itemId) {
      const existing = db
        .prepare(`SELECT linked_column_id FROM grading_items WHERE id = ?`)
        .get(itemId) as { linked_column_id: string | null } | undefined;
      if (!existing) throw new AppError('NOT_FOUND', '试题不存在');

      db.prepare(
        `UPDATE grading_items
         SET label = ?, prompt = ?, max_units = ?, scoring_units_json = ?, reference_asset_ids_json = ?
         WHERE id = ?`,
      ).run(
        label.slice(0, 60),
        payload.prompt.trim().slice(0, 20000),
        maxUnits,
        JSON.stringify(units),
        JSON.stringify(payload.referenceAssetIds || []),
        itemId,
      );

      if (existing.linked_column_id) {
        db.prepare(`UPDATE exam_columns SET label = ?, max_units = ? WHERE id = ?`).run(
          colLabel,
          maxUnits,
          existing.linked_column_id,
        );
      }

      const latestRubric = db
        .prepare(
          `SELECT id, version, frozen_at FROM grading_rubrics WHERE item_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(itemId) as { id: string; version: number; frozen_at: string | null } | undefined;

      if (latestRubric && !latestRubric.frozen_at) {
        db.prepare(
          `UPDATE grading_rubrics SET reference_answer = ?, criteria_json = ? WHERE id = ?`,
        ).run(payload.referenceAnswer.trim(), JSON.stringify(criteria), latestRubric.id);
      } else {
        db.prepare(
          `INSERT INTO grading_rubrics (id, item_id, version, reference_answer, frozen_at, criteria_json, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          uid(),
          itemId,
          (latestRubric?.version || 0) + 1,
          payload.referenceAnswer.trim(),
          JSON.stringify(criteria),
          now,
        );
      }
    } else {
      const colId = uid();
      const maxColOrder = (
        db
          .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM exam_columns WHERE exam_id = ?`)
          .get(payload.examId) as { mx: number }
      ).mx;
      const maxItemOrder = (
        db
          .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM grading_items WHERE exam_id = ?`)
          .get(payload.examId) as { mx: number }
      ).mx;

      // Auto-create linked exam column so confirmed grading scores flow directly into unified Exam Center!
      db.prepare(
        `INSERT INTO exam_columns (id, exam_id, col_key, label, role, source, grading_item_id, max_units, sort_order)
         VALUES (?, ?, ?, ?, 'score', 'grading', ?, ?, ?)`,
      ).run(colId, payload.examId, colKey, colLabel, itemId, maxUnits, maxColOrder + 1);

      db.prepare(
        `INSERT INTO grading_items (id, exam_id, label, prompt, max_units, scoring_units_json, reference_asset_ids_json, linked_column_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        payload.examId,
        label.slice(0, 60),
        payload.prompt.trim().slice(0, 20000),
        maxUnits,
        JSON.stringify(units),
        JSON.stringify(payload.referenceAssetIds || []),
        colId,
        maxItemOrder + 1,
        now,
      );

      db.prepare(
        `INSERT INTO grading_rubrics (id, item_id, version, reference_answer, frozen_at, criteria_json, created_at)
         VALUES (?, ?, 1, ?, NULL, ?, ?)`,
      ).run(uid(), itemId, payload.referenceAnswer.trim(), JSON.stringify(criteria), now);
    }
  });

  return listGradingItemsForExam(db, payload.examId).find((i) => i.id === itemId)!;
}

export function freezeRubric(db: DatabaseSync, rubricId: string): GradingItemDetail {
  const row = db
    .prepare(
      `SELECT r.item_id, gi.exam_id, e.class_id
       FROM grading_rubrics r
       JOIN grading_items gi ON gi.id = r.item_id
       JOIN exams e ON e.id = gi.exam_id
       WHERE r.id = ?`,
    )
    .get(rubricId) as { item_id: string; exam_id: string; class_id: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', '评分细则不存在');
  assertClassEditable(db, row.class_id);
  db.prepare(`UPDATE grading_rubrics SET frozen_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    rubricId,
  );
  return listGradingItemsForExam(db, row.exam_id).find((i) => i.id === row.item_id)!;
}

export function deleteGradingItem(db: DatabaseSync, itemId: string) {
  const row = db
    .prepare(
      `SELECT gi.exam_id, gi.linked_column_id, e.class_id
       FROM grading_items gi JOIN exams e ON e.id = gi.exam_id WHERE gi.id = ?`,
    )
    .get(itemId) as
    | { exam_id: string; linked_column_id: string | null; class_id: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', '试题不存在');
  assertClassEditable(db, row.class_id);
  withTransaction(db, () => {
    if (row.linked_column_id) {
      db.prepare(`DELETE FROM exam_columns WHERE id = ?`).run(row.linked_column_id);
    }
    db.prepare(`DELETE FROM grading_items WHERE id = ?`).run(itemId);
  });
}

export function registerPhotoAsset(
  db: DatabaseSync,
  vaultPath: string,
  payload: {
    examId: string;
    role: 'answer' | 'reference';
    bytes: Uint8Array;
    mime: string;
    width: number;
    height: number;
  },
): PhotoAsset {
  const saved = savePhotoToVault(vaultPath, payload.examId, payload.bytes, payload.mime);
  const existing = db
    .prepare(
      `SELECT id, exam_id, hash, rel_path, mime, bytes, width, height, role, created_at
       FROM photo_assets WHERE exam_id = ? AND hash = ? AND role = ? LIMIT 1`,
    )
    .get(payload.examId, saved.hash, payload.role) as Record<string, unknown> | undefined;
  if (existing) {
    return {
      id: String(existing.id),
      examId: String(existing.exam_id),
      hash: String(existing.hash),
      relPath: String(existing.rel_path),
      mime: String(existing.mime),
      bytes: Number(existing.bytes),
      width: Number(existing.width),
      height: Number(existing.height),
      role: existing.role === 'reference' ? 'reference' : 'answer',
      createdAt: String(existing.created_at),
    };
  }
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO photo_assets (id, exam_id, hash, rel_path, mime, bytes, width, height, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    payload.examId,
    saved.hash,
    saved.relPath,
    saved.mime,
    saved.bytes,
    Math.max(1, Math.round(payload.width)),
    Math.max(1, Math.round(payload.height)),
    payload.role,
    now,
  );
  return {
    id,
    examId: payload.examId,
    hash: saved.hash,
    relPath: saved.relPath,
    mime: saved.mime,
    bytes: saved.bytes,
    width: Math.max(1, Math.round(payload.width)),
    height: Math.max(1, Math.round(payload.height)),
    role: payload.role,
    createdAt: now,
  };
}

export function listSubmissions(
  db: DatabaseSync,
  examId: string,
  itemId?: string,
): GradingSubmission[] {
  const sql = itemId
    ? `SELECT gs.*, s.name AS student_name, m.roster_no
       FROM grading_submissions gs
       JOIN memberships m ON m.id = gs.membership_id
       JOIN students s ON s.id = m.student_id
       WHERE gs.exam_id = ? AND gs.item_id = ? AND gs.deleted_at IS NULL
       ORDER BY m.sort_order ASC, gs.updated_at DESC`
    : `SELECT gs.*, s.name AS student_name, m.roster_no
       FROM grading_submissions gs
       JOIN memberships m ON m.id = gs.membership_id
       JOIN students s ON s.id = m.student_id
       WHERE gs.exam_id = ? AND gs.deleted_at IS NULL
       ORDER BY gs.updated_at DESC`;

  const rows = (itemId ? db.prepare(sql).all(examId, itemId) : db.prepare(sql).all(examId)) as Array<
    Record<string, unknown>
  >;

  const getDec = db.prepare(
    `SELECT id, submission_id, rubric_id, total_units, scores_json, comment, source, confidence, confirmed_at
     FROM grading_decisions WHERE submission_id = ?`,
  );

  return rows.map((r) => {
    const id = String(r.id);
    const dRow = getDec.get(id) as Record<string, unknown> | undefined;
    const decision: GradingDecision | null = dRow
      ? {
          id: String(dRow.id),
          submissionId: id,
          rubricId: String(dRow.rubric_id),
          totalUnits: Number(dRow.total_units),
          scores: JSON.parse(String(dRow.scores_json || '[]')),
          comment: String(dRow.comment || ''),
          source: (dRow.source as GradingDecision['source']) || 'manual',
          confidence:
            dRow.confidence !== null && dRow.confidence !== undefined
              ? Number(dRow.confidence)
              : null,
          confirmedAt: String(dRow.confirmed_at),
        }
      : null;

    const assetIds = JSON.parse(String(r.asset_ids_json || '[]')) as string[];
    return {
      id,
      examId: String(r.exam_id),
      itemId: String(r.item_id),
      membershipId: String(r.membership_id),
      studentName: String(r.student_name),
      rosterNo: String(r.roster_no || ''),
      typedText: String(r.typed_text || ''),
      assets: loadAssetsByIds(db, assetIds),
      completeness: r.completeness === 'needs-attention' ? 'needs-attention' : 'complete',
      decision,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });
}

export function saveSubmission(
  db: DatabaseSync,
  payload: {
    examId: string;
    itemId: string;
    membershipId: string;
    assetIds: string[];
    typedText?: string;
    completeness?: 'complete' | 'needs-attention';
  },
): GradingSubmission {
  const ex = db
    .prepare(`SELECT class_id FROM exams WHERE id = ? AND deleted_at IS NULL`)
    .get(payload.examId) as { class_id: string } | undefined;
  if (!ex) throw new AppError('NOT_FOUND', '考试不存在');
  assertClassEditable(db, ex.class_id);

  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM grading_submissions
       WHERE exam_id = ? AND item_id = ? AND membership_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(payload.examId, payload.itemId, payload.membershipId) as { id: string } | undefined;

  const id = existing?.id || uid();
  if (existing) {
    db.prepare(
      `UPDATE grading_submissions SET asset_ids_json = ?, typed_text = ?, completeness = ?, updated_at = ? WHERE id = ?`,
    ).run(
      JSON.stringify(payload.assetIds),
      (payload.typedText || '').slice(0, 20000),
      payload.completeness || 'complete',
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO grading_submissions (id, exam_id, item_id, membership_id, typed_text, asset_ids_json, completeness, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.examId,
      payload.itemId,
      payload.membershipId,
      (payload.typedText || '').slice(0, 20000),
      JSON.stringify(payload.assetIds),
      payload.completeness || 'complete',
      now,
      now,
    );
  }

  return listSubmissions(db, payload.examId, payload.itemId).find((s) => s.id === id)!;
}

export function softDeleteSubmission(db: DatabaseSync, submissionId: string) {
  db.prepare(`UPDATE grading_submissions SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    submissionId,
  );
}

/**
 * Confirms a grading decision AND atomically syncs the confirmed total score
 * into the unified exam's linked exam_columns/exam_scores + audit log!
 */
export function confirmGradingDecision(
  db: DatabaseSync,
  payload: {
    submissionId: string;
    rubricId: string;
    scores: Array<{ criterionId: string; units: number; reason: string }>;
    comment: string;
    source: 'manual' | 'ai-auto' | 'ai-assisted';
    confidence: number | null;
  },
): { submission: GradingSubmission; syncedColumnId: string } {
  const subRow = db
    .prepare(
      `SELECT gs.id, gs.exam_id, gs.item_id, gs.membership_id, gi.label AS item_label, gi.linked_column_id, gi.max_units,
              e.class_id, s.name AS student_name
       FROM grading_submissions gs
       JOIN grading_items gi ON gi.id = gs.item_id
       JOIN exams e ON e.id = gs.exam_id
       JOIN memberships m ON m.id = gs.membership_id
       JOIN students s ON s.id = m.student_id
       WHERE gs.id = ? AND gs.deleted_at IS NULL`,
    )
    .get(payload.submissionId) as Record<string, unknown> | undefined;

  if (!subRow) throw new AppError('NOT_FOUND', '答卷不存在或已删除');
  assertClassEditable(db, String(subRow.class_id));

  const totalUnits = payload.scores.reduce((sum, x) => sum + Math.round(x.units), 0);
  const maxUnits = Number(subRow.max_units);
  if (totalUnits < 0 || totalUnits > maxUnits) {
    throw new AppError('SCORE', `总分 ${formatScore(totalUnits)} 超出本题满分 ${formatScore(maxUnits)}`);
  }

  const now = new Date().toISOString();
  const examId = String(subRow.exam_id);
  const itemId = String(subRow.item_id);
  const membershipId = String(subRow.membership_id);
  const studentName = String(subRow.student_name);
  const itemLabel = String(subRow.item_label);
  let syncedColumnId = subRow.linked_column_id ? String(subRow.linked_column_id) : '';

  withTransaction(db, () => {
    const prevDec = db
      .prepare(`SELECT total_units FROM grading_decisions WHERE submission_id = ?`)
      .get(payload.submissionId) as { total_units: number } | undefined;

    db.prepare(
      `INSERT INTO grading_decisions (id, submission_id, rubric_id, total_units, scores_json, comment, source, confidence, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(submission_id) DO UPDATE SET
         rubric_id = excluded.rubric_id,
         total_units = excluded.total_units,
         scores_json = excluded.scores_json,
         comment = excluded.comment,
         source = excluded.source,
         confidence = excluded.confidence,
         confirmed_at = excluded.confirmed_at`,
    ).run(
      uid(),
      payload.submissionId,
      payload.rubricId,
      totalUnits,
      JSON.stringify(payload.scores),
      payload.comment.trim().slice(0, 2000),
      payload.source,
      payload.confidence !== null ? Math.round(payload.confidence) : null,
      now,
    );

    // Ensure linked exam column exists
    if (!syncedColumnId) {
      syncedColumnId = uid();
      const maxOrder = (
        db
          .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM exam_columns WHERE exam_id = ?`)
          .get(examId) as { mx: number }
      ).mx;
      db.prepare(
        `INSERT INTO exam_columns (id, exam_id, col_key, label, role, source, grading_item_id, max_units, sort_order)
         VALUES (?, ?, ?, ?, 'score', 'grading', ?, ?, ?)`,
      ).run(
        syncedColumnId,
        examId,
        `grading_${itemId.slice(0, 8)}`,
        `第 ${itemLabel} 题（阅卷）`,
        itemId,
        maxUnits,
        maxOrder + 1,
      );
      db.prepare(`UPDATE grading_items SET linked_column_id = ? WHERE id = ?`).run(
        syncedColumnId,
        itemId,
      );
    }

    // Sync into unified exam_scores!
    const scoreStr = formatScore(totalUnits);
    db.prepare(
      `INSERT INTO exam_scores (id, exam_id, column_id, membership_id, status, units, raw_text, corrected_text, from_formula, updated_at)
       VALUES (?, ?, ?, ?, 'score', ?, ?, NULL, 0, ?)
       ON CONFLICT(exam_id, column_id, membership_id) DO UPDATE SET
         status = 'score',
         units = excluded.units,
         raw_text = excluded.raw_text,
         updated_at = excluded.updated_at`,
    ).run(uid(), examId, syncedColumnId, membershipId, totalUnits, scoreStr, now);

    // Lightweight audit log if revising an already confirmed score
    if (prevDec && prevDec.total_units !== totalUnits) {
      db.prepare(
        `INSERT INTO score_audit_logs (id, exam_id, membership_id, student_name, target_label, old_value, new_value, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uid(),
        examId,
        membershipId,
        studentName,
        `第 ${itemLabel} 题（阅卷）`,
        formatScore(prevDec.total_units),
        scoreStr,
        payload.comment.trim().slice(0, 300) || '阅卷复核改分',
        now,
      );
    }
  });

  const submission = listSubmissions(db, examId, itemId).find(
    (s) => s.id === payload.submissionId,
  )!;
  return { submission, syncedColumnId };
}

export function saveKnowledgePoints(
  db: DatabaseSync,
  examId: string,
  names: string[],
): KnowledgePoint[] {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  withTransaction(db, () => {
    const existing = db
      .prepare(`SELECT id, name FROM knowledge_points WHERE exam_id = ?`)
      .all(examId) as Array<{ id: string; name: string }>;
    const keepSet = new Set(clean);
    for (const e of existing) {
      if (!keepSet.has(e.name)) db.prepare(`DELETE FROM knowledge_points WHERE id = ?`).run(e.id);
    }
    const ins = db.prepare(
      `INSERT OR IGNORE INTO knowledge_points (id, exam_id, name) VALUES (?, ?, ?)`,
    );
    for (const name of clean) ins.run(uid(), examId, name.slice(0, 120));
  });
  return (
    db
      .prepare(`SELECT id, exam_id, name FROM knowledge_points WHERE exam_id = ? ORDER BY name ASC`)
      .all(examId) as Array<{ id: string; exam_id: string; name: string }>
  ).map((r) => ({ id: r.id, examId: r.exam_id, name: r.name }));
}

export function saveItemKnowledgeMap(
  db: DatabaseSync,
  itemId: string,
  allocations: Array<{ knowledgeId: string; weightBps: number }>,
) {
  const sum = allocations.reduce((s, a) => s + a.weightBps, 0);
  if (allocations.length > 0 && sum !== 10000) {
    throw new AppError('VALIDATION', `知识点权重合计须为 100%（当前 ${(sum / 100).toFixed(1)}%）`);
  }
  withTransaction(db, () => {
    db.prepare(`DELETE FROM knowledge_mappings WHERE item_id = ?`).run(itemId);
    const ins = db.prepare(
      `INSERT INTO knowledge_mappings (item_id, knowledge_id, weight_bps) VALUES (?, ?, ?)`,
    );
    for (const a of allocations) {
      if (a.weightBps > 0) ins.run(itemId, a.knowledgeId, Math.round(a.weightBps));
    }
  });
}

export function getKnowledgeStats(db: DatabaseSync, examId: string): KnowledgeStatRow[] {
  const kps = db
    .prepare(`SELECT id, name FROM knowledge_points WHERE exam_id = ? ORDER BY name ASC`)
    .all(examId) as Array<{ id: string; name: string }>;
  if (!kps.length) return [];

  const items = listGradingItemsForExam(db, examId);
  const subs = listSubmissions(db, examId);
  const stats = new Map<
    string,
    { name: string; earned: number; possible: number; itemLabels: Set<string> }
  >();
  for (const kp of kps) {
    stats.set(kp.id, { name: kp.name, earned: 0, possible: 0, itemLabels: new Set() });
  }

  for (const item of items) {
    if (!item.knowledgeMappings.length) continue;
    const confirmed = subs.filter((s) => s.itemId === item.id && s.decision);
    for (const map of item.knowledgeMappings) {
      const bucket = stats.get(map.knowledgeId);
      if (!bucket) continue;
      bucket.itemLabels.add(`第 ${item.label} 题`);
      const ratio = map.weightBps / 10000;
      for (const s of confirmed) {
        bucket.earned += s.decision!.totalUnits * ratio;
        bucket.possible += item.maxUnits * ratio;
      }
    }
  }

  return [...stats.entries()]
    .map(([knowledgeId, v]) => ({
      knowledgeId,
      name: v.name,
      earnedUnits: Math.round(v.earned),
      possibleUnits: Math.round(v.possible),
      rate: v.possible > 0 ? (v.earned / v.possible) * 100 : 0,
      itemLabels: [...v.itemLabels],
    }))
    .sort((a, b) => a.rate - b.rate);
}
