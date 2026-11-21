import { z } from 'zod';
import {
  activeMembers,
  AppError,
  assertEditable,
  copy,
  id,
  validate,
  type Snapshot,
} from '../../app/model';
import type { WorkbenchStore } from '../../app/store';
import { addClass, saveStudent, setMembershipStatus } from '../roster';
import { move, resize, sequential } from '../seating';
import { analyzeGrades, totalDifferences } from '../gradebook/analysis';
import { inferMapping } from '../gradebook/recognize';
import {
  commitGradeImport,
  importInputSchema,
  previewGradeImport,
  type GradePreview,
  type TableSource,
} from '../gradebook/service';
const ident = z.string().min(1).max(120),
  text = z.string().max(120);
const actions = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('class.create'),
      name: ident,
      school: z.string().max(200),
      term: text,
    })
    .strict(),
  z
    .object({
      kind: z.literal('class.status'),
      classId: ident,
      status: z.enum(['active', 'archived']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('student.save'),
      classId: ident,
      membershipId: ident.optional(),
      name: ident,
      rosterNo: z.string().max(100),
      gender: z.enum(['male', 'female', 'unspecified']),
      characterId: ident.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('member.status'),
      membershipId: ident,
      status: z.enum(['active', 'removed']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('seating.resize'),
      planId: ident,
      rows: z.number().int().min(1).max(12),
      cols: z.number().int().min(1).max(16),
    })
    .strict(),
  z
    .object({
      kind: z.literal('seating.move'),
      planId: ident,
      membershipId: ident,
      row: z.number().int().min(0).max(11).nullable(),
      col: z.number().int().min(0).max(15).nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('seating.sequential'), planId: ident }).strict(),
]);
export type WorkspaceAction = z.infer<typeof actions>;
const definitions = {
  'workspace.classes': {
    description: '列出班级及成员数；不返回整份工作区',
    effect: 'read',
    schema: z.object({}).strict(),
  },
  'workspace.members': {
    description: '分页读取指定班级的姓名、编号和身份 ID',
    effect: 'read-sensitive',
    schema: z.object({ classId: ident, offset: z.number().int().min(0).default(0) }).strict(),
  },
  'workspace.seating': {
    description: '读取班级座位方案与成员 ID',
    effect: 'read-sensitive',
    schema: z.object({ classId: ident }).strict(),
  },
  'workspace.propose': {
    description: '准备班级、学生或排座变更，校验但不写入；返回需授权的提案',
    effect: 'prepare',
    schema: z.object({ action: actions }).strict(),
  },
  'table.inspect': {
    description: '分页读取用户已选表格；文件必须由宿主提供，工具不访问任意文件或 URL',
    effect: 'read-sensitive',
    schema: z.object({ sourceId: ident, offset: z.number().int().min(0).default(0) }).strict(),
  },
  'table.suggest_mapping': {
    description: '建议表头和列映射；不写入班级或成绩',
    effect: 'prepare',
    schema: z.object({ sourceId: ident }).strict(),
  },
  'grades.preview': {
    description: '校验成绩、身份与映射，生成导入提案；不修改工作区',
    effect: 'prepare',
    schema: z.object({ sourceId: ident, classId: ident, input: importInputSchema }).strict(),
  },
  'grades.preview_rows': {
    description: '分页查看提案的匹配、原始值、更正、错误及排除行',
    effect: 'read-sensitive',
    schema: z.object({ proposalId: ident, offset: z.number().int().min(0).default(0) }).strict(),
  },
  'grades.list': {
    description: '列出指定班级已导入考试及修订版本',
    effect: 'read',
    schema: z.object({ classId: ident }).strict(),
  },
  'grades.analyze': {
    description: '查询选定导入版本与成绩列的统计；不修改数据',
    effect: 'read-sensitive',
    schema: z
      .object({
        importId: ident,
        column: ident,
        passPercent: z.number().min(0).max(100).default(60),
        excellentPercent: z.number().min(0).max(100).default(85),
      })
      .strict(),
  },
  'workspace.commit': {
    description:
      '应用已核对提案；要求宿主对该提案另行授予授权，参数内不能声明授权。检查过期与重复调用。',
    effect: 'write',
    schema: z.object({ proposalId: ident }).strict(),
  },
} as const;
export type ToolName = keyof typeof definitions;
export const assistantToolCatalog = Object.entries(definitions).map(([name, definition]) => ({
  name,
  description: definition.description,
  effect: definition.effect,
  inputSchema: z.toJSONSchema(definition.schema),
}));
type Proposal =
  | { kind: 'grade'; token: string; preview: GradePreview }
  | { kind: 'workspace'; token: string; action: WorkspaceAction; summary: string };
