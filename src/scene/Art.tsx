import { catalog, displayCharacter } from '../modules/characters';
import type { Gender } from '../app/model';
import { useId } from 'react';
declare global {
  interface Window {
    __CYZ_ASSETS__: Record<string, string>;
  }
}
export function ArtRegistry() {
  return (
    <svg className="art-registry" width="0" height="0" aria-hidden="true">
      <defs>
        {catalog.assets
          .filter((x) => x.bundled)
          .map((x) => (
            <image
              key={x.path}
              id={`asset-${x.path.split('/').pop()!.replace('.png', '')}`}
              href={window.__CYZ_ASSETS__[x.path]}
              width={x.width}
              height={x.height}
            />
          ))}
      </defs>
    </svg>
  );
}
export function Crop({
  sheet,
  rect,
  x = 0,
  y = 0,
  width,
  height,
}: {
  sheet: string;
  rect: number[];
  x?: number;
  y?: number;
  width: number;
  height: number;
}) {
  const clipId = useId();
  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={rect.join(' ')}
      preserveAspectRatio="xMidYMax meet"
      overflow="hidden"
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} />
        </clipPath>
      </defs>
      <use href={`#asset-${sheet}`} clipPath={`url(#${clipId})`} />
    </svg>
  );
}
export function CharacterArt({
  gender,
  characterId,
  facing = 'front',
  x = 0,
  y = 0,
  width = 64,
  height = 80,
}: {
  gender: Gender;
  characterId: string | null;
  facing?: 'front' | 'back';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const character = displayCharacter(gender, characterId);
  if (!character)
    return (
      <svg x={x} y={y} width={width} height={height} viewBox="0 0 64 80" aria-label="未填写性别">
        <circle cx="32" cy="24" r="15" fill="#c4cbd2" />
        <path d="M9 76V57a23 23 0 0 1 46 0v19" fill="#c4cbd2" />
        <text x="32" y="66" textAnchor="middle" fill="#35444d" fontSize="17">
          ?
        </text>
      </svg>
    );
  return (
    <Crop
      sheet={character.sheetId}
      rect={character[facing]}
      x={x}
      y={y}
      width={width}
      height={height}
    />
  );
}
export function Avatar({
  gender,
  characterId,
  size = 48,
}: {
  gender: Gender;
  characterId: string | null;
  size?: number;
}) {
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 64 80" aria-hidden="true">
      <CharacterArt gender={gender} characterId={characterId} />
    </svg>
  );
}
export function AnimatedCharacter(props: Parameters<typeof CharacterArt>[0]) {
  return (
    <g className="person">
      <g className={props.facing === 'front' ? 'turn' : ''}>
        <CharacterArt {...props} />
      </g>
    </g>
  );
}
