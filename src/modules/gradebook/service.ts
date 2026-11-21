import { z } from 'zod';
import { AppError, assertEditable, id, type Snapshot } from '../../app/model';
import { saveStudent } from '../roster';
import {
  blankCell,
  mappingSchema,
  normalizeName,
  scoreValue,
  sourceClasses,
  gradeSourceRows,
  type TableMapping,
} from './recognize';
import type { TableSheet } from './table';
import type { GradeCell, GradeImport } from './model';
export const importInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    examId: z.string().max(120),
    reason: z.string().max(2000),
    mapping: mappingSchema,
    bindings: z.record(z.string(), z.string().max(120)),
    excluded: z.record(z.string(), z.string().max(200)),
    includedRows: z.array(z.number().int().positive().max(5000)).max(5000),
    corrections: z.record(z.string(), z.string().max(200)),
    acceptFormulas: z.boolean(),
  })
  .strict();
export type ImportInput = z.infer<typeof importInputSchema>;
export type TableSource = { file: string; hash: string; sheet: TableSheet };
export type PreviewRow = {
  line: number;
  name: string;
  number: string;
  membershipId: string | null;
  match: string;
  cells: GradeCell[];
  errors: string[];
  excluded: string;
  warnings: string[];
};
export type GradePreview = {
  classId: string;
  token: string;
  input: ImportInput;
  source: TableSource;
  columns: GradeImport['columns'];
  rows: PreviewRow[];
  errors: string[];
  formulaCount: number;
};
function fail(message: string): never {
  throw new AppError('GRADE_IMPORT', message);
}
export function previewGradeImport(
  s: Snapshot,
  classId: string,
  source: TableSource,
  raw: ImportInput,
  token: string,
): GradePreview {
  assertEditable(s, classId);
  const input = importInputSchema.parse(raw),
    mapping = input.mapping,
    sheet = source.sheet;
  if (mapping.headerStart > mapping.headerEnd || mapping.headerEnd >= sheet.rows.length)
    fail('请核对表头起止行');
  const width = Math.max(0, ...sheet.rows.map((r) => r.length));
  if (
    mapping.headerEnd - mapping.headerStart >= 10 ||
    mapping.columns.some((c) => c.index >= width)
  )
    fail('表头最多 10 行，映射列必须存在于原表');
  if (new Set(mapping.columns.map((c) => c.index)).size !== mapping.columns.length)
    fail('列映射重复');
  for (const key of ['name', 'number', 'class']) {
    const count = mapping.columns.filter((c) => c.role === key).length;
    if (count > 1 || (key === 'name' && count !== 1))
      fail(key === 'name' ? '请选择且仅选择一列姓名' : '学号和班级各只能映射一列');
  }
  const picked = mapping.columns.filter((c) => c.role === 'score' || c.role === 'total');
  if (!picked.length || picked.length > 50) fail('请选择 1—50 个成绩/原表总分列');
  if (picked.length * sheet.rows.length > 100000) fail('单次导入最多 10 万个成绩单元，请拆分');
  if (new Set(picked.map((c) => c.label)).size !== picked.length)
    fail('成绩列名称重复，请分别命名（如数学原始分/数学成绩）');
  const columns: GradeImport['columns'] = picked.map((c) => {
    const max = c.max.trim() ? scoreValue({ ...blankCell, text: c.max }) : null;
    if (max && (max.error || max.units === null || max.units === 0))
      fail(`${c.label} 的满分应为正数，未知请留空`);
    return {
      key: `column-${c.index}`,
      label: c.label,
      sourceColumn: c.index,
      role: c.role as 'score' | 'total',
      maxUnits: max?.units ?? null,
    };
  });
  const errors: string[] = [];
  const sourceRows = gradeSourceRows(sheet, mapping);
  const classes = sourceClasses(sourceRows, input.includedRows);
  const hasClassColumn = mapping.columns.some((c) => c.role === 'class');
  if (classes.length > 1 && !mapping.sourceClass)
    errors.push('原表包含多个班级，请选择本次导入的来源班级');
  if (mapping.sourceClass && !classes.includes(mapping.sourceClass))
    errors.push('所选来源班级不在当前表格中');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date
  )
    errors.push('考试日期无效');
  const prior = s.data.gradebook.imports.filter((x) => x.examId === input.examId);
  if (input.examId && (!prior.length || prior.some((x) => x.classId !== classId)))
    errors.push('修订目标考试不存在或不属于本班');
  if (input.examId && !input.reason.trim()) errors.push('修订整份成绩单需要填写原因');
  const members = s.data.memberships.filter((m) => m.classId === classId),
    students = new Map(s.data.students.map((p) => [p.id, p]));
  const included = new Set(input.includedRows);
  const classified = sourceRows.map((row) => {
    let excluded = input.excluded[String(row.line)] || '';
    if (!excluded && !included.has(row.line)) excluded = row.automaticExclusion;
    if (
      !excluded &&
      mapping.sourceClass &&
      row.sourceClass &&
      row.sourceClass !== mapping.sourceClass
    )
      excluded = '其他来源班级';
    return { ...row, excluded };
  });
  const rowNames = new Map<string, number>();
  for (const row of classified) {
    if (row.excluded) continue;
    const normalized = normalizeName(row.name);
    rowNames.set(normalized, (rowNames.get(normalized) || 0) + 1);
  }
  let formulaCount = 0;
  const rows: PreviewRow[] = [];
  for (const { line, name, number, sourceClass, classFormula, excluded } of classified) {
    const rawRow = sheet.rows[line - 1],
      rowErrors: string[] = [],
      warnings: string[] = [];
    if (!excluded && hasClassColumn && !sourceClass)
      rowErrors.push('学生行缺少来源班级，请在原表补全班级或明确排除此行');
    const binding = input.bindings[String(line)] || 'auto';
    let membershipId: string | null = null,
      match = '新增学生';
    const byNumber = number ? members.filter((m) => m.rosterNo === number) : [];
    const byName = members.filter(
      (m) => normalizeName(students.get(m.studentId)!.name) === normalizeName(name),
    );
    if (binding !== 'auto' && binding !== 'new') {
      const target = members.find((m) => m.id === binding && m.status === 'active');
      if (!target) rowErrors.push('手动绑定成员不存在或已移出');
      else {
        membershipId = target.id;
        match = '手动绑定';
        if (target.rosterNo !== number || students.get(target.studentId)!.name !== name)
          warnings.push('原表身份与所选成员不同，保留原表字段作来源');
      }
    } else if (binding === 'new') {
      if (byNumber.length) rowErrors.push('此编号已被本班成员使用，不能新增重复编号');
      if (byName.length) warnings.push('将新增同名学生，请核对确为不同人');
    } else if (byNumber.length) {
      const target = byNumber[0];
      if (target.status === 'removed') rowErrors.push('编号属于已移出成员，请先恢复成员或手动绑定');
      else if (normalizeName(students.get(target.studentId)!.name) !== normalizeName(name))
        rowErrors.push('学号匹配但姓名不同，请手动核对绑定');
      else {
        membershipId = target.id;
        match = '按本班编号匹配';
      }
    } else if (byName.length) {
      if (
        !number &&
        byName.length === 1 &&
        rowNames.get(normalizeName(name)) === 1 &&
        byName[0].status === 'active'
      ) {
        membershipId = byName[0].id;
        match = '按唯一姓名匹配（请核对）';
        warnings.push('原表无编号，仅按本班唯一姓名提出匹配');
      } else rowErrors.push('同名或编号不一致，请明确绑定现有学生或选择新增');
    } else if (!number && (rowNames.get(normalizeName(name)) || 0) > 1 && binding === 'auto')
      rowErrors.push('原表同名且无编号，请手动确认每行身份');
    if (!name || name.length > 120) rowErrors.push('姓名为空或过长');
    if (number.length > 100) rowErrors.push('编号过长');
    const identityCols = mapping.columns.filter((c) => c.role === 'name' || c.role === 'number');
    const numberColumn = mapping.columns.find((c) => c.role === 'number');
    const numberValue = numberColumn ? rawRow[numberColumn.index]?.value : null;
    if (
      typeof numberValue === 'number' &&
      (!Number.isSafeInteger(numberValue) || numberValue >= 1e15)
    )
      rowErrors.push('编号为过长数字或非整数，Excel 可能已丢失精度；请核对原始编号并以文本保存');
    for (const c of identityCols) {
      const error = rawRow[c.index]?.error;
      if (error) rowErrors.push(`${c.label}：${error}，请在原表更正身份信息`);
    }
    if (identityCols.some((c) => rawRow[c.index]?.formula))
      warnings.push('身份列来自公式缓存值，请确认已重算');
    const cells = picked.map((col, index) => {
      const cell = rawRow[col.index] || blankCell,
        correction = input.corrections[`${line}:${col.index}`];
      const value = scoreValue(cell, correction);
      if (value.error) rowErrors.push(`${col.label}：${value.error}`);
      if (cell.formula && !excluded) formulaCount++;
      if (cell.formula && cell.error && correction !== undefined && !correction.trim())
        rowErrors.push(`${col.label}：请填写核对后的值，或明确填写“未录入”`);
      if (cell.text.length > 200)
        rowErrors.push(`${col.label}：原始单元格超过 200 字，请在原文件整理`);
      const max = columns[index].maxUnits;
      if (value.units !== null && max !== null && value.units > max)
        rowErrors.push(`${col.label}：超过满分 ${max / 100}`);
      return {
        status: value.status,
        units: value.units,
        raw: cell.text.slice(0, 200),
        corrected: correction ?? null,
        formula: cell.formula,
      };
    });
    if (!excluded && (classFormula || identityCols.some((c) => rawRow[c.index]?.formula)))
      formulaCount++;
    rows.push({
      line,
      name,
      number,
      membershipId,
      match,
      cells,
      errors: rowErrors,
      excluded,
      warnings,
    });
  }
  const selected = rows.filter((r) => !r.excluded),
    ids = new Map<string, PreviewRow[]>(),
    numbers = new Map<string, PreviewRow[]>();
  for (const row of selected) {
    if (row.membershipId) ids.set(row.membershipId, [...(ids.get(row.membershipId) || []), row]);
    if (row.number) numbers.set(row.number, [...(numbers.get(row.number) || []), row]);
  }
  for (const group of [...ids.values(), ...numbers.values()])
    if (group.length > 1)
      for (const row of group)
        row.errors.push('所选行重复绑定同一学生或重复原表编号，请排除重复行');
  if (!selected.length) errors.push('没有选中学生行');
  if (formulaCount && !input.acceptFormulas)
    errors.push('表格有公式缓存，请确认已在表格软件重算并保存');
  return { classId, token, input, source, columns, rows, errors, formulaCount };
}
export function commitGradeImport(
  s: Snapshot,
  preview: GradePreview,
  currentToken: string,
): string {
  if (currentToken !== preview.token) fail('成绩预览已过期，请重新生成预览，未覆盖资料');
  const fresh = previewGradeImport(s, preview.classId, preview.source, preview.input, currentToken);
  const selected = fresh.rows.filter((r) => !r.excluded);
  if (fresh.errors.length || selected.some((r) => r.errors.length))
    fail(
      [...fresh.errors, ...selected.flatMap((r) => r.errors.map((e) => `第 ${r.line} 行：${e}`))]
        .slice(0, 4)
        .join('；'),
    );
  const configuration = JSON.stringify(fresh.input);
  if (configuration.length > 20000) fail('更正和映射记录过多，请整理原表后重新导入');
  if (
    s.data.gradebook.imports.some(
      (x) =>
        x.classId === fresh.classId &&
        x.source.hash === fresh.source.hash &&
        x.source.sheet === fresh.source.sheet.name &&
        x.source.configuration === configuration,
    )
  )
    fail('同一文件与配置已经导入，未重复写入');
  const prior = s.data.gradebook.imports
    .filter((x) => x.examId === fresh.input.examId)
    .sort((a, b) => b.version - a.version)[0];
  const batch: GradeImport = {
    id: id(),
    examId: prior?.examId || id(),
    classId: fresh.classId,
    version: (prior?.version || 0) + 1,
    title: fresh.input.title,
    date: fresh.input.date,
    createdAt: new Date().toISOString(),
    reason: fresh.input.reason,
    source: {
      file: fresh.source.file.slice(0, 255),
      sheet: fresh.source.sheet.name.slice(0, 120),
      hash: fresh.source.hash,
      configuration,
      headerStart: fresh.input.mapping.headerStart,
      headerEnd: fresh.input.mapping.headerEnd,
      sourceClass: fresh.input.mapping.sourceClass,
    },
    columns: fresh.columns,
    rows: selected.map((row) => ({
      line: row.line,
      membershipId:
        row.membershipId ||
        saveStudent(s, fresh.classId, {
          name: row.name,
          rosterNo: row.number,
          gender: 'unspecified',
        }),
      sourceName: row.name,
      sourceNo: row.number,
      cells: row.cells,
    })),
    excluded: fresh.rows
      .filter((r) => r.excluded)
      .map((r) => ({ line: r.line, reason: r.excluded })),
  };
  s.data.gradebook.imports.push(batch);
  return batch.id;
}
