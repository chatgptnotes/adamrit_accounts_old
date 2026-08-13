import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

interface Position {
  x: number;
  y: number;
}

/** Movement below this counts as a click, not a drag. */
const DRAG_THRESHOLD = 4;
/** Keep the button at least this far from the viewport edges. */
const EDGE_MARGIN = 8;

function clampToViewport(pos: Position, el: HTMLElement | null): Position {
  const width = el?.offsetWidth ?? 56;
  const height = el?.offsetHeight ?? 56;
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(pos.x, EDGE_MARGIN), maxX),
    y: Math.min(Math.max(pos.y, EDGE_MARGIN), maxY),
  };
}

/**
 * Makes a fixed-position floating action button draggable with the pointer.
 *
 * Spread the returned `dragProps` onto the button. Until it is dragged the
 * button keeps whatever position its CSS classes give it; after that the
 * position is inline and persisted to localStorage under `storageKey`.
 * A press that moves less than DRAG_THRESHOLD still fires onClick.
 */
export function useDraggableFab<T extends HTMLElement>(storageKey: string) {
  const ref = useRef<T | null>(null);
  const [position, setPosition] = useState<Position | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Position) : null;
    } catch {
      return null;
    }
  });
  const [isDragging, setIsDragging] = useState(false);

  const positionRef = useRef(position);
  const dragOrigin = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });
  const moved = useRef(false);

  const applyPosition = useCallback((next: Position) => {
    const clamped = clampToViewport(next, ref.current);
    positionRef.current = clamped;
    setPosition(clamped);
  }, []);

  // Pull a stored position back on screen if the window has since shrunk.
  useEffect(() => {
    if (positionRef.current) applyPosition(positionRef.current);
    const onResize = () => {
      if (positionRef.current) applyPosition(positionRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [applyPosition]);

  const onPointerDown = useCallback((e: ReactPointerEvent<T>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragOrigin.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: rect.left,
      y: rect.top,
    };
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<T>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - dragOrigin.current.pointerX;
      const dy = e.clientY - dragOrigin.current.pointerY;
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved.current = true;
      applyPosition({ x: dragOrigin.current.x + dx, y: dragOrigin.current.y + dy });
    },
    [applyPosition]
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<T>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setIsDragging(false);
      if (moved.current && positionRef.current) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(positionRef.current));
        } catch {
          // Storage unavailable (private mode / quota) — position just won't persist.
        }
      }
    },
    [storageKey]
  );

  // Swallow the click that ends a drag so the button doesn't also open its panel.
  const onClickCapture = useCallback((e: ReactMouseEvent<T>) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    isDragging,
    dragProps: {
      ref,
      style: {
        ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {}),
        touchAction: 'none' as const,
        cursor: isDragging ? 'grabbing' : 'grab',
      },
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
    },
  };
}
