import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultManager } from '../src/main/vault';
import { AiKeychainStore, type SafeStorageLike } from '../src/main/keychain';
import * as classesRepo from '../src/main/repositories/classes';
import * as seatingRepo from '../src/main/repositories/seating';
import * as examsRepo from '../src/main/repositories/exams';
import * as gradingRepo from '../src/main/repositories/grading';
import * as trashRepo from '../src/main/repositories/trash';
import { analyzeExamColumn } from '../src/shared/gradebook/analysis';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Vault + node:sqlite 全链路闭环：班级/排座/统一考试/阅卷回填/学生成长档案/改分留痕/回收站清照片', () => {
  const userData = makeTempDir('cyz-ud-');
  const vaultDir = makeTempDir('cyz-vault-');
  const vault = new VaultManager(userData);

  try {
    const info = vault.open(vaultDir);
    assert.equal(info.path, path.resolve(vaultDir));
    assert.equal(fs.existsSync(path.join(vaultDir, 'workbench.sqlite')), true);
    assert.equal(fs.existsSync(path.join(vaultDir, 'vault.json')), true);

    const db = vault.getDb();

    // 1. Class & Roster
    const cls = classesRepo.createClass(db, {
      name: '高一（2）班',
      school: '示例中学',
      termLabel: '2026秋',
    });
    const s1 = classesRepo.saveStudent(db, cls.id, { name: '张三', rosterNo: '001', gender: 'male' });
    const s2 = classesRepo.saveStudent(db, cls.id, { name: '李四', rosterNo: '002', gender: 'female' });
    const s3 = classesRepo.saveStudent(db, cls.id, { name: '王五', rosterNo: '003', gender: 'male' });
    const s4 = classesRepo.saveStudent(db, cls.id, { name: '赵六', rosterNo: '004', gender: 'female' });
    assert.equal(classesRepo.listRoster(db, cls.id).length, 4);
    assert.ok(s1.characterId && s2.characterId);

    // 2. Unified Exam Import + Score Cell Edit Audit Log
    const exam = examsRepo.commitGradeImport(db, {
      classId: cls.id,
      title: '力学单元测试',
      examDate: '2026-11-15',
      sourceFile: 'physics.xlsx',
      columns: [{ key: 'phys', label: '物理总分', role: 'total', maxUnits: 10000 }],
      rows: [
        { membershipId: s1.membershipId, cells: [{ columnKey: 'phys', status: 'score', units: 9600, rawText: '96', correctedText: null, fromFormula: false }] },
        { membershipId: s2.membershipId, cells: [{ columnKey: 'phys', status: 'score', units: 8400, rawText: '84', correctedText: null, fromFormula: false }] },
        { membershipId: s3.membershipId, cells: [{ columnKey: 'phys', status: 'score', units: 6200, rawText: '62', correctedText: null, fromFormula: false }] },
        { membershipId: s4.membershipId, cells: [{ columnKey: 'phys', status: 'score', units: 5000, rawText: '50', correctedText: null, fromFormula: false }] },
      ],
    });
    let detail = examsRepo.getExamDetail(db, exam.id);
    assert.equal(detail.columns.length, 1);
    const physColId = detail.columns[0].id;

    // Revise s3 score -> must log audit trail!
    detail = examsRepo.updateScoreCell(db, {
      examId: exam.id,
      columnId: physColId,
      membershipId: s3.membershipId,
      status: 'score',
      units: 6600,
      reason: '漏加第 2 小题 4 分',
    });
    assert.equal(detail.auditLogs.length, 1);
    assert.equal(detail.auditLogs[0].oldValue, '62');
    assert.equal(detail.auditLogs[0].newValue, '66');
    assert.equal(detail.auditLogs[0].reason, '漏加第 2 小题 4 分');

    // 3. Smart Score-based Seating (pair-help: top half paired with bottom half!)
    const plans = seatingRepo.listSeatPlans(db, cls.id);
    assert.equal(plans.length, 1);
    const arranged = seatingRepo.arrangePlanByExam(db, {
      planId: plans[0].id,
      examId: exam.id,
      columnId: physColId,
      strategy: 'pair-help',
    });
    // Sorted scores: s1(96), s2(84), s3(66), s4(50) -> pair-help order: s1, s3, s2, s4
    assert.deepEqual(
      arranged.assignments.map((a) => a.membershipId),
      [s1.membershipId, s3.membershipId, s2.membershipId, s4.membershipId],
    );

    // 4. Unified Grading attached to SAME Exam -> auto-syncs into exam_scores!
    const item = gradingRepo.saveGradingItem(db, {
      examId: exam.id,
      label: '15',
      prompt: '求加速度大小',
      referenceAnswer: 'F=ma, a=2.5 m/s²',
      scoringUnits: [{ label: '第 1 问', maxUnits: 1000 }],
      criteria: [
        { scoringUnitIndex: 0, description: '公式 F=ma', maxUnits: 400, stepUnits: 100, exclusiveGroup: null },
        { scoringUnitIndex: 0, description: '答案 2.5 m/s²', maxUnits: 600, stepUnits: 100, exclusiveGroup: null },
      ],
    });
    assert.ok(item.linkedColumnId);
    const frozenItem = gradingRepo.freezeRubric(db, item.rubric!.id);
    assert.ok(frozenItem.rubric?.frozenAt);

    // Upload a fake photo to disk PhotoStore
    const fakePhotoBytes = new Uint8Array(2048).fill(0xab);
    const photo = gradingRepo.registerPhotoAsset(db, vaultDir, {
      examId: exam.id,
      role: 'answer',
      bytes: fakePhotoBytes,
      mime: 'image/jpeg',
      width: 800,
      height: 600,
    });
    const absPhotoPath = path.join(vaultDir, photo.relPath);
    assert.equal(fs.existsSync(absPhotoPath), true);

    const sub = gradingRepo.saveSubmission(db, {
      examId: exam.id,
      itemId: item.id,
      membershipId: s1.membershipId,
      assetIds: [photo.id],
    });

    const confirmed = gradingRepo.confirmGradingDecision(db, {
      submissionId: sub.id,
      rubricId: frozenItem.rubric!.id,
      scores: [
        { criterionId: frozenItem.rubric!.criteria[0].id, units: 400, reason: '公式完整' },
        { criterionId: frozenItem.rubric!.criteria[1].id, units: 500, reason: '少写单位扣 1 分' },
      ],
      comment: '整体不错',
      source: 'ai-assisted',
      confidence: 92,
    });
    assert.equal(confirmed.syncedColumnId, item.linkedColumnId);

    // Verify synced score immediately appears in unified exam detail & analysis!
    const afterSync = examsRepo.getExamDetail(db, exam.id);
    const syncedCell = afterSync.scores.find(
      (sc) => sc.columnId === item.linkedColumnId && sc.membershipId === s1.membershipId,
    );
    assert.equal(syncedCell?.units, 900);
    const analysis = analyzeExamColumn({
      columns: afterSync.columns,
      scores: afterSync.scores,
      members: classesRepo.listRoster(db, cls.id),
      columnId: item.linkedColumnId!,
    });
    assert.equal(analysis.meanUnits, 900);

    // 5. Student Growth Profile aggregates Seat + Exam History + Recent Handwritten Submissions
    const profile = classesRepo.getStudentGrowthProfile(db, s1.membershipId);
    assert.equal(profile.seat?.row, 0);
    assert.equal(profile.seat?.col, 0);
    assert.equal(profile.examHistory.length, 1);
    assert.equal(profile.examHistory[0].units, 9600);
    assert.equal(profile.examHistory[0].rank, 1);
    assert.equal(profile.recentSubmissions.length, 1);
    assert.equal(profile.recentSubmissions[0].scoreUnits, 900);

    // 6. Soft Delete -> Restore -> Purge reclaims real photo file on disk!
    examsRepo.softDeleteExam(db, exam.id);
    assert.equal(examsRepo.listExams(db, cls.id).length, 0);
    assert.equal(trashRepo.listTrash(db).length, 1);
    assert.equal(trashRepo.listTrash(db)[0].photoBytes, 2048);

    trashRepo.restoreTrashItem(db, 'exam', exam.id);
    assert.equal(examsRepo.listExams(db, cls.id).length, 1);

    examsRepo.softDeleteExam(db, exam.id);
    const { freedBytes } = trashRepo.purgeTrashItem(db, vaultDir, 'exam', exam.id);
    assert.equal(freedBytes, 2048);
    assert.equal(fs.existsSync(absPhotoPath), false);
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});

