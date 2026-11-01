import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { defaultState, migrate } from '../src/core/schema.js';
import { replaceState } from '../src/core/state.js';
import { examTable, examStats, subjectStats, entryProgress } from '../src/core/statistics.js';
import { parseTable, toCSV } from '../src/core/table.js';
import { parseScore, setScore } from '../src/features/scores.js';
import { demoState } from '../src/core/demo.js';
import { mdToHtml } from '../src/ai/markdown.js';
import { TPLS } from '../src/ai/templates.js';
import { ART } from '../src/art/scene.js';
import { Store, save, load } from '../src/core/storage.js';
import { STORE_KEY } from '../src/core/constants.js';

// Evaluate the immutable upstream reference with no DOM, network or user data.
const upstream = execFileSync(
  'git',
  ['show', '0bcff76f7def9afcf73338ec21df34dff5723899:index.html'],
  { encoding: 'utf8' }
);
const script = upstream.match(/<script>([\s\S]*)<\/script>/)[1].replace(/\bboot\(\);\s*$/, '');
const memory = new Map();
const legacy = vm.createContext({
  document: { addEventListener() {} },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
  localStorage: {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k)
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
});
vm.runInContext(script, legacy);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('old backup schema, store key and migration remain compatible', () => {
  assert.equal(STORE_KEY, 'bzr-workbench-v1');
  assert.deepEqual(defaultState(), plain(legacy.defaultState()));
  const old = {
    settings: { className: '测试班' },
    students: [{ id: 'a', name: '甲' }],
    exams: [{ id: 'e' }]
  };
  assert.deepEqual(migrate(plain(old)), plain(legacy.migrate(plain(old))));
});

test('partial scores, absence, zero, ties and denominators preserve upstream behavior', () => {
  const state = defaultState();
  state.students = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id }));
  const exam = {
    id: 'exam',
    subjects: [
      { name: '语文', full: 100 },
      { name: '数学', full: 100 }
    ],
    scores: {
      a: { 语文: 90, 数学: 90 },
      b: { 语文: 90, 数学: 90 },
      c: { 语文: 100, 数学: null },
      d: { 语文: 0 }
    }
  };
  state.exams = [exam];
  replaceState(state);
  legacy.S = plain(state);
  assert.deepEqual(
    examTable(exam).map((r) => r.rank),
    [1, 1, 3, 4]
  );
  assert.equal(examStats(exam).avg, 115);
  assert.equal(subjectStats(exam, '数学').n, 2);
  assert.deepEqual(entryProgress(exam), { n: 3, total: 5 });
  assert.deepEqual(plain(examStats(exam)), plain(legacy.examStats(plain(exam))));
});

test('score parsing keeps zero, full-width numerals, missing and absent distinct', () => {
  for (const value of ['', '0', '９８．５', '缺', '缺考', '—', '/', 'X', '-1', '120', 'abc']) {
    assert.equal(parseScore(value), legacy.parseScore(value));
  }
  const exam = { scores: {} };
  setScore(exam, 'a', '语文', 0);
  assert.equal(exam.scores.a.语文, 0);
  setScore(exam, 'a', '语文', null);
  assert.equal(exam.scores.a.语文, null);
  setScore(exam, 'a', '语文', undefined);
  assert.equal(Object.hasOwn(exam.scores.a, '语文'), false);
});

test('CSV and pasted grids preserve quotes, newlines and empty cells', () => {
  for (const value of [
    '姓名\t语文\t数学\n甲\t0\t缺\n乙\t\t90',
    '姓名,备注\n"甲,乙","第一行\n第二行"',
    'a,b\n"say ""hi""",1'
  ]) {
    assert.deepEqual(parseTable(value, true), plain(legacy.parseTable(value, true)));
  }
  const rows = [
    ['姓名', '备注'],
    ['甲', 'a,"b"\nc']
  ];
  assert.equal(toCSV(rows), legacy.toCSV(rows));
});

test('example class and all four exams produce the same statistics', () => {
  const state = demoState();
  replaceState(state);
  legacy.S = plain(state);
  assert.equal(state.students.length, 46);
  assert.equal(state.exams.length, 4);
  for (const exam of state.exams)
    assert.deepEqual(plain(examStats(exam)), plain(legacy.examStats(plain(exam))));
});

test('save and load round-trip the original backup structure', () => {
  const state = defaultState();
  state.settings.onboarded = true;
  state.students = [{ id: 'test', name: '示例', parents: [], tags: [], comments: [] }];
  replaceState(state);
  save(true);
  assert.deepEqual(JSON.parse(Store.get(STORE_KEY)), state);
  assert.deepEqual(load(), state);
});

test('AI templates and Markdown export keep their existing behavior', () => {
  assert.deepEqual(
    TPLS.map((t) => t.id),
    plain(legacy.TPLS.map((t) => t.id))
  );
  for (const input of [
    '# 标题\n\n**重要**\n\n- 第一项\n- 第二项',
    '<script>alert(1)</script>',
    '| 名称 | 分数 |\n|---|---|\n|甲|90|'
  ])
    assert.equal(mdToHtml(input), legacy.mdToHtml(input));
});

test('public artwork interface remains compatible after the approved asset replacement', () => {
  assert.deepEqual(Object.keys(ART).sort(), Object.keys(legacy.ART).sort());
  for (const rows of [4, 6, 9]) {
    const layout = ART.layout(rows, 4, 0);
    assert.equal(layout.rows, rows);
    assert.ok(layout.seatX(2) > layout.seatX(1));
    assert.ok(layout.seatY(1) > layout.seatY(0));
  }
});

test('every original page and delegated action is still registered in source', async () => {
  async function gather(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? gather(`${dir}/${e.name}`)
            : e.name.endsWith('.js')
              ? readFile(`${dir}/${e.name}`, 'utf8')
              : ''
        )
      )
    )
      .flat()
      .join('\n');
  }
  const source = await gather(fileURLToPath(new URL('../src', import.meta.url)));
  const actions = (text) =>
    [...text.matchAll(/UI\.(act|inp|chg|key)\['([^']+)'\]\s*=/g)].map((m) => m[1] + ':' + m[2]);
  const current = new Set(actions(source));
  for (const name of actions(script)) assert.ok(current.has(name), `missing action ${name}`);
  for (const [, page] of script.matchAll(/UI\.register\('([^']+)'/g))
    assert.ok(source.includes(`UI.register('${page}'`), `missing page ${page}`);
});
