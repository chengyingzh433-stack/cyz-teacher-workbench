import { AppError, type Gender, type StudentMember } from './types';

export type RawRosterRow = { line: number; cells: string[] };
export type RosterColumnMapping = { name: number; rosterNo: number; gender: number };
export type RosterImportRow = {
  line: number;
  name: string;
  rosterNo: string;
  gender: Gender;
  errors: string[];
  matchMembershipId?: string;
  changes: string[];
};

export function parseDelimitedText(text: string, delimiter: ',' | '\t'): RawRosterRow[] {
  if (new TextEncoder().encode(text).length > 5 * 1024 ** 2) {
    throw new AppError('VALIDATION', '名单超过 5 MiB，请拆分文件');
  }
  const clean = text.replace(/^\uFEFF/, '');
  const rows: RawRosterRow[] = [];
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
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
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
      if (c === '\r' && clean[i + 1] === '\n') i++;
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

export function previewRosterImport(
  existingMembers: StudentMember[],
  rows: RawRosterRow[],
  mapping: RosterColumnMapping,
  hasHeader: boolean,
): RosterImportRow[] {
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length > 5000) throw new AppError('VALIDATION', '单次导入最多 5,000 条');
  if (mapping.name < 0) throw new AppError('VALIDATION', '请映射姓名列');

  const noCounts = new Map<string, number>();
  for (const row of body) {
    const no = (row.cells[mapping.rosterNo] || '').trim();
    if (no) noCounts.set(no, (noCounts.get(no) || 0) + 1);
  }

  const genderDict: Record<string, Gender> = {
    '': 'unspecified',
    未填写: 'unspecified',
    男: 'male',
    女: 'female',
    male: 'male',
    female: 'female',
    m: 'male',
    f: 'female',
    unspecified: 'unspecified',
  };

  return body.map((row) => {
    const name = (row.cells[mapping.name] || '').trim();
    const rosterNo = mapping.rosterNo >= 0 ? (row.cells[mapping.rosterNo] || '').trim() : '';
    const rawGender = mapping.gender >= 0 ? (row.cells[mapping.gender] || '').trim() : '';
    const genderKey = rawGender.toLowerCase();
    const gender = Object.hasOwn(genderDict, rawGender)
      ? genderDict[rawGender]
      : Object.hasOwn(genderDict, genderKey)
        ? genderDict[genderKey]
        : undefined;

    const errors: string[] = [];
    if (!name) errors.push('姓名为空');
    if (name.length > 120) errors.push('姓名超过 120 字');
    if (!gender) errors.push(`未知性别：${rawGender}`);
    if (rosterNo.length > 100) errors.push('编号超过 100 字');
    if (rosterNo && (noCounts.get(rosterNo) || 0) > 1) errors.push('文件内编号重复');

    const match = rosterNo ? existingMembers.find((m) => m.rosterNo === rosterNo) : undefined;
    if (match?.status === 'removed') errors.push('编号属于已移出学生，请先恢复或更换编号');

    const changes: string[] = [];
    if (match && match.status === 'active') {
      if (match.name !== name) changes.push(`姓名：${match.name} → ${name}`);
      if (gender && match.gender !== gender) {
        const gText = (g: Gender) => (g === 'male' ? '男' : g === 'female' ? '女' : '未填');
        changes.push(`性别：${gText(match.gender)} → ${gText(gender)}`);
      }
    }

    return {
      line: row.line,
      name,
      rosterNo,
      gender: gender || 'unspecified',
      errors,
      matchMembershipId: match?.status === 'active' ? match.membershipId : undefined,
      changes,
    };
  });
}
