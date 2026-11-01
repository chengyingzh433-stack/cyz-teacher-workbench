import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHARACTERS,
  characterOf,
  charactersForGender,
  teacherCharacter,
  ensureStudentCharacters
} from '../src/core/characters.js';
import { ASSETS, ATLAS_SIZES } from '../src/art/assets.js';
import { ART } from '../src/art/scene.js';
import { characterPickerHTML } from '../src/ui/character-picker.js';
import { defaultState, migrate } from '../src/core/schema.js';
import { replaceState } from '../src/core/state.js';
import { save, load } from '../src/core/storage.js';

test('29 paired characters have valid crop bounds within real local PNG atlases', async () => {
  assert.equal(CHARACTERS.length, 29);
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, 29);
  for (const [key, url] of Object.entries(ASSETS)) {
    const bytes = await readFile(new URL('..' + url, import.meta.url));
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], ATLAS_SIZES[key]);
    if (key !== 'room') assert.equal(bytes[25], 6, 'sprite must have an alpha channel');
  }
  for (const c of CHARACTERS)
    for (const side of ['front', 'back']) {
      const [x, y, w, h] = c[side],
        [W, H] = ATLAS_SIZES[c.sheet];
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= W && y + h <= H, `${c.id} ${side}`);
    }
});

test('teacher defaults are exactly the two requested characters; explicit choices take priority', () => {
  assert.equal(teacherCharacter({ gender: 'M' }).name, '炼狱杏寿郎');
  assert.equal(teacherCharacter({ gender: 'F' }).name, '甘露寺蜜璃');
  assert.equal(teacherCharacter({ gender: 'F', characterId: 'touhou-01' }).name, '博丽灵梦');
});

test('old students receive balanced persistent IDs, matched by gender and unaffected by seats, names or sort order', () => {
  const state = defaultState();
  state.students = Array.from({ length: 46 }, (_, i) => ({
    id: 'id-' + i,
    name: '同学' + i,
    gender: i % 2 ? 'M' : 'F',
    seat: '0-' + i
  }));
  const before = JSON.parse(JSON.stringify(state));
  assert.equal(ensureStudentCharacters(state), true);
  const counts = new Map();
  for (const s of state.students) counts.set(s.characterId, (counts.get(s.characterId) || 0) + 1);
  assert.equal(counts.size, 29);
  assert.equal(Math.max(...counts.values()), 3);
  for (const student of state.students) assert.equal(characterOf(student).gender, student.gender);
  for (let i = 0; i < 46; i++) {
    const { characterId, ...rest } = state.students[i];
    assert.deepEqual(rest, before.students[i]);
  }
  const identities = new Map(state.students.map((s) => [s.id, s.characterId]));
  state.students.reverse();
  for (const s of state.students) {
    s.name = '改名';
    s.seat = null;
  }
  assert.equal(ensureStudentCharacters(state), false);
  for (const s of state.students) assert.equal(s.characterId, identities.get(s.id));
  state.students.push({ id: 'new', name: '新增' });
  ensureStudentCharacters(state);
  for (const s of state.students.slice(0, -1)) assert.equal(s.characterId, identities.get(s.id));
});

test('custom character survives backup roundtrip, migration and unknown future IDs are preserved', () => {
  const s = defaultState();
  s.settings.onboarded = true;
  s.students = [
    {
      id: 'a',
      name: '甲',
      gender: 'F',
      characterId: 'mygo-04',
      comments: [],
      parents: [],
      tags: []
    }
  ];
  replaceState(s);
  save(true);
  const restored = migrate(load());
  assert.equal(restored.students[0].characterId, 'mygo-04');
  assert.equal(characterOf(restored.students[0]).name, '千早爱音');
  s.students[0].characterId = 'future-asset';
  ensureStudentCharacters(s);
  assert.equal(s.students[0].characterId, 'future-asset');
  assert.ok(characterOf(s.students[0]));
});

test('all 24 supported layouts preserve every seat target, dynamic board hooks and status overlays', () => {
  for (let rows = 4; rows <= 9; rows++)
    for (let pairs = 2; pairs <= 5; pairs++) {
      const seats = {};
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < pairs * 2; c++)
          seats[`${r}-${c}`] = { id: `${r}-${c}`, name: '甲', characterId: 'hashira-03' };
      delete seats['0-1'];
      const { svg, L } = ART.scene({
        rows,
        pairs,
        seats,
        views: { '0-0': { badge: '+2', chip: '请假', cls: 'ghost', tint: '#eee' } },
        teacher: { gender: 'M' },
        board: {
          leftLines: ['数学'],
          rightLines: ['通知'],
          days: 10,
          stars: [{ name: '甲', pts: '+2' }]
        },
        seatNos: true,
        subjects: ['语文']
      });
      assert.equal((svg.match(/data-seat=/g) || []).length, rows * pairs * 2);
      assert.equal((svg.match(/data-sid=/g) || []).length, rows * pairs * 2 - 1);
      for (const hook of [
        'clock-h',
        'clock-m',
        'data-sact="pt-board"',
        'class="teacher"',
        'fx-layer',
        '请假',
        '数学',
        '通知',
        '语文'
      ])
        assert.ok(svg.includes(hook), hook);
      assert.ok(svg.includes('data-character="hashira-03"'));
      assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
      assert.ok(L.seatY(rows - 1) + 116 < L.H);
    }
});

test('character classification is 9 male and 20 female; incorrect assignments are repaired without changing student data', () => {
  assert.deepEqual(
    charactersForGender('M').map((c) => c.name),
    [
      '灶门炭治郎',
      '我妻善逸',
      '富冈义勇',
      '炼狱杏寿郎',
      '宇髓天元',
      '时透无一郎',
      '伊黑小芭内',
      '不死川实弥',
      '悲鸣屿行冥'
    ]
  );
  assert.equal(charactersForGender('F').length, 20);
  const students = [
    { id: 'boy', name: '男同学', gender: 'M', seat: '0-0', characterId: 'mygo-01' },
    { id: 'girl', name: '女同学', gender: 'F', seat: '0-1', characterId: 'hashira-03' },
    { id: 'chosen', gender: 'M', characterId: 'trio-01' },
    { id: 'unknown', gender: 'F', characterId: 'future-asset' }
  ];
  const before = structuredClone(students);
  assert.equal(ensureStudentCharacters({ students }), true);
  for (let i = 0; i < students.length; i++) {
    assert.equal(characterOf(students[i]).gender, students[i].gender);
    const { characterId, ...rest } = students[i];
    const { characterId: oldId, ...oldRest } = before[i];
    assert.deepEqual(rest, oldRest);
  }
  assert.equal(students[2].characterId, 'trio-01');
  assert.equal(students[3].characterId, 'future-asset');
  assert.equal(ensureStudentCharacters({ students }), false);
  students[2].gender = 'F';
  ensureStudentCharacters({ students });
  assert.equal(characterOf(students[2]).gender, 'F');
});

test('student picker shows only matching characters with correctly named portraits', () => {
  for (const gender of ['M', 'F']) {
    const pool = charactersForGender(gender);
    const html = characterPickerHTML(pool[0].id, 'f-character', gender);
    assert.equal((html.match(/class="character-choice /g) || []).length, pool.length);
    for (const c of pool) assert.ok(html.includes(`role="img" aria-label="${c.name}"`));
    for (const c of charactersForGender(gender === 'M' ? 'F' : 'M'))
      assert.ok(!html.includes(`data-character="${c.id}"`));
  }
});
