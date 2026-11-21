import type { Membership, Student } from '../../app/model';
import { mappedColumns, type TableMapping } from '../../modules/gradebook/recognize';
import type { GradeImport } from '../../modules/gradebook/model';
import type { GradePreview, ImportInput } from '../../modules/gradebook/service';
import type { TableBook, TableSheet } from '../../modules/gradebook/table';
import { Badge, Pager } from '../Primitives';
import { Icon } from '../Icons';

const ROLES = {
  ignore: '忽略',
  name: '学生姓名',
  number: '学号 / 编号',
  class: '来源班级',
  score: '科目成绩',
  total: '原表总分',
};

export function MappingStep({
  book,
  sheet,
  sheetIndex,
  prior,
  classes,
  hasFormulas,
  input,
  onSheet,
  onExamTarget,
  onChange,
  onMapping,
}: {
  book: TableBook;
  sheet: TableSheet;
  sheetIndex: number;
  prior: GradeImport[];
  classes: string[];
  hasFormulas: boolean;
  input: ImportInput;
  onSheet: (i: number) => void;
  onExamTarget: (examId: string) => void;
  onChange: (patch: Partial<ImportInput>) => void;
  onMapping: (m: TableMapping) => void;
}) {
  const m = input.mapping;
  const pickHeader = (row: number) =>
    onMapping({ ...m, headerStart: row, headerEnd: row, columns: mappedColumns(sheet, row, row) });

  return (
    <div className="col">
      <div className="soft-card col">
        <div className="form-row">
          {book.sheets.length > 1 && (
            <label className="tight">
              工作表
              <select value={sheetIndex} onChange={(e) => onSheet(Number(e.target.value))}>
                {book.sheets.map((sh, i) => <option key={i} value={i}>{sh.name}（{sh.rows.length}行）</option>)}
              </select>
            </label>
          )}
          <label className="tight">
            保存为
            <select value={input.examId} onChange={(e) => onExamTarget(e.target.value)}>
              <option value="">新建一场考试</option>
              {prior.map((p) => <option key={p.id} value={p.examId}>修订：{p.title}（当前 v{p.version}）</option>)}
            </select>
          </label>
          <label className="tight">
            考试名称
            <input maxLength={120} placeholder="如：第一次物理月考" value={input.title} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label className="tight">
            考试日期
            <input type="date" value={input.date} onChange={(e) => onChange({ date: e.target.value })} />
          </label>
        </div>
        {input.examId && (
          <label className="tight">
            本次修订原因（必填，旧版本会自动保留）
            <input maxLength={2000} placeholder="如：更正缺考记录或补录分数" value={input.reason} onChange={(e) => onChange({ reason: e.target.value })} />
          </label>
        )}
      </div>

      {sheet.warnings.map((w) => (
        <div className="alert tone-warning" key={w}><Icon name="alert" size={15} /><span>{w}</span></div>
      ))}

      {classes.length > 0 && (
        <div className={`soft-card row ${classes.length > 1 && !m.sourceClass ? 'warn-box' : ''}`}>
          <label className="tight" style={{ flex: 1 }}>
            {classes.length > 1 ? '检测到多班合表！请选择本班对应的「来源班级」' : '筛选来源班级（选填）'}
            <select value={m.sourceClass} onChange={(e) => onMapping({ ...m, sourceClass: e.target.value })}>
              <option value="">{classes.length > 1 ? '— 请选择一个来源班级 —' : '表内全部学生'}</option>
              {classes.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {classes.length > 1 && <p className="tip" style={{ flex: 1 }}>只导入所选班级的学生，其他班与平均分汇总行会自动排除。</p>}
        </div>
      )}

      <div className="row between">
        <div>
          <h3>1. 核对表头行</h3>
          <p className="tip">当前第 {m.headerStart + 1}{m.headerEnd > m.headerStart ? `—${m.headerEnd + 1}` : ''} 行（点击下方行号直接设为表头）</p>
        </div>
        <div className="row">
          <label className="compact-input">
            起始行
            <input
              type="number" min={1} max={sheet.rows.length} value={m.headerStart + 1}
              onChange={(e) => {
                const start = Number(e.target.value) - 1;
                if (Number.isInteger(start) && start >= 0 && start < sheet.rows.length) {
                  const end = m.headerEnd >= start && m.headerEnd - start < 10 ? m.headerEnd : start;
                  onMapping({ ...m, headerStart: start, headerEnd: end, columns: mappedColumns(sheet, start, end) });
                }
              }}
            />
          </label>
          <label className="compact-input">
            结束行
            <input
              type="number" min={m.headerStart + 1} max={Math.min(sheet.rows.length, m.headerStart + 10)} value={m.headerEnd + 1}
              onChange={(e) => {
                const end = Number(e.target.value) - 1;
                if (end >= m.headerStart && end < sheet.rows.length && end - m.headerStart < 10)
                  onMapping({ ...m, headerEnd: end, columns: mappedColumns(sheet, m.headerStart, end) });
              }}
            />
          </label>
        </div>
      </div>

      <div className="mini-raw bordered">
        <table>
          <tbody>
            {sheet.rows.slice(0, 8).map((row, r) => {
              const isH = r >= m.headerStart && r <= m.headerEnd;
              return (
                <tr key={r} className={isH ? 'is-hdr' : ''}>
                  <th><button type="button" className="row-pick" onClick={() => pickHeader(r)}>{r + 1}{isH ? ' 表头' : ''}</button></th>
                  {row.slice(0, 14).map((cell, c) => (
                    <td key={c}>{cell.text}{cell.formula ? <span className="mini-tag-warn">{cell.error ? '公式待核' : '公式'}</span> : null}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h3>2. 核对各列用途与满分</h3>
        <p className="tip">排名/等级等列默认忽略；填写满分后才能计算及格率与优秀率（未知可留空）。</p>
      </div>
      <div className="table-wrap bordered">
        <table>
          <thead><tr><th style={{ width: 54 }}>列</th><th>显示名称</th><th style={{ width: 145 }}>用途</th><th style={{ width: 105 }}>满分(选填)</th><th>数据样例</th></tr></thead>
          <tbody>
            {m.columns.map((col, i) => (
              <tr key={col.index} className={col.role === 'ignore' ? 'row-muted' : ''}>
                <td className="num">第{col.index + 1}列</td>
                <td><input aria-label={`第${col.index + 1}列名称`} value={col.label} maxLength={120} onChange={(e) => onMapping({ ...m, columns: m.columns.map((c, j) => (i === j ? { ...c, label: e.target.value } : c)) })} /></td>
                <td>
                  <select aria-label={`第${col.index + 1}列用途`} className={`role-${col.role}`} value={col.role} onChange={(e) => onMapping({ ...m, columns: m.columns.map((c, j) => (i === j ? { ...c, role: e.target.value as typeof col.role } : c)) })}>
                    {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td>
                  {col.role === 'score' || col.role === 'total' ? (
                    <input aria-label={`${col.label}满分`} inputMode="decimal" placeholder="如 100" value={col.max} onChange={(e) => onMapping({ ...m, columns: m.columns.map((c, j) => (i === j ? { ...c, max: e.target.value } : c)) })} />
                  ) : <span className="muted">—</span>}
                </td>
                <td className="sample-cell">
                  {sheet.rows.slice(m.headerEnd + 1, m.headerEnd + 4).map((r) => r[col.index]?.text || '空').join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasFormulas && (
        <div className="alert tone-info">
          <label className="check">
            <input type="checkbox" checked={input.acceptFormulas} onChange={(e) => onChange({ acceptFormulas: e.target.checked })} />
            <span>表格含有公式单元格：我确认已在 Excel / WPS 中重算并保存，采用文件中的公式缓存结果（缺结果的单元格仍会提示核对）。</span>
          </label>
        </div>
      )}
    </div>
  );
}

export function ReviewStep({
  preview,
  input,
  members,
  students,
  stale,
  problemsOnly,
  page,
  onProblemsOnly,
  onPage,
  onChange,
}: {
  preview: GradePreview;
  input: ImportInput;
  members: Membership[];
  students: Map<string, Student>;
  stale: boolean;
  problemsOnly: boolean;
  page: number;
  onProblemsOnly: (v: boolean) => void;
  onPage: (p: number) => void;
  onChange: (patch: Partial<ImportInput>) => void;
}) {
  const rows = preview.rows.filter((r) => !problemsOnly || r.errors.length || r.warnings.length);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 30) - 1));
  const selected = preview.rows.filter((r) => !r.excluded);
  const invalid = selected.filter((r) => r.errors.length).length;
  const newCount = selected.filter((r) => !r.membershipId).length;

  return (
    <div className="col">
      <div className="row">
        <Badge tone="success">纳入 {selected.length} 人</Badge>
        {newCount > 0 && <Badge tone="info">顺带新增花名册 {newCount} 人</Badge>}
        <Badge>已排除 {preview.rows.length - selected.length} 行</Badge>
        <Badge tone={invalid ? 'danger' : 'success'}>{invalid ? `有错误 ${invalid} 行` : '无阻塞错误'}</Badge>
        {stale && <Badge tone="warning">已修改 · 请点右下角「刷新核对结果」</Badge>}
      </div>

      {preview.errors.map((e) => <div role="alert" className="alert tone-danger" key={e}><Icon name="alert" size={15} /><span>{e}</span></div>)}

      <div className="row between">
        <label className="check"><input type="checkbox" checked={problemsOnly} onChange={(e) => { onProblemsOnly(e.target.checked); onPage(0); }} />只看有错误或提醒的行</label>
        <span className="tip">改完绑定或分数后，直接点右下角「刷新核对结果」即可</span>
      </div>

      <div className="table-scroll bordered" style={{ maxHeight: '45dvh' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 112 }}>原行 / 排除</th>
              <th style={{ width: 120 }}>原表学生</th>
              <th style={{ width: 185 }}>绑定本班学生</th>
              {preview.columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>核对提醒</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(currentPage * 30, (currentPage + 1) * 30).map((row) => (
              <tr key={row.line} className={row.excluded ? 'row-muted' : row.errors.length ? 'row-err' : row.warnings.length ? 'row-warn' : ''}>
                <td>
                  <div className="num"><strong>第 {row.line} 行</strong></div>
                  <label className="check" style={{ marginTop: 3 }}>
                    <input
                      type="checkbox"
                      aria-label={`排除第${row.line}行`}
                      checked={!!input.excluded[String(row.line)] || (!!row.excluded && row.excluded !== '用户明确排除' && !input.includedRows.includes(row.line))}
                      disabled={row.excluded === '其他来源班级'}
                      onChange={(e) => {
                        const excluded = { ...input.excluded };
                        if (e.target.checked) excluded[String(row.line)] = '用户明确排除';
                        else delete excluded[String(row.line)];
                        onChange({
                          excluded,
                          includedRows: e.target.checked
                            ? input.includedRows.filter((n) => n !== row.line)
                            : [...new Set([...input.includedRows, row.line])],
                        });
                      }}
                    />
                    排除
                  </label>
                  {row.excluded && <small className="muted">{row.excluded}</small>}
                </td>
                <td><strong>{row.name || '无姓名'}</strong><div className="tip num">{row.number || '无编号'}</div></td>
                <td>
                  <select
                    aria-label={`第${row.line}行学生绑定`}
                    disabled={!!row.excluded}
                    value={input.bindings[String(row.line)] || 'auto'}
                    onChange={(e) => onChange({ bindings: { ...input.bindings, [String(row.line)]: e.target.value } })}
                  >
                    <option value="auto">自动：{row.match}</option>
                    <option value="new">明确新增学生</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.rosterNo || '无编号'} · {students.get(m.studentId)!.name}</option>)}
                  </select>
                </td>
                {row.cells.map((cell, i) => {
                  const key = `${row.line}:${preview.columns[i].sourceColumn}`;
                  return (
                    <td key={key}>
                      <input
                        className="score-input"
                        aria-label={`第${row.line}行${preview.columns[i].label}`}
                        disabled={!!row.excluded}
                        value={input.corrections[key] ?? cell.raw}
                        maxLength={200}
                        onChange={(e) => onChange({ corrections: { ...input.corrections, [key]: e.target.value } })}
                      />
                      {cell.formula && <small className="muted block">{cell.raw ? '公式缓存' : '公式待填'}</small>}
                      {input.corrections[key] !== undefined && <small className="text-info block">原值：{cell.raw || '空'}</small>}
                    </td>
                  );
                })}
                <td>
                  {row.errors.map((e) => <div key={e} className="text-danger" style={{ fontSize: 12 }}>• {e}</div>)}
                  {row.warnings.map((w) => <div key={w} className="text-warn" style={{ fontSize: 12 }}>• {w}</div>)}
                  {!row.errors.length && !row.warnings.length && !row.excluded && <Icon name="checkCircle" size={15} className="text-ok" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty-box">当前没有需要处理的异常行！</p>}
      </div>
      <Pager page={currentPage} total={rows.length} pageSize={30} unit="行" onChange={onPage} />
    </div>
  );
}
