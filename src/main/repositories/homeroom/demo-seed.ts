import type { DatabaseSync } from 'node:sqlite';
import {
  addDaysToIsoDate,
  formatMaterialSavedText,
  getMoralSafetyTheme,
  localTodayStr,
} from '../../../shared/homeroom-materials';
import type { StudentMember } from '../../../shared/types';
import { saveComm, saveMaterial, saveMemo } from './comms-memos';
import { saveTask, toggleTask } from './daily';
import { ensureDailyRow, uid } from './shared';
import { saveCheckBatch } from './stats';

export function seedDemoHomeroomData(
  db: DatabaseSync,
  classId: string,
  members: StudentMember[],
) {
  const today = localTodayStr();
  const yesterday = addDaysToIsoDate(today, -1);
  const twoDaysAgo = addDaysToIsoDate(today, -2);
  const tomorrow = addDaysToIsoDate(today, 1);

  // 1. Recent check-ins, focus minutes & daily journal notes
  ensureDailyRow(db, classId, twoDaysAgo);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, checkin_teach = 1, checkin_meeting = 1, focus_minutes = 50
     WHERE class_id = ? AND log_date = ?`,
  ).run(classId, twoDaysAgo);

  ensureDailyRow(db, classId, yesterday);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, checkin_teach = 1, checkin_talk = 1, focus_minutes = 25, notes_json = ?
     WHERE class_id = ? AND log_date = ?`,
  ).run(
    JSON.stringify([
      {
        id: uid(),
        time: '17:20',
        text: '物理期中讲评后找前排与后排互助小组交流了笔记方法，晚自习秩序明显提升。',
      },
    ]),
    classId,
    yesterday,
  );

  ensureDailyRow(db, classId, today);
  db.prepare(
    `UPDATE homeroom_daily_logs
     SET checkin_morning = 1, focus_minutes = 25, notes_json = ?
     WHERE class_id = ? AND log_date = ?`,
  ).run(
    JSON.stringify([
      {
        id: uid(),
        time: '08:05',
        text: '早读全班状态不错，1 名同学感冒请假已与家长电话确认。',
      },
    ]),
    classId,
    today,
  );

  // 2. Sample daily tasks
  const t1 = saveTask(db, {
    classId,
    title: '晨检查看考勤并确认请假条',
    category: '班级晨检',
    priority: '常规工作',
    taskDate: today,
  });
  toggleTask(db, t1.id);

  saveTask(db, {
    classId,
    title: '收齐《冬季交通与防欺凌安全告家长书》回执',
    category: '安全落实',
    priority: '紧急必办',
    taskDate: today,
  });
  saveTask(db, {
    classId,
    title: '批改牛顿第二定律专题练习并登记缺交名单',
    category: '学科教学',
    priority: '常规工作',
    taskDate: today,
  });
  saveTask(db, {
    classId,
    title: '筹备下周一「考前心理疏导」主题班会课件',
    category: '班级管理',
    priority: '延后跟进',
    taskDate: tomorrow,
  });

  // 3. Sample parent-teacher comms linked to real demo students
  const m0 = members[0];
  const m2 = members[2];
  const m5 = members[5];

  if (m0) {
    saveComm(db, {
      classId,
      membershipId: m0.membershipId,
      studentName: m0.name,
      commType: '即时电话',
      commDate: today,
      reason: '期中物理压轴题进步明显，同步表彰并约定竞赛拓展计划',
      studentPerf: '课堂专注度高，实验题步骤规范，近期作业全勤。',
      parentFeedback: '家长非常高兴，希望老师推荐几道受力分析拔高题供周末练习。',
      actionPlan: '周五前发放受力分析专题小卷，下周复盘错题整理本。',
      followUpDate: addDaysToIsoDate(today, 5),
      status: '待跟进',
    });
  }
  if (m2) {
    saveComm(db, {
      classId,
      membershipId: m2.membershipId,
      studentName: m2.name,
      commType: '一对一单独面谈',
      commDate: yesterday,
      reason: '本周物理练习册缺交 1 次，晚自习偶有分心',
      studentPerf: '思维敏捷但计算步骤跳步较多，导致主观题扣分。',
      parentFeedback: '家长反馈近期在家写作业偏晚，愿意配合收管晚间电子设备。',
      actionPlan: '与同桌建立每日作业互查打卡，连续两周按时提交后给予表扬。',
      followUpDate: addDaysToIsoDate(today, 3),
      status: '待跟进',
    });
  }
  if (m5) {
    saveComm(db, {
      classId,
      membershipId: m5.membershipId,
      studentName: m5.name,
      commType: '3-5人小组家长会',
      commDate: twoDaysAgo,
      reason: '考前心态微调与作息规律沟通',
      studentPerf: '基础知识扎实，考前偶有紧张情绪。',
      parentFeedback: '家长表示已调整为鼓励式沟通，不再晚间加压刷题。',
      actionPlan: '考前一周保持 22:40 前入睡，班会带领练习腹式呼吸放松法。',
      followUpDate: '',
      status: '已办结',
    });
  }

  // 4. Sample classroom check batches in current month (auto-populates Monthly Stats ECharts!)
  const classSize = members.length || 32;
  saveCheckBatch(db, {
    classId,
    checkDate: twoDaysAgo,
    kind: 'attendance',
    title: '早读晨检考勤',
    totalCount: classSize,
    anomalyMemberIds: m2 ? [m2.membershipId] : [],
  });
  saveCheckBatch(db, {
    classId,
    checkDate: yesterday,
    kind: 'homework',
    title: '牛顿定律巩固作业',
    totalCount: classSize,
    anomalyMemberIds: m2 ? [m2.membershipId] : [],
  });
  saveCheckBatch(db, {
    classId,
    checkDate: today,
    kind: 'receipt',
    title: '安全教育告家长书回执',
    totalCount: classSize,
    anomalyMemberIds: m2 && members[7] ? [m2.membershipId, members[7].membershipId] : [],
  });

  // 5. Sample work memos & saved moral material
  saveMemo(db, {
    classId,
    title: '高二年级期中家长会流程与座位贴准备',
    tag: '行政通知',
    content: '周五 18:30 召开家长会：1) 打印本班物理成绩分布图；2) 提前张贴最新互助座位表；3) 准备签到表与告家长书回执。',
    memoDate: today,
  });
  saveMemo(db, {
    classId,
    title: '过敏体质与体育免测学生名单备查',
    tag: '特殊学生档案',
    content: '长跑体测前务必再次确认免测证明原件归档，运动会期间安排后勤记录岗位。',
    memoDate: yesterday,
  });

  const sampleTheme = getMoralSafetyTheme('考前心理疏导');
  saveMaterial(db, {
    classId,
    themeKey: sampleTheme.key,
    title: `${sampleTheme.key} · 家长会宣讲脚本`,
    content: formatMaterialSavedText(sampleTheme, 'script'),
    savedDate: today,
  });
}
