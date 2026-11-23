import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAPTER_TEMPLATES, DEFAULT_CHAPTER_TEMPLATE_KEY } from '../../shared/qbank/chapter-templates';
import { DEFAULT_WORD_OPTIONS } from '../../shared/qbank/editable';
import { withTransaction } from '../db';

export const QBANK_DIR_NAME = 'question-bank';
export const QBANK_DB_NAME = 'question-bank.sqlite';

export function getQbankDir(vaultPath: string): string {
  return path.join(vaultPath, QBANK_DIR_NAME);
}

export function getQbankDbPath(vaultPath: string): string {
  return path.join(getQbankDir(vaultPath), QBANK_DB_NAME);
}

export function openQbankDatabase(vaultPath: string): DatabaseSync {
  const dir = getQbankDir(vaultPath);
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  const db = new DatabaseSync(getQbankDbPath(vaultPath));
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  initQbankSchema(db);
  seedDefaults(db);
  // Safety guardrail: any OCR job left in-flight from a prior session is paused, never auto-re-uploaded.
  db.prepare(
    `UPDATE ocr_jobs
     SET status = 'paused',
         error = COALESCE(error, '软件重启后已自动暂停等待；如需继续请手动点击查询'),
         updated_at = ?
     WHERE status = 'processing'`,
  ).run(new Date().toISOString());
  return db;
}

function initQbankSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT NOT NULL DEFAULT '',
      node_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_parent ON chapters(parent_id, sort_order);

    CREATE TABLE IF NOT EXISTS knowledge_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS difficulties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'intake' CHECK (kind IN ('paper', 'intake', 'manual')),
      source_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
      seq_in_paper INTEGER NOT NULL DEFAULT 0,
      image_rel_path TEXT,
      answer_image_rel_path TEXT,
      type_id INTEGER REFERENCES question_types(id) ON DELETE SET NULL,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      difficulty_id INTEGER REFERENCES difficulties(id) ON DELETE SET NULL,
      year INTEGER,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_questions_filter ON questions(type_id, chapter_id, difficulty_id, year);

    CREATE TABLE IF NOT EXISTS question_knowledge_points (
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
      PRIMARY KEY (question_id, knowledge_point_id)
    );

    CREATE TABLE IF NOT EXISTS question_contents (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      question_mode TEXT NOT NULL DEFAULT 'editable' CHECK (question_mode IN ('original', 'editable')),
      answer_mode TEXT NOT NULL DEFAULT 'editable' CHECK (answer_mode IN ('original', 'editable')),
      question_body_json TEXT NOT NULL,
      answer_body_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_content_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      question_mode TEXT NOT NULL,
      answer_mode TEXT NOT NULL,
      question_body_json TEXT NOT NULL,
      answer_body_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (question_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_qcontent_revs ON question_content_revisions(question_id, revision DESC);

    CREATE TABLE IF NOT EXISTS question_assets (
      id TEXT PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      width_px INTEGER NOT NULL,
      height_px INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qassets_question ON question_assets(question_id);

    CREATE TABLE IF NOT EXISTS question_search (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      meta_text TEXT NOT NULL DEFAULT '',
      normalized_text TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS intake_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('pdf', 'docx', 'image')),
      rel_path TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intake_drafts (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES intake_sources(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
      question_blocks_json TEXT NOT NULL DEFAULT '[]',
      answer_blocks_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      original_rel_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intake_drafts_source ON intake_drafts(source_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS question_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_folder_items (
      folder_id INTEGER NOT NULL REFERENCES question_folders(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY (folder_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS paper_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      word_options_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_set_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER NOT NULL REFERENCES paper_sets(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      display_number TEXT NOT NULL DEFAULT '',
      group_header TEXT NOT NULL DEFAULT '',
      UNIQUE (set_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_paper_set_items_order ON paper_set_items(set_id, sort_order ASC);

    CREATE TABLE IF NOT EXISTS ocr_jobs (
      id TEXT PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      part TEXT NOT NULL CHECK (part IN ('question', 'answer')),
      provider TEXT NOT NULL CHECK (provider IN ('workbench-ai', 'doc2x')),
      status TEXT NOT NULL CHECK (status IN ('processing', 'paused', 'ready', 'failed')),
      remote_uid TEXT,
      raw_markdown TEXT,
      candidate_doc_json TEXT,
      issues_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ocr_jobs_question ON ocr_jobs(question_id, part, created_at DESC);
  `);
}

function seedDefaults(db: DatabaseSync) {
  withTransaction(db, () => {
    const types = ['单选题', '多选题', '实验题', '计算题', '填空题', '简答题'];
    const insertType = db.prepare(
      `INSERT OR IGNORE INTO question_types (name, sort_order) VALUES (?, ?)`,
    );
    types.forEach((name, idx) => insertType.run(name, idx + 1));

    const diffs: Array<[number, string]> = [
      [1, '容易'],
      [2, '较易'],
      [3, '中等'],
      [4, '较难'],
      [5, '困难'],
    ];
    const insertDiff = db.prepare(
      `INSERT OR IGNORE INTO difficulties (level, name) VALUES (?, ?)`,
    );
    for (const [level, name] of diffs) insertDiff.run(level, name);

    const kps = [
      '牛顿运动定律',
      '受力分析与平衡',
      '曲线与平抛运动',
      '圆周运动与向心力',
      '万有引力与航天',
      '动能定理与机械能守恒',
      '动量守恒与碰撞',
      '静电场与带电粒子运动',
      '恒定电流与电路实验',
      '磁场与洛伦兹力',
      '电磁感应与楞次定律',
      '交变电流与变压器',
      '机械振动与机械波',
      '几何光学与波动光学',
      '热力学与理想气体',
      '光电效应与原子核',
    ];
    const insertKp = db.prepare(`INSERT OR IGNORE INTO knowledge_points (name) VALUES (?)`);
    for (const kp of kps) insertKp.run(kp);

    const chapterCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM chapters`).get() as { cnt: number }
    ).cnt;
    if (chapterCount === 0) {
      const tpl =
        CHAPTER_TEMPLATES.find((t) => t.key === DEFAULT_CHAPTER_TEMPLATE_KEY) ||
        CHAPTER_TEMPLATES[0];
      const keyToId = new Map<string, number>();
      const insertCh = db.prepare(
        `INSERT OR IGNORE INTO chapters (template_key, node_key, name, parent_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      );
      tpl.nodes.forEach((node, idx) => {
        const parentId = node.parentKey ? (keyToId.get(node.parentKey) ?? null) : null;
        const info = insertCh.run(tpl.key, node.key, node.name, parentId, idx + 1);
        keyToId.set(node.key, Number(info.lastInsertRowid));
      });
    }

    const setCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM paper_sets`).get() as { cnt: number })
      .cnt;
    if (setCount === 0) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO paper_sets (title, word_options_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('默认组卷篮', JSON.stringify(DEFAULT_WORD_OPTIONS), now, now);
    }
  });
}

function dirSizeRecursive(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeRecursive(full);
    else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // ignore transient file
      }
    }
  }
  return total;
}

export function computeQbankUsage(
  vaultPath: string,
  db: DatabaseSync | null,
): { questionCount: number; bytes: number } {
  let questionCount = 0;
  if (db) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS cnt FROM questions`).get() as { cnt: number };
      questionCount = Number(row?.cnt || 0);
    } catch {
      questionCount = 0;
    }
  }
  return {
    questionCount,
    bytes: dirSizeRecursive(getQbankDir(vaultPath)),
  };
}
