import { AppError, assertEditable, id, type Snapshot } from '../../app/model';
import type { AnswerAsset, GradingData } from './model';
import { calculateScores, type ScoreInput } from './score-policy';
import { participationFor } from '../assessment';
export type Item = GradingData['items'][number];
export type Submission = GradingData['submissions'][number];
export type Decision = GradingData['decisions'][number];
export type ItemPlan = {
  item: Omit<Item, 'id' | 'examId'>;
  rubric: Omit<
    GradingData['rubrics'][number],
    'id' | 'itemId' | 'version' | 'createdAt' | 'frozenAt'
  >;
};
const now = () => new Date().toISOString();
function examFor(s: Snapshot, examId: string) {
  const exam = s.data.grading.exams.find((e) => e.id === examId);
  if (!exam) throw new AppError('GRADING', '考试不存在');
  assertEditable(s, exam.classId);
  return exam;
}
export function createExam(s: Snapshot, classId: string, title: string) {
  assertEditable(s, classId);
  if (!title.trim()) throw new AppError('GRADING', '请输入考试名称');
  const examId = id();
  s.data.grading.exams.push({ id: examId, classId, title: title.trim(), createdAt: now() });
  return examId;
}
export function saveItem(
  s: Snapshot,
  examId: string,
  input: ItemPlan,
  existingId: string | null,
  assets: AnswerAsset[] = [],
) {
  examFor(s, examId);
  const g = s.data.grading,
    existing = existingId ? g.items.find((i) => i.id === existingId && i.examId === examId) : null;
  if (existingId && !existing) throw new AppError('GRADING', '题目已不存在');
  if (
    existing &&
    (g.rubrics.some((r) => r.itemId === existing.id && r.frozenAt) ||
      g.submissions.some((a) => a.itemId === existing.id))
  )
    throw new AppError('GRADING', '已冻结或已使用的题目不能直接修改');
  if (
    g.items.some(
      (i) => i.examId === examId && i.id !== existingId && i.label === input.item.label.trim(),
    )
  )
    throw new AppError('GRADING', '本场考试题号重复');
  const itemId = existing?.id || id();
  const item = { ...input.item, label: input.item.label.trim(), id: itemId, examId };
  if (existing) Object.assign(existing, item);
  else g.items.push(item);
  const oldRubric = g.rubrics.find((r) => r.itemId === itemId);
  if (oldRubric) Object.assign(oldRubric, input.rubric);
  else
    g.rubrics.push({
      ...input.rubric,
      id: id(),
      itemId,
      version: 1,
      createdAt: now(),
      frozenAt: null,
    });
  g.assets.push(...assets);
  return itemId;
}
export function freezeRubric(s: Snapshot, rubricId: string) {
  const rubric = s.data.grading.rubrics.find((r) => r.id === rubricId);
  const item = s.data.grading.items.find((i) => i.id === rubric?.itemId);
  if (!rubric || !item) throw new AppError('GRADING', '评分细则不存在');
  examFor(s, item.examId);
  if (
    (!item.prompt.trim() && !item.referenceAssetIds.length) ||
    (!rubric.referenceAnswer.trim() && !item.referenceAssetIds.length) ||
    rubric.criteria.some((c) => !c.description.trim())
  )
    throw new AppError('GRADING', '冻结前请补齐题干或参考图、参考答案及各评分点判定条件');
  if (!rubric.frozenAt) rubric.frozenAt = now();
}
export function latestSubmission(g: GradingData, itemId: string, membershipId: string) {
  return g.submissions
    .filter((a) => a.itemId === itemId && a.membershipId === membershipId)
    .sort((a, b) => b.version - a.version)[0];
}
export function latestDecision(g: GradingData, submissionId: string) {
  const decisions = g.decisions.filter((d) => d.submissionId === submissionId);
  const replaced = new Set(decisions.map((d) => d.previousDecisionId));
  return decisions.find((d) => !replaced.has(d.id));
}
export function saveSubmission(
  s: Snapshot,
  input: {
    itemId: string;
    membershipId: string;
    text: string;
    assetIds: string[];
    expectedPages: number;
    complete: boolean;
    previousId: string | null;
  },
  assets: AnswerAsset[],
) {
  const g = s.data.grading,
    item = g.items.find((i) => i.id === input.itemId);
  if (!item) throw new AppError('GRADING', '题目不存在');
  const exam = examFor(s, item.examId);
  const member = s.data.memberships.find(
    (m) => m.id === input.membershipId && m.classId === exam.classId && m.status === 'active',
  );
  if (!member) throw new AppError('GRADING', '请明确绑定本班有效成员');
  if (participationFor(g, exam.id, member.id)?.status === 'absent')
    throw new AppError('GRADING', '本次考试已标记缺考，请先在分析与导出中改为参测');
  if (!g.rubrics.some((r) => r.itemId === item.id && r.frozenAt))
    throw new AppError('GRADING', '请先冻结题目评分细则');
  const previous = latestSubmission(g, item.id, member.id);
  if ((previous?.id || null) !== input.previousId)
    throw new AppError('STALE_PREVIEW', '作答版本已经改变，请重新打开');
  const submissionId = id();
  g.assets.push(...assets);
  g.submissions.push({
    id: submissionId,
    examId: exam.id,
    itemId: item.id,
    membershipId: member.id,
    version: (previous?.version || 0) + 1,
    previousVersionId: previous?.id || null,
    text: input.text,
    assetIds: [...input.assetIds],
    expectedPages: input.expectedPages,
    completeness: input.complete ? 'complete' : 'needs-attention',
    createdAt: now(),
  });
  return submissionId;
}
function reviewContext(s: Snapshot, submissionId: string, rubricId: string) {
  const g = s.data.grading,
    submission = g.submissions.find((a) => a.id === submissionId),
    rubric = g.rubrics.find((r) => r.id === rubricId);
  if (!submission || !rubric?.frozenAt || rubric.itemId !== submission.itemId)
    throw new AppError('GRADING', '作答与冻结细则不匹配');
  examFor(s, submission.examId);
  if (participationFor(g, submission.examId, submission.membershipId)?.status === 'absent')
    throw new AppError('GRADING', '本次考试已标记缺考，请先更正参测状态');
  if (latestSubmission(g, submission.itemId, submission.membershipId)?.id !== submissionId)
    throw new AppError('STALE_PREVIEW', '已有更新作答，请重新选择最新版本');
  if (submission.completeness !== 'complete')
    throw new AppError('GRADING', '作答尚未核对完整，不能评分确认');
  return { g, submission, rubric };
}
export function saveDraft(
  s: Snapshot,
  submissionId: string,
  rubricId: string,
  inputs: ScoreInput[],
  reason: string,
) {
  const { g } = reviewContext(s, submissionId, rubricId);
  const old = g.drafts.find((d) => d.submissionId === submissionId);
  const draft = {
    id: old?.id || id(),
    submissionId,
    rubricVersionId: rubricId,
    scores: inputs,
    reason,
    updatedAt: now(),
  };
  if (old) Object.assign(old, draft);
  else g.drafts.push(draft);
}
export function confirmScores(
  s: Snapshot,
  submissionId: string,
  rubricId: string,
  inputs: ScoreInput[],
  reason: string,
  previousDecisionId: string | null,
) {
  const { g, rubric } = reviewContext(s, submissionId, rubricId);
  const previous = latestDecision(g, submissionId);
  if ((previous?.id || null) !== previousDecisionId)
    throw new AppError('STALE_PREVIEW', '教师决定已改变，请重新读取');
  if (previous && !reason.trim()) throw new AppError('GRADING', '修改已确认成绩时请填写原因');
  const { scores } = calculateScores(rubric, inputs);
  if (
    previous &&
    previous.rubricVersionId === rubricId &&
    JSON.stringify(previous.scores) === JSON.stringify(scores) &&
    previous.reason === reason.trim()
  )
    throw new AppError('GRADING', '与上一条教师决定相同，无需重复确认');
  g.decisions.push({
    id: id(),
    submissionId,
    rubricVersionId: rubricId,
    previousDecisionId: previous?.id || null,
    confirmedAt: now(),
    reason: reason.trim(),
    scores,
  });
  g.drafts = g.drafts.filter((d) => d.submissionId !== submissionId);
}
