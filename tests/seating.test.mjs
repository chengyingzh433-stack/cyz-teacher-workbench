import test from 'node:test';
import assert from 'node:assert/strict';
import { columnCount, resizeSeating, pairedSeats, seatKeys } from '../src/core/seating.js';
import { demoState } from '../src/core/demo.js';
import { migrate } from '../src/core/schema.js';
import { ART } from '../src/art/scene.js';

test('odd-column resizing preserves students, valid seats, and backup dimensions', () => {
  const state = demoState();
  const records = state.students.map(({ seat, group, ...student }) => student);
  const retained = state.students
    .filter((s) => +s.seat.split('-')[1] < 7)
    .map((s) => [s.id, s.seat]);
  assert.equal(resizeSeating(state, 7, 7), 0);
  assert.equal(new Set(state.students.map((s) => s.seat)).size, 46);
  retained.forEach(([id, seat]) =>
    assert.equal(state.students.find((s) => s.id === id).seat, seat)
  );
  assert.deepEqual(
    state.students.map(({ seat, group, ...student }) => student),
    records
  );
  const restored = migrate(JSON.parse(JSON.stringify(state)));
  assert.equal(columnCount(restored.settings), 7);
  assert.deepEqual(
    restored.students.map((s) => s.seat),
    state.students.map((s) => s.seat)
  );
  assert.equal(resizeSeating(state, 2, 3), 40);
  assert.equal(state.students.length, 46);
  assert.equal(new Set(state.students.filter((s) => s.seat).map((s) => s.seat)).size, 6);
  assert.equal(resizeSeating(state, 6, 8), 0);
});

test('invalid dimensions fail before changing any data; legacy pairs remain readable', () => {
  const state = demoState(),
    before = JSON.stringify(state);
  for (const [r, c] of [
    [0, 8],
    [13, 8],
    [6, 17],
    [6, 0],
    [2.5, 8],
    [6, NaN]
  ]) {
    assert.throws(() => resizeSeating(state, r, c));
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(columnCount({ pairs: 4 }), 8);
});

test('pairing uses odd-column single seats without duplicates or out-of-range assignments', () => {
  for (const [rows, cols] of [
    [3, 1],
    [2, 3],
    [7, 7],
    [12, 16]
  ]) {
    const people = Array.from({ length: rows * cols }, (_, i) => ({ id: i }));
    const pairs = [];
    for (let i = 0; i < people.length; i += 2) pairs.push([people[i], people[i + 1] || null]);
    const assignments = pairedSeats(rows, cols, pairs),
      keys = new Set(seatKeys(rows, cols));
    assert.equal(assignments.length, people.length);
    assert.equal(new Set(assignments.map(([student]) => student.id)).size, people.length);
    assert.equal(new Set(assignments.map(([, seat]) => seat)).size, people.length);
    assert.ok(assignments.every(([, seat]) => keys.has(seat)));
  }
});

test('student-only scene removes the teacher area and renders every custom seat within its canvas', () => {
  for (const [rows, cols] of [
    [1, 1],
    [2, 3],
    [7, 7],
    [12, 16]
  ]) {
    const data = { rows, cols, pairs: Math.ceil(cols / 2), seats: {}, views: {} };
    const full = ART.scene(data),
      focused = ART.scene({ ...data, studentsOnly: true });
    assert.match(full.svg, /class="teacher"/);
    assert.doesNotMatch(focused.svg, /class="teacher"|pixel-boards|room-front/);
    assert.equal((focused.svg.match(/data-seat=/g) || []).length, rows * cols);
    assert.ok(focused.L.H < full.L.H);
    assert.ok(focused.L.seatX(cols - 1) + 100 <= focused.L.W);
    assert.ok(focused.L.seatY(rows - 1) + 116 <= focused.L.H);
  }
});
