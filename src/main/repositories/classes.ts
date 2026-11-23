import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  type ClassRecord,
  type Gender,
  type ScoreStatus,
  type StudentExamPoint,
  type StudentGrowthProfile,
  type StudentInput,
  type StudentMember,
  type StudentSubmissionBrief,
  type TeacherProfile,
} from '../../shared/types';
import { pickLeastUsedCharacter } from '../../shared/characters';
import { withTransaction } from '../db';
import type { ImportedStudentRow } from '../../shared/ipc';
import { getStudentDailySummary, listComms, seedDemoHomeroomData } from './homeroom';

const uid = () => crypto.randomUUID();

export function getTeacher(db: DatabaseSync): TeacherProfile {
  const row = db.prepare(`SELECT value_json FROM settings WHERE key = 'teacher'`).get() as
    | { value_json: string }
    | undefined;
  if (!row) return { name: '', gender: 'unspecified', characterId: null };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<TeacherProfile>;
    return {
      name: String(parsed.name || ''),
      gender:
        parsed.gender === 'male' || parsed.gender === 'female' ? parsed.gender : 'unspecified',
      characterId: typeof parsed.characterId === 'string' ? parsed.characterId : null,
    };
  } catch {
    return { name: '', gender: 'unspecified', characterId: null };
  }
}

export function saveTeacher(db: DatabaseSync, profile: TeacherProfile): TeacherProfile {
  const clean: TeacherProfile = {
    name: profile.name.trim().slice(0, 120),
    gender: profile.gender,
    characterId: profile.characterId || null,
  };
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES ('teacher', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(JSON.stringify(clean));
  return clean;
}

export function assertClassEditable(db: DatabaseSync, classId: string) {
  const row = db
    .prepare(`SELECT status, deleted_at FROM classes WHERE id = ?`)
    .get(classId) as { status: string; deleted_at: string | null } | undefined;
  if (!row || row.deleted_at) throw new AppError('NOT_FOUND', '班级不存在或已移入回收站');
  if (row.status === 'archived') throw new AppError('VALIDATION', '归档班级为只读，请先恢复班级');
}

export function listClasses(db: DatabaseSync): ClassRecord[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.school, c.term_label, c.status, c.created_at, c.deleted_at,
        (SELECT COUNT(*) FROM memberships m WHERE m.class_id = c.id AND m.status = 'active') AS member_count,
        (SELECT COUNT(*) FROM exams e WHERE e.class_id = c.id AND e.deleted_at IS NULL) AS exam_count
       FROM classes c
       WHERE c.deleted_at IS NULL
       ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    school: String(r.school),
    termLabel: String(r.term_label),
    status: r.status === 'archived' ? 'archived' : 'active',
    createdAt: String(r.created_at),
    deletedAt: r.deleted_at ? String(r.deleted_at) : null,
    memberCount: Number(r.member_count || 0),
    examCount: Number(r.exam_count || 0),
  }));
}

export function createClass(
  db: DatabaseSync,
  input: { name: string; school: string; termLabel: string },
): ClassRecord {
  const name = input.name.trim();
  if (!name) throw new AppError('VALIDATION', '班级名称不能为空');
  const id = uid();
  const now = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO classes (id, name, school, term_label, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(id, name.slice(0, 120), input.school.trim().slice(0, 200), input.termLabel.trim().slice(0, 100), now);

    db.prepare(
      `INSERT INTO seat_plans (id, class_id, name, rows, cols, created_at)
       VALUES (?, ?, '默认座位方案', 6, 8, ?)`,
    ).run(uid(), id, now);
  });
  return listClasses(db).find((c) => c.id === id)!;
}

export function updateClass(
  db: DatabaseSync,
  id: string,
  input: { name: string; school: string; termLabel: string },
): ClassRecord {
  assertClassEditable(db, id);
  const name = input.name.trim();
  if (!name) throw new AppError('VALIDATION', '班级名称不能为空');
  db.prepare(`UPDATE classes SET name = ?, school = ?, term_label = ? WHERE id = ?`).run(
    name.slice(0, 120),
    input.school.trim().slice(0, 200),
    input.termLabel.trim().slice(0, 100),
    id,
  );
  return listClasses(db).find((c) => c.id === id)!;
}

