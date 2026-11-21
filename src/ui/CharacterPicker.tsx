import { characters, pool } from '../modules/characters';
import type { Gender } from '../app/model';
import { Avatar } from '../scene/Art';

export function CharacterPicker({
  gender,
  value,
  usage,
  onChange,
  onQuickGender,
}: {
  gender: Gender;
  value: string | null;
  usage?: Map<string, number>;
  onChange: (id: string) => void;
  onQuickGender?: (gender: 'male' | 'female') => void;
}) {
  if (gender === 'unspecified') {
    return (
      <div className="soft-card col">
        <p className="tip">未填写性别时显示中性占位头像，补全性别后即可挑选专属像素形象：</p>
        {onQuickGender && (
          <div className="row">
            <button type="button" onClick={() => onQuickGender('male')}>设为男生并选形象</button>
            <button type="button" onClick={() => onQuickGender('female')}>设为女生并选形象</button>
          </div>
        )}
      </div>
    );
  }
  const options = pool(gender);
  const unknown = value && !characters.some((x) => x.id === value);
  return (
    <fieldset className="char-field">
      <legend>
        挑选像素形象 · {options.length} 个{gender === 'male' ? '男' : '女'}角色
        {usage ? <small className="muted">（角标为本班已用人数）</small> : null}
      </legend>
      {unknown && <div className="alert tone-warning">原形象「{value}」暂不可识别，已保留原值并以替代形象展示。</div>}
      <div className="char-grid">
        {options.map((c) => {
          const count = usage?.get(c.id) || 0;
          return (
            <button type="button" key={c.id} aria-pressed={c.id === value} onClick={() => onChange(c.id)} title={c.name}>
              {usage && <span className={`char-tag ${count === 0 ? 'free' : ''}`}>{count === 0 ? '未用' : `${count}人`}</span>}
              <Avatar gender={gender} characterId={c.id} size={60} />
              <span className="char-name">{c.name}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
