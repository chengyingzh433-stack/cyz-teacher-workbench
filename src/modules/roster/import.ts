import { AppError, copy, type Gender, type Snapshot } from '../../app/model';
import { saveStudent, type StudentInput } from './index';
export type RawRow = { line: number; cells: string[] };
export type Mapping = { name: number; rosterNo: number; gender: number };
export type ImportRow = {
  line: number;
  input: StudentInput;
  errors: string[];
  match?: string;
  changes: string[];
};
export type ImportPreview = { token: string; classId: string; rows: ImportRow[] };
export function parseTable(text: string, delimiter: ',' | '\t'): RawRow[] {
  if (new TextEncoder().encode(text).length > 5 * 1024 ** 2)
    throw new AppError('VALIDATION', '名单超过 5 MiB，请拆分文件');
  text = text.replace(/^\uFEFF/, '');
  const rows: RawRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let start = 1;
  const pushRow = () => {
    cells.push(field);
    if (cells.some((x) => x.trim())) rows.push({ line: start, cells });
    cells = [];
    field = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += c;
        if (c === '\n') line++;
      }
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new AppError('VALIDATION', `第 ${line} 行引号位置不正确`);
      quoted = true;
    } else if (c === delimiter) {
      cells.push(field);
      field = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      line++;
      start = line;
    } else {
      if (closed) throw new AppError('VALIDATION', `第 ${line} 行结束引号后有多余字符`);
      field += c;
    }
  }
  if (quoted) throw new AppError('VALIDATION', `第 ${start} 行引号未闭合`);
  if (field || cells.length) pushRow();
  if (rows.length > 5001) throw new AppError('VALIDATION', '单次导入最多 5,000 条，请拆分');
  return rows;
}
export function previewImport(
  s: Snapshot,
  classId: string,
  rows: RawRow[],
  mapping: Mapping,
  header: boolean,
  token: string,
): ImportPreview {
  const body = header ? rows.slice(1) : rows;
  if (body.length > 5000) throw new AppError('VALIDATION', '单次导入最多 5,000 条');
  if (mapping.name < 0) throw new AppError('VALIDATION', '请映射姓名列');
  const counts = new Map<string, number>();
  for (const row of body) {
    const no = (row.cells[mapping.rosterNo] || '').trim();
    if (no) counts.set(no, (counts.get(no) || 0) + 1);
  }
  return {
    token,
    classId,
    rows: body.map((row) => {
      const name = (row.cells[mapping.name] || '').trim();
      const rosterNo = (row.cells[mapping.rosterNo] || '').trim();
      const rawGender = (row.cells[mapping.gender] || '').trim();
      const values: Record<string, Gender> = {
        '': 'unspecified',
        未填写: 'unspecified',
        男: 'male',
        女: 'female',
        male: 'male',
        female: 'female',
        unspecified: 'unspecified',
      };
      const gender = Object.hasOwn(values, rawGender) ? values[rawGender] : undefined;
      const errors: string[] = [];
      if (!name) errors.push('姓名为空');
      if (name.length > 120) errors.push('姓名超过 120 字');
      if (!gender) errors.push(`未知性别：${rawGender}`);
      if (rosterNo.length > 100) errors.push('编号超过 100 字');
      if (rosterNo && counts.get(rosterNo)! > 1) errors.push('文件内编号重复');
      const match = rosterNo
        ? s.data.memberships.find((x) => x.classId === classId && x.rosterNo === rosterNo)
        : undefined;
      if (match?.status === 'removed') errors.push('编号属于已移出成员，请先恢复或改用其他编号');
      const old = match && s.data.students.find((x) => x.id === match.studentId);
      const changes: string[] = [];
      if (old) {
        if (old.name !== name) changes.push(`姓名：${old.name} → ${name}`);
        if (old.gender !== gender)
          changes.push(
            `性别：${old.gender === 'male' ? '男' : old.gender === 'female' ? '女' : '未填写'} → ${rawGender || '未填写'}，同时重新匹配形象`,
          );
      }
      return {
        line: row.line,
        input: { name, rosterNo, gender: gender || 'unspecified' },
        match: match?.id,
        changes,
        errors,
      };
    }),
  };
}
export function applyImport(
  s: Snapshot,
  preview: ImportPreview,
  token: string,
  excluded: number[],
  updates: number[],
): Snapshot {
  if (preview.token !== token)
    throw new AppError('STALE_PREVIEW', '名单预览已过期，请重新生成预览');
  const rows = preview.rows.filter((x) => !excluded.includes(x.line));
  if (!rows.length) throw new AppError('VALIDATION', '没有选中可导入的行');
  for (const r of rows) {
    if (r.errors.length)
      throw new AppError('VALIDATION', `第 ${r.line} 行仍有错误，请修正或明确排除`);
    if (r.match && !updates.includes(r.line))
      throw new AppError('VALIDATION', `第 ${r.line} 行编号已存在，请勾选更新或排除该行`);
  }
  const next = copy(s);
  for (const r of rows) saveStudent(next, preview.classId, r.input, r.match);
  return next;
}
