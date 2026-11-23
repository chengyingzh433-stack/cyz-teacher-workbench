import rawCatalog from '../../resources/catalog.json';
import type { CharacterCatalog, Gender } from './types';

export const catalog: CharacterCatalog = {
  teacherDefaults: rawCatalog.teacherDefaults,
  characters: rawCatalog.characters.map((c) => ({
    id: c.id,
    name: c.name,
    gender: c.gender as 'male' | 'female',
    sheetId: c.sheetId,
    front: c.front as [number, number, number, number],
    back: c.back as [number, number, number, number],
  })),
  scene: {
    desk: {
      sheetId: rawCatalog.scene.desk.sheetId,
      rect: rawCatalog.scene.desk.rect as [number, number, number, number],
    },
    chairFront: {
      sheetId: rawCatalog.scene.chairFront.sheetId,
      rect: rawCatalog.scene.chairFront.rect as [number, number, number, number],
    },
  },
};

export type CharacterInfo = CharacterCatalog['characters'][number];
export const characters = catalog.characters;

export const characterPool = (gender: Gender): CharacterInfo[] =>
  gender === 'unspecified' ? [] : characters.filter((c) => c.gender === gender);

export function pickLeastUsedCharacter(
  gender: Gender,
  usedCharacterIds: Array<string | null>,
): string | null {
  if (gender === 'unspecified') return null;
  const counts = new Map<string, number>();
  for (const cid of usedCharacterIds) {
    if (cid) counts.set(cid, (counts.get(cid) || 0) + 1);
  }
  return characterPool(gender)
    .map((c, index) => ({ id: c.id, index, count: counts.get(c.id) || 0 }))
    .sort((a, b) => a.count - b.count || a.index - b.index)[0]?.id ?? null;
}

export function resolveDisplayCharacter(
  gender: Gender,
  characterId: string | null,
): CharacterInfo | null {
  if (gender === 'unspecified') return null;
  const exact = characters.find((c) => c.id === characterId && c.gender === gender);
  return exact || characterPool(gender)[0] || null;
}
