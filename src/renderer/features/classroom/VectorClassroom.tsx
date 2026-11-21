import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClassRecord, SeatPlan, StudentMember, TeacherProfile } from '../../../shared/types';
import { moveSeat } from '../../../shared/seating';
import { CharacterArt, SeatedPerson } from './SpriteArt';
import { useSeatDrag } from './useSeatDrag';

function trimCaption(name: string, width: number) {
  const chars = Array.from(name);
  const limit = Math.max(4, Math.floor((width - 8) / 12));
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : name;
}

/**
 * Adaptive Vector Architectural Classroom Stage.
 * Scales seamlessly to any rows × cols (1×1 up to 12×16) with ZERO image stretching,
 * reacts automatically to the Design Token Theme Engine, and renders the 29 pixel characters & desks cleanly.
 */
export function VectorClassroom({
  cls,
  teacher,
  plan,
  members,
  themeId,
  editing,
  selected,
  highlightedId,
  front,
  zoom,
  fitView,
  onScale,
  onSelectSeat,
  onDropSeat,
  onOpenProfile,
}: {
  cls: ClassRecord;
  teacher: TeacherProfile;
  plan: SeatPlan;
  members: StudentMember[];
  themeId: string;
  editing: boolean;
  selected: string | null;
  highlightedId: string | null;
  front: boolean;
  zoom: number;
  fitView: boolean;
  onScale: (scale: number) => void;
  onSelectSeat: (membershipId: string | null, row: number, col: number) => void;
  onDropSeat: (membershipId: string, row: number, col: number) => void;
  onOpenProfile: (membershipId: string) => void;
}) {
  const isPixelTheme = themeId === 'cozy-pixel';
  const isSakuraTheme = themeId === 'sakura-campus';
  const isAuroraTheme = themeId === 'glass-aurora';
  const woodPatternId = useId();
  const sunGradId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 600 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.membershipId, m])),
    [members],
  );
  const seatDrag = useSeatDrag(viewportRef, onDropSeat);
  const { drag, cancel } = seatDrag;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(260, entry.contentRect.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!hoveredId) return;
    const t = window.setTimeout(() => setHoveredId(null), 1200);
    return () => window.clearTimeout(t);
  }, [hoveredId]);

  const aisle = 28;
  const aisles = Math.floor((plan.cols - 1) / 2);
  const sidePad = editing ? 40 : 68;
  const frontArea = editing ? 36 : 146;
  const bottomPad = 28;

  const stepX = 92;
  const stepY = 104;
  const gridWidth = plan.cols * stepX + aisles * aisle;
  const gridHeight = plan.rows * stepY;

  const stageW = Math.max(size.width - 24, gridWidth + sidePad * 2);
  const stageH = Math.max(size.height - 24, frontArea + gridHeight + bottomPad);
  const offsetX = (stageW - gridWidth) / 2;
  const offsetY = frontArea + Math.max(0, (stageH - frontArea - bottomPad - gridHeight) / 2);

  const fitScale = Math.min(1, (size.width - 20) / stageW, (size.height - 20) / stageH);
  const viewScale = (fitView ? fitScale : 1) * zoom;

  useEffect(() => {
    onScale(viewScale);
  }, [viewScale, onScale]);

  useEffect(() => {
    cancel();
  }, [editing, plan.id, plan.rows, plan.cols, viewScale, cancel]);

  // Smooth scroll highlighted student into view
  useEffect(() => {
    if (!highlightedId || !viewportRef.current) return;
    const target = plan.assignments.find((a) => a.membershipId === highlightedId);
    if (!target) return;
    const cx = (offsetX + target.col * stepX + Math.floor(target.col / 2) * aisle + stepX / 2) * viewScale;
    const cy = (offsetY + target.row * stepY + stepY / 2) * viewScale;
    viewportRef.current.scrollTo({
      left: Math.max(0, cx - size.width / 2),
      top: Math.max(0, cy - size.height / 2),
      behavior: 'smooth',
    });
  }, [highlightedId, plan.assignments, offsetX, offsetY, viewScale, size.width, size.height]);

  const previewTarget =
    drag?.over && (drag.over.row !== drag.from.row || drag.over.col !== drag.from.col)
      ? drag.over
      : null;
  const effectiveAssignments = useMemo(
    () => (drag && previewTarget ? moveSeat(plan, members, drag.id, previewTarget) : plan.assignments),
    [drag, previewTarget, plan, members],
  );
  const cellMap = useMemo(
    () => new Map(effectiveAssignments.map((a) => [`${a.row},${a.col}`, a.membershipId])),
    [effectiveAssignments],
  );
  const origCellMap = useMemo(
    () => new Map(plan.assignments.map((a) => [`${a.row},${a.col}`, a.membershipId])),
    [plan.assignments],
  );

  const draggedMember = drag ? memberMap.get(drag.id) : undefined;
  const targetOrigId = previewTarget ? origCellMap.get(`${previewTarget.row},${previewTarget.col}`) : undefined;
  const targetMember = targetOrigId ? memberMap.get(targetOrigId) : undefined;
  const dragHint = previewTarget
    ? targetMember
      ? `松手与 ${targetMember.name} 互换`
      : `松手移至第 ${previewTarget.row + 1} 行 ${previewTarget.col + 1} 列`
    : '拖到任意座位 · 按 Esc 取消';

  const boardW = Math.min(460, stageW * 0.46);
  const boardX = (stageW - boardW) / 2;

  return (
    <div
      ref={viewportRef}
      onScroll={cancel}
      className={`theme-card flex-1 min-w-0 h-full overflow-auto rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-sm)] flex items-safe-center justify-safe-center relative bg-[var(--classroom-floor-b)]`}
      style={{ display: 'flex', alignItems: 'safe center', justifyContent: 'safe center' }}
    >
      <svg
        width={stageW * viewScale}
        height={stageH * viewScale}
        viewBox={`0 0 ${stageW} ${stageH}`}
        className={`shrink-0 select-none touch-none ${drag ? 'cursor-grabbing' : ''}`}
        onPointerMove={seatDrag.onPointerMove}
        onPointerUp={seatDrag.onPointerUp}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        <defs>
          {/* Adaptive warm wood-plank floor pattern */}
          <pattern id={woodPatternId} width="120" height="36" patternUnits="userSpaceOnUse">
            <rect width="120" height="36" fill="var(--classroom-floor-a)" />
            <rect y="18" width="120" height="18" fill="var(--classroom-floor-b)" />
            <line x1="0" y1="18" x2="120" y2="18" stroke="var(--border-subtle)" strokeWidth="0.6" opacity="0.55" />
            <line x1="60" y1="0" x2="60" y2="18" stroke="var(--border-subtle)" strokeWidth="0.6" opacity="0.45" />
            <line x1="20" y1="18" x2="20" y2="36" stroke="var(--border-subtle)" strokeWidth="0.6" opacity="0.45" />
          </pattern>
          <linearGradient id={sunGradId} x1="0" y1="0" x2="1" y2="0.45">
            <stop offset="0%" stopColor="var(--classroom-sunlight)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>

        {/* Classroom Floor */}
        <rect x={0} y={0} width={stageW} height={stageH} fill={`url(#${woodPatternId})`} />

        {/* Architectural Left Windows & Gentle Daylight Beams */}
        {!editing && (
          <g className="pointer-events-none">
            <rect x={0} y={0} width={14} height={stageH} fill="var(--classroom-wall)" />
            <rect x={stageW - 14} y={0} width={14} height={stageH} fill="var(--classroom-wall)" />
            {[0.24, 0.56].map((ratio, i) => {
              const wy = stageH * ratio;
              return (
                <g key={i}>
                  <rect x={4} y={wy} width={10} height={116} rx={3} fill="var(--classroom-window)" opacity="0.58" />
                  <polygon
                    points={`14,${wy} ${stageW * 0.48},${wy + 46} ${stageW * 0.48},${wy + 168} 14,${wy + 116}`}
                    fill={`url(#${sunGradId})`}
                  />
                </g>
              );
            })}
            {/* Delicate floating sakura petals in spring daylight for sakura-campus theme */}
            {isSakuraTheme &&
              [
                [56, 178, -22],
                [122, 232, 34],
                [84, 345, -14],
                [168, 410, 48],
                [48, 465, 18],
                [210, 205, -36],
              ].map(([px, py, rot], idx) => (
                <ellipse
                  key={idx}
                  cx={px}
                  cy={py}
                  rx={5.5}
                  ry={2.8}
                  fill="#f48fb1"
                  opacity={0.42}
                  transform={`rotate(${rot} ${px} ${py})`}
                />
              ))}
            {/* Warm subtle evening self-study lamp aura for glass-aurora theme */}
            {isAuroraTheme && (
              <ellipse
                cx={stageW / 2}
                cy={stageH * 0.52}
                rx={stageW * 0.36}
                ry={stageH * 0.28}
                fill="rgba(253, 224, 156, 0.06)"
              />
            )}
          </g>
        )}

        {/* Front Wall, Chalkboard, Podium & Teacher (hidden in seating-edit mode to maximize space) */}
        {!editing ? (
          <g className="pointer-events-none">
            {/* Front wall strip */}
            <rect x={0} y={0} width={stageW} height={62} fill="var(--classroom-wall)" />
            <line x1={0} y1={62} x2={stageW} y2={62} stroke="var(--border-strong)" strokeWidth="1.5" />

            {/* Matte Chalkboard with Oak Frame */}
            <rect
              x={boardX}
              y={10}
              width={boardW}
              height={46}
              rx={5}
              fill="var(--classroom-board)"
              stroke="var(--classroom-board-frame)"
              strokeWidth="4"
            />
            {/* Chalk tray */}
            <rect
              x={boardX + 26}
              y={54}
              width={boardW - 52}
              height={4}
              rx={2}
              fill="var(--classroom-board-frame)"
            />
            <text
              x={stageW / 2}
              y={35}
              textAnchor="middle"
              fill="#f3f7f4"
              fontSize="14.5"
              fontWeight="600"
              letterSpacing="1.5"
            >
              {cls.name}
              {cls.termLabel ? ` · ${cls.termLabel}` : ''}
            </text>

            {/* Wooden Podium + Teacher Pixel Avatar */}
            <g>
              <ellipse cx={stageW / 2} cy={126} rx={58} ry={10} fill="rgba(0,0,0,0.08)" />
              <CharacterArt
                gender={teacher.gender}
                characterId={teacher.characterId}
                facing="front"
                x={stageW / 2 - 34}
                y={58}
                width={68}
                height={72}
              />
              <rect
                x={stageW / 2 - 46}
                y={104}
                width={92}
                height={24}
                rx={5}
                fill="var(--classroom-podium)"
                stroke="var(--classroom-board-frame)"
                strokeWidth="1.5"
              />
              <rect
                x={stageW / 2 - 50}
                y={101}
                width={100}
                height={6}
                rx={3}
                fill="var(--classroom-board-frame)"
              />
              <text
                x={stageW / 2}
                y={120}
                textAnchor="middle"
                fill="#fffdf8"
                fontSize="11.5"
                fontWeight="600"
              >
                {teacher.name || '讲台'}
              </text>
            </g>
          </g>
        ) : (
          <g className="pointer-events-none">
            <rect
              x={stageW / 2 - 90}
              y={8}
              width={180}
              height={20}
              rx={10}
              fill="var(--accent-soft)"
            />
            <text
              x={stageW / 2}
              y={22}
              textAnchor="middle"
              fill="var(--accent)"
              fontSize="11.5"
              fontWeight="600"
            >
              黑板 / 讲台方向
            </text>
          </g>
        )}

        {/* Aisle subtle guide markers */}
        {Array.from({ length: aisles }, (_, i) => {
          const ax = offsetX + (i + 1) * 2 * stepX + i * aisle + aisle / 2;
          return (
            <line
              key={i}
              x1={ax}
              y1={offsetY - 4}
              x2={ax}
              y2={offsetY + gridHeight}
              stroke="var(--border-strong)"
              strokeDasharray="4 6"
              strokeWidth="1"
              opacity="0.45"
              className="pointer-events-none"
            />
          );
        })}

        {/* Row numbers in edit mode */}
        {editing &&
          Array.from({ length: plan.rows }, (_, r) => (
            <text
              key={r}
              x={offsetX - 16}
              y={offsetY + r * stepY + stepY / 2 + 4}
              textAnchor="middle"
              fill="var(--ink-muted)"
              fontSize="11"
              fontWeight="600"
              className="pointer-events-none"
            >
              {r + 1}
            </text>
          ))}

        {/* Seat Grid */}
        {Array.from({ length: plan.rows }, (_, row) =>
          Array.from({ length: plan.cols }, (_, col) => {
            const x = offsetX + col * stepX + Math.floor(col / 2) * aisle;
            const y = offsetY + row * stepY;
            const mid = cellMap.get(`${row},${col}`);
            const member = mid ? memberMap.get(mid) : undefined;
            const origMid = origCellMap.get(`${row},${col}`);
            const isSelected = Boolean(mid && selected === mid);
            const isHighlighted = Boolean(mid && highlightedId === mid);
            const isDragOrigin = Boolean(drag && drag.from.row === row && drag.from.col === col);
            const isDragTarget = Boolean(
              previewTarget && previewTarget.row === row && previewTarget.col === col,
            );
            const isHeld = Boolean(drag && mid === drag.id && !previewTarget);
            const facing: 'front' | 'back' =
              front || (member && hoveredId === member.membershipId) ? 'front' : 'back';

            return (
              <g
                key={`${row}-${col}`}
                transform={`translate(${x}, ${y})`}
                data-seat="1"
                data-row={row}
                data-col={col}
                className={editing ? 'cursor-grab' : member ? 'cursor-pointer' : ''}
                onMouseEnter={() => {
                  if (!editing && member) setHoveredId(member.membershipId);
                }}
                onMouseLeave={() => {
                  if (member && hoveredId === member.membershipId) setHoveredId(null);
                }}
              >
                {/* Interactive Hit Rect */}
                <rect
                  x={2}
                  y={0}
                  width={stepX - 4}
                  height={stepY - 4}
                  rx={10}
                  fill={
                    isHighlighted
                      ? 'rgba(245, 158, 11, 0.25)'
                      : isSelected || isDragTarget
                        ? 'var(--accent-soft)'
                        : editing && !member
                          ? 'rgba(128,128,128,0.06)'
                          : 'transparent'
                  }
                  stroke={
                    isHighlighted
                      ? '#d97706'
                      : isSelected || isDragTarget
                        ? 'var(--accent)'
                        : isDragOrigin
                          ? 'var(--border-strong)'
                          : editing && selected && !member
                            ? 'var(--accent)'
                            : 'transparent'
                  }
                  strokeWidth={isHighlighted || isSelected || isDragTarget ? 2.4 : 1.5}
                  strokeDasharray={isDragOrigin || (editing && selected && !member) ? '4 3' : undefined}
                  className={isHighlighted ? 'seat-spotlight' : ''}
                  onPointerDown={(e) => {
                    if (editing && origMid) seatDrag.start(e, origMid, { row, col }, viewScale, facing);
                  }}
                  onClick={() => {
                    if (!seatDrag.allowClick()) return;
                    if (editing) onSelectSeat(mid || null, row, col);
                    else if (mid) onOpenProfile(mid);
                  }}
                >
                  <title>
                    {member
                      ? `${member.name}${member.rosterNo ? ` (${member.rosterNo})` : ''} · 第 ${row + 1} 行第 ${col + 1} 列`
                      : `空座 · 第 ${row + 1} 行第 ${col + 1} 列`}
                  </title>
                </rect>

                {/* Desk + Character Layer */}
                <g transform="translate(2, 20)" opacity={isHeld ? 0.25 : member ? 1 : 0.42}>
                  <SeatedPerson
                    person={member ? { gender: member.gender, characterId: member.characterId } : undefined}
                    facing={facing}
                  />
                </g>

                {/* Crisp Floating Name Plate */}
                <g className="pointer-events-none">
                  {isPixelTheme && member && (
                    <rect
                      x={10}
                      y={3}
                      width={stepX - 16}
                      height={19}
                      rx={3}
                      fill="rgba(74, 55, 40, 0.25)"
                    />
                  )}
                  <rect
                    x={8}
                    y={1}
                    width={stepX - 16}
                    height={19}
                    rx={isPixelTheme ? 3 : 6}
                    fill={
                      isHighlighted
                        ? '#d97706'
                        : isSelected
                          ? 'var(--accent)'
                          : member
                            ? 'var(--classroom-plate-bg)'
                            : 'transparent'
                    }
                    stroke={
                      isHighlighted
                        ? '#b45309'
                        : isSelected
                          ? 'var(--accent)'
                          : member
                            ? 'var(--classroom-plate-border)'
                            : editing
                              ? 'var(--border-strong)'
                              : 'transparent'
                    }
                    strokeWidth={isPixelTheme ? '1.6' : '1'}
                    strokeDasharray={!member && editing ? '3 2' : undefined}
                  />
                  <text
                    x={stepX / 2}
                    y={14}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight={member ? '600' : '400'}
                    fill={
                      isHighlighted || isSelected
                        ? '#ffffff'
                        : member
                          ? 'var(--ink-primary)'
                          : 'var(--ink-muted)'
                    }
                  >
                    {member ? trimCaption(member.name, stepX - 16) : editing ? '空座' : ''}
                  </text>
                </g>
              </g>
            );
          }),
        )}
      </svg>

      {/* Smooth Portal Drag Ghost */}
      {drag &&
        draggedMember &&
        createPortal(
          <div
            className="fixed z-50 pointer-events-none select-none"
            style={{
              left: drag.x - drag.offsetX,
              top: drag.y - drag.offsetY,
              filter: 'drop-shadow(0 10px 16px rgba(0,0,0,0.28))',
            }}
          >
            <svg width={88 * viewScale} height={80 * viewScale} viewBox="0 0 88 80">
              <SeatedPerson
                person={{ gender: draggedMember.gender, characterId: draggedMember.characterId }}
                facing={drag.facing}
              />
            </svg>
            <div className="mt-1 px-2.5 py-1 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-medium text-center whitespace-nowrap shadow-md">
              {dragHint}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
