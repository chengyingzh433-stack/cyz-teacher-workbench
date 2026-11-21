import test from 'node:test';
import assert from 'node:assert/strict';
import { askPhysicsMean, resolvePhysicsQuery } from '../src/modules/assistant/physicsMean';
import { AssistantConnection } from '../src/modules/assistant/provider';
import type { GradeImport } from '../src/modules/gradebook/model';

const exam: GradeImport = {
  id: 'import1',
  classId: 'A',
  examId: 'exam1',
  version: 1,
  title: '物理周测',
  date: '2026-11-19',
  createdAt: '2026-11-19T00:00:00Z',
  reason: '',
  source: {
    file: 'local-file.xlsx',
    sheet: 'sheet',
    hash: '0'.repeat(64),
    configuration: '{}',
    headerStart: 0,
    headerEnd: 1,
    sourceClass: 'A',
  },
  columns: [{ key: 'p', label: '物理 / 得分', role: 'score', sourceColumn: 2, maxUnits: null }],
  excluded: [],
  rows: [8000, 6000, null].map((units, i) => ({
    line: i + 3,
    membershipId: 'member' + i,
    sourceName: '私有姓名' + i,
    sourceNo: '私有编号' + i,
    cells: [
      {
        status: units === null ? 'absent' : 'score',
        units,
        raw: '私有原值',
        corrected: null,
        formula: false,
      },
    ],
  })),
};
const runtime = () => {
  const c = new AssistantConnection();
  c.configure({ provider: 'deepseek', url: '', model: 'deepseek-flash', key: 'fixture-token' });
  return c;
};
const context = {
  className: '班级A',
  exam: exam.title,
  date: exam.date,
  version: 1,
  column: '物理 / 得分',
};
const envelope = (message: object) =>
  Response.json({ choices: [{ message: { role: 'assistant', ...message } }] });
const toolCall = (name = 'grades__physics_mean', args = '{}') => ({
  content: null,
  tool_calls: [{ id: 'fixture-call', type: 'function', function: { name, arguments: args } }],
});

test('同名考试先选；明确指定版本时查询该版本，其他班和修订不构成同名歧义', () => {
  const second = { ...exam, examId: 'exam2', id: 'import2', date: '2026-11-18' };
  assert.equal(resolvePhysicsQuery(exam, [exam, second], false, '').kind, 'exams');
  assert.equal(resolvePhysicsQuery(second, [exam, second], true, '').kind, 'ready');
  assert.equal(
    resolvePhysicsQuery(
      exam,
      [exam, { ...second, classId: 'B' }, { ...exam, version: 2, id: 'revision' }],
      false,
      '',
    ).kind,
    'ready',
  );
});
test('空班、无物理列和全缺考在本地结束；有效零分保留', () => {
  assert.equal(resolvePhysicsQuery(undefined, [], false, '').kind, 'empty');
  for (const label of ['数学', '物理 / 年排', '物理正确率']) {
    assert.equal(
      resolvePhysicsQuery({ ...exam, columns: [{ ...exam.columns[0], label }] }, [], false, '')
        .kind,
      'empty',
    );
  }
  assert.equal(
    resolvePhysicsQuery({ ...exam, rows: exam.rows.slice(2) }, [], false, '').kind,
    'empty',
  );
  const zero = resolvePhysicsQuery(
    { ...exam, rows: [{ ...exam.rows[0], cells: [{ ...exam.rows[0].cells[0], units: 0 }] }] },
    [],
    false,
    '',
  );
  assert.equal(zero.kind, 'ready');
  assert.deepEqual(zero.summary, { average: 0, count: 1 });
});
test('两轮协议仅发送上下文与汇总，80、60、缺考得到70分2人', async (t) => {
  const task = resolvePhysicsQuery(exam, [exam], false, '');
  assert.equal(task.kind, 'ready');
  let rounds = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    rounds++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(init.body));
    assert.deepEqual(
      body.tools.map((x: { function: { name: string } }) => x.function.name),
      ['grades__physics_mean'],
    );
    assert.doesNotMatch(
      String(init.body),
      /私有|local-file.xlsx|workspace__commit|8000|6000|fixture-token/,
    );
    if (rounds === 1) {
      assert.equal(body.messages[0].role, 'system');
      assert.equal(JSON.parse(body.messages[1].content).className, '班级A');
      assert.equal(body.tool_choice, 'required');
      return envelope(toolCall());
    }
    assert.equal(body.tool_choice, 'none');
    assert.equal(body.messages.at(-1).tool_call_id, 'fixture-call');
    assert.deepEqual(JSON.parse(body.messages.at(-1).content), { average: 70, count: 2 });
    return envelope({ content: '{"average":70,"count":2}' });
  });
  assert.match(
    await askPhysicsMean(runtime(), context, () => task.summary, new AbortController().signal),
    /70 分，2 人/,
  );
  assert.equal(rounds, 2);
});
test('越权工具、附加参数、凭空回答与错误数字都被拒绝', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch');
  for (const first of [
    toolCall('workspace__commit'),
    toolCall('grades__physics_mean', '{"classId":"B"}'),
    { content: '平均70分' },
  ]) {
    fetchMock.mock.mockImplementation(async () => envelope(first));
    await assert.rejects(
      askPhysicsMean(
        runtime(),
        context,
        () => {
          assert.fail('不应执行统计工具');
        },
        new AbortController().signal,
      ),
      /只读查询|只读统计工具/,
    );
  }
  let first = true;
  fetchMock.mock.mockImplementation(async () => {
    if (first) {
      first = false;
      return envelope(toolCall());
    }
    return envelope({ content: '{"average":7000,"count":2}' });
  });
  await assert.rejects(
    askPhysicsMean(
      runtime(),
      context,
      () => ({ average: 70, count: 2 }),
      new AbortController().signal,
    ),
    /无法核对/,
  );
});
