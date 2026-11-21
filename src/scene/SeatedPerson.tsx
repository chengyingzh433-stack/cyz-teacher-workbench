import type { Gender } from '../app/model';
import { catalog } from '../modules/characters';
import { AnimatedCharacter, Crop } from './Art';

/** One shared 88 × 80 composition for the classroom and the full art audit. */
export function SeatedPerson({
  person,
  facing,
}: {
  person?: { gender: Gender; characterId: string | null };
  facing: 'front' | 'back';
}) {
  return (
    <g className="seated-art" pointerEvents="none">
      <Crop
        sheet={catalog.scene.desk.sheetId}
        rect={catalog.scene.desk.rect}
        x={5}
        y={0}
        width={78}
        height={78}
      />
      {person && (
        <>
          <AnimatedCharacter {...person} facing={facing} x={9} y={0} width={70} height={76} />
          <Crop
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
