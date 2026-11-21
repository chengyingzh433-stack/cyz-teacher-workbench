import type { ScoreStatus } from '../types';
import type { ColumnMapping, ColumnRole, TableCell, TableMapping, TableSheet } from './table';

const tidy = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\s_·]/g, '')
    .toLowerCase();

export const normalizeName = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').trim();

const excludedColumnLabel =
  /排名|名次|班排|校排|级排|年排|等级|赋分|标准分|百分位|性别|序号|座号|座位|考场|备注|电话/;

function detectRole(text: string): ColumnRole {
  const t = tidy(text);
  if (/^(姓名|学生姓名|考生姓名|名字|name|studentname)$/.test(t)) return 'name';
  if (/^(学号|学生编号|考号|准考证号|考生号|编号|学籍号|studentid|id|no\.?|number)$/.test(t))
    return 'number';
  if (/^(班级|班别|行政班|班级名称|class|classname)$/.test(t)) return 'class';
  if (excludedColumnLabel.test(t)) return 'ignore';
  if (/^(总分|总成绩|合计|总计|total|totalscore)(\(|（|\d|$)/.test(t)) return 'total';
  if (
    /^(语文|数学|英语|物理|化学|生物|政治|思想政治|道德与法治|历史|地理|科学|信息技术|体育|技术|综合|理综|文综|成绩|分数|得分|score)(成绩|分数|得分|\(|（|\d|$)/.test(
      t,
    )
  ) {
    return 'score';
  }
  return 'ignore';
}

const headerCache = new WeakMap<TableSheet, Map<string, string>>();

export function tableText(sheet: TableSheet, r: number, c: number): string {
  const own = sheet.rows[r]?.[c]?.text || '';
  if (own.trim()) return own;
  let cache = headerCache.get(sheet);
  if (!cache) {
    cache = new Map();
    headerCache.set(sheet, cache);
  }
  const key = `${r}:${c}`;
  if (cache.has(key)) return cache.get(key)!;
  const merge = sheet.merges.find(
    (m) => r >= m.startRow && r <= m.endRow && c >= m.startCol && c <= m.endCol,
  );
  const value = merge ? sheet.rows[merge.startRow]?.[merge.startCol]?.text || '' : '';
  cache.set(key, value);
  return value;
}

export function mappedColumns(sheet: TableSheet, start: number, end: number): ColumnMapping[] {
  const width = Math.max(0, ...sheet.rows.map((r) => r.length));
  const columns: ColumnMapping[] = [];
  for (let c = 0; c < width; c++) {
    const parts = [
      ...new Set(
        Array.from({ length: end - start + 1 }, (_, i) =>
          tableText(sheet, start + i, c).trim(),
        ).filter(Boolean),
      ),
    ];
    const leaf = parts.at(-1) || `第 ${c + 1} 列`;
    const combined = parts.join(' / ');
    let selected = detectRole(leaf);
    if (parts.length > 1 && /^(成绩|分数|得分|原始分|原分|卷面分)$/.test(tidy(leaf))) {
      const parent = detectRole(parts.at(-2)!);
      if (parent === 'score' || parent === 'total') selected = parent;
    }
    const label =
      parts.length > 1 && !['name', 'number', 'class'].includes(selected) ? combined : leaf;
    const max =
      combined.match(/满分\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/) ||
      combined.match(/[（(]\s*(\d+(?:\.\d{1,2})?)\s*分?\s*[)）]/);
    columns.push({ index: c, label: label.slice(0, 120), role: selected, max: max?.[1] || '' });
  }
  for (const identity of ['name', 'number', 'class'] as const) {
    const matches = columns.filter((c) => c.role === identity);
    if (matches.length > 1) for (const col of matches) col.role = 'ignore';
  }
  return columns;
}

export function inferMapping(sheet: TableSheet): TableMapping {
  let best = { score: -Infinity, start: 0, end: 0 };
  for (let start = 0; start < Math.min(40, sheet.rows.length); start++) {
    for (let depth = 1; depth <= 3 && start + depth <= sheet.rows.length; depth++) {
      const end = start + depth - 1;
      const columns = mappedColumns(sheet, start, end);
      const names = columns.filter((c) => c.role === 'name').length;
      const numbers = columns.filter((c) => c.role === 'number').length;
      const scores = columns.filter((c) => c.role === 'score' || c.role === 'total').length;
      const nameColumn = columns.find((c) => c.role === 'name')?.index ?? -1;
      let body = 0;
      for (const row of sheet.rows.slice(end + 1, end + 6)) {
        if (row[nameColumn]?.text.trim() && !/姓名|平均|合计/.test(row[nameColumn].text)) body++;
      }
      const selected = columns.filter((c) => c.role === 'score' || c.role === 'total');
      const subjectContext = selected.filter((c) =>
        /语文|数学|英语|物理|化学|生物|政治|历史|地理|理综|文综/.test(c.label),
      ).length;
      if (
        selected.some((c) =>
          excludedColumnLabel.test(tidy(sheet.rows[end + 1]?.[c.index]?.text || '')),
        )
      ) {
        continue;
      }
      const duplicateLabels = selected.length - new Set(selected.map((c) => c.label)).size;
      const nextIsHeader = (sheet.rows[end + 1] || []).filter((c) =>
        /^(成绩|分数|得分|名次|排名|班排|级排|年排|校排|百分位|标准分|姓名|学号|满分)/.test(
          c.text.trim(),
        ),
      ).length;
      let numericEvidence = 0;
      for (const row of sheet.rows.slice(end + 1, end + 4)) {
        for (const col of selected) {
          if (scoreValue(row[col.index] || blankCell).status === 'score') numericEvidence++;
        }
      }
      const score =
        names * 30 +
        numbers * 10 +
        scores * 4 +
        subjectContext * 3 +
        body * 2 +
        Math.min(numericEvidence, 20) -
        duplicateLabels * 12 -
        (nextIsHeader >= 2 ? 40 : 0) -
        depth * 1.5 -
        start * 0.1;
      if (score > best.score) best = { score, start, end };
    }
  }
  return {
    headerStart: best.start,
    headerEnd: best.end,
    sourceClass: '',
    columns: mappedColumns(sheet, best.start, best.end),
  };
}

const summaryLabel =
  /^(?:班级|年级|全班)?(?:平均分?|均分|最高分|最低分|合计|总计|人数|标准差|及格率|优秀率|备注|说明)(?:[:：\s]|$)/;

export function gradeSourceRows(sheet: TableSheet, mapping: TableMapping) {
  const colIdx = (r: ColumnRole) => mapping.columns.find((c) => c.role === r)?.index;
  const nameCol = colIdx('name');
  const numberCol = colIdx('number');
  const classCol = colIdx('class');
  const classMerges = sheet.merges
    .filter(
      (m) => m.startCol === classCol && m.endCol === classCol && m.startRow > mapping.headerEnd,
    )
    .sort((a, b) => a.startRow - b.startRow);
  let mergeIndex = 0;
  return sheet.rows.slice(mapping.headerEnd + 1).flatMap((cells, offset) => {
    if (!cells.some((c) => c.text.trim() || c.formula)) return [];
    const row = mapping.headerEnd + 1 + offset;
    const name = nameCol === undefined ? '' : cells[nameCol]?.text.trim() || '';
    const number = numberCol === undefined ? '' : cells[numberCol]?.text.trim() || '';
    while (mergeIndex < classMerges.length && classMerges[mergeIndex].endRow < row) mergeIndex++;
    const merge = classMerges[mergeIndex];
    const classRow = merge && merge.startRow <= row ? merge.startRow : row;
    const classCell = classCol === undefined ? undefined : sheet.rows[classRow]?.[classCol];
    const sourceClass = classCell?.error ? '' : classCell?.text.trim() || '';
    let automaticExclusion = '';
    if (summaryLabel.test(name) || (!name && cells.some((c) => summaryLabel.test(c.text.trim())))) {
      automaticExclusion = '识别为汇总/说明行';
    } else if (detectRole(name) === 'name') {
      automaticExclusion = '重复表头';
    }
    return [
      {
        line: row + 1,
        rowIndex: row,
        name,
        number,
        sourceClass,
        classFormula: !!classCell?.formula,
        automaticExclusion,
      },
    ];
  });
}

export function sourceClasses(
  rows: ReturnType<typeof gradeSourceRows>,
  includedRows: number[] = [],
): string[] {
  const included = new Set(includedRows);
  return [
    ...new Set(
      rows
        .filter((r) => !r.automaticExclusion || included.has(r.line))
        .map((r) => r.sourceClass)
        .filter(Boolean),
    ),
  ];
}

export function scoreValue(
  cell: TableCell,
  corrected?: string,
): { status: ScoreStatus; units: number | null; error?: string } {
  if (corrected === undefined && cell.error) {
    return { status: 'missing', units: null, error: cell.error };
  }
  const text = (corrected ?? (typeof cell.value === 'number' ? String(cell.value) : cell.text))
    .normalize('NFKC')
    .trim();
  if (!text || /^(?:[-—–/]|未录|未录入|暂无|NA|N\/A|null)$/i.test(text)) {
    return { status: 'missing', units: null };
  }
  if (/^(缺考|缺|缺测|旷考|absent)$/i.test(text)) return { status: 'absent', units: null };
  if (/^(免考|免测|免|exempt)$/i.test(text)) return { status: 'exempt', units: null };
  const match = text.match(/^(\d{1,5})(?:\.(\d{1,2}))?\s*分?$/);
  if (!match) {
    return {
      status: 'missing',
      units: null,
      error: '不是合法分数/缺考/免考/空值；请更正或排除此行',
    };
  }
  const units = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (units > 1000000) return { status: 'missing', units: null, error: '分数超过 10000 分限制' };
  return { status: 'score', units };
}

export const blankCell: TableCell = { text: '', value: null, formula: false };
