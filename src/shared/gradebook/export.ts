import type { ExamColumn, ExamDetail, StudentMember } from '../types';
import { formatScore } from '../score-policy';
import { analyzeExamColumn, cellStatusLabels } from './analysis';

const csvCell = (raw: string): string => {
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const escHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildExamCsv(
  detail: ExamDetail,
  members: StudentMember[],
  identified: boolean,
): string {
  const { exam, columns, scores } = detail;
  const scoreMap = new Map(scores.map((s) => [`${s.membershipId}:${s.columnId}`, s]));
  const primaryColId = columns.find((c) => c.role === 'total')?.id || columns[0]?.id || 'computed';
  const analysis = analyzeExamColumn({ columns, scores, members, columnId: primaryColId });

  const header = [
    identified ? '姓名' : '学生代号',
    ...(identified ? ['学号'] : []),
    ...columns.map((c: ExamColumn) => c.label),
    '班内名次',
  ];

  const lines = [
    `# ${exam.title} (${exam.examDate})`,
    header.map(csvCell).join(','),
    ...members.map((m, idx) => {
      const cells = columns.map((col) => {
        const sc = scoreMap.get(`${m.membershipId}:${col.id}`);
        if (!sc) return '未录入';
        return sc.status === 'score' ? formatScore(sc.units) : cellStatusLabels[sc.status];
      });
      const rank = analysis.valuesByMember.get(m.membershipId)?.rank;
      const row = [
        identified ? m.name : `学生${idx + 1}`,
        ...(identified ? [m.rosterNo ? `'${m.rosterNo}` : ''] : []),
        ...cells,
        rank !== null && rank !== undefined ? String(rank) : '—',
      ];
      return row.map(csvCell).join(',');
    }),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export function buildExamHtmlReport(
  detail: ExamDetail,
  members: StudentMember[],
  identified: boolean,
  passPercent = 60,
  excellentPercent = 85,
): string {
  const { exam, columns, scores } = detail;
  const scoreMap = new Map(scores.map((s) => [`${s.membershipId}:${s.columnId}`, s]));
  const primaryColId = columns.find((c) => c.role === 'total')?.id || columns[0]?.id || 'computed';
  const a = analyzeExamColumn({
    columns,
    scores,
    members,
    columnId: primaryColId,
    passPercent,
    excellentPercent,
  });

  const rowsHtml = members
    .map((m, idx) => {
      const rank = a.valuesByMember.get(m.membershipId)?.rank;
      const tds = columns
        .map((c) => {
          const sc = scoreMap.get(`${m.membershipId}:${c.id}`);
          const text = !sc
            ? '未录入'
            : sc.status === 'score'
              ? formatScore(sc.units)
              : cellStatusLabels[sc.status];
          return `<td>${escHtml(text)}</td>`;
        })
        .join('');
      return `<tr><td>${escHtml(identified ? m.name : `学生 ${idx + 1}`)}</td>${
        identified ? `<td>${escHtml(m.rosterNo || '—')}</td>` : ''
      }${tds}<td>${rank ?? '—'}</td></tr>`;
    })
    .join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escHtml(exam.title)} — 成绩分析报告</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;max-width:980px;margin:28px auto;padding:0 20px;color:#1c1917;background:#faf9f6}
h1{font-size:22px;margin:0 0 6px}p.meta{color:#78716c;font-size:13px;margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px}
.kpi{background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:12px 14px}.kpi span{display:block;font-size:12px;color:#78716c}.kpi strong{font-size:20px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e7e5e4}
th,td{padding:9px 12px;border-bottom:1px solid #f0eeeb;text-align:left;font-size:13.5px}th{background:#f5f4f0;color:#57534e;font-weight:600}</style></head>
<body><h1>${escHtml(exam.title)}</h1><p class="meta">日期：${escHtml(exam.examDate)} · 报告范围：${identified ? '实名版（限本人归档）' : '匿名脱敏版'} · 分析科目：${escHtml(a.label)}</p>
<div class="kpis">
<div class="kpi"><span>有效人数</span><strong>${a.count} / ${members.length}</strong></div>
<div class="kpi"><span>平均分</span><strong>${formatScore(a.meanUnits)}</strong></div>
<div class="kpi"><span>中位数</span><strong>${formatScore(a.medianUnits)}</strong></div>
<div class="kpi"><span>最高 / 最低</span><strong>${formatScore(a.maxObservedUnits)} / ${formatScore(a.minUnits)}</strong></div>
<div class="kpi"><span>及格率 (≥${passPercent}%)</span><strong>${a.passCount === null ? '未设满分' : `${((a.passCount / Math.max(1, a.count)) * 100).toFixed(1)}%`}</strong></div>
<div class="kpi"><span>优秀率 (≥${excellentPercent}%)</span><strong>${a.excellentCount === null ? '未设满分' : `${((a.excellentCount / Math.max(1, a.count)) * 100).toFixed(1)}%`}</strong></div>
</div>
<table><thead><tr><th>${identified ? '姓名' : '代号'}</th>${identified ? '<th>学号</th>' : ''}${columns.map((c) => `<th>${escHtml(c.label)}</th>`).join('')}<th>名次</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
}