test('Keychain 密钥加密存储：API Key 加密落盘于 userData，绝不明文落盘且不进 Vault', () => {
  const userData = makeTempDir('cyz-kc-');
  const mockSafeStorage: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from('ENC:' + plain, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^ENC:/, ''),
  };

  try {
    const store = new AiKeychainStore(userData, mockSafeStorage);
    store.save({
      general: { provider: 'deepseek', url: '', model: 'deepseek-chat', key: 'sk-secret-test-999' },
      ocr: { mode: 'http-ocr', url: 'http://127.0.0.1:8500/ocr', model: '' },
    });

    const rawFile = fs.readFileSync(path.join(userData, 'ai-config.json'), 'utf8');
    assert.equal(rawFile.includes('sk-secret-test-999'), false, '明文密钥绝不能落盘');

    // Reload from disk to prove persistence across restarts!
    const reloaded = new AiKeychainStore(userData, mockSafeStorage);
    assert.equal(reloaded.getView().general.hasKey, true);
    assert.equal(reloaded.resolveChatRole('general').key, 'sk-secret-test-999');
    assert.equal(reloaded.resolveChatRole('vision').key, 'sk-secret-test-999');
    assert.equal(reloaded.resolveOcr().mode, 'http-ocr');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('嵌套事务 SAVEPOINT：一键演示班 / 批量导入花名册 / 成绩导入自动建档均原子成功', () => {
  const userData = makeTempDir('cyz-nest-ud-');
  const vaultDir = makeTempDir('cyz-nest-vault-');
  const vault = new VaultManager(userData);
  try {
    vault.open(vaultDir);
    const db = vault.getDb();

    // 1. One-click demo class (nested saveStudent inside withTransaction)
    const demo = classesRepo.createDemoClass(db);
    assert.equal(demo.memberCount, 32);
    assert.equal(demo.examCount, 2);
    const demoRoster = classesRepo.listRoster(db, demo.id);
    assert.equal(demoRoster.length, 32);

    // 2. Batch import roster (nested saveStudent inside withTransaction)
    const res = classesRepo.batchImportRoster(db, demo.id, [
      { name: '新转入甲', rosterNo: '260333', gender: 'male' },
      { name: '林知行', rosterNo: '260301', gender: 'male', updateMembershipId: demoRoster[0].membershipId },
    ]);
    assert.equal(res.added, 1);
    assert.equal(res.updated, 1);
    assert.equal(classesRepo.listRoster(db, demo.id).length, 33);

    // 3. Gradebook import auto-creating a new student inside outer transaction
    const exam = examsRepo.commitGradeImport(db, {
      classId: demo.id,
      title: '随堂测验',
      examDate: '2026-11-20',
      sourceFile: 'quiz.xlsx',
      columns: [{ key: 'q', label: '得分', role: 'total', maxUnits: 10000 }],
      rows: [
        {
          createStudent: { name: '成绩表新生', rosterNo: '260334' },
          cells: [{ columnKey: 'q', status: 'score', units: 8800, rawText: '88', correctedText: null, fromFormula: false }],
        },
      ],
    });
    assert.equal(classesRepo.listRoster(db, demo.id).length, 34);
    assert.equal(examsRepo.getExamDetail(db, exam.id).scores[0].units, 8800);
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});

test('成绩导入：自动新建学生并入座空位、同考换列序覆盖不重列、快捷录分新建学生与资料库重置', () => {
  const userData = makeTempDir('cyz-gimp-ud-');
  const vaultDir = makeTempDir('cyz-gimp-vault-');
  const vault = new VaultManager(userData);
  try {
    vault.open(vaultDir);
    const db = vault.getDb();

    const cls = classesRepo.createClass(db, {
      name: '高三54班',
      school: '实验中学',
      termLabel: '2026-2027 上学期',
    });

    // 1. First import into empty class: create 2 new students with gender & auto-seat into default plan
    const ex1 = examsRepo.commitGradeImport(db, {
      classId: cls.id,
      title: '一模统考',
      examDate: '2026-11-20',
      sourceFile: '一模统考.xlsx',
      autoSeatNewStudents: true,
      columns: [
        { key: 'col_2', label: '物理(100分)', role: 'score', maxUnits: 10000 },
        { key: 'col_3', label: '总分', role: 'total', maxUnits: 75000 },
      ],
      rows: [
        {
          createStudent: { name: '王明', rosterNo: '5401', gender: 'male' },
          cells: [
            { columnKey: 'col_2', status: 'score', units: 8200, rawText: '82', correctedText: null, fromFormula: false },
            { columnKey: 'col_3', status: 'score', units: 60100, rawText: '601', correctedText: null, fromFormula: false },
          ],
        },
        {
          createStudent: { name: '陈雪', rosterNo: '5402', gender: 'female' },
          cells: [
            { columnKey: 'col_2', status: 'score', units: 9000, rawText: '90', correctedText: null, fromFormula: false },
            { columnKey: 'col_3', status: 'score', units: 63500, rawText: '635', correctedText: null, fromFormula: false },
          ],
        },
      ],
    });
    const roster1 = classesRepo.listRoster(db, cls.id);
    assert.equal(roster1.length, 2);
    assert.equal(roster1[0].gender, 'male');
    assert.ok(roster1[0].characterId, 'New student with gender must receive sprite character');
    const plans1 = seatingRepo.listSeatPlans(db, cls.id);
    assert.equal(plans1[0].assignments.length, 2, 'New students must be auto-seated when autoSeatNewStudents=true');

    // 2. Overwrite SAME exam with swapped column order & stripped max-score suffix -> must NOT duplicate columns!
    examsRepo.commitGradeImport(db, {
      classId: cls.id,
      examId: ex1.id,
      title: '一模统考',
      examDate: '2026-11-20',
      sourceFile: '一模统考-修正版.xlsx',
      columns: [
        { key: 'col_1', label: '总分', role: 'total', maxUnits: null },
        { key: 'col_2', label: '物理', role: 'score', maxUnits: null },
      ],
      rows: [
        {
          membershipId: roster1[0].membershipId,
          cells: [
            { columnKey: 'col_1', status: 'score', units: 61200, rawText: '612', correctedText: null, fromFormula: false },
            { columnKey: 'col_2', status: 'score', units: 9300, rawText: '93', correctedText: null, fromFormula: false },
          ],
        },
      ],
    });
    const detailAfterOverwrite = examsRepo.getExamDetail(db, ex1.id);
    assert.equal(detailAfterOverwrite.columns.length, 2, 'Overwriting same exam must match columns by normalized label, not duplicate');
    const physCol = detailAfterOverwrite.columns.find((c) => c.label.includes('物理'))!;
    assert.equal(physCol.maxUnits, 10000, 'Preserves existing maxUnits when overwrite sheet omits max');
    const wangPhys = detailAfterOverwrite.scores.find(
      (s) => s.membershipId === roster1[0].membershipId && s.columnId === physCol.id,
    );
    assert.equal(wangPhys?.units, 9300, 'Student physics score must be overwritten to 93');

    // 3. Quick inline score recording: create a 3rd student & auto-seat into empty slot
    const quickRes = examsRepo.quickRecordExamScore(db, {
      examId: ex1.id,
      columnId: physCol.id,
      createStudent: { name: '赵新', rosterNo: '5403', gender: 'male' },
      autoSeat: true,
      status: 'score',
      units: 8850,
    });
    assert.equal(quickRes.createdStudent?.name, '赵新');
    assert.equal(quickRes.seated, true);
    assert.equal(classesRepo.listRoster(db, cls.id).length, 3);
    assert.equal(seatingRepo.listSeatPlans(db, cls.id)[0].assignments.length, 3);

    // 4. Vault reset clears all classes/exams cleanly
    const freshInfo = vault.resetCurrent();
    assert.equal(freshInfo.path, vaultDir);
    assert.equal(classesRepo.listClasses(vault.getDb()).length, 0);
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
