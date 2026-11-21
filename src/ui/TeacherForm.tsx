import { useState } from 'react';
import type { Gender, Teacher } from '../app/model';
import { teacherDefault } from '../modules/characters';
import { Avatar } from '../scene/Art';
import { CharacterPicker } from './CharacterPicker';
import { ErrorText } from './Modal';

export function TeacherForm({ teacher, submit }: { teacher: Teacher; submit: (t: Teacher) => Promise<void> }) {
  const [draft, setDraft] = useState(teacher);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setGender = (gender: Gender) =>
    setDraft({ ...draft, gender, characterId: gender === teacher.gender ? teacher.characterId : teacherDefault(gender) });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try { await submit(draft); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <div className="soft-card row" style={{ marginBottom: 12 }}>
        <Avatar gender={draft.gender} characterId={draft.characterId} size={58} />
        <div>
          <strong>{draft.name.trim() || '我的教室'}</strong>
          <p className="tip">设置后同步显示在左侧栏头像与教室讲台上方</p>
        </div>
      </div>
      <div className="form-row">
        <label>教师称呼<input autoFocus value={draft.name} maxLength={120} placeholder="如：陈老师" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>
          教师性别
          <select value={draft.gender} onChange={(e) => setGender(e.target.value as Gender)}>
            <option value="unspecified">未填写</option>
            <option value="male">男（默认炼狱杏寿郎）</option>
            <option value="female">女（默认甘露寺蜜璃）</option>
          </select>
        </label>
      </div>
      <CharacterPicker gender={draft.gender} value={draft.characterId} onChange={(characterId) => setDraft({ ...draft, characterId })} onQuickGender={setGender} />
      <ErrorText message={error} />
      <div className="dialog-actions">
        <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存教师设置'}</button>
      </div>
    </form>
  );
}
