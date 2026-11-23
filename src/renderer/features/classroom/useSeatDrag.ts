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
  const suppressTimer = useRef<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const resetSuppressClick = useCallback(() => {
    if (suppressTimer.current !== null) {
      window.clearTimeout(suppressTimer.current);
      suppressTimer.current = null;
    }
    suppressClick.current = false;
  }, []);

  const markSuppressClick = useCallback(() => {
    suppressClick.current = true;
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    // Only suppress the synthetic click dispatched immediately after pointerup/cancel;
    // never let it leak across turns into normal clicks or Quick-Check mode.
    suppressTimer.current = window.setTimeout(() => {
      suppressTimer.current = null;
      suppressClick.current = false;
    }, 0);
  }, []);

  const clear = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (g?.capture.hasPointerCapture(g.pointerId)) {
      g.capture.releasePointerCapture(g.pointerId);
    }
  }, []);

  const cancel = useCallback(() => {
    const wasMoved = Boolean(gesture.current?.moved);
    clear();
    if (wasMoved) markSuppressClick();
    else resetSuppressClick();
  }, [clear, markSuppressClick, resetSuppressClick]);

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
      resetSuppressClick();
    };
  }, [cancel, resetSuppressClick]);

  function seatAt(x: number, y: number): SeatCoord | null {
    const seat = document.elementFromPoint(x, y)?.closest('[data-seat]');
    return seat && viewport.current?.contains(seat)
      ? { row: Number(seat.getAttribute('data-row')), col: Number(seat.getAttribute('data-col')) }
      : null;
  }

  return {
    drag,
    cancel,
    allowClick: () => {
      if (!suppressClick.current) return true;
      resetSuppressClick();
      return false;
    },
    start(
      event: PointerEvent<SVGRectElement>,
      id: string | undefined,
      from: SeatCoord,
      scale: number,
      facing: 'front' | 'back',
    ) {
      if (event.button !== 0 || !event.isPrimary || gesture.current) return;
      resetSuppressClick();
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
      const wasMoved = g.moved;
      clear();
      if (wasMoved) markSuppressClick();
      else resetSuppressClick();
      if (target && (target.row !== g.from.row || target.col !== g.from.col)) {
        onDrop(g.id, target.row, target.col);
      }
    },
  };
}
