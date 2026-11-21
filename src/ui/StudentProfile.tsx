import type { Membership, SeatPlan, Snapshot } from '../app/model';
import { displayCharacter } from '../modules/characters';
import { Avatar } from '../scene/Art';
import { Icon } from './Icons';
import { Badge } from './Primitives';

export function StudentProfile({
  snapshot,
  member,
  plan,
  onEdit,
  readOnly,
  disabled,
}: {
  snapshot: Snapshot;
  member: Membership;
  plan?: SeatPlan;
  onEdit: () => void;
  readOnly: boolean;
  disabled: boolean;
}) {
  const student = snapshot.data.students.find((s) => s.id === member.studentId)!;
  const classroom = snapshot.data.classes.find((c) => c.id === member.classId)!;
  const seat = plan?.assignments.find((a) => a.membershipId === member.id);
  const character = displayCharacter(student.gender, student.characterId);
  return (
    <section className="col">
      <div className="profile-hero">
        <div className="profile-avatar"><Avatar {...student} size={94} /></div>
        <div>
          <h3>{student.name}</h3>
          <p className="muted">{classroom.name}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <Badge>编号 {member.rosterNo || '未填写'}</Badge>
            <Badge tone={seat ? 'success' : member.status === 'removed' ? 'danger' : 'info'}>
              {seat ? `${seat.row + 1} 行 ${seat.col + 1} 列` : member.status === 'removed' ? '已移出' : '未排座'}
            </Badge>
          </div>
        </div>
      </div>
      <dl className="facts">
        <div><dt>档案性别</dt><dd>{student.gender === 'male' ? '男' : student.gender === 'female' ? '女' : '未填写'}</dd></div>
        <div><dt>像素形象</dt><dd>{character?.name || '中性占位形象'}</dd></div>
        <div><dt>座位方案</dt><dd>{plan?.name || '暂无方案'}</dd></div>
        <div><dt>当前座位</dt><dd>{seat ? `第 ${seat.row + 1} 行 · 第 ${seat.col + 1} 列` : member.status === 'removed' ? '已移出本班' : '未安排'}</dd></div>
        <div><dt>学期</dt><dd>{classroom.termLabel || '未填写'}</dd></div>
      </dl>
      {readOnly ? (
        <div className="alert tone-warning">该班级已归档，档案仅支持查看。</div>
      ) : (
        <button className="primary block" disabled={disabled} onClick={onEdit}>
          <Icon name="edit" size={15} />编辑档案与更换形象
        </button>
      )}
    </section>
  );
}