export function setClassStatus(
  db: DatabaseSync,
  id: string,
  status: 'active' | 'archived',
): ClassRecord {
  const exists = db.prepare(`SELECT id FROM classes WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!exists) throw new AppError('NOT_FOUND', '班级不存在');
  db.prepare(`UPDATE classes SET status = ? WHERE id = ?`).run(status, id);
  return listClasses(db).find((c) => c.id === id)!;
}

export function softDeleteClass(db: DatabaseSync, id: string) {
  db.prepare(`UPDATE classes SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

export function listRoster(
  db: DatabaseSync,
  classId: string,
  includeRemoved = false,
): StudentMember[] {
  const sql = includeRemoved
    ? `SELECT m.id AS membership_id, m.student_id, m.class_id, m.roster_no, m.sort_order, m.status,
              s.name, s.gender, s.character_id
       FROM memberships m JOIN students s ON s.id = m.student_id
       WHERE m.class_id = ?
       ORDER BY m.sort_order ASC, m.id ASC`
    : `SELECT m.id AS membership_id, m.student_id, m.class_id, m.roster_no, m.sort_order, m.status,
              s.name, s.gender, s.character_id
       FROM memberships m JOIN students s ON s.id = m.student_id
       WHERE m.class_id = ? AND m.status = 'active'
       ORDER BY m.sort_order ASC, m.id ASC`;
  const rows = db.prepare(sql).all(classId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    membershipId: String(r.membership_id),
    studentId: String(r.student_id),
    classId: String(r.class_id),
    name: String(r.name),
    gender: (r.gender as Gender) || 'unspecified',
    characterId: r.character_id ? String(r.character_id) : null,
    rosterNo: String(r.roster_no || ''),
    sortOrder: Number(r.sort_order || 0),
    status: r.status === 'removed' ? 'removed' : 'active',
  }));
}

