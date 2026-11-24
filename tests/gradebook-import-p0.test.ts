import assert from 'node:assert/strict';
import test from 'node:test';
import { utils, write } from 'xlsx';
import {
  gradeSourceRows,
  inferMapping,
  normalizeColumnLabel,
  scoreValue,
  sourceClasses,
} from '../src/shared/gradebook/recognize';
import { parseGradeWorkbook } from '../src/shared/gradebook/workbook';

function buildFormulaSample() {
  const wb = utils.book_new();
  const ws = utils.aoa_to_sheet([
    ['姓名', '学号', '物理'],
    ['甲', '001', 0],
    ['乙', '002', 80],
    ['丙', '003', 80],
    ['丁', '004', null],
  ]);
  ws['C4'] = { t: 'n', v: 80, f: '80+0' };
  ws['C5'] = { t: 'n', f: 'SUM(D5:E5)' };
  utils.book_append_sheet(wb, ws, '成绩');
  const bytes = new Uint8Array(write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return parseGradeWorkbook(bytes, '01-公式与零分.xlsx', 'utf-8');
}

function buildMultiClassSample() {
  const wb = utils.book_new();
  const makeSheet = (mergedClass: boolean) => {
    const ws = utils.aoa_to_sheet([
      ['班级', '姓名', '学号', '物理', null],
      [null, null, null, '成绩', '年排'],
      ['班级A', '样例甲', '001', 80, 12],
      [mergedClass ? null : '班级A', '样例乙', '002', 60, 45],
      ['班级B', '样例戊', '005', 90, 5],
      [null, '平均分', null, 76.7, null],
    ]);
    ws['!merges'] = [
      { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
      ...(mergedClass ? [{ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }] : []),
    ];
    return ws;
  };
  utils.book_append_sheet(wb, makeSheet(false), '逐行班名');
  utils.book_append_sheet(wb, makeSheet(true), '合并班名');
  const bytes = new Uint8Array(write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return parseGradeWorkbook(bytes, '02-多班物理成绩与年排.xlsx', 'utf-8');
}

test('P0 成绩单识别：真零分保留，无缓存公式拦截，手动更正生效', () => {
  const [sheet] = buildFormulaSample().sheets;
  const mapping = inferMapping(sheet);
  assert.deepEqual(
    mapping.columns.map((c) => c.role),
    ['name', 'number', 'score'],
  );
  const rows = gradeSourceRows(sheet, mapping);
  assert.equal(rows.length, 4);
  const parsed = rows.map((r) => scoreValue(sheet.rows[r.rowIndex][2]));
  assert.deepEqual(
    parsed.map((p) => p.units),
    [0, 8000, 8000, null],
  );
  assert.match(parsed[3].error || '', /公式.*缓存/);
  const fixed = scoreValue(sheet.rows[rows[3].rowIndex][2], '80');
  assert.equal(fixed.status, 'score');
  assert.equal(fixed.units, 8000);
});

test('P0 成绩单识别：多行表头忽略年排，合并班名正确识别，汇总行自动排除', () => {
  const { sheets } = buildMultiClassSample();
  assert.equal(sheets.length, 2);
  for (const sheet of sheets) {
    const mapping = inferMapping(sheet);
    assert.deepEqual(
      mapping.columns.map((c) => c.role),
      ['class', 'name', 'number', 'score', 'ignore'],
    );
    const rows = gradeSourceRows(sheet, mapping);
    assert.deepEqual(sourceClasses(rows), ['班级A', '班级B']);
    const autoExcluded = rows.filter((r) => r.automaticExclusion);
    assert.equal(autoExcluded.length, 1);
    assert.equal(autoExcluded[0].automaticExclusion, '识别为汇总/说明行');
  }
});

test('成绩单识别：自动识别性别列与规范化科目名（用于同考覆盖对齐）', () => {
  const wb = utils.book_new();
  const ws = utils.aoa_to_sheet([
    ['姓名', '学号', '性别', '物理(100分)', '总分'],
    ['张一', '5401', '男', 91, 610],
    ['李二', '5402', '女', 86, 598],
  ]);
  utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = new Uint8Array(write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const [sheet] = parseGradeWorkbook(bytes, '54班月考.xlsx', 'utf-8').sheets;
  const mapping = inferMapping(sheet);
  assert.deepEqual(
    mapping.columns.map((c) => c.role),
    ['name', 'number', 'gender', 'score', 'total'],
  );
  const rows = gradeSourceRows(sheet, mapping);
  assert.deepEqual(
    rows.map((r) => r.gender),
    ['male', 'female'],
  );
  assert.equal(normalizeColumnLabel('物理(100分)'), normalizeColumnLabel('物理'));
  assert.equal(normalizeColumnLabel('物理（满分:100）'), normalizeColumnLabel('物理'));
});
