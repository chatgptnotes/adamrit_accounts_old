import { useCallback, useMemo, type RefObject } from 'react';
import { useShortcuts, type Binding } from './keyboard';

/**
 * Tally's field cursor: Enter walks forward through a form, Backspace walks
 * back, and Enter on the last field accepts. Every field opts in by carrying a
 * `data-tally-field` attribute — the pop-ups have used that marker for their
 * own hand-rolled version since they were written, so they get this for free.
 *
 * The ring reads the DOM rather than a registered list of refs, so fields that
 * come and go (a voucher's ledger lines) need no bookkeeping: whatever is on
 * screen, in document order, is the ring.
 */

interface FieldRingOptions {
  /** The form or pop-up box the fields live in. */
  containerRef: RefObject<HTMLElement>;
  /** Enter on the last field. Tally accepts the pop-up here. */
  onAccept?: () => void;
  /**
   * Pop-ups also walk their fields with the arrow keys. Forms do not — a
   * voucher's ledger field uses ↑↓ to pick from its "List of Ledger Accounts".
   */
  arrows?: boolean;
  enabled?: boolean;
}

export function useFieldRing({ containerRef, onAccept, arrows = false, enabled = true }: FieldRingOptions): void {
  const fields = useCallback(
    (): HTMLElement[] => Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-tally-field]') ?? []),
    [containerRef],
  );

  /** Focus (and select) the field `step` places from the focused one. */
  const move = useCallback(
    (step: number): void => {
      const all = fields();
      if (all.length === 0) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      // Nothing in the ring has focus yet — Enter starts at the first field.
      const next = all[Math.max(0, Math.min(all.length - 1, at < 0 ? 0 : at + step))];
      next?.focus();
      if (next instanceof HTMLInputElement) next.select();
    },
    [fields],
  );

  /**
   * Backspace only leaves the field when there is nothing to delete — caret at
   * the very start and no selection. Anywhere else it still deletes a
   * character, which is what anyone typing expects.
   */
  const atStartOfField = useCallback((): boolean => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) return true;
    return active.selectionStart === 0 && active.selectionEnd === 0;
  }, []);

  const bindings = useMemo<Binding[]>(() => {
    const ring: Binding[] = [
      {
        combo: 'Enter',
        layer: 'field',
        allowInInput: true,
        label: 'Next field (accepts on the last one)',
        run: () => {
          const all = fields();
          const at = all.indexOf(document.activeElement as HTMLElement);
          if (at >= 0 && at === all.length - 1 && onAccept) onAccept();
          else move(1);
        },
      },
      {
        combo: 'Backspace',
        layer: 'field',
        allowInInput: true,
        label: 'Previous field',
        when: atStartOfField,
        run: () => move(-1),
      },
    ];
    if (arrows) {
      ring.push(
        { combo: 'ArrowDown', layer: 'field', allowInInput: true, run: () => move(1) },
        { combo: 'ArrowUp', layer: 'field', allowInInput: true, run: () => move(-1) },
      );
    }
    return ring;
  }, [arrows, atStartOfField, fields, move, onAccept]);

  useShortcuts(bindings, enabled);
}
