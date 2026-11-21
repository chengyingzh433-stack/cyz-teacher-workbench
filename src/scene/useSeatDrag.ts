import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type Seat = { row: number; col: number };
type Drag = {
  id: string;
  from: Seat;
  over: Seat | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  facing: 'front' | 'back';
};
type Gesture = Drag & {
  startX: number;
  startY: number;
  pointerId: number;
  capture: SVGRectElement;
  moved: boolean;
};

// Only the release callback commits a change. Hovering and cancellation never
// touch the seat plan, so undo and persistence still receive one complete move.
export function useSeatDrag(
  viewport: RefObject<HTMLDivElement | null>,
  onDrop: (memberId: string, row: number, col: number) => void,
) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const clear = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (g?.capture.hasPointerCapture(g.pointerId)) g.capture.releasePointerCapture(g.pointerId);
  }, []);
  const cancel = useCallback(() => {
    if (gesture.current) suppressClick.current = true;
    clear();
  }, [clear]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [cancel]);
  function seatAt(x: number, y: number): Seat | null {
    const seat = document.elementFromPoint(x, y)?.closest('[data-seat]');
    return seat && viewport.current?.contains(seat)
      ? { row: Number(seat.getAttribute('data-row')), col: Number(seat.getAttribute('data-col')) }
      : null;
  }
  return {
    drag,
    cancel,
    allowClick: () => !suppressClick.current,
    allowKeyboard: () => {
      if (gesture.current) return false;
      suppressClick.current = false;
      return true;
    },
    start(
      event: PointerEvent<SVGRectElement>,
      id: string | undefined,
      from: Seat,
      scale: number,
      facing: 'front' | 'back',
    ) {
      if (event.button !== 0 || !event.isPrimary || gesture.current) return;
      suppressClick.current = false;
      if (!id) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      gesture.current = {
        id,
        from,
        over: null,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        // The hit rectangle starts at (1, -1) within the seat. Preserve the
        // exact grab point even when the classroom has been zoomed or scrolled.
        offsetX: event.clientX - bounds.left + scale,
        offsetY: event.clientY - bounds.top - scale,
        facing,
        pointerId: event.pointerId,
        capture: event.currentTarget,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<SVGSVGElement>) {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) <= 7) return;
      g.moved = true;
      suppressClick.current = true;
      setDrag({
        id: g.id,
        from: g.from,
        over: seatAt(event.clientX, event.clientY),
        x: event.clientX,
        y: event.clientY,
        offsetX: g.offsetX,
        offsetY: g.offsetY,
        facing: g.facing,
      });
    },
    onPointerUp(event: PointerEvent<SVGSVGElement>) {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      const target = g.moved ? seatAt(event.clientX, event.clientY) : null;
      clear();
      if (target && (target.row !== g.from.row || target.col !== g.from.col)) {
        onDrop(g.id, target.row, target.col);
      }
    },
  };
}
