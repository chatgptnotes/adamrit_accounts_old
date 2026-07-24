import { useEffect, useState } from 'react';
import { isTypingTarget, tallyModalIsOpen } from './TallyChrome';

/**
 * Tally's row cursor — the amber highlight that walks a report with the arrow
 * keys and drills into the highlighted line on Enter. Space / R / U stay with
 * the screen's bottom key bar, so this hook only owns movement and Enter.
 */
export function useRowCursor({
  count,
  onEnter,
  enabled = true,
}: {
  count: number;
  onEnter?: (index: number) => void;
  enabled?: boolean;
}): { cursor: number; setCursor: (index: number) => void } {
  const [cursor, setCursor] = useState(0);

  // Keep the cursor inside the list as rows come and go
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, count - 1)));
  }, [count]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Someone upstream already owns this key — PgUp/PgDn in particular are
      // the report's period step, not a cursor jump.
      if (e.defaultPrevented) return;
      if (tallyModalIsOpen() || isTypingTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step =
        e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowUp' ? -1
        : e.key === 'PageDown' ? 10
        : e.key === 'PageUp' ? -10
        : e.key === 'Home' ? -count
        : e.key === 'End' ? count
        : 0;
      if (step !== 0) {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(count - 1, c + step)));
        return;
      }
      if (e.key === 'Enter' && onEnter && count > 0) {
        // A focused button handles its own Enter — don't drill down twice
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'BUTTON' || active.tagName === 'A')) return;
        e.preventDefault();
        onEnter(cursor);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, cursor, onEnter, enabled]);

  return { cursor, setCursor };
}
