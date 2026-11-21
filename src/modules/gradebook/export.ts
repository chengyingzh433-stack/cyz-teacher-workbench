import type { GradeImport } from './model';
import { analyzeGrades, cellLabels, columnValues, formatScore } from './analysis';
import { escapeHtml } from '../assessment/export';
const csv = (value: string, force = false) =>
  '"' +
  ((force || /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? "'" : '') + value).replace(
    /"/g,
    '""',
  ) +
  '"';
export function exportGradebookCsv(batch: GradeImport, identified: boolean, saveLabel: string) {
  const sums = columnValues(batch, 'computed');
  const rows = [
    [
      '学生',
      '原表编号',
      '来源行',
      ...batch.columns.flatMap((c) => [c.label, `${c.label}状态`]),
      '所选科目合计',
      '版本',
      '保存状态',
    ]
      .map((s) => csv(s))
      .join(','),
  ];
  batch.rows.forEach((r, i) =>
    rows.push(
      [
        identified ? r.sourceName : `学生 ${i + 1}`,
        identified ? r.sourceNo : '',
        String(r.line),
        ...r.cells.flatMap((c) => [
          c.units === null ? '' : formatScore(c.units),
          cellLabels[c.status],
        ]),
        sums[i] === null ? '' : formatScore(sums[i]),
        `v${batch.version}`,
        saveLabel,
      ]
        .map((v, col) => csv(v, col === 1 && identified && !!r.sourceNo))
        .join(','),
    ),
  );
  return '\ufeff' + rows.join('\r\n');
}
export function exportGradebookHtml(
  batch: GradeImport,
  identified: boolean,
  saveLabel: string,
  pass: number,
  excellent: number,
) {
  const e = escapeHtml;
  const reports = [
    ...batch.columns.map((c) => analyzeGrades(batch, c.key, pass, excellent)),
    analyzeGrades(batch, 'computed', pass, excellent),
  ];
  const summary = reports
    .map(
      (r) =>
        `<tr>${[r.label, String(r.count), formatScore(r.meanUnits), formatScore(r.medianUnits), formatScore(r.minUnits), formatScore(r.maxObservedUnits), r.pass === null ? '未设置满分或无有效成绩' : `${r.pass}/${r.count}`, r.excellent === null ? '未设置满分或无有效成绩' : `${r.excellent}/${r.count}`].map((v) => `<td>${e(v)}</td>`).join('')}</tr>`,
    )
    .join('');
  const rows = batch.rows
    .map(
      (r, i) =>
        `<tr><td>${e(identified ? `${r.sourceName} · ${r.sourceNo}` : `学生 ${i + 1}`)}</td>${r.cells.map((c) => `<td>${e(c.units === null ? cellLabels[c.status] : formatScore(c.units))}</td>`).join('')}<td>${e(formatScore(reports.at(-1)!.values[i]))}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>成绩分析报告</title><style>body{font:15px/1.6 system-ui;max-width:1200px;margin:auto;padding:24px;color:#263c34}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #bbb;padding:6px;text-align:left}thead{display:table-header-group}@media print{tr{break-inside:avoid}body{padding:0}}</style></head><body><h1>${e(identified ? batch.title : '考试成绩分析')}</h1><p>${e(batch.date)} · v${batch.version} · ${e(saveLabel)} · ${e(new Date().toISOString())}</p><p>本报告仅含该次导入选中的学生。缺考、免考与未录入不记为零。均分与比例按每列有效成绩人数计算；及格线 ${pass}%，优秀线 ${excellent}%。科目合计须各科完整，不包含原表总分列。原表总分可能包含加权或赋分，本报告不覆盖原表。</p><p>${identified ? '含学生身份，请核对使用范围。' : '使用本报告学生代号，不输出姓名和编号字段；列名为用户文本。'}</p><h2>统计</h2><table><thead><tr>${['项目', '有效人数', '均分', '中位数', '最低分', '最高分', '及格人数/有效人数', '优秀人数/有效人数'].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${summary}</tbody></table><h2>成绩表</h2><table><thead><tr><th>学生</th>${batch.columns.map((c) => `<th>${e(c.label)}</th>`).join('')}<th>所选科目合计</th></tr></thead><tbody>${rows}</tbody></table><p>这是离线阅读报告，不是完整工作区备份。</p></body></html>`;
}
