import {
  activeMembers,
  AppError,
  assertEditable,
  id,
  type Gender,
  type Snapshot,
} from '../../app/model';
import { characters, chooseCharacter } from '../characters';
import { newPlan } from '../seating';
export function addClass(s: Snapshot, name: string, school = '', termLabel = ''): string {
  if (!name.trim()) throw new AppError('VALIDATION', '班级名称不能为空');
  const classId = id();
  s.data.classes.push({
    id: classId,
    name: name.trim(),
    school: school.trim(),
    termLabel: termLabel.trim(),
    status: 'active',
  });
  s.data.seatPlans.push(newPlan(classId));
  return classId;
}
export type StudentInput = {
  name: string;
  gender: Gender;
  rosterNo: string;
  characterId?: string | null;
};
export function saveStudent(
  s: Snapshot,
  classId: string,
  input: StudentInput,
  membershipId?: string,
): string {
  assertEditable(s, classId);
  const name = input.name.trim();
  const rosterNo = input.rosterNo.trim();
  if (!name) throw new AppError('VALIDATION', '学生姓名不能为空');
  if (
    rosterNo &&
    s.data.memberships.some(
      (x) => x.classId === classId && x.rosterNo === rosterNo && x.id !== membershipId,
    )
  )
    throw new AppError('VALIDATION', `编号 ${rosterNo} 已被使用（包括已移出成员）`);
  const m = membershipId
    ? s.data.memberships.find((x) => x.id === membershipId && x.classId === classId)
    : undefined;
  if (membershipId && !m) throw new AppError('VALIDATION', '学生已不在当前班级');
  const student = m ? s.data.students.find((x) => x.id === m.studentId)! : undefined;
  let characterId = input.characterId;
  if (characterId === undefined)
    characterId =
      student?.gender === input.gender
        ? student.characterId
        : chooseCharacter(s, classId, input.gender, student?.id);
  if (input.gender === 'unspecified') characterId = null;
  const known = characters.find((x) => x.id === characterId);
  if (known && known.gender !== input.gender)
    throw new AppError('VALIDATION', '形象与档案性别不匹配');
  if (student && m) {
    Object.assign(student, { name, gender: input.gender, characterId });
    m.rosterNo = rosterNo;
    return m.id;
  }
  const studentId = id();
  const memberId = id();
  s.data.students.push({
    id: studentId,
    name,
    gender: input.gender,
    characterId: characterId ?? null,
  });
  const order =
    Math.max(-1, ...s.data.memberships.filter((x) => x.classId === classId).map((x) => x.order)) +
    1;
  s.data.memberships.push({ id: memberId, classId, studentId, rosterNo, order, status: 'active' });
  return memberId;
}
export function setMembershipStatus(
  s: Snapshot,
  membershipId: string,
  status: 'active' | 'removed',
) {
  const m = s.data.memberships.find((x) => x.id === membershipId);
  if (!m) throw new AppError('VALIDATION', '未找到成员');
  assertEditable(s, m.classId);
  m.status = status;
  if (status === 'removed')
    for (const p of s.data.seatPlans.filter((x) => x.classId === m.classId))
      p.assignments = p.assignments.filter((x) => x.membershipId !== m.id);
}
export function addDemo(s: Snapshot) {
  const classId = addClass(s, '星河班 · 虚构示例', '示例学校', '2026 秋');
  for (let i = 0; i < 46; i++)
    saveStudent(s, classId, {
      name: `示例学生${String(i + 1).padStart(2, '0')}`,
      rosterNo: String(i + 1).padStart(3, '0'),
      gender: i < 23 ? 'male' : i < 45 ? 'female' : 'unspecified',
    });
  const plan = s.data.seatPlans.find((x) => x.classId === classId)!;
  plan.assignments = activeMembers(s, classId).map((x, i) => ({
    membershipId: x.id,
    row: Math.floor(i / 8),
    col: i % 8,
  }));
  return classId;
}
