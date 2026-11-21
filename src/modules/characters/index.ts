import catalog from '../../../assets/catalog.json';
import type { Gender, Snapshot } from '../../app/model';
export { catalog };
export type Character = (typeof catalog.characters)[number];
export const characters = catalog.characters;
export const pool = (gender: Gender) => characters.filter((x) => x.gender === gender);
export const teacherDefault = (gender: Gender): string | null =>
  gender === 'unspecified' ? null : catalog.teacherDefaults[gender];
export function chooseCharacter(
  s: Snapshot,
  classId: string,
  gender: Gender,
  excludeStudentId?: string,
): string | null {
  if (gender === 'unspecified') return null;
  const ids = new Set(
    s.data.memberships
      .filter((m) => m.classId === classId && m.status === 'active')
      .map((m) => m.studentId),
  );
  const used = s.data.students.filter((x) => ids.has(x.id) && x.id !== excludeStudentId);
  return pool(gender)
    .map((c, index) => ({
      id: c.id,
      index,
      count: used.filter((s) => s.characterId === c.id).length,
    }))
    .sort((a, b) => a.count - b.count || a.index - b.index)[0].id;
}
export function displayCharacter(gender: Gender, characterId: string | null): Character | null {
  if (gender === 'unspecified') return null;
  const found = characters.find((x) => x.id === characterId && x.gender === gender);
  return found || pool(gender)[0] || null;
}
export function correctKnownCharacters(s: Snapshot): string[] {
  const repairs: string[] = [];
  for (const student of s.data.students) {
    const known = characters.find((c) => c.id === student.characterId);
    if (known && known.gender !== student.gender) {
      const member = s.data.memberships.find((x) => x.studentId === student.id);
      student.characterId = chooseCharacter(s, member?.classId || '', student.gender, student.id);
      repairs.push(`${student.name}：形象已按档案性别匹配`);
    }
  }
  const teacher = s.data.settings.teacher;
  const c = characters.find((x) => x.id === teacher.characterId);
  if (c && c.gender !== teacher.gender) {
    teacher.characterId = teacherDefault(teacher.gender);
    repairs.push('教师：形象已按性别匹配');
  }
  return repairs;
}
