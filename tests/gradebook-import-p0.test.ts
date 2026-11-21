import assert from 'node:assert/strict';
import test from 'node:test';
import { utils, write } from 'xlsx';
import { emptyWorkspace, validate } from '../src/app/model';
import { analyzeGrades } from '../src/modules/gradebook/analysis';
import { exportGradebookCsv } from '../src/modules/gradebook/export';
import { gradeSourceRows, inferMapping, sourceClasses } from '../src/modules/gradebook/recognize';
import {
  commitGradeImport,
  previewGradeImport,
  type ImportInput,
} from '../src/modules/gradebook/service';
import type { TableSheet } from '../src/modules/gradebook/table';
import { parseGradeWorkbook } from '../src/modules/gradebook/workbook';
import { addClass, saveStudent } from '../src/modules/roster';

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
function options(sheet: TableSheet): ImportInput {
  return {
    title: '验收',
    date: '2026-11-18',
    examId: '',
    reason: '',
    mapping: inferMapping(sheet),
    bindings: {},
    excluded: {},
    includedRows: [],
    corrections: {},
    acceptFormulas: true,
  };
}
test('成绩单：缺缓存公式不能由通用确认放行；更正后与真零分分别入账', async () => {
  const file = '01-公式与零分.xlsx';
  const [sheet] = buildFormulaSample().sheets;
  const s = emptyWorkspace(),
    c = addClass(s, '公式');
  const source = { file, sheet, hash: '1'.repeat(64) },
    input = options(sheet);
  const preview = () => previewGradeImport(s, c, source, input, 'token');
  const before = preview();
  assert.deepEqual(
    before.rows.map((r) => r.cells[0].units),
    [0, 8000, 8000, null],
  );
  assert.deepEqual(
    before.rows.map((r) => r.errors.length > 0),
    [false, false, false, true],
  );
  assert.match(before.rows[3].errors.join(' '), /公式.*缓存/);
  assert.throws(() => commitGradeImport(s, before, 'token'));
  assert.equal(s.data.memberships.length, 0);
  input.corrections['5:2'] = '80';
  commitGradeImport(s, preview(), 'token');
  const [batch] = validate(s).data.gradebook.imports;
  const result = analyzeGrades(batch, 'computed');
  assert.deepEqual([result.count, result.meanUnits, result.minUnits], [4, 6000, 0]);
  assert.equal(batch.rows[3].cells[0].raw, '');
  assert.equal(batch.rows[3].cells[0].corrected, '80');
});
test('成绩单：两种班名布局都按班提交，同科年排与汇总行都不计分', async () => {
  const file = '02-多班物理成绩与年排.xlsx';
  const { sheets } = buildMultiClassSample();
  assert.equal(sheets.length, 2);
  for (const sheet of sheets) {
    const s = emptyWorkspace(),
      c = addClass(s, '班级A');
    for (const [name, rosterNo] of [
      ['样例甲', '001'],
      ['样例乙', '002'],
    ])
      saveStudent(s, c, { name, rosterNo, gender: 'unspecified' });
    const source = { file, sheet, hash: '2'.repeat(64) },
      input = options(sheet);
    assert.deepEqual(
      input.mapping.columns.map((col) => col.role),
      ['class', 'name', 'number', 'score', 'ignore'],
    );
    assert.deepEqual(sourceClasses(gradeSourceRows(sheet, input.mapping), []), ['班级A', '班级B']);
    const preview = () => previewGradeImport(s, c, source, input, 'token');
    assert.throws(() => commitGradeImport(s, preview(), 'token'), /来源班级/);
    assert.equal(s.data.gradebook.imports.length, 0);
    input.mapping.sourceClass = '班级A';
    commitGradeImport(s, preview(), 'token');
    const [batch] = validate(s).data.gradebook.imports;
    assert.equal(s.data.memberships.length, 2);
    assert.deepEqual(
      batch.rows.map((r) => r.sourceNo),
      ['001', '002'],
    );
    assert.deepEqual(batch.excluded, [
      { line: 5, reason: '其他来源班级' },
      { line: 6, reason: '识别为汇总/说明行' },
    ]);
    const result = analyzeGrades(batch, 'computed');
    assert.deepEqual(result.values, [8000, 6000]);
    assert.equal(result.meanUnits, 7000);
    const csv = exportGradebookCsv(batch, true, '验收');
    assert.equal(csv.split('\r\n').length, 3);
    assert.doesNotMatch(csv, /年排|样例戊|平均分/);
  }
});
