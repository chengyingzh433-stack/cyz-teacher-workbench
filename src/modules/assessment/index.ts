import { AppError, assertEditable, id, type Snapshot } from '../../app/model';
import type { GradingData } from '../grading/model';
import type { Submission, Decision, Item } from '../grading';
export type Mapping = GradingData['knowledgePlans'][number]['mappings'][number];
export type Plan = GradingData['knowledgePlans'][number];
export type Participation = GradingData['participation'][number];
export type CellStatus =
  'confirmed' | 'unconfirmed' | 'needs-attention' | 'not-recorded' | 'absent';
export const statusLabels: Record<CellStatus, string> = {
  confirmed: '已确认',
  unconfirmed: '未确认',
  'needs-attention': '待处理',
  'not-recorded': '未录入',
  absent: '缺考',
};
export function participationFor(g: GradingData, examId: string, membershipId: string) {
  return g.participation
    .filter((p) => p.examId === examId && p.membershipId === membershipId)
    .sort((a, b) => b.version - a.version)[0];
}
export function recordParticipation(
  s: Snapshot,
  examId: string,
  membershipId: string,
  status: Participation['status'],
  reason: string,
) {
  const exam = s.data.grading.exams.find((e) => e.id === examId),
    member = s.data.memberships.find((m) => m.id === membershipId);
  if (!exam || member?.classId !== exam.classId)
    throw new AppError('ASSESSMENT', '考试与学生不匹配');
  assertEditable(s, exam.classId);
  const previous = participationFor(s.data.grading, examId, membershipId);
  if (previous?.status === status && previous.reason === reason.trim()) return;
  if (status === 'absent' && !reason.trim())
    throw new AppError('ASSESSMENT', '标记缺考时请说明原因');
  s.data.grading.participation.push({
    id: id(),
    examId,
    membershipId,
    version: (previous?.version || 0) + 1,
    status,
    reason: reason.trim(),
    createdAt: new Date().toISOString(),
  });
}
export function saveKnowledgePlan(
  s: Snapshot,
  examId: string,
  input: {
    itemId: string;
    scoringUnitId: string;
    allocations: { name: string; weightBps: number }[];
  }[],
) {
  const exam = s.data.grading.exams.find((e) => e.id === examId);
  if (!exam) throw new AppError('ASSESSMENT', '考试不存在');
  assertEditable(s, exam.classId);
  const g = s.data.grading;
  const mappings = input
    .filter((m) => m.allocations.length)
    .map((m) => ({
      ...m,
      allocations: m.allocations.map((a) => {
        const name = a.name.trim();
        if (!name) throw new AppError('ASSESSMENT', '知识点名称不能为空');
        let topic = g.knowledgePoints.find((k) => k.name === name);
        if (!topic) {
          topic = { id: id(), name };
          g.knowledgePoints.push(topic);
        }
        return { knowledgeId: topic.id, weightBps: a.weightBps };
      }),
    }));
  const previous = g.knowledgePlans
    .filter((p) => p.examId === examId)
    .sort((a, b) => b.version - a.version)[0];
  if (previous && JSON.stringify(previous.mappings) === JSON.stringify(mappings)) return;
  g.knowledgePlans.push({
    id: id(),
    examId,
    version: (previous?.version || 0) + 1,
    createdAt: new Date().toISOString(),
    mappings,
  });
}
export type GradeCell = {
  item: Item;
  status: CellStatus;
  submission?: Submission;
  decision?: Decision;
  scoreUnits: number | null;
};
export type GradeRow = {
  membershipId: string;
  name: string;
  rosterNo: string;
  removed: boolean;
  attendance?: Participation;
  cells: GradeCell[];
  confirmedUnits: number;
  confirmedMaxUnits: number;
  totalUnits: number | null;
};
export type TopicEvidence = {
  membershipId: string;
  itemId: string;
  scoringUnitId: string;
  submissionId: string;
  decisionId: string;
  rubricVersionId: string;
  weightBps: number;
  earnedWeighted: number;
  possibleWeighted: number;
};
export type TopicResult = {
  knowledgeId: string;
  name: string;
  earnedWeighted: number;
  possibleWeighted: number;
  studentCount: number;
  itemCount: number;
  evidence: TopicEvidence[];
};
export type ExamReport = {
  exam: GradingData['exams'][number];
  className: string;
  items: Item[];
  rows: GradeRow[];
  maxUnits: number;
  plan?: Plan;
  topics: TopicResult[];
  confirmedCount: number;
  unmappedUnits: number;
  confirmedPossibleUnits: number;
  completeCount: number;
  averageUnits: number | null;
  draftCount: number;
};
export function buildExamReport(s: Snapshot, examId: string, planId?: string): ExamReport {
  const g = s.data.grading,
    exam = g.exams.find((e) => e.id === examId);
  if (!exam) throw new AppError('ASSESSMENT', '考试不存在');
  const items = g.items.filter((i) => i.examId === examId),
    itemIds = new Set(items.map((i) => i.id));
  const plans = g.knowledgePlans
    .filter((p) => p.examId === examId)
    .sort((a, b) => b.version - a.version);
  const plan = planId ? plans.find((p) => p.id === planId) : plans[0];
  if (planId && !plan) throw new AppError('ASSESSMENT', '知识点方案版本不存在');
  const submissions = new Map<string, Submission>(),
    decisions = new Map<string, Decision>(),
    attendance = new Map<string, Participation>();
  for (const a of g.submissions.filter((a) => a.examId === examId)) {
    const key = JSON.stringify([a.membershipId, a.itemId]);
    if ((submissions.get(key)?.version || 0) < a.version) submissions.set(key, a);
  }
  const replaced = new Set(g.decisions.map((d) => d.previousDecisionId));
  for (const d of g.decisions) if (!replaced.has(d.id)) decisions.set(d.submissionId, d);
  for (const a of g.participation.filter((a) => a.examId === examId))
    if ((attendance.get(a.membershipId)?.version || 0) < a.version)
      attendance.set(a.membershipId, a);
  const involved = new Set([...submissions.values()].map((a) => a.membershipId));
  for (const memberId of attendance.keys()) involved.add(memberId);
  const students = new Map(s.data.students.map((p) => [p.id, p]));
  const reportMembers = s.data.memberships.filter(
    (m) => m.classId === exam.classId && (m.status === 'active' || involved.has(m.id)),
  );
  if (reportMembers.length * Math.max(items.length, 1) > 100000)
    throw new AppError(
      'REPORT_LIMIT',
      '本场考试超过 10 万个学生×题目单元格的候选版分析预算，请缩小考试范围',
    );
  const rows = reportMembers
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((m) => {
      const entry = attendance.get(m.id),
        absent = entry?.status === 'absent';
      const cells: GradeCell[] = items.map((item) => {
        const submission = submissions.get(JSON.stringify([m.id, item.id])),
          decision = submission ? decisions.get(submission.id) : undefined;
        const status: CellStatus = absent
          ? 'absent'
          : !submission
            ? 'not-recorded'
            : submission.completeness !== 'complete'
              ? 'needs-attention'
              : decision
                ? 'confirmed'
                : 'unconfirmed';
        return {
          item,
          submission,
          decision,
          status,
          scoreUnits:
            status === 'confirmed' ? decision!.scores.reduce((sum, x) => sum + x.units, 0) : null,
        };
      });
      const confirmed = cells.filter((c) => c.status === 'confirmed'),
        confirmedUnits = confirmed.reduce((sum, c) => sum + c.scoreUnits!, 0);
      return {
        membershipId: m.id,
        name: students.get(m.studentId)!.name,
        rosterNo: m.rosterNo,
        removed: m.status === 'removed',
        attendance: entry,
        cells,
        confirmedUnits,
        confirmedMaxUnits: confirmed.reduce((sum, c) => sum + c.item.maxUnits, 0),
        totalUnits: items.length > 0 && confirmed.length === items.length ? confirmedUnits : null,
      };
    });
  const mappingMap = new Map(
    (plan?.mappings || []).map((m) => [JSON.stringify([m.itemId, m.scoringUnitId]), m]),
  );
  const names = new Map(g.knowledgePoints.map((k) => [k.id, k.name])),
    topicMap = new Map<string, TopicResult>();
  for (const mapping of plan?.mappings || [])
    for (const allocation of mapping.allocations)
      if (!topicMap.has(allocation.knowledgeId))
        topicMap.set(allocation.knowledgeId, {
          knowledgeId: allocation.knowledgeId,
          name: names.get(allocation.knowledgeId)!,
          earnedWeighted: 0,
          possibleWeighted: 0,
          studentCount: 0,
          itemCount: 0,
          evidence: [],
        });
  const rubrics = new Map(g.rubrics.map((r) => [r.id, r]));
  let unmappedUnits = 0,
    confirmedPossibleUnits = 0,
    confirmedCount = 0,
    evidenceCount = 0;
  for (const row of rows)
    for (const cell of row.cells) {
      if (cell.status !== 'confirmed') continue;
      confirmedCount++;
      confirmedPossibleUnits += cell.item.maxUnits;
      const decision = cell.decision!,
        rubric = rubrics.get(decision.rubricVersionId)!;
      const criteria = new Map(rubric.criteria.map((c) => [c.id, c])),
        unitScores = new Map<string, number>();
      for (const score of decision.scores) {
        const unitId = criteria.get(score.criterionId)!.scoringUnitId;
        unitScores.set(unitId, (unitScores.get(unitId) || 0) + score.units);
      }
      for (const unit of cell.item.scoringUnits) {
        const mapping = mappingMap.get(JSON.stringify([cell.item.id, unit.id]));
        if (!mapping) {
          unmappedUnits += unit.maxUnits;
          continue;
        }
        for (const a of mapping.allocations) {
          if (++evidenceCount > 100000)
            throw new AppError(
              'REPORT_LIMIT',
              '知识点统计明细超过 10 万条候选版预算，请减少单次分析范围',
            );
          const target = topicMap.get(a.knowledgeId)!;
          const evidence = {
            membershipId: row.membershipId,
            itemId: cell.item.id,
            scoringUnitId: unit.id,
            submissionId: cell.submission!.id,
            decisionId: decision.id,
            rubricVersionId: decision.rubricVersionId,
            weightBps: a.weightBps,
            earnedWeighted: (unitScores.get(unit.id) || 0) * a.weightBps,
            possibleWeighted: unit.maxUnits * a.weightBps,
          };
          target.earnedWeighted += evidence.earnedWeighted;
          target.possibleWeighted += evidence.possibleWeighted;
          target.evidence.push(evidence);
        }
      }
    }
  const topics = [...topicMap.values()].map((t) => ({
    ...t,
    studentCount: new Set(t.evidence.map((e) => e.membershipId)).size,
    itemCount: new Set(t.evidence.map((e) => e.itemId)).size,
  }));
  const complete = rows.filter((r) => r.totalUnits !== null);
  const submissionsById = new Map(g.submissions.map((a) => [a.id, a]));
  return {
    exam,
    className: s.data.classes.find((c) => c.id === exam.classId)!.name,
    items,
    rows,
    maxUnits: items.reduce((sum, i) => sum + i.maxUnits, 0),
    plan,
    topics,
    confirmedCount,
    unmappedUnits,
    confirmedPossibleUnits,
    completeCount: complete.length,
    averageUnits: complete.length
      ? complete.reduce((sum, r) => sum + r.totalUnits!, 0) / complete.length
      : null,
    draftCount: g.drafts.filter((d) => {
      const a = submissionsById.get(d.submissionId);
      return (
        a &&
        itemIds.has(a.itemId) &&
        submissions.get(JSON.stringify([a.membershipId, a.itemId]))?.id === a.id
      );
    }).length,
  };
}
export function rateText(earned: number, possible: number) {
  return possible > 0 ? `${((earned / possible) * 100).toFixed(1)}%` : '暂无数据';
}
export function weightedPoints(value: number) {
  return (value / 1000000).toFixed(6).replace(/\.?0+$/, '');
}
