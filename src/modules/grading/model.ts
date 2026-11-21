import { z } from 'zod';

const ident = z.string().min(1).max(120);
const text = z.string().max(20000);
const date = z.string().datetime({ offset: true });
// All marks are integer hundredths of a point, never binary floating point scores.
export const SCORE_SCALE = 100;
const units = z.number().int().min(0).max(1000000);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const assetSchema = z
  .object({
    id: ident,
    hash: hashSchema,
    mime: z.enum(['image/png', 'image/jpeg']),
    bytes: z
      .number()
      .int()
      .positive()
      .max(12 * 1024 ** 2),
    width: z.number().int().positive().max(12000),
    height: z.number().int().positive().max(12000),
    role: z.enum(['answer', 'reference']),
    originalId: ident.nullable(),
    transforms: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('rotate'),
              degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
            })
            .strict(),
          z
            .object({ kind: z.literal('crop'), x: units, y: units, width: units, height: units })
            .strict(),
        ]),
      )
      .max(20),
    createdAt: date,
  })
  .strict();
const examSchema = z
  .object({ id: ident, classId: ident, title: z.string().min(1).max(200), createdAt: date })
  .strict();
const itemSchema = z
  .object({
    id: ident,
    examId: ident,
    label: z.string().min(1).max(120),
    prompt: text,
    maxUnits: units,
    referenceAssetIds: z.array(ident).max(100),
    scoringUnits: z
      .array(z.object({ id: ident, label: z.string().max(120), maxUnits: units }).strict())
      .min(1)
      .max(100),
  })
  .strict();
