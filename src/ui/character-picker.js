import { CHARACTERS, characterById, charactersForGender } from '../core/characters.js';
import { avatar } from '../art/sprites.js';
import { esc } from '../core/utils.js';

export function characterPickerHTML(selectedId, action, gender) {
  const selected = characterById(selectedId);
  const choices = gender ? charactersForGender(gender) : CHARACTERS;
  return (
    `<details class="character-picker"><summary>${gender ? (gender === 'F' ? '女生形象' : '男生形象') : '教师形象'} · <span>${esc(selected?.name || '自动分配')}</span></summary><div class="character-grid">` +
    choices
      .map(
        (c) =>
          `<button type="button" class="character-choice ${c.id === selectedId ? 'selected' : ''}" data-act="${action}" data-character="${c.id}" aria-label="选择${esc(c.name)}" aria-pressed="${c.id === selectedId}">${avatar({ characterId: c.id, gender: c.gender }, 52)}<span>${esc(c.name)}</span></button>`
      )
      .join('') +
    '</div></details>'
  );
}
export function updateCharacterPicker(button, id) {
  const root = button.closest('.character-picker');
  root.querySelector('summary span').textContent = characterById(id).name;
  root.querySelectorAll('.character-choice').forEach((el) => {
    const selected = el.getAttribute('data-character') === id;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
}
