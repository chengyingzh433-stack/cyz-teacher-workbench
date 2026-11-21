import { z } from 'zod';
const ident = z.string().min(1).max(120);
const units = z.number().int().min(0).max(1000000);
export const gradeCellSchema = z
  .object({
    status: z.enum(['score', 'missing', 'absent', 'exempt']),
    units: units.nullable(),
    raw: z.string().max(200),
    corrected: z.string().max(200).nullable(),
    formula: z.boolean(),
  })
  .strict();
export const gradebookSchema = z
  .object({
    schemaVersion: z.literal(1),
    imports: z
      .array(
        z
          .object({
            id: ident,
            examId: ident,
            classId: ident,
            version: z.number().int().positive(),
            title: z.string().trim().min(1).max(120),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            createdAt: z.string().datetime({ offset: true }),
            reason: z.string().max(2000),
            source: z
              .object({
                file: z.string().max(255),
                sheet: z.string().max(120),
                hash: z.string().regex(/^[a-f0-9]{64}$/),
                configuration: z.string().max(20000),
                headerStart: z.number().int().nonnegative(),
                headerEnd: z.number().int().nonnegative(),
                sourceClass: z.string().max(200),
              })
              .strict(),
            columns: z
              .array(
                z
                  .object({
                    key: ident,
                    label: z.string().trim().min(1).max(120),
                    role: z.enum(['score', 'total']),
                    sourceColumn: z.number().int().min(0).max(199),
                    maxUnits: units.refine((x) => x > 0).nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
            rows: z
              .array(
                z
                  .object({
                    line: z.number().int().positive(),
                    membershipId: ident,
                    sourceName: z.string().max(120),
                    sourceNo: z.string().max(100),
                    cells: z.array(gradeCellSchema).max(50),
                  })
                  .strict(),
              )
              .min(1)
              .max(5000),
            excluded: z
              .array(
                z
                  .object({ line: z.number().int().positive(), reason: z.string().min(1).max(200) })
                  .strict(),
              )
              .max(5000),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type Gradebook = z.infer<typeof gradebookSchema>;
export type GradeImport = Gradebook['imports'][number];
export type GradeCell = z.infer<typeof gradeCellSchema>;
export const emptyGradebook = (): Gradebook => ({ schemaVersion: 1, imports: [] });
export function validateGradebook(
  g: Gradebook,
  classes: Set<string>,
  members: Map<string, { classId: string }>,
) {
  function require(ok: unknown, message: string): asserts ok {
    if (!ok) throw new Error(message);
  }
  function unique(keys: unknown[], label: string) {
    require(new Set(keys).size === keys.length, label + '重复');
  }
  unique(
    g.imports.map((x) => x.id),
    '成绩导入 ID',
  );
  unique(
    g.imports.map((x) => JSON.stringify([x.examId, x.version])),
    '考试版本',
  );
  const owners = new Map<string, string>();
  let cells = 0;
  for (const batch of g.imports) {
    require(classes.has(batch.classId), '成绩单班级不存在');
    require(!Number.isNaN(Date.parse(batch.date)) &&
      new Date(batch.date).toISOString().slice(0, 10) === batch.date, '考试日期无效');
    require(!owners.has(batch.examId) ||
      owners.get(batch.examId) === batch.classId, '考试不能跨班改写');
    owners.set(batch.examId, batch.classId);
    require(batch.version === 1 || batch.reason.trim(), '修订成绩单须说明原因');
    require(g.imports.some((x) => x.examId === batch.examId && x.version === batch.version - 1) ||
      batch.version === 1, '成绩版本不连续');
    require(batch.source.headerStart <= batch.source.headerEnd, '成绩表头范围无效');
    unique(
      batch.columns.map((c) => c.key),
      '成绩列 ID',
    );
    unique(
      batch.columns.map((c) => c.label),
      '成绩列名称',
    );
    unique(
      batch.columns.map((c) => c.sourceColumn),
      '来源成绩列',
    );
    unique(
      batch.rows.map((r) => r.membershipId),
      '同场考试学生',
    );
    unique([...batch.rows.map((r) => r.line), ...batch.excluded.map((r) => r.line)], '来源行');
    for (const row of batch.rows) {
      require(members.get(row.membershipId)?.classId === batch.classId, '成绩与学生班级不匹配');
      require(row.cells.length === batch.columns.length, '成绩列数量不匹配');
      cells += row.cells.length;
      require(cells <= 300000, '成绩历史超过 30 万单元格，请拆分工作区');
      row.cells.forEach((cell, index) => {
        require((cell.status === 'score') === (cell.units !== null), '成绩状态与数值不一致');
        const max = batch.columns[index].maxUnits;
        require(cell.units === null || max === null || cell.units <= max, '成绩超过已确认满分');
      });
    }
  }
}
export function assertGradebookTransition(old: Gradebook, next: Gradebook) {
  const lookup = new Map(next.imports.map((x) => [x.id, x]));
  for (const item of old.imports)
    if (JSON.stringify(lookup.get(item.id)) !== JSON.stringify(item))
      throw new Error('成绩历史不可覆盖；请导入新修订版本');
}
