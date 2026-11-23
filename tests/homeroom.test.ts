import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultManager } from '../src/main/vault';
import * as classesRepo from '../src/main/repositories/classes';
import * as homeroomRepo from '../src/main/repositories/homeroom';
import {
  addDaysToIsoDate,
  formatMaterialPartBody,
  formatMaterialSavedText,
  localCurrentMonth,
  localTodayStr,
  MORAL_SAFETY_THEMES,
  weekDateRange,
} from '../src/shared/homeroom-materials';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('带班工作台 SQLite 全链路：打卡/专注/带班计划延后/家校沟通状态保留/教室点检自动月度汇总/学生档案聚合', () => {
  const userData = makeTempDir('cyz-hr-ud-');
  const vaultDir = makeTempDir('cyz-hr-vault-');
  const vault = new VaultManager(userData);

  try {
    vault.open(vaultDir);
    const db = vault.getDb();

    const cls = classesRepo.createClass(db, {
      name: '高二（5）班',
      school: '实验中学',
      termLabel: '2026秋',
    });
    const s1 = classesRepo.saveStudent(db, cls.id, { name: '林知行', rosterNo: '01', gender: 'male' });
    const s2 = classesRepo.saveStudent(db, cls.id, { name: '沈清禾', rosterNo: '02', gender: 'female' });
    const s3 = classesRepo.saveStudent(db, cls.id, { name: '周屿白', rosterNo: '03', gender: 'male' });

    const today = '2026-11-22';
    const ym = '2026-11';

    // 1. Check-ins & 7-day rolling matrix
    let dash = homeroomRepo.toggleCheckin(db, cls.id, 'meeting', today);
    assert.equal(dash.todayCheckins.meeting, true);
    assert.equal(dash.checkinTotals.meeting, 1);
    assert.equal(dash.recent7Days.length, 7);
    assert.equal(dash.recent7Days[6].date, today);
    assert.equal(dash.recent7Days[6].checkins.meeting, true);

    // Focus minutes accumulate incrementally without double-counting
    let focus = homeroomRepo.addFocusMinutes(db, cls.id, 12, today);
    assert.equal(focus.todayFocusMinutes, 12);
    focus = homeroomRepo.addFocusMinutes(db, cls.id, 13, today);
    assert.equal(focus.todayFocusMinutes, 25);

    // 2. Daily journal notes
    const note1 = homeroomRepo.addNote(db, cls.id, '早读状态很好', today, '07:50');
    const noteGroups = homeroomRepo.listNotes(db, cls.id);
    assert.equal(noteGroups.length, 1);
    assert.equal(noteGroups[0].entries[0].text, '早读状态很好');
    homeroomRepo.deleteNote(db, cls.id, today, note1.id);
    assert.equal(homeroomRepo.listNotes(db, cls.id).length, 0);

    // 3. Tasks CRUD + delayTask (+1 day) + safety warning counter
    const safeTask = homeroomRepo.saveTask(db, {
      classId: cls.id,
      title: '收齐防溺水安全回执',
      category: '安全落实',
      priority: '紧急必办',
      taskDate: today,
    });
    const teachTask = homeroomRepo.saveTask(db, {
      classId: cls.id,
      title: '批改力学小测',
      category: '学科教学',
      priority: '常规工作',
      taskDate: today,
    });
    dash = homeroomRepo.getDashboardSummary(db, cls.id, today);
    assert.equal(dash.todayTodoCount, 2);
    assert.equal(dash.pendingSafetyTaskCount, 1);

    homeroomRepo.toggleTask(db, teachTask.id);
    const delayed = homeroomRepo.delayTask(db, safeTask.id, 1);
    assert.equal(delayed.taskDate, '2026-11-23');
    dash = homeroomRepo.getDashboardSummary(db, cls.id, today);
    assert.equal(dash.todayTodoCount, 0);
    assert.equal(dash.todayDoneCount, 1);
    assert.equal(dash.pendingSafetyTaskCount, 1); // safety count spans dates!

    // 4. Parent-teacher comms + regression test: editing a 已办结 comm preserves status!
    const comm1 = homeroomRepo.saveComm(db, {
      classId: cls.id,
      membershipId: s1.membershipId,
      studentName: s1.name,
      commType: '即时电话',
      commDate: today,
      reason: '物理计算题进步',
      studentPerf: '步骤清晰',
      parentFeedback: '很满意',
      actionPlan: '继续保持',
      followUpDate: '2026-11-29',
    });
    assert.equal(comm1.status, '待跟进');
    dash = homeroomRepo.getDashboardSummary(db, cls.id, today);
    assert.equal(dash.pendingFollowUpCount, 1);
    assert.deepEqual(dash.pendingFollowUpMemberIds, [s1.membershipId]);

    const toggled = homeroomRepo.toggleCommStatus(db, comm1.id);
    assert.equal(toggled.status, '已办结');

    // Edit text without specifying status -> MUST stay 已办结 (original HTML bug would reset to 待跟进!)
    const edited = homeroomRepo.saveComm(db, {
      classId: cls.id,
      id: comm1.id,
      membershipId: s1.membershipId,
      studentName: s1.name,
      commType: '即时电话',
      commDate: today,
      reason: '物理计算题显著进步（修正措辞）',
      studentPerf: '步骤清晰',
      parentFeedback: '很满意',
      actionPlan: '继续保持',
      followUpDate: '2026-11-29',
    });
    assert.equal(edited.status, '已办结');

    // 5. Classroom Quick-Check batches -> auto morning check-in + auto monthly stats
    homeroomRepo.saveCheckBatch(db, {
      classId: cls.id,
      checkDate: today,
      kind: 'attendance',
      title: '早读晨检',
      totalCount: 3,
      anomalyMemberIds: [s2.membershipId],
    });
    homeroomRepo.saveCheckBatch(db, {
      classId: cls.id,
      checkDate: today,
      kind: 'homework',
      title: '牛顿定律作业',
      totalCount: 3,
      anomalyMemberIds: [s2.membershipId, s3.membershipId],
    });
    homeroomRepo.saveCheckBatch(db, {
      classId: cls.id,
      checkDate: today,
      kind: 'receipt',
      title: '安全告家长书回执',
      totalCount: 3,
      anomalyMemberIds: [],
    });
    homeroomRepo.saveCheckBatch(db, {
      classId: cls.id,
      checkDate: today,
      kind: 'discipline',
      title: '晚自习违纪',
      totalCount: 3,
      anomalyMemberIds: [s2.membershipId],
    });

    // Attendance check automatically marked today's morning check-in!
    dash = homeroomRepo.getDashboardSummary(db, cls.id, today);
    assert.equal(dash.todayCheckins.morning, true);

    // Monthly stats automatically aggregated from batches + checkins + comms!
    let stats = homeroomRepo.getMonthlyStats(db, cls.id, ym);
    assert.equal(stats.hasManualOverride, false);
    assert.equal(stats.effective.classSize, 3);
    assert.equal(stats.effective.attendCount, 2);
    assert.equal(stats.effective.absentCount, 1);
    assert.equal(stats.effective.hwShould, 3);
    assert.equal(stats.effective.hwMiss, 2);
    assert.equal(stats.effective.receiptShould, 3);
    assert.equal(stats.effective.receiptGot, 3);
    assert.equal(stats.effective.disciplineCount, 1);
    assert.equal(stats.effective.meetingCount, 1);
    assert.equal(stats.effective.commCount, 1);

    // Manual override + restore to auto
    stats = homeroomRepo.saveMonthlyManualStats(db, {
      classId: cls.id,
      yearMonth: ym,
      classSize: 3,
      attendCount: 60,
      absentCount: 2,
      hwShould: 50,
      hwMiss: 3,
      disciplineCount: 1,
      receiptShould: 3,
      receiptGot: 3,
    });
    assert.equal(stats.hasManualOverride, true);
    assert.equal(stats.effective.attendCount, 60);
    assert.equal(stats.effective.commCount, 1); // still auto-linked!

    stats = homeroomRepo.clearMonthlyManualStats(db, cls.id, ym);
    assert.equal(stats.hasManualOverride, false);
    assert.equal(stats.effective.attendCount, 2);

    // 6. StudentGrowthProfile integrates comms + daily check anomalies!
    const p1 = classesRepo.getStudentGrowthProfile(db, s1.membershipId);
    assert.equal(p1.comms.length, 1);
    assert.equal(p1.comms[0].reason, '物理计算题显著进步（修正措辞）');
    assert.equal(p1.dailySummary.attendanceAnomalies, 0);

    const p2 = classesRepo.getStudentGrowthProfile(db, s2.membershipId);
    assert.equal(p2.dailySummary.attendanceAnomalies, 1);
    assert.equal(p2.dailySummary.homeworkMissing, 1);
    assert.equal(p2.dailySummary.disciplineCount, 1);
    assert.equal(p2.dailySummary.recentBatches.length, 3);

    // 7. Memos & saved moral materials
    const memo = homeroomRepo.saveMemo(db, {
      classId: cls.id,
      title: '期中家长会通知',
      tag: '行政通知',
      content: '周五 18:30 教室召开',
      memoDate: today,
    });
    assert.equal(homeroomRepo.listMemos(db, cls.id).length, 1);
    homeroomRepo.deleteMemo(db, memo.id);
    assert.equal(homeroomRepo.listMemos(db, cls.id).length, 0);

    const mat = homeroomRepo.saveMaterial(db, {
      classId: cls.id,
      themeKey: '防溺水',
      title: '防溺水 · 家长会宣讲脚本',
      content: formatMaterialSavedText(MORAL_SAFETY_THEMES[0], 'script'),
      savedDate: today,
    });
    assert.equal(homeroomRepo.listSavedMaterials(db, cls.id).length, 1);
    homeroomRepo.deleteMaterial(db, mat.id);
    assert.equal(homeroomRepo.listSavedMaterials(db, cls.id).length, 0);
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});

test('演示班自动注入带班工作台样例数据 & 离线德育素材库完整度校验', () => {
  const userData = makeTempDir('cyz-hr-demo-ud-');
  const vaultDir = makeTempDir('cyz-hr-demo-vault-');
  const vault = new VaultManager(userData);

  try {
    vault.open(vaultDir);
    const db = vault.getDb();

    const demo = classesRepo.createDemoClass(db);
    const dash = homeroomRepo.getDashboardSummary(db, demo.id, localTodayStr());
    assert.ok(dash.todayDoneCount >= 1);
    assert.ok(dash.todayTodoCount >= 1);
    assert.ok(dash.pendingFollowUpCount >= 2);
    assert.ok(dash.pendingSafetyTaskCount >= 1);
    assert.ok(homeroomRepo.listTasks(db, demo.id).length >= 4);
    assert.ok(homeroomRepo.listComms(db, demo.id).length >= 3);
    assert.ok(homeroomRepo.listMemos(db, demo.id).length >= 2);
    assert.ok(homeroomRepo.listSavedMaterials(db, demo.id).length >= 1);

    const monthly = homeroomRepo.getMonthlyStats(db, demo.id, localCurrentMonth());
    assert.ok(monthly.auto.batchCount >= 3);
    assert.ok(monthly.effective.attendCount > 0);
    assert.ok(monthly.effective.commCount >= 3);

    // Offline 5 themes x 4 structured parts integrity + date helpers
    assert.equal(MORAL_SAFETY_THEMES.length, 5);
    for (const theme of MORAL_SAFETY_THEMES) {
      assert.equal(theme.topics.length, 5);
      assert.ok(formatMaterialPartBody(theme, 'flow').includes('第一段'));
      assert.ok(formatMaterialPartBody(theme, 'script').length > 30);
      assert.equal(theme.letters.length, 3);
    }
    assert.equal(addDaysToIsoDate('2026-11-30', 1), '2026-12-01');
    const wk = weekDateRange('2026-11-22'); // Sunday -> Mon Nov 16 .. Sun Nov 22
    assert.deepEqual(wk, { start: '2026-11-16', end: '2026-11-22' });
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
