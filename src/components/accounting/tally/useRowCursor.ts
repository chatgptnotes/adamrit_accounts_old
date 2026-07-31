import { useEffect, useMemo, useState } from 'react';
import { useShortcuts, type Binding } from './keyboard';

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

  const bindings = useMemo<Binding[]>(() => {
    const step = (by: number) => () => setCursor((c) => Math.max(0, Math.min(count - 1, c + by)));
    return [
      { combo: 'ArrowDown', layer: 'screen', label: 'Move the row cursor', run: step(1) },
      { combo: 'ArrowUp', layer: 'screen', run: step(-1) },
      { combo: 'Home', layer: 'screen', label: 'First / last row', run: step(-count) },
      { combo: 'End', layer: 'screen', run: step(count) },
      {
        combo: 'Enter',
        layer: 'screen',
        label: 'Drill into the highlighted row',
        when: () => {
          if (!onEnter || count === 0) return false;
          // A focused button handles its own Enter — don't drill down twice
          const active = document.activeElement;
          return !(active instanceof HTMLElement) || (active.tagName !== 'BUTTON' && active.tagName !== 'A');
        },
        run: () => onEnter?.(cursor),
      },
    ];
  }, [count, cursor, onEnter]);

  useShortcuts(bindings, enabled);

  return { cursor, setCursor };
}
