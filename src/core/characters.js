import { CHARACTERS } from '../art/character-data.js';
export { CHARACTERS };
const byId = new Map(CHARACTERS.map((c) => [c.id, c]));
export const TEACHER_CHARACTERS = { M: 'hashira-03', F: 'hashira-06' };
function seed(value) {
  let n = 2166136261;
  for (const ch of String(value || '')) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function characterById(id) {
  return byId.get(id) || null;
}
export function charactersForGender(gender) {
  return CHARACTERS.filter((c) => c.gender === (gender === 'F' ? 'F' : 'M'));
}
export function characterOf(student) {
  const chosen = byId.get(student.characterId);
  const pool = charactersForGender(student.gender);
  return chosen && pool.includes(chosen)
    ? chosen
    : pool[seed(student.id || student.name) % pool.length];
}
export function teacherCharacter(teacher) {
  return (
    byId.get(teacher.characterId) ||
    byId.get(TEACHER_CHARACTERS[teacher.gender === 'F' ? 'F' : 'M'])
  );
}
// Match the recorded student gender; preserve compatible choices across moves and renames.
export function ensureStudentCharacters(state) {
  if (!state || !Array.isArray(state.students)) return false;
  const counts = new Map(CHARACTERS.map((c) => [c.id, 0]));
  for (const student of state.students) {
    if (byId.get(student.characterId)?.gender === (student.gender === 'F' ? 'F' : 'M'))
      counts.set(student.characterId, counts.get(student.characterId) + 1);
  }
  let changed = false;
  for (const student of state.students) {
    const current = byId.get(student.characterId);
    const eligible = charactersForGender(student.gender);
    if (student.characterId && (!current || eligible.includes(current))) continue;
    // Unknown future IDs remain in backups; characterOf displays a same-gender fallback.
    const min = Math.min(...eligible.map((c) => counts.get(c.id)));
    const pool = eligible.filter((c) => counts.get(c.id) === min);
    const chosen = pool[seed(student.id) % pool.length];
    student.characterId = chosen.id;
    counts.set(chosen.id, counts.get(chosen.id) + 1);
    changed = true;
  }
  return changed;
}