export function saveStudent(
  db: DatabaseSync,
  classId: string,
  input: StudentInput,
  membershipId?: string,
): StudentMember {
  assertClassEditable(db, classId);
  const name = input.name.trim();
  const rosterNo = input.rosterNo.trim();
  if (!name) throw new AppError('VALIDATION', '学生姓名不能为空');

  const existing = listRoster(db, classId, true);
  if (rosterNo) {
    const dup = existing.find((m) => m.rosterNo === rosterNo && m.membershipId !== membershipId);
    if (dup) throw new AppError('VALIDATION', `编号「${rosterNo}」在本班已存在`);
  }

  return withTransaction(db, () => {
    const usedChars = existing
      .filter((m) => m.status === 'active' && m.membershipId !== membershipId)
      .map((m) => m.characterId);

    if (membershipId) {
      const target = existing.find((m) => m.membershipId === membershipId);
      if (!target) throw new AppError('NOT_FOUND', '未找到对应学生');
      let charId = input.characterId !== undefined ? input.characterId : target.characterId;
      if (input.gender !== target.gender && input.characterId === undefined) {
        charId = pickLeastUsedCharacter(input.gender, usedChars);
      }
      if (input.gender === 'unspecified') charId = null;
      db.prepare(`UPDATE students SET name = ?, gender = ?, character_id = ? WHERE id = ?`).run(
        name.slice(0, 120),
        input.gender,
        charId,
        target.studentId,
      );
      db.prepare(`UPDATE memberships SET roster_no = ? WHERE id = ?`).run(
        rosterNo.slice(0, 100),
        membershipId,
      );
      return listRoster(db, classId, true).find((m) => m.membershipId === membershipId)!;
    }

    const studentId = uid();
    const newMembershipId = uid();
    const now = new Date().toISOString();
    const maxOrder = existing.reduce((mx, m) => Math.max(mx, m.sortOrder), -1);
    const charId =
      input.characterId !== undefined
        ? input.characterId
        : pickLeastUsedCharacter(input.gender, usedChars);

    db.prepare(
      `INSERT INTO students (id, name, gender, character_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(studentId, name.slice(0, 120), input.gender, input.gender === 'unspecified' ? null : charId, now);
    db.prepare(
      `INSERT INTO memberships (id, class_id, student_id, roster_no, sort_order, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    ).run(newMembershipId, classId, studentId, rosterNo.slice(0, 100), maxOrder + 1);

    return listRoster(db, classId, true).find((m) => m.membershipId === newMembershipId)!;
  });
}

export function batchImportRoster(
  db: DatabaseSync,
  classId: string,
  rows: ImportedStudentRow[],
): { added: number; updated: number } {
  assertClassEditable(db, classId);
  let added = 0;
  let updated = 0;
  withTransaction(db, () => {
    for (const r of rows) {
      if (r.updateMembershipId) {
        saveStudent(
          db,
          classId,
          { name: r.name, rosterNo: r.rosterNo, gender: r.gender },
          r.updateMembershipId,
        );
        updated++;
      } else {
        saveStudent(db, classId, { name: r.name, rosterNo: r.rosterNo, gender: r.gender });
        added++;
      }
    }
  });
  return { added, updated };
}

export function setMembershipStatus(
  db: DatabaseSync,
  membershipId: string,
  status: 'active' | 'removed',
) {
  const row = db
    .prepare(`SELECT class_id FROM memberships WHERE id = ?`)
    .get(membershipId) as { class_id: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', '学生记录不存在');
  assertClassEditable(db, row.class_id);
  withTransaction(db, () => {
    db.prepare(`UPDATE memberships SET status = ? WHERE id = ?`).run(status, membershipId);
    if (status === 'removed') {
      db.prepare(`DELETE FROM seat_assignments WHERE membership_id = ?`).run(membershipId);
    }
  });
}

export function getStudentGrowthProfile(
  db: DatabaseSync,
  membershipId: string,
): StudentGrowthProfile {
  const mRow = db
    .prepare(
      `SELECT m.id AS membership_id, m.student_id, m.class_id, m.roster_no, m.sort_order, m.status,
              s.name, s.gender, s.character_id
       FROM memberships m JOIN students s ON s.id = m.student_id
       WHERE m.id = ?`,
    )
    .get(membershipId) as Record<string, unknown> | undefined;
  if (!mRow) throw new AppError('NOT_FOUND', '未找到学生档案');

  const member: StudentMember = {
    membershipId: String(mRow.membership_id),
    studentId: String(mRow.student_id),
    classId: String(mRow.class_id),
    name: String(mRow.name),
    gender: (mRow.gender as Gender) || 'unspecified',
    characterId: mRow.character_id ? String(mRow.character_id) : null,
    rosterNo: String(mRow.roster_no || ''),
    sortOrder: Number(mRow.sort_order || 0),
    status: mRow.status === 'removed' ? 'removed' : 'active',
  };

  const seatRow = db
    .prepare(
      `SELECT sp.id AS plan_id, sp.name AS plan_name, sa.row, sa.col
       FROM seat_assignments sa
       JOIN seat_plans sp ON sp.id = sa.plan_id
       WHERE sa.membership_id = ?
       ORDER BY sp.created_at ASC LIMIT 1`,
    )
    .get(membershipId) as
    | { plan_id: string; plan_name: string; row: number; col: number }
    | undefined;

  const exams = db
    .prepare(
      `SELECT id, title, exam_date FROM exams
       WHERE class_id = ? AND deleted_at IS NULL
       ORDER BY exam_date ASC, created_at ASC`,
    )
    .all(member.classId) as Array<{ id: string; title: string; exam_date: string }>;

  const examHistory: StudentExamPoint[] = [];
  for (const ex of exams) {
    const cols = db
      .prepare(
        `SELECT id, label, role, max_units FROM exam_columns
         WHERE exam_id = ? ORDER BY CASE WHEN role = 'total' THEN 0 ELSE 1 END, sort_order ASC`,
      )
      .all(ex.id) as Array<{ id: string; label: string; role: string; max_units: number | null }>;
    const primary = cols[0];
    if (!primary) continue;

    const allScores = db
      .prepare(`SELECT membership_id, status, units FROM exam_scores WHERE exam_id = ? AND column_id = ?`)
      .all(ex.id, primary.id) as Array<{
      membership_id: string;
      status: ScoreStatus;
      units: number | null;
    }>;

    const mine = allScores.find((x) => x.membership_id === membershipId);
    const valid = allScores
      .filter((x) => x.status === 'score' && x.units !== null)
      .map((x) => x.units!)
      .sort((a, b) => b - a);
    const classMeanUnits = valid.length
      ? valid.reduce((s, v) => s + v, 0) / valid.length
      : null;
    const rank =
      mine && mine.status === 'score' && mine.units !== null
        ? valid.indexOf(mine.units) + 1
        : null;

    examHistory.push({
      examId: ex.id,
      examTitle: ex.title,
      examDate: ex.exam_date,
      columnId: primary.id,
      columnLabel: primary.label,
      units: mine?.status === 'score' ? mine.units : null,
      maxUnits: primary.max_units,
      status: mine?.status || 'missing',
      rank: rank && rank > 0 ? rank : null,
      totalScored: valid.length,
      classMeanUnits,
    });
  }

  const subRows = db
    .prepare(
      `SELECT gs.id, gs.exam_id, e.title AS exam_title, gs.item_id, gi.label AS item_label,
              gi.max_units, gs.asset_ids_json, gs.updated_at, gd.total_units
       FROM grading_submissions gs
       JOIN exams e ON e.id = gs.exam_id AND e.deleted_at IS NULL
       JOIN grading_items gi ON gi.id = gs.item_id
       LEFT JOIN grading_decisions gd ON gd.submission_id = gs.id
       WHERE gs.membership_id = ? AND gs.deleted_at IS NULL
       ORDER BY gs.updated_at DESC LIMIT 8`,
    )
    .all(membershipId) as Array<Record<string, unknown>>;

  const recentSubmissions: StudentSubmissionBrief[] = subRows.map((r) => {
    const ids = JSON.parse(String(r.asset_ids_json || '[]')) as string[];
    const relPaths: string[] = [];
    for (const aid of ids) {
      const a = db.prepare(`SELECT rel_path FROM photo_assets WHERE id = ?`).get(aid) as
        | { rel_path: string }
        | undefined;
      if (a) relPaths.push(a.rel_path);
    }
    return {
      submissionId: String(r.id),
      examId: String(r.exam_id),
      examTitle: String(r.exam_title),
      itemId: String(r.item_id),
      itemLabel: String(r.item_label),
      assetRelPaths: relPaths,
      scoreUnits: r.total_units !== null && r.total_units !== undefined ? Number(r.total_units) : null,
      maxUnits: Number(r.max_units || 0),
      updatedAt: String(r.updated_at),
    };
  });

  return {
    member,
    seat: seatRow
      ? { planId: seatRow.plan_id, planName: seatRow.plan_name, row: seatRow.row, col: seatRow.col }
      : null,
    examHistory,
    recentSubmissions,
    comms: listComms(db, member.classId, membershipId),
    dailySummary: getStudentDailySummary(db, member.classId, membershipId),
  };
}

/** One-click rich demo class (32 students, seated, with 2 realistic physics exams for instant exploration). */
export function createDemoClass(db: DatabaseSync): ClassRecord {
  const demoNames: Array<[string, Gender]> = [
    ['林知行', 'male'], ['沈清禾', 'female'], ['周屿白', 'male'], ['江星眠', 'female'],
    ['顾言深', 'male'], ['陆安宁', 'female'], ['陈景铄', 'male'], ['苏晚晴', 'female'],
    ['许嘉树', 'male'], ['温如初', 'female'], ['宋明远', 'male'], ['程诗韵', 'female'],
    ['谢云帆', 'male'], ['唐知夏', 'female'], ['韩牧之', 'male'], ['叶舒窈', 'female'],
    ['赵时安', 'male'], ['夏若溪', 'female'], ['吴承泽', 'male'], ['何念初', 'female'],
    ['徐望舒', 'female'], ['孙逸飞', 'male'], ['马思涵', 'female'], ['朱墨轩', 'male'],
    ['胡映雪', 'female'], ['郭子谦', 'male'], ['高明月', 'female'], ['梁景行', 'male'],
    ['郑清浅', 'female'], ['罗一鸣', 'male'], ['宋语桐', 'female'], ['曹致远', 'male'],
  ];

  const cls = createClass(db, {
    name: '高二（3）班 · 演示班',
    school: '实验中学',
    termLabel: '2026-2027 上学期',
  });

  withTransaction(db, () => {
    const members: StudentMember[] = [];
    demoNames.forEach(([name, gender], idx) => {
      const m = saveStudent(db, cls.id, {
        name,
        gender,
        rosterNo: `2603${String(idx + 1).padStart(2, '0')}`,
      });
      members.push(m);
    });

    const plan = db
      .prepare(`SELECT id FROM seat_plans WHERE class_id = ? LIMIT 1`)
      .get(cls.id) as { id: string };
    db.prepare(`UPDATE seat_plans SET rows = 5, cols = 8 WHERE id = ?`).run(plan.id);
    const insSeat = db.prepare(
      `INSERT INTO seat_assignments (plan_id, membership_id, row, col) VALUES (?, ?, ?, ?)`,
    );
    members.forEach((m, i) => {
      insSeat.run(plan.id, m.membershipId, Math.floor(i / 8), i % 8);
    });

    // Seed two realistic physics exams so ECharts histograms & growth trend lines shine immediately!
    const now = new Date().toISOString();
    const examsSpec = [
      { title: '第一次月考（力学基础）', date: '2026-10-12', shift: 0 },
      { title: '期中统考（牛顿定律综合）', date: '2026-11-10', shift: 4 },
    ];
    for (const ex of examsSpec) {
      const examId = uid();
      db.prepare(
        `INSERT INTO exams (id, class_id, title, exam_date, notes, source_file, created_at)
         VALUES (?, ?, ?, ?, '演示班样例成绩，可随时体验分析、AI助教与按成绩排座', '演示数据', ?)`,
      ).run(examId, cls.id, ex.title, ex.date, now);

      const colPhys = uid();
      const colChoice = uid();
      const colSubj = uid();
      db.prepare(
        `INSERT INTO exam_columns (id, exam_id, col_key, label, role, source, max_units, sort_order) VALUES
         (?, ?, 'physics_total', '物理总分', 'total', 'import', 10000, 0),
         (?, ?, 'choice', '客观选择题', 'score', 'import', 4800, 1),
         (?, ?, 'subjective', '实验与计算题', 'score', 'import', 5200, 2)`,
      ).run(colPhys, examId, colChoice, examId, colSubj, examId);

      const insScore = db.prepare(
        `INSERT INTO exam_scores (id, exam_id, column_id, membership_id, status, units, raw_text, from_formula, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      );
      members.forEach((m, i) => {
        if (i === 29 && ex.shift === 0) {
          insScore.run(uid(), examId, colPhys, m.membershipId, 'absent', null, '缺考', now);
          insScore.run(uid(), examId, colChoice, m.membershipId, 'absent', null, '缺考', now);
          insScore.run(uid(), examId, colSubj, m.membershipId, 'absent', null, '缺考', now);
          return;
        }
        const base = 54 + ((i * 19 + 11) % 41) + ex.shift + (i % 5 === 0 ? -5 : 2);
        const total = Math.max(38, Math.min(99, base));
        const choice = Math.min(48, Math.max(16, Math.round(total * 0.49)));
        const subj = Math.max(10, total - choice);
        insScore.run(uid(), examId, colPhys, m.membershipId, 'score', total * 100, String(total), now);
        insScore.run(uid(), examId, colChoice, m.membershipId, 'score', choice * 100, String(choice), now);
        insScore.run(uid(), examId, colSubj, m.membershipId, 'score', subj * 100, String(subj), now);
      });
    }

    // Seed homeroom tasks, parent-teacher comms, check batches, memos & material for demo class
    seedDemoHomeroomData(db, cls.id, members);
  });

  return listClasses(db).find((c) => c.id === cls.id)!;
}
