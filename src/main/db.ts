import { DatabaseSync } from 'node:sqlite';

export const VAULT_SCHEMA_VERSION = 1;

export function openVaultDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  // DELETE journal mode keeps SQLite in a single file when idle — much safer for iCloud / 坚果云 folder sync.
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  initSchema(db);
  return db;
}

const txDepthMap = new WeakMap<DatabaseSync, number>();

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const depth = txDepthMap.get(db) ?? 0;
  txDepthMap.set(db, depth + 1);
  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure if already rolled back
      }
      throw err;
    } finally {
      txDepthMap.set(db, 0);
    }
  } else {
    const sp = `sp_${depth}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        db.exec(`RELEASE SAVEPOINT ${sp}`);
      } catch {
        // ignore savepoint rollback failure
      }
      throw err;
    } finally {
      txDepthMap.set(db, depth);
    }
  }
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      school TEXT NOT NULL DEFAULT '',
      term_label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'unspecified' CHECK (gender IN ('male', 'female', 'unspecified')),
      character_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      roster_no TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
      UNIQUE (class_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memberships_class ON memberships(class_id, status, sort_order);

    CREATE TABLE IF NOT EXISTS seat_plans (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND 12),
      cols INTEGER NOT NULL CHECK (cols BETWEEN 1 AND 16),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seat_plans_class ON seat_plans(class_id);

    CREATE TABLE IF NOT EXISTS seat_assignments (
      plan_id TEXT NOT NULL REFERENCES seat_plans(id) ON DELETE CASCADE,
      membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      PRIMARY KEY (plan_id, membership_id),
      UNIQUE (plan_id, row, col)
    );

    -- Unified Exam Entity (merges legacy gradebook + grading into one cohesive table)
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      source_file TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exams_class ON exams(class_id, deleted_at, exam_date DESC);

    CREATE TABLE IF NOT EXISTS exam_columns (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      col_key TEXT NOT NULL,
      label TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'score' CHECK (role IN ('score', 'total')),
      source TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'grading', 'manual')),
      grading_item_id TEXT,
      max_units INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (exam_id, col_key)
    );
    CREATE INDEX IF NOT EXISTS idx_exam_columns_exam ON exam_columns(exam_id, sort_order);

    CREATE TABLE IF NOT EXISTS exam_scores (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES exam_columns(id) ON DELETE CASCADE,
      membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('score', 'missing', 'absent', 'exempt')),
      units INTEGER,
      raw_text TEXT NOT NULL DEFAULT '',
      corrected_text TEXT,
      from_formula INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (exam_id, column_id, membership_id)
    );
    CREATE INDEX IF NOT EXISTS idx_exam_scores_exam ON exam_scores(exam_id, column_id);
    CREATE INDEX IF NOT EXISTS idx_exam_scores_member ON exam_scores(membership_id);

    CREATE TABLE IF NOT EXISTS photo_assets (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      hash TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'answer' CHECK (role IN ('answer', 'reference')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photo_assets_exam ON photo_assets(exam_id);

    CREATE TABLE IF NOT EXISTS grading_items (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      max_units INTEGER NOT NULL,
      scoring_units_json TEXT NOT NULL,
      reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
      linked_column_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grading_items_exam ON grading_items(exam_id, sort_order);

    CREATE TABLE IF NOT EXISTS grading_rubrics (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES grading_items(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      reference_answer TEXT NOT NULL DEFAULT '',
      frozen_at TEXT,
      criteria_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grading_rubrics_item ON grading_rubrics(item_id, version DESC);

    CREATE TABLE IF NOT EXISTS grading_submissions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES grading_items(id) ON DELETE CASCADE,
      membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
      typed_text TEXT NOT NULL DEFAULT '',
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      completeness TEXT NOT NULL DEFAULT 'complete' CHECK (completeness IN ('complete', 'needs-attention')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_grading_submissions_exam ON grading_submissions(exam_id, item_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_grading_submissions_member ON grading_submissions(membership_id, deleted_at);

    CREATE TABLE IF NOT EXISTS grading_decisions (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE REFERENCES grading_submissions(id) ON DELETE CASCADE,
      rubric_id TEXT NOT NULL REFERENCES grading_rubrics(id),
      total_units INTEGER NOT NULL,
      scores_json TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai-auto', 'ai-assisted')),
      confidence INTEGER,
      confirmed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_points (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE (exam_id, name)
    );

    CREATE TABLE IF NOT EXISTS knowledge_mappings (
      item_id TEXT NOT NULL REFERENCES grading_items(id) ON DELETE CASCADE,
      knowledge_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
      weight_bps INTEGER NOT NULL CHECK (weight_bps BETWEEN 1 AND 10000),
      PRIMARY KEY (item_id, knowledge_id)
    );

    CREATE TABLE IF NOT EXISTS score_audit_logs (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      membership_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      target_label TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_exam ON score_audit_logs(exam_id, created_at DESC);
  `);

  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value_json) VALUES ('teacher', ?)`,
  ).run(JSON.stringify({ name: '', gender: 'unspecified', characterId: null }));
}
