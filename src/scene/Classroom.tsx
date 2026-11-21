import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeMembers, type SeatPlan, type Snapshot } from '../app/model';
import { move } from '../modules/seating';
import { CharacterArt } from './Art';
import { SeatedPerson } from './SeatedPerson';
import { useSeatDrag } from './useSeatDrag';

function seatCaption(name: string, width: number) {
  const chars = Array.from(name);
  const limit = Math.max(4, Math.floor((width - 6) / 12));
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : name;
}

export function Classroom({
  snapshot,
  plan,
  editing,
  selected,
  highlightedId,
  onSelect,
  onDrop,
  onProfile,
  front,
  zoom,
  fitView,
  onScale,
}: {
  snapshot: Snapshot;
  plan: SeatPlan;
  editing: boolean;
  selected: string | null;
  highlightedId?: string | null;
  onSelect: (memberId: string | null, row: number, col: number) => void;
  onDrop: (memberId: string, row: number, col: number) => void;
  onProfile: (memberId: string) => void;
  front: boolean;
  zoom: number;
  fitView: boolean;
  onScale: (scale: number) => void;
}) {
  const members = activeMembers(snapshot, plan.classId);
  const students = new Map(snapshot.data.students.map((s) => [s.id, s]));
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const cells = new Map(plan.assignments.map((a) => [`${a.row},${a.col}`, a]));
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 550 });
  const seatDrag = useSeatDrag(ref, onDrop);
  const { drag, cancel } = seatDrag;
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!hovered) return;
    const timer = setTimeout(() => setHovered(null), 1100);
    return () => clearTimeout(timer);
  }, [hovered]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [editing, plan.id, plan.rows, plan.cols]);

  // Keep names separate from the artwork in the natural layout. Fit scales this
  // whole stage; zooming in restores readable labels. Pair gaps do not add seats.
  const aisle = 24;
  const aisles = Math.floor((plan.cols - 1) / 2);
  const side = editing ? 24 : 84;
  const frontHeight = editing ? 10 : Math.max(100, Math.min(138, size.height * 0.22));
  const width = Math.max(size.width, plan.cols * 78 + aisles * aisle + side * 2);
  const height = Math.max(size.height, plan.rows * (editing ? 58 : 66) + frontHeight + 18);
  const stepX = Math.min(88, (width - side * 2 - aisles * aisle) / plan.cols);
  const stepY = Math.min(110, (height - frontHeight - 18) / plan.rows);
  const cellScale = Math.min((stepX - 4) / 88, (stepY - 20) / 80);
  const gridWidth = stepX * plan.cols + aisles * aisle;
  const offsetX = (width - gridWidth) / 2;
  const offsetY = frontHeight + Math.max(0, (height - frontHeight - 18 - stepY * plan.rows) / 2);
  const viewScale = (fitView ? Math.min(1, size.width / width, size.height / height) : 1) * zoom;

  // Scroll highlighted student smoothly into view when searched
  useEffect(() => {
    if (!highlightedId || !ref.current) return;
    const target = plan.assignments.find((a) => a.membershipId === highlightedId);
    if (!target) return;
    const seatCenterX =
      (offsetX + target.col * stepX + Math.floor(target.col / 2) * aisle + stepX / 2) * viewScale;
    const seatCenterY = (offsetY + target.row * stepY + stepY / 2) * viewScale;
    ref.current.scrollTo({
      left: Math.max(0, seatCenterX - size.width / 2),
      top: Math.max(0, seatCenterY - size.height / 2),
      behavior: 'smooth',
    });
  }, [highlightedId, plan.assignments, offsetX, offsetY, stepX, stepY, viewScale, size.width, size.height]);

  useEffect(() => {
    cancel();
  }, [editing, plan, viewScale, stepX, stepY, cancel]);
  useEffect(() => {
    onScale(viewScale);
  }, [viewScale, onScale]);

  const previewTarget =
    drag?.over && (drag.over.row !== drag.from.row || drag.over.col !== drag.from.col)
      ? drag.over
      : null;
  const previewCells = new Map(
    (drag && previewTarget ? move(plan, members, drag.id, previewTarget) : plan).assignments.map(
      (a) => [`${a.row},${a.col}`, a],
    ),
  );
  const draggedMember = drag && memberMap.get(drag.id);
  const draggedStudent = draggedMember && students.get(draggedMember.studentId);
  const targetMember = previewTarget && cells.get(`${previewTarget.row},${previewTarget.col}`);
  const targetStudent =
    targetMember && students.get(memberMap.get(targetMember.membershipId)!.studentId);
  const dragHint = previewTarget
    ? targetStudent
      ? `松手与 ${targetStudent.name} 互换`
      : `松手移到 ${previewTarget.row + 1} 行 ${previewTarget.col + 1} 列`
    : '拖到目标座位 · 按 Esc 取消';
  const teacher = snapshot.data.settings.teacher;
  function activate(memberId: string | undefined, row: number, col: number) {
    if (!seatDrag.allowClick()) return;
    if (editing) onSelect(memberId || null, row, col);
    else if (memberId) onProfile(memberId);
  }

  return (
    <div
      className={`scene-viewport ${editing ? 'editing' : ''}`}
      ref={ref}
      onScroll={cancel}
      aria-label={editing ? '排座学生区域' : '教室场景'}
    >
      <svg
        className={`classroom ${drag ? 'is-dragging' : ''} ${editing && selected ? 'has-selection' : ''}`}
        role="group"
        aria-label={
          editing
            ? '座位图，拖动人物或依次点击两个座位即可换座'
            : '教室座位图，点击人物或按 Enter 查看档案'
        }
        width={width * viewScale}
        height={height * viewScale}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={seatDrag.onPointerMove}
        onPointerUp={seatDrag.onPointerUp}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {!editing && (
          <g className="room-scenery" pointerEvents="none">
            <svg
              width={width}
              height={frontHeight}
              viewBox="0 0 1024 350"
              preserveAspectRatio="none"
              overflow="hidden"
            >
              <use href="#asset-room" />
            </svg>
            <svg
              y={frontHeight}
              width={width}
              height={height - frontHeight}
              viewBox="0 350 1024 415"
              preserveAspectRatio="none"
              overflow="hidden"
            >
              <use href="#asset-room" />
            </svg>
            <g className="teacher-person" data-character-id={teacher.characterId || ''}>
              <CharacterArt
                {...teacher}
                x={width / 2 - 36}
                y={frontHeight * 0.22}
                width={72}
                height={frontHeight * 0.56}
              />
              <svg
                x={width / 2 - (width * 74.5) / 1024}
                y={(frontHeight * 214) / 350}
                width={(width * 149) / 1024}
                height={(frontHeight * 132) / 350}
                viewBox="440 214 149 132"
                preserveAspectRatio="none"
                overflow="hidden"
              >
                <use href="#asset-room" />
              </svg>
            </g>
            <text x={width / 2} y={frontHeight * 0.18} textAnchor="middle" className="teacher-name">
              {teacher.name || '我的教室'}
            </text>
          </g>
        )}
        {Array.from({ length: plan.rows }, (_, row) =>
          Array.from({ length: plan.cols }, (_, col) => {
            const original = cells.get(`${row},${col}`);
            const assignment = previewCells.get(`${row},${col}`);
            const member = assignment && memberMap.get(assignment.membershipId);
            const student = member && students.get(member.studentId);
            const label = `${row + 1} 行 ${col + 1} 列，${student?.name || '空座'}`;
            const fullName = student?.name || '空座';
            const caption = seatCaption(fullName, stepX);
            const isHighlighted = !!highlightedId && member?.id === highlightedId;
            return (
              <g
                key={`${row}-${col}`}
                transform={`translate(${offsetX + col * stepX + Math.floor(col / 2) * aisle},${offsetY + row * stepY})`}
                className={`seat ${student ? 'occupied' : 'empty-seat'} ${member?.id === selected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''} ${member?.id === drag?.id ? 'drag-held' : ''} ${drag?.from.row === row && drag.from.col === col ? 'drag-origin' : ''} ${previewTarget?.row === row && previewTarget.col === col ? 'drag-target' : ''}`}
                onPointerEnter={() => {
                  if (member && !drag) setHovered(member.id);
                }}
              >
                <title>
                  {label}
                  {member ? ` · 编号 ${member.rosterNo || '未填写'}` : ''}
                </title>
                <rect
                  className="seat-hit"
                  x={1}
                  y={-1}
                  width={stepX - 2}
                  height={stepY - 1}
                  rx={6}
                />
                <rect className="name-plate" x={2} y={0} width={stepX - 4} height={18} rx={4} />
                <text x={stepX / 2} y={13} textAnchor="middle" className="seat-name">
                  {caption}
                </text>
                <g
                  key={student?.id || 'empty'}
                  transform={`translate(${(stepX - 88 * cellScale) / 2},20) scale(${cellScale})`}
                >
                  <SeatedPerson
                    person={student}
                    facing={front || hovered === member?.id || isHighlighted ? 'front' : 'back'}
                  />
                </g>
                <rect
                  className="seat-target"
                  data-seat="true"
                  data-row={row}
                  data-col={col}
                  x={1}
                  y={-1}
                  width={stepX - 2}
                  height={stepY - 1}
                  rx={6}
                  fill="transparent"
                  role={editing || student ? 'button' : 'img'}
                  aria-label={label + (!editing && student ? '，查看档案' : '')}
                  aria-pressed={editing ? selected === member?.id : undefined}
                  tabIndex={editing || student ? 0 : undefined}
                  onFocus={() => {
                    if (member && !drag) setHovered(member.id);
                  }}
                  onPointerDown={(e) => {
                    seatDrag.start(
                      e,
                      editing ? original?.membershipId : undefined,
                      { row, col },
                      viewScale,
                      front || hovered === original?.membershipId ? 'front' : 'back',
                    );
                  }}
                  onClick={() => activate(original?.membershipId, row, col)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && seatDrag.allowKeyboard()) {
                      e.preventDefault();
                      activate(original?.membershipId, row, col);
                    }
                  }}
                />
              </g>
            );
          }),
        )}
      </svg>
      {drag &&
        draggedStudent &&
        createPortal(
          <div
            className="seat-drag-ghost"
            style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY }}
          >
            <svg
              width={stepX * viewScale}
              height={stepY * viewScale}
              viewBox={`0 0 ${stepX} ${stepY}`}
              aria-hidden="true"
            >
              <rect className="name-plate" x={2} y={0} width={stepX - 4} height={18} rx={4} />
              <text x={stepX / 2} y={13} textAnchor="middle" className="seat-name">
                {seatCaption(draggedStudent.name, stepX)}
              </text>
              <g transform={`translate(${(stepX - 88 * cellScale) / 2},20) scale(${cellScale})`}>
                <CharacterArt
                  {...draggedStudent}
                  facing={drag.facing}
                  x={9}
                  y={0}
                  width={70}
                  height={76}
                />
              </g>
            </svg>
            <span className="seat-drag-hint" role="status">
              {dragHint}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