type Grant = { proposalId: string };
function applyAction(s: Snapshot, a: WorkspaceAction) {
  if (a.kind === 'class.create') return addClass(s, a.name, a.school, a.term);
  if (a.kind === 'class.status') {
    const c = s.data.classes.find((c) => c.id === a.classId);
    if (!c) throw new Error('班级不存在');
    c.status = a.status;
    return c.id;
  }
  if (a.kind === 'student.save')
    return saveStudent(
      s,
      a.classId,
      {
        name: a.name,
        rosterNo: a.rosterNo,
        gender: a.gender,
        ...(a.characterId !== undefined ? { characterId: a.characterId } : {}),
      },
      a.membershipId,
    );
  if (a.kind === 'member.status') {
    setMembershipStatus(s, a.membershipId, a.status);
    return a.membershipId;
  }
  const index = s.data.seatPlans.findIndex((p) => p.id === a.planId);
  if (index < 0) throw new Error('座位方案不存在');
  const p = s.data.seatPlans[index];
  assertEditable(s, p.classId);
  const members = activeMembers(s, p.classId);
  if (a.kind === 'seating.resize') s.data.seatPlans[index] = resize(p, members, a.rows, a.cols);
  if (a.kind === 'seating.sequential') s.data.seatPlans[index] = sequential(p, members);
  if (a.kind === 'seating.move') {
    if ((a.row === null) !== (a.col === null)) throw new Error('行列须同时填写或同时为空');
    s.data.seatPlans[index] = move(
      p,
      members,
      a.membershipId,
      a.row === null ? null : { row: a.row, col: a.col! },
    );
  }
  return p.id;
}
// One host session owns local files and proposals. This object is not put on window or exposed as a chat API.
export class AssistantToolSession {
  private sources = new Map<string, TableSource>();
  private proposals = new Map<string, Proposal>();
  private grants = new WeakSet<Grant>();
  private receipts = new Map<string, unknown>();
  constructor(private store: WorkbenchStore) {}
  registerSource(source: TableSource) {
    const key = id();
    this.sources.clear();
    this.proposals.clear();
    this.sources.set(key, copy(source));
    return key;
  }
  dispose() {
    this.sources.clear();
    this.proposals.clear();
    this.receipts.clear();
    this.grants = new WeakSet();
  }
  private source(key: string) {
    const source = this.sources.get(key);
    if (!source) throw new AppError('TOOL_SOURCE', '表格来源已失效，请重新选择');
    return source;
  }
  getPreview(key: string) {
    const p = this.proposals.get(key);
    return p?.kind === 'grade' ? copy(p.preview) : null;
  }
  // Only trusted host UI / future authorization policy calls this; deliberately absent from the tool catalog.
  authorize(proposalId: string): Grant {
    if (!this.proposals.has(proposalId)) throw new Error('提案不存在');
    const grant = { proposalId };
    this.grants.add(grant);
    return grant;
  }
  async invoke(name: ToolName, raw: unknown, grant?: Grant): Promise<unknown> {
    if (!Object.hasOwn(definitions, name)) throw new Error('未知内置工具');
    definitions[name].schema.parse(raw);
    const state = this.store.getState(),
      s = state.snapshot;
    if (!s || state.status === 'loading' || state.status === 'load-error')
      throw new Error('工作区尚未正常读取');
    const token = this.store.token();
    switch (name) {
      case 'workspace.classes':
        return s.data.classes.map((c) => ({
          ...c,
          members: s.data.memberships.filter((m) => m.classId === c.id && m.status === 'active')
            .length,
        }));
      case 'workspace.members': {
        const p = definitions[name].schema.parse(raw),
          students = new Map(s.data.students.map((x) => [x.id, x]));
        return s.data.memberships
          .filter((m) => m.classId === p.classId)
          .slice(p.offset, p.offset + 100)
          .map((m) => ({ ...m, name: students.get(m.studentId)!.name }));
      }
      case 'workspace.seating': {
        const p = definitions[name].schema.parse(raw);
        return copy(s.data.seatPlans.filter((x) => x.classId === p.classId));
      }
      case 'table.inspect': {
        const p = definitions[name].schema.parse(raw),
          source = this.source(p.sourceId);
        return {
          file: source.file,
          sheet: source.sheet.name,
          totalRows: source.sheet.rows.length,
          warnings: source.sheet.warnings,
          rows: copy(source.sheet.rows.slice(p.offset, p.offset + 50)),
          startLine: p.offset + 1,
        };
      }
      case 'table.suggest_mapping': {
        const p = definitions[name].schema.parse(raw);
        return inferMapping(this.source(p.sourceId).sheet);
      }
      case 'workspace.propose': {
        const p = definitions[name].schema.parse(raw),
          next = copy(s);
        applyAction(next, p.action);
        validate(next);
        const key = id();
        this.trimProposals();
        this.proposals.set(key, {
          kind: 'workspace',
          token,
          action: p.action,
          summary: JSON.stringify(p.action),
        });
        return { proposalId: key, token, action: p.action, requiresAuthorization: true };
      }
      case 'grades.preview': {
        const p = definitions[name].schema.parse(raw),
          preview = previewGradeImport(s, p.classId, this.source(p.sourceId), p.input, token),
          key = id();
        this.trimProposals();
        this.proposals.set(key, { kind: 'grade', token, preview });
        return {
          proposalId: key,
          token,
          errors: preview.errors,
          rows: preview.rows.length,
          selected: preview.rows.filter((r) => !r.excluded).length,
          newStudents: preview.rows.filter((r) => !r.excluded && !r.membershipId).length,
          invalid: preview.rows.filter((r) => !r.excluded && r.errors.length).length,
          requiresAuthorization: true,
        };
      }
      case 'grades.preview_rows': {
        const p = definitions[name].schema.parse(raw),
          preview = this.getPreview(p.proposalId);
        if (!preview) throw new Error('成绩提案已失效');
        return { total: preview.rows.length, rows: preview.rows.slice(p.offset, p.offset + 50) };
      }
      case 'grades.list': {
        const p = definitions[name].schema.parse(raw);
        return s.data.gradebook.imports
          .filter((x) => x.classId === p.classId)
          .map((x) => ({
            id: x.id,
            examId: x.examId,
            title: x.title,
            date: x.date,
            version: x.version,
            students: x.rows.length,
            columns: x.columns,
          }));
      }
      case 'grades.analyze': {
        const p = definitions[name].schema.parse(raw),
          batch = s.data.gradebook.imports.find((x) => x.id === p.importId);
        if (!batch) throw new Error('成绩版本不存在');
        return {
          statistics: analyzeGrades(batch, p.column, p.passPercent, p.excellentPercent),
          totalDifferences: totalDifferences(batch),
        };
      }
      case 'workspace.commit': {
        const p = definitions[name].schema.parse(raw);
        if (this.receipts.has(p.proposalId)) return this.receipts.get(p.proposalId);
        if (!grant || grant.proposalId !== p.proposalId || !this.grants.has(grant))
          throw new AppError('TOOL_AUTHORIZATION', '此写入尚未获得宿主授权，请先核对操作提案');
        this.grants.delete(grant);
        const proposal = this.proposals.get(p.proposalId);
        if (!proposal) throw new Error('提案已失效');
        let resultId = '';
        await this.store.edit((next, current) => {
          if (current !== proposal.token)
            throw new AppError('STALE_PREVIEW', '工作区已改变，请重新预览后提交');
          if (this.store.getState().status === 'conflict')
            throw new Error('工作区存在冲突，请先重新读取');
          resultId =
            proposal.kind === 'grade'
              ? commitGradeImport(next, proposal.preview, current)
              : applyAction(next, proposal.action);
        });
        const receipt = {
          resultId,
          saveStatus: this.store.getState().status,
          appliedToWorkingCopy: true,
        };
        this.receipts.set(p.proposalId, receipt);
        return receipt;
      }
    }
  }
  private trimProposals() {
    if (this.proposals.size >= 8) this.proposals.delete(this.proposals.keys().next().value!);
    if (this.receipts.size >= 100) this.receipts.delete(this.receipts.keys().next().value!);
  }
}
