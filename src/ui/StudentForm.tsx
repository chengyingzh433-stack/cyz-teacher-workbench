import { useMemo, useState } from 'react';
import { activeMembers, type Gender, type Membership, type Snapshot } from '../app/model';
import { chooseCharacter } from '../modules/characters';
import type { StudentInput } from '../modules/roster';
import { CharacterPicker } from './CharacterPicker';
import { ErrorText } from './Modal';

export function StudentForm({
  snapshot,
  classId,
  member,
  submit,
  cancel,
}: {
  snapshot: Snapshot;
  classId: string;
  member?: Membership;
  submit: (input: StudentInput) => Promise<void>;
  cancel: () => void;
}) {
  const old = snapshot.data.students.find((x) => x.id === member?.studentId);
  const [name, setName] = useState(old?.name || '');
  const [rosterNo, setNo] = useState(member?.rosterNo || '');
  const [gender, setGender] = useState<Gender>(old?.gender || 'unspecified');
  const [characterId, setCharacter] = useState<string | null>(old?.characterId || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    const map = new Map(snapshot.data.students.map((s) => [s.id, s]));
    for (const m of activeMembers(snapshot, classId)) {
      if (m.id === member?.id) continue;
      const cid = map.get(m.studentId)?.characterId;
      if (cid) counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    return counts;
  }, [snapshot, classId, member?.id]);

  const changeGender = (g: Gender) => {
    setGender(g);
    setCharacter(g === old?.gender ? old.characterId : chooseCharacter(snapshot, classId, g, old?.id));
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try { await submit({ name, rosterNo, gender, characterId }); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <div className="form-row">
        <label>学生姓名<input autoFocus required maxLength={120} placeholder="如：陈雨桐" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>学号 / 班内编号<input maxLength={100} placeholder="选填，如 001" value={rosterNo} onChange={(e) => setNo(e.target.value)} /></label>
        <label>
          档案性别
          <select value={gender} onChange={(e) => changeGender(e.target.value as Gender)}>
            <option value="unspecified">未填写</option>
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        </label>
      </div>
      <CharacterPicker gender={gender} value={characterId} usage={usage} onChange={setCharacter} onQuickGender={changeGender} />
      <ErrorText message={error} />
      <div className="dialog-actions">
        <button type="button" onClick={cancel}>取消</button>
        <button className="primary" disabled={busy}>{busy ? '保存中…' : member ? '保存修改' : '添加学生'}</button>
      </div>
    </form>
  );
}
