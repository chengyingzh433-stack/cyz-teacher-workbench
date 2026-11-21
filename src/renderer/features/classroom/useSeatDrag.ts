import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export type SeatCoord = { row: number; col: number };
export type DragState = {
  id: string;
  from: SeatCoord;
  over: SeatCoord | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  facing: 'front' | 'back';
};

type Gesture = DragState & {
  startX: number;
  startY: number;
  pointerId: number;
  capture: SVGRectElement;
  moved: boolean;
};

export function useSeatDrag(
  viewport: RefObject<HTMLDivElement | null>,
  onDrop: (memberId: string, row: number, col: number) => void,
) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  const clear = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (g?.capture.hasPointerCapture(g.pointerId)) {
      g.capture.releasePointerCapture(g.pointerId);
    }
  }, []);

  const cancel = useCallback(() => {
    if (gesture.current) suppressClick.current = true;
    clear();
  }, [clear]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [cancel]);

  function seatAt(x: number, y: number): SeatCoord | null {
    const seat = document.elementFromPoint(x, y)?.closest('[data-seat]');
    return seat && viewport.current?.contains(seat)
      ? { row: Number(seat.getAttribute('data-row')), col: Number(seat.getAttribute('data-col')) }
      : null;
  }

  return {
    drag,
    cancel,
    allowClick: () => !suppressClick.current,
    start(
      event: PointerEvent<SVGRectElement>,
      id: string | undefined,
      from: SeatCoord,
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