const rubricSchema = z
  .object({
    id: ident,
    itemId: ident,
    version: z.number().int().positive(),
    referenceAnswer: text,
    createdAt: date,
    frozenAt: date.nullable(),
    criteria: z
      .array(
        z
          .object({
            id: ident,
            scoringUnitId: ident,
            description: text,
            maxUnits: units,
            stepUnits: units.refine((n) => n > 0),
            exclusiveGroup: ident.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const submissionSchema = z
  .object({
    id: ident,
    examId: ident,
    itemId: ident,
    membershipId: ident,
    version: z.number().int().positive(),
    previousVersionId: ident.nullable(),
    text,
    assetIds: z.array(ident).max(100),
    expectedPages: z.number().int().min(0).max(100),
    completeness: z.enum(['complete', 'needs-attention']),
    createdAt: date,
  })
  .strict();
const decisionSchema = z
  .object({
    id: ident,
    submissionId: ident,
    rubricVersionId: ident,
    previousDecisionId: ident.nullable(),
    confirmedAt: date,
    reason: text,
    scores: z.array(z.object({ criterionId: ident, units, reason: text }).strict()).max(500),
  })
  .strict();

const gradingV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    exams: z.array(examSchema).max(1000),
    items: z.array(itemSchema).max(10000),
    rubrics: z.array(rubricSchema).max(20000),
    submissions: z.array(submissionSchema).max(50000),
    decisions: z.array(decisionSchema).max(100000),
    assets: z.array(assetSchema).max(500),
  })
  .strict();
const draftSchema = z
  .object({
    id: ident,
    submissionId: ident,
    rubricVersionId: ident,
    reason: text,
    updatedAt: date,
    scores: z
      .array(z.object({ criterionId: ident, value: z.string().max(40), reason: text }).strict())
      .max(500),
  })
  .strict();
const gradingV2Schema = gradingV1Schema.extend({
  schemaVersion: z.literal(2),
  drafts: z.array(draftSchema).max(50000),
});
const topicSchema = z.object({ id: ident, name: z.string().trim().min(1).max(120) }).strict();
const mappingSchema = z
  .object({
    itemId: ident,
    scoringUnitId: ident,
    allocations: z
      .array(
        z.object({ knowledgeId: ident, weightBps: z.number().int().min(1).max(10000) }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const planSchema = z
  .object({
    id: ident,
    examId: ident,
    version: z.number().int().positive(),
    createdAt: date,
    mappings: z.array(mappingSchema).max(10000),
  })
  .strict();
const participationSchema = z
  .object({
    id: ident,
    examId: ident,
    membershipId: ident,
    version: z.number().int().positive(),
    status: z.enum(['present', 'absent']),
    reason: text,
    createdAt: date,
  })
  .strict();
const gradingV3Schema = gradingV2Schema.extend({
  schemaVersion: z.literal(3),
  knowledgePoints: z.array(topicSchema).max(10000),
  knowledgePlans: z.array(planSchema).max(1000),
  participation: z.array(participationSchema).max(100000),
});
export const gradingSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value)) return value;
  if (value.schemaVersion === 1) {
    const legacy = gradingV1Schema.safeParse(value);
    if (legacy.success)
      return {
        ...legacy.data,
        schemaVersion: 3,
        drafts: [],
        knowledgePoints: [],
        knowledgePlans: [],
        participation: [],
      };
  }
  if (value.schemaVersion === 2) {
    const legacy = gradingV2Schema.safeParse(value);
    if (legacy.success)
      return {
        ...legacy.data,
        schemaVersion: 3,
        knowledgePoints: [],
        knowledgePlans: [],
        participation: [],
      };
  }
  return value;
}, gradingV3Schema);
export type GradingData = z.infer<typeof gradingSchema>;
export type AnswerAsset = z.infer<typeof assetSchema>;
export const emptyGrading = (): GradingData => ({
  schemaVersion: 3,
  knowledgePoints: [],
  knowledgePlans: [],
  participation: [],
  drafts: [],
  exams: [],
  items: [],
  rubrics: [],
  submissions: [],
  decisions: [],
  assets: [],
});
export function hasGrading(data: GradingData) {
  return [
    data.exams,
    data.items,
    data.rubrics,
    data.submissions,
    data.decisions,
    data.assets,
    data.drafts,
    data.knowledgePoints,
    data.knowledgePlans,
    data.participation,
  ].some((a) => a.length > 0);
}
export function assertGradingTransition(previous: GradingData, next: GradingData) {
  // Corrections append versions; normal edits cannot rewrite already-used evidence.
  for (const key of [
    'submissions',
    'decisions',
    'assets',
    'knowledgePoints',
    'knowledgePlans',
    'participation',
  ] as const) {
    const current = new Map<string, unknown>(next[key].map((value) => [value.id, value]));
    for (const old of previous[key])
      requireRule(
        JSON.stringify(current.get(old.id)) === JSON.stringify(old),
        '既有证据、知识点方案和参测记录须保留；更正请新增版本',
      );
  }
  for (const old of previous.rubrics.filter((r) => r.frozenAt))
    requireRule(
      JSON.stringify(next.rubrics.find((r) => r.id === old.id)) === JSON.stringify(old),
      '冻结细则不能直接修改，请新增版本',
    );
  for (const old of previous.items) {
    if (
      previous.rubrics.some((r) => r.itemId === old.id && r.frozenAt) ||
      previous.submissions.some((s) => s.itemId === old.id)
    )
      requireRule(
        JSON.stringify(next.items.find((item) => item.id === old.id)) === JSON.stringify(old),
        '已使用的题目须保留，不能改写历史题干或满分',
      );
  }
  for (const old of previous.exams) {
    if (previous.items.some((item) => item.examId === old.id))
      requireRule(
        next.exams.find((e) => e.id === old.id)?.classId === old.classId,
        '已有题目的考试不能更换班级',
      );
  }
}
function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function unique(ids: string[], label: string) {
  requireRule(new Set(ids).size === ids.length, `${label}重复`);
}
export function validateGrading(
  g: GradingData,
  classIds: Set<string>,
  memberships: Map<string, { classId: string }>,
) {
  for (const [key, values] of Object.entries(g)) {
    if (Array.isArray(values))
      unique(
        values.map((v) => v.id),
        key,
      );
  }
  const exams = new Map(g.exams.map((x) => [x.id, x]));
  const items = new Map(g.items.map((x) => [x.id, x]));
  const rubrics = new Map(g.rubrics.map((x) => [x.id, x]));
  const submissions = new Map(g.submissions.map((x) => [x.id, x]));
  const assets = new Map(g.assets.map((x) => [x.id, x]));
  const decisions = new Map(g.decisions.map((x) => [x.id, x]));
  unique(
    g.rubrics.map((x) => JSON.stringify([x.itemId, x.version])),
    '细则版本',
  );
  unique(
    g.submissions.map((x) => JSON.stringify([x.itemId, x.membershipId, x.version])),
    '作答版本',
  );
  for (const exam of g.exams) requireRule(classIds.has(exam.classId), '考试引用不存在的班级');
  for (const asset of g.assets) {
    requireRule(asset.width * asset.height <= 24000000, '图片超过 2400 万像素');
    if (asset.originalId) {
      const original = assets.get(asset.originalId);
      requireRule(
        original && original.originalId === null && original.role === asset.role,
        '派生图必须引用同角色原件',
      );
      requireRule(asset.transforms.length > 0, '派生图缺少变换记录');
      let { width, height } = original;
      for (const transform of asset.transforms) {
        if (transform.kind === 'rotate') {
          if (transform.degrees !== 180) [width, height] = [height, width];
        } else {
          requireRule(
            transform.width > 0 &&
              transform.height > 0 &&
              transform.x + transform.width <= width &&
              transform.y + transform.height <= height,
            '裁剪超出原件范围',
          );
          width = transform.width;
          height = transform.height;
        }
      }
      requireRule(width === asset.width && height === asset.height, '派生图尺寸与变换记录不一致');
    } else requireRule(asset.transforms.length === 0, '原件不能包含派生变换');
  }
  for (const item of g.items) {
    requireRule(exams.has(item.examId), '题目引用不存在的考试');
    unique(
      item.scoringUnits.map((x) => x.id),
      '小题 ID',
    );
    requireRule(
      item.scoringUnits.reduce((sum, x) => sum + x.maxUnits, 0) === item.maxUnits,
      '小题与题目满分不一致',
    );
    unique(item.referenceAssetIds, '参考图');
    for (const ref of item.referenceAssetIds)
      requireRule(assets.get(ref)?.role === 'reference', '参考图引用无效');
  }
  for (const rubric of g.rubrics) {
    const item = items.get(rubric.itemId);
    requireRule(item, '细则引用不存在的题目');
    unique(
      rubric.criteria.map((x) => x.id),
      '评分点 ID',
    );
    const validUnits = new Set(item.scoringUnits.map((x) => x.id));
    const groups = new Map<string, string>();
    for (const c of rubric.criteria) {
      requireRule(
        validUnits.has(c.scoringUnitId) && c.maxUnits % c.stepUnits === 0,
        '评分点小题或步长无效',
      );
      if (c.exclusiveGroup) {
        requireRule(
          !groups.has(c.exclusiveGroup) || groups.get(c.exclusiveGroup) === c.scoringUnitId,
          '互斥组不能跨小题',
        );
        groups.set(c.exclusiveGroup, c.scoringUnitId);
      }
    }
    for (const unit of item.scoringUnits) {
      const capacities = new Map<string, number>();
      for (const c of rubric.criteria.filter((x) => x.scoringUnitId === unit.id)) {
        const key = c.exclusiveGroup ? `group:${c.exclusiveGroup}` : `criterion:${c.id}`;
        capacities.set(key, Math.max(capacities.get(key) || 0, c.maxUnits));
      }
      requireRule(
        [...capacities.values()].reduce((a, b) => a + b, 0) === unit.maxUnits,
        '评分细则可得分与小题满分不一致',
      );
    }
  }
  for (const submission of g.submissions) {
    const item = items.get(submission.itemId);
    requireRule(
      item?.examId === submission.examId &&
        memberships.get(submission.membershipId)?.classId === exams.get(submission.examId)?.classId,
      '作答与考试、题目、学生身份不匹配',
    );
    unique(submission.assetIds, '作答页面');
    for (const ref of submission.assetIds)
      requireRule(assets.get(ref)?.role === 'answer', '答卷图引用无效');
    requireRule(
      submission.completeness !== 'complete' ||
        (submission.assetIds.length === submission.expectedPages &&
          (submission.text.trim().length > 0 || submission.assetIds.length > 0)),
      '完整作答缺少文字或预期页面',
    );
    const previous = submission.previousVersionId
      ? submissions.get(submission.previousVersionId)
      : null;
    requireRule(
      submission.version === 1
        ? !submission.previousVersionId
        : previous &&
            previous.itemId === submission.itemId &&
            previous.membershipId === submission.membershipId &&
            previous.version === submission.version - 1,
      '作答版本链无效',
    );
  }
  unique(
    g.decisions.filter((d) => d.previousDecisionId).map((d) => d.previousDecisionId!),
    '教师决定后继',
  );
  unique(
    g.decisions.filter((d) => !d.previousDecisionId).map((d) => d.submissionId),
    '教师决定初始记录',
  );
  for (const decision of g.decisions) {
    const submission = submissions.get(decision.submissionId);
    const rubric = rubrics.get(decision.rubricVersionId);
    requireRule(
      submission && rubric && rubric.itemId === submission.itemId && rubric.frozenAt,
      '教师决定缺少作答或冻结细则',
    );
    requireRule(submission.completeness === 'complete', '不完整作答不能确认成绩');
    unique(
      decision.scores.map((x) => x.criterionId),
      '教师评分点',
    );
    requireRule(decision.scores.length === rubric.criteria.length, '教师决定缺少评分点');
    const criteria = new Map(rubric.criteria.map((c) => [c.id, c]));
    const usedGroups = new Set<string>();
    for (const score of decision.scores) {
      const c = criteria.get(score.criterionId);
      requireRule(
        c && score.units <= c.maxUnits && score.units % c.stepUnits === 0,
        '教师分数超限或不符合步长',
      );
      if (c.exclusiveGroup && score.units > 0) {
        requireRule(!usedGroups.has(c.exclusiveGroup), '互斥评分点重复给分');
        usedGroups.add(c.exclusiveGroup);
      }
    }
    if (decision.previousDecisionId)
      requireRule(
        decisions.get(decision.previousDecisionId)?.submissionId === decision.submissionId,
        '教师决定修订链跨作答或缺失',
      );
  }
  unique(
    g.drafts.map((d) => d.submissionId),
    '评分草稿',
  );
  for (const draft of g.drafts) {
    const submission = submissions.get(draft.submissionId),
      rubric = rubrics.get(draft.rubricVersionId);
    requireRule(
      submission && rubric?.frozenAt && rubric.itemId === submission.itemId,
      '评分草稿引用无效',
    );
    unique(
      draft.scores.map((score) => score.criterionId),
      '草稿评分点',
    );
    requireRule(
      draft.scores.length === rubric.criteria.length &&
        draft.scores.every((score) => rubric.criteria.some((c) => c.id === score.criterionId)),
      '草稿评分点与细则不一致',
    );
  }
  const topics = new Set(g.knowledgePoints.map((k) => k.id));
  unique(
    g.knowledgePoints.map((k) => k.name),
    '知识点名称',
  );
  unique(
    g.knowledgePlans.map((p) => JSON.stringify([p.examId, p.version])),
    '知识点方案版本',
  );
  for (const plan of g.knowledgePlans) {
    requireRule(exams.has(plan.examId), '知识点方案引用无效考试');
    unique(
      plan.mappings.map((m) => JSON.stringify([m.itemId, m.scoringUnitId])),
      '小题知识点映射',
    );
    for (const mapping of plan.mappings) {
      const item = items.get(mapping.itemId);
      requireRule(
        item?.examId === plan.examId &&
          item.scoringUnits.some((u) => u.id === mapping.scoringUnitId),
        '知识点映射引用无效小题',
      );
      unique(
        mapping.allocations.map((a) => a.knowledgeId),
        '小题知识点',
      );
      requireRule(
        mapping.allocations.every((a) => topics.has(a.knowledgeId)) &&
          mapping.allocations.reduce((sum, a) => sum + a.weightBps, 0) === 10000,
        '知识点权重须合计 100% 且引用有效',
      );
    }
  }
  unique(
    g.participation.map((p) => JSON.stringify([p.examId, p.membershipId, p.version])),
    '参测记录版本',
  );
  for (const p of g.participation) {
    requireRule(
      exams.has(p.examId) &&
        memberships.get(p.membershipId)?.classId === exams.get(p.examId)?.classId,
      '参测记录与班级成员不匹配',
    );
    requireRule(p.status !== 'absent' || p.reason.trim().length > 0, '缺考记录必须说明原因');
  }
  const resolved = new Set<string>();
  for (const decision of g.decisions) {
    const path = new Set<string>();
    let current: typeof decision | undefined = decision;
    while (current && !resolved.has(current.id)) {
      requireRule(!path.has(current.id), '教师决定修订链存在循环');
      path.add(current.id);
      current = current.previousDecisionId ? decisions.get(current.previousDecisionId) : undefined;
    }
    for (const key of path) resolved.add(key);
  }
}
