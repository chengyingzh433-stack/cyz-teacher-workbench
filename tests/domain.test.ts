import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMembers, copy, emptyWorkspace, id, validate } from '../src/app/model';
import { addClass, addDemo, saveStudent, setMembershipStatus } from '../src/modules/roster';
import { applyImport, parseTable, previewImport } from '../src/modules/roster/import';
import { exchange, move, newPlan, resize, sequential, waiting } from '../src/modules/seating';
import { characters, displayCharacter, teacherDefault } from '../src/modules/characters';
import { encodeBackup, inspectBackup } from '../src/modules/backup';
const fixture = () => {
  const s = emptyWorkspace();
  const c = addDemo(s);
  return { s, c, p: s.data.seatPlans[0], m: activeMembers(s, c) };
};
const preview = (s: ReturnType<typeof emptyWorkspace>, c: string, text: string) =>
  previewImport(s, c, parseTable(text, ','), { name: 0, rosterNo: 1, gender: 2 }, true, 'token');
test('AC-03: two classes and demo are additive, archived classes reject edits', () => {
  const { s, c } = fixture();
  const other = addClass(s, '另一班');
  const before = copy(s.data.memberships);
  saveStudent(s, other, { name: '另一同学', rosterNo: '001', gender: 'male' });
  assert.equal(activeMembers(s, c).length, 46);
  assert.deepEqual(s.data.memberships.slice(0, 46), before);
  s.data.classes[0].status = 'archived';
  assert.throws(() => saveStudent(s, c, { name: '不能添加', rosterNo: '', gender: 'male' }));
  validate(s);
});
test('AC-04: duplicate names have independent identities; rename preserves role and leading zeros', () => {
  const s = emptyWorkspace();
  const c = addClass(s, '同名测试');
  const a = saveStudent(s, c, { name: '同名', rosterNo: '001', gender: 'female' });
  const b = saveStudent(s, c, { name: '同名', rosterNo: '002', gender: 'female' });
  const before = copy(s);
  saveStudent(s, c, { name: '改名', rosterNo: '001', gender: 'female' }, a);
  assert.notEqual(a, b);
  assert.equal(s.data.students[0].id, before.data.students[0].id);
  assert.equal(s.data.students[0].characterId, before.data.students[0].characterId);
  assert.equal(s.data.memberships[0].rosterNo, '001');
  assert.equal(s.data.students[1].name, '同名');
});
test('AC-05: CSV quoted comma/newline and physical line numbers; empty rows ignored', () => {
  const rows = parseTable(
    '姓名,编号,性别\r\n"名字,逗号",001,男\r\n"跨\n行",002,女\r\n,,\r\n"双""引号",,\r\n',
    ',',
  );
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((x) => x.line),
    [1, 2, 3, 6],
  );
  assert.equal(rows[2].cells[0], '跨\n行');
  assert.equal(rows[3].cells[0], '双"引号');
  assert.throws(() => parseTable('"未闭合', ','));
  assert.throws(() => parseTable('"x"a,b', ','));
});
test('AC-05/06: invalid rows need explicit exclusion; same-name empty numbers stay independent', () => {
  const s = emptyWorkspace();
  const c = addClass(s, '导入班');
  const before = copy(s);
  const p = preview(
    s,
    c,
    '姓名,编号,性别\n同名,,男\n同名,,男\n,003,女\n错性别,004,未知\n重复,005,男\n重复,005,女',
  );
  assert.equal(p.rows[2].errors[0], '姓名为空');
  assert.equal(p.rows[3].errors.length, 1);
  assert.equal(p.rows[4].errors.length, 1);
  assert.throws(() => applyImport(s, p, 'token', [], []));
  assert.deepEqual(s, before);
  const next = applyImport(s, p, 'token', [4, 5, 6, 7], []);
  assert.equal(next.data.students.length, 2);
  assert.notEqual(next.data.students[0].id, next.data.students[1].id);
  assert.deepEqual(s, before);
});
test('AC-06: existing number update is explicit; stale preview rejected', () => {
  const s = emptyWorkspace();
  const c = addClass(s, '更新班');
  saveStudent(s, c, { name: '原名', rosterNo: '001', gender: 'male' });
  const p = preview(s, c, '姓名,编号,性别\n新名,001,女');
  assert.equal(p.rows[0].changes.length, 2);
  assert.throws(() => applyImport(s, p, 'changed', [], [2]), /过期/);
  assert.throws(() => applyImport(s, p, 'token', [], []), /勾选更新/);
  const next = applyImport(s, p, 'token', [], [2]);
  assert.equal(next.data.students.length, 1);
  assert.equal(next.data.students[0].id, s.data.students[0].id);
  assert.equal(next.data.students[0].name, '新名');
  assert.equal(displayCharacter('female', next.data.students[0].characterId)?.gender, 'female');
});
test('AC-07/08: 46 students 6x8 → 2x3 → 7x7; legal seats stay, identities conserved', () => {
  const { s, p, m } = fixture();
  const small = resize(p, m, 2, 3);
  assert.equal(small.assignments.length, 6);
  assert.equal(waiting(small, m).length, 40);
  assert.deepEqual(
    small.assignments,
    p.assignments.filter((x) => x.row < 2 && x.col < 3),
  );
  const large = resize(small, m, 7, 7);
  assert.equal(large.assignments.length, 46);
  assert.equal(waiting(large, m).length, 0);
  assert.equal(new Set(large.assignments.map((x) => x.membershipId)).size, 46);
  assert.deepEqual(large.assignments.slice(0, 6), small.assignments);
  s.data.seatPlans[0] = large;
  validate(s);
  for (const [r, c] of [
    [0, 8],
    [-1, 3],
    [2.2, 3],
    [13, 1],
    [1, 17],
  ])
    assert.throws(() => resize(p, m, r, c));
  assert.equal(resize(p, m, 1, 1).assignments.length, 1);
  assert.equal(resize(p, m, 12, 16).assignments.length, 46);
});
test('AC-07: copied plan can change independently', () => {
  const { p, m } = fixture();
  const duplicate = { ...copy(p), id: id(), name: '副本' };
  const changed = resize(duplicate, m, 2, 3);
  assert.equal(p.assignments.length, 46);
  assert.equal(changed.assignments.length, 6);
});
test('AC-09: occupied seat swap, empty seat move, waiting displaces occupant', () => {
  const { p, m } = fixture();
  const a = p.assignments[0];
  const b = p.assignments[1];
  const swapped = move(p, m, a.membershipId, b);
  assert.deepEqual(
    swapped.assignments.find((x) => x.membershipId === a.membershipId),
    { membershipId: a.membershipId, row: b.row, col: b.col },
  );
  assert.equal(swapped.assignments.find((x) => x.membershipId === b.membershipId)!.col, a.col);
  const emptied = move(swapped, m, a.membershipId, { row: 5, col: 7 });
  assert.equal(emptied.assignments.length, 46);
  assert.equal(
    emptied.assignments.some((x) => x.row === b.row && x.col === b.col),
    false,
  );
  const small = resize(p, m, 1, 1);
  const waitingId = waiting(small, m)[0].id;
  const entered = move(small, m, waitingId, { row: 0, col: 0 });
  assert.equal(entered.assignments[0].membershipId, waitingId);
  assert.equal(waiting(entered, m).length, 45);
});
test('AC-09/10: exchange with waiting; no-op leaves undo candidate and source unchanged', () => {
  const { p, m } = fixture();
  const before = copy(p);
  assert.strictEqual(move(p, m, p.assignments[0].membershipId, p.assignments[0]), p);
  assert.throws(() => move(p, m, m[0].id, { row: 99, col: 0 }));
  assert.deepEqual(p, before);
  const small = resize(p, m, 1, 1);
  const switched = exchange(small, m, small.assignments[0].membershipId, waiting(small, m)[0].id);
  assert.equal(switched.assignments.length, 1);
  assert.equal(switched.assignments[0].membershipId, waiting(small, m)[0].id);
  const ordered = sequential(p, [...m].reverse());
  assert.equal(ordered.assignments[0].membershipId, m.at(-1)!.id);
});
test('AC-11: removal clears all class plans; restore enters waiting with same identity and character', () => {
  const { s, c, m } = fixture();
  const original = copy(s.data.students[0]);
  s.data.seatPlans.push({ ...copy(s.data.seatPlans[0]), id: id() });
  const other = addClass(s, '其他班');
  const otherPlan = copy(s.data.seatPlans.at(-1));
  setMembershipStatus(s, m[0].id, 'removed');
  assert.ok(s.data.seatPlans.every((p) => !p.assignments.some((a) => a.membershipId === m[0].id)));
  setMembershipStatus(s, m[0].id, 'active');
  assert.ok(waiting(s.data.seatPlans[0], activeMembers(s, c)).some((x) => x.id === m[0].id));
  assert.deepEqual(s.data.students[0], original);
  assert.deepEqual(
    s.data.seatPlans.find((p) => p.classId === other),
    otherPlan,
  );
  validate(s);
});
test('AC-15/16: full backup round trip excludes foreign keys and ephemeral fields', () => {
  const { s } = fixture();
  s.data.classes[0].status = 'archived';
  const raw = JSON.parse(encodeBackup(s));
  raw.apiKey = 'secret';
  raw.data.apiKey = 'secret';
  raw.data.settings.apiKey = 'secret';
  const restored = inspectBackup(JSON.stringify(raw), 'token');
  assert.deepEqual(restored.snapshot, s);
  assert.equal(encodeBackup(restored.snapshot).includes('secret'), false);
  assert.equal(encodeBackup(s).includes('data:image'), false);
});
test('AC-17: invalid/future/duplicate/dangling/conflicting/out-of-bounds/type-invalid backups refused', () => {
  const { s } = fixture();
  const base = JSON.parse(encodeBackup(s));
  const corruptions = [
    (b: any) => (b.formatVersion = 9),
    (b: any) => b.data.students.push(b.data.students[0]),
    (b: any) => (b.data.memberships[0].studentId = 'missing'),
    (b: any) =>
      b.data.seatPlans[0].assignments.push({
        ...b.data.seatPlans[0].assignments[0],
        membershipId: b.data.memberships[1].id,
      }),
    (b: any) => (b.data.seatPlans[0].assignments[0].row = 100),
    (b: any) => (b.data.students[0].name = 123),
  ];
  for (const corrupt of corruptions) {
    const b = copy(base);
    corrupt(b);
    assert.throws(() => inspectBackup(JSON.stringify(b), 'token'));
  }
  assert.throws(() => inspectBackup('{broken', 'token'));
  assert.throws(() => inspectBackup(' '.repeat(20 * 1024 ** 2 + 1), 'token'));
});
test('AC-17/21: known gender mismatch repairs; unknown IDs round-trip intact with fallback', () => {
  const { s } = fixture();
  s.data.students[0].characterId = 'touhou-01';
  s.data.students[1].characterId = 'future-character';
  const p = inspectBackup(encodeBackup(s), 'token');
  assert.equal(p.repairs.length, 1);
  assert.equal(displayCharacter('male', p.snapshot.data.students[0].characterId)?.gender, 'male');
  assert.equal(p.snapshot.data.students[1].characterId, 'future-character');
  assert.equal(displayCharacter('male', 'future-character')?.gender, 'male');
  assert.equal(displayCharacter('unspecified', 'future-character'), null);
  assert.equal(s.data.students[0].characterId, 'touhou-01');
});
test('AC-21: complete pools, teacher defaults, least-used allocation', () => {
  assert.equal(characters.length, 29);
  assert.equal(characters.filter((x) => x.gender === 'male').length, 9);
  assert.equal(characters.filter((x) => x.gender === 'female').length, 20);
  assert.equal(teacherDefault('male'), 'hashira-03');
  assert.equal(teacherDefault('female'), 'hashira-06');
  const { s } = fixture();
  assert.equal(new Set(s.data.students.slice(0, 9).map((x) => x.characterId)).size, 9);
  assert.equal(new Set(s.data.students.slice(23, 43).map((x) => x.characterId)).size, 20);
  assert.equal(s.data.students[45].characterId, null);
});
test('AC-18: text containing closing script and HTML survives only as data', () => {
  const s = emptyWorkspace();
  const c = addClass(s, '文本');
  saveStudent(s, c, {
    name: '</script><img src=x onerror=alert(1)>',
    rosterNo: '001',
    gender: 'unspecified',
  });
  assert.equal(
    inspectBackup(encodeBackup(s), 't').snapshot.data.students[0].name,
    s.data.students[0].name,
  );
});
test('F4: 1000-student workload retains all identities and stays within seat capacity', () => {
  const s = emptyWorkspace();
  for (let c = 0; c < 10; c++) {
    const classId = addClass(s, `虚构班${c}`);
    for (let i = 0; i < 100; i++)
      saveStudent(s, classId, {
        name: `虚构学生${c}-${i}`,
        rosterNo: String(i).padStart(3, '0'),
        gender: i % 2 ? 'female' : 'male',
      });
    const p = s.data.seatPlans.at(-1)!;
    Object.assign(p, sequential(p, activeMembers(s, classId)));
  }
  assert.equal(s.data.students.length, 1000);
  assert.equal(new Set(s.data.students.map((x) => x.id)).size, 1000);
  assert.deepEqual(inspectBackup(encodeBackup(validate(s)), 't').snapshot, s);
});
