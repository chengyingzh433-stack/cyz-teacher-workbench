import { z } from 'zod';
import { gradebookSchema, emptyGradebook, validateGradebook } from '../modules/gradebook/model';
import { v4 as uuid } from 'uuid';
import { emptyGrading, gradingSchema, validateGrading } from '../modules/grading/model';
export const id = () => uuid();
const ident = z.string().min(1).max(120);
const name = z.string().trim().min(1, '名称不能为空').max(120);
export const genderSchema = z.enum(['male', 'female', 'unspecified']);
export type Gender = z.infer<typeof genderSchema>;
const character = z.string().min(1).max(120).nullable();
const studentSchema = z.object({ id: ident, name, gender: genderSchema, characterId: character });
const classSchema = z.object({
  id: ident,
  name,
  school: z.string().max(200),
  termLabel: z.string().max(100),
  status: z.enum(['active', 'archived']),
});
const membershipSchema = z.object({
  id: ident,
  classId: ident,
  studentId: ident,
  rosterNo: z.string().trim().max(100),
  order: z.number().int().nonnegative(),
  status: z.enum(['active', 'removed']),
});
const assignmentSchema = z.object({
  membershipId: ident,
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
});
const planSchema = z.object({
  id: ident,
  classId: ident,
  name,
  rows: z.number().int().min(1).max(12),
  cols: z.number().int().min(1).max(16),
  assignments: z.array(assignmentSchema).max(192),
});
export const legacySnapshotSchema = z.object({
  workspace: z.object({ id: ident, name, createdAt: z.string().datetime({ offset: true }) }),
  data: z.object({
    classes: z.array(classSchema).max(1000),
    students: z.array(studentSchema).max(50000),
    memberships: z.array(membershipSchema).max(100000),
    seatPlans: z.array(planSchema).max(10000),
    settings: z.object({
      teacher: z.object({
        name: z.string().max(120),
        gender: genderSchema,
        characterId: character,
      }),
    }),
  }),
});
export const snapshotSchema = legacySnapshotSchema
  .extend({
    data: legacySnapshotSchema.shape.data
      .extend({ grading: gradingSchema, gradebook: gradebookSchema.default(emptyGradebook) })
      .strict(),
  })
  .strict();
export function migrateV1(value: unknown): Snapshot {
  if (
    typeof value === 'object' &&
    value &&
    'data' in value &&
    typeof value.data === 'object' &&
    value.data &&
    ('grading' in value.data || 'gradebook' in value.data)
  )
    throw new AppError(
      'UNSUPPORTED_VERSION',
      '旧版本声明中出现新增考试数据，已拒绝可能丢失字段的迁移',
    );
  const old = legacySnapshotSchema.parse(value);
  return validate({ ...old, data: { ...old.data, grading: emptyGrading() } });
}
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Student = Snapshot['data']['students'][number];
export type ClassRecord = Snapshot['data']['classes'][number];
export type Membership = Snapshot['data']['memberships'][number];
export type SeatPlan = Snapshot['data']['seatPlans'][number];
export type Assignment = SeatPlan['assignments'][number];
export type Teacher = Snapshot['data']['settings']['teacher'];
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export const copy = <T>(value: T): T => structuredClone(value);
export function emptyWorkspace(): Snapshot {
  return {
    workspace: { id: id(), name: '我的工作区', createdAt: new Date().toISOString() },
    data: {
      classes: [],
      students: [],
      memberships: [],
      seatPlans: [],
      grading: emptyGrading(),
      gradebook: emptyGradebook(),
      settings: { teacher: { name: '', gender: 'unspecified', characterId: null } },
    },
  };
}
export function validate(value: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'VALIDATION',
      parsed.error.issues
        .map((x) => `${x.path.join('.')}: ${x.message}`)
        .slice(0, 4)
        .join('；'),
    );
  const s = parsed.data;
  const unique = (keys: string[], label: string) => {
    if (new Set(keys).size !== keys.length) throw new AppError('VALIDATION', `${label}重复`);
  };
  for (const [key, list] of Object.entries({
    classes: s.data.classes,
    students: s.data.students,
    memberships: s.data.memberships,
    seatPlans: s.data.seatPlans,
  }))
    unique(
      list.map((x) => x.id),
      `${key} ID`,
    );
  const classes = new Set(s.data.classes.map((x) => x.id));
  const students = new Set(s.data.students.map((x) => x.id));
  const members = new Map(s.data.memberships.map((x) => [x.id, x]));
  unique(
    s.data.memberships.map((x) => `${x.classId}\0${x.studentId}`),
    '班级成员',
  );
  unique(
    s.data.memberships.filter((x) => x.rosterNo).map((x) => `${x.classId}\0${x.rosterNo}`),
    '本班编号',
  );
  for (const m of s.data.memberships)
    if (!classes.has(m.classId) || !students.has(m.studentId))
      throw new AppError('VALIDATION', '成员引用了不存在的班级或学生');
  for (const p of s.data.seatPlans) {
    if (!classes.has(p.classId)) throw new AppError('VALIDATION', '方案引用了不存在的班级');
    unique(
      p.assignments.map((x) => `${x.row},${x.col}`),
      '座位',
    );
    unique(
      p.assignments.map((x) => x.membershipId),
      '已安排成员',
    );
    for (const a of p.assignments) {
      const m = members.get(a.membershipId);
      if (!m || m.classId !== p.classId || m.status !== 'active')
        throw new AppError('VALIDATION', '座位引用了不存在、已移出或其他班级的成员');
      if (a.row >= p.rows || a.col >= p.cols) throw new AppError('VALIDATION', '座位超出方案行列');
    }
  }
  try {
    validateGrading(s.data.grading, classes, members);
    validateGradebook(s.data.gradebook, classes, members);
  } catch (error) {
    throw new AppError('VALIDATION', (error as Error).message);
  }
  return s;
}
export function activeMembers(s: Snapshot, classId: string) {
  return s.data.memberships
    .filter((x) => x.classId === classId && x.status === 'active')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function assertEditable(s: Snapshot, classId: string) {
  const c = s.data.classes.find((x) => x.id === classId);
  if (!c || c.status === 'archived')
    throw new AppError('VALIDATION', '归档班级为只读，请先恢复班级');
}
