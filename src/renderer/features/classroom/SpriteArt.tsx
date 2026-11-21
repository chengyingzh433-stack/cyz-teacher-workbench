import { useEffect, useId } from 'react';
import { catalog, resolveDisplayCharacter } from '../../../shared/characters';
import type { Gender } from '../../../shared/types';

const SHEETS: Array<{ id: string; width: number; height: number }> = [
  { id: 'touhou', width: 1536, height: 1024 },
  { id: 'mygo', width: 1536, height: 1024 },
  { id: 'ave', width: 1536, height: 1024 },
  { id: 'trio', width: 1536, height: 1024 },
  { id: 'hashira', width: 1536, height: 1024 },
  { id: 'desk', width: 1451, height: 1084 },
];

/** Registers all 6 compressed WebP sprite sheets once via safe workbench-asset:// protocol. */
export function ArtRegistry() {
  useEffect(() => {
    for (const s of SHEETS) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `workbench-asset://sprite/${s.id}.webp`;
    }
  }, []);

  return (
    <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
      <defs>
        {SHEETS.map((s) => (
          <image
            key={s.id}
            id={`sprite-${s.id}`}
            href={`workbench-asset://sprite/${s.id}.webp`}
            width={s.width}
            height={s.height}
          />
        ))}
      </defs>
    </svg>
  );
}

export function SpriteCrop({
  sheet,
  rect,
  x = 0,
  y = 0,
  width,
  height,
}: {
  sheet: string;
  rect: [number, number, number, number];
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
      <use href={`#sprite-${sheet}`} clipPath={`url(#${clipId})`} />
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
  const ch = resolveDisplayCharacter(gender, characterId);
  if (!ch) {
    return (
      <svg x={x} y={y} width={width} height={height} viewBox="0 0 64 80" aria-label="待选性别形象">
        <circle cx="32" cy="24" r="14" fill="var(--border-strong)" />
        <path d="M11 74V56a21 21 0 0 1 42 0v18" fill="var(--border-strong)" />
        <text x="32" y="64" textAnchor="middle" fill="var(--ink-secondary)" fontSize="15" fontWeight="600">
          ?
        </text>
      </svg>
    );
  }
  return (
    <SpriteCrop
      sheet={ch.sheetId}
      rect={ch[facing]}
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
  size = 40,
  className = '',
}: {
  gender: Gender;
  characterId: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`shrink-0 block ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 80"
      aria-hidden="true"
    >
      <CharacterArt gender={gender} characterId={characterId} />
    </svg>
  );
}

export function SeatedPerson({
  person,
  facing,
}: {
  person?: { gender: Gender; characterId: string | null };
  facing: 'front' | 'back';
}) {
  return (
    <g className="pointer-events-none">
      <SpriteCrop
        sheet={catalog.scene.desk.sheetId}
        rect={catalog.scene.desk.rect}
        x={5}
        y={0}
        width={78}
        height={78}
      />
      {person && (
        <>
          <g className="person-enter">
            <g className={facing === 'front' ? 'person-turn' : ''}>
              <CharacterArt {...person} facing={facing} x={9} y={0} width={70} height={76} />
            </g>
          </g>
          <SpriteCrop
            sheet={catalog.scene.chairFront.sheetId}
            rect={catalog.scene.chairFront.rect}
            x={28}
            y={49}
            width={32}
            height={28}
          />
        </>
      )}
    </g>
  );
}
