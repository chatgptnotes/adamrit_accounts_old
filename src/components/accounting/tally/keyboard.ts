import { useEffect, useRef } from 'react';

/**
 * The accounting module's one keyboard dispatcher.
 *
 * Every Tally shortcut in the module registers here and nowhere else. Before
 * this there were a dozen independent `keydown` listeners that coordinated by
 * side effect — `e.defaultPrevented` meant "someone already claimed this key"
 * and two module-global counters stood in for a modal stack. Whoever happened
 * to bind first won, which is why the Gateway's hot letters had to be bound in
 * the capture phase to beat the top bar.
 *
 * Now precedence is explicit. Bindings sit on one of four layers:
 *
 *   popup  — a pop-up owns the keyboard until it is accepted or quit
 *   field  — the field cursor inside a form (Enter / Backspace walk)
 *   screen — the screen's own rail and key-bar actions
 *   global — the module-wide keys (F2, F3, F4-F10, Alt+F, …)
 *
 * A key falls through the layers until one of them claims it, so the Gateway's
 * "P" (Profit & Loss) beats the global "P" (Print) without either of them
 * knowing the other exists. The one exception is `popup`: while a pop-up is
 * open, only `popup` and the `field` ring inside it are consulted at all —
 * that is how Tally's modal boxes take the keyboard, and it is what the old
 * `tallyModalIsOpen()` check did by hand on every listener.
 */

/** Modifier a combo needs. Tally is a Windows product, so its modifier is Ctrl. */
export type HotkeyMod = 'alt' | 'ctrl';

export type Layer = 'popup' | 'field' | 'screen' | 'global';

/** Consulted in this order; the first layer to claim the key stops the search. */
const LAYER_ORDER: Layer[] = ['popup', 'field', 'screen', 'global'];

/** While a pop-up is open these are the only layers that answer a key. */
const MODAL_LAYERS: Layer[] = ['popup', 'field'];

export interface Binding {
  /** "F5", "Alt+F2", "Ctrl+F8", "Esc", "Space", "A" */
  combo: string;
  layer: Layer;
  run: (e: KeyboardEvent) => void;
  /** Shown in the F1 Help sheet. Bindings without one stay out of it. */
  label?: string;
  /** Checked at dispatch time — a binding that says no is skipped entirely, so
   *  the key carries on to the next candidate instead of being swallowed. */
  when?: () => boolean;
  /**
   * Tally fires F-keys and modified combos while you are typing but not bare
   * letters, which would otherwise be swallowed mid-word. Set this to bind a
   * bare key inside a field anyway (Enter, Backspace, the arrow keys).
   */
  allowInInput?: boolean;
  /**
   * Tally greys an action that does not apply but still swallows its key, so
   * Space never scrolls the report out from under the cursor. Same here: the
   * key is claimed, `run` is not called.
   */
  disabled?: boolean;
}

interface Registration {
  /** A getter, so handlers closing over fresh state never go stale. */
  readonly bindings: Binding[];
  /** Registration order. Later wins within a layer — see `dispatch`. */
  seq: number;
}

const registrations: Registration[] = [];
let nextSeq = 0;
let listening = false;

/** "F" + ctrl -> "Ctrl+F"; the text shown in the blue key prefix. */
export const hotkeyLabel = (hotkey: string, mod?: HotkeyMod): string =>
  mod === 'ctrl' ? `Ctrl+${hotkey}` : mod === 'alt' ? `Alt+${hotkey}` : hotkey;

/** "Alt+F2" -> { key: "F2", mod: "alt" }. */
export const parseCombo = (combo: string): { key: string; mod?: HotkeyMod } => {
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const mod = parts.map((p) => p.toLowerCase()).find((p): p is HotkeyMod => p === 'alt' || p === 'ctrl');
  return { key, mod };
};

/** True when the event landed in a field the user is typing into. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Does this keydown match the hotkey (and only its modifier)?
 *
 * macOS Cmd (metaKey) is deliberately NOT accepted as Ctrl — treating them as
 * the same key made Cmd+F hijack the browser's own Find, and the same for
 * Cmd+A / Cmd+P.
 */
export const hotkeyMatches = (e: KeyboardEvent, hotkey: string, mod: HotkeyMod | undefined): boolean => {
  // "Esc" and "Space" are how Tally labels them; the browser calls the same
  // keys "Escape" and " ".
  const wanted = hotkey.toUpperCase() === 'ESC' ? 'ESCAPE' : hotkey.toUpperCase();
  const pressed = e.key === ' ' ? 'SPACE' : e.key.toUpperCase();
  if (pressed !== wanted) return false;
  if (mod === 'ctrl') return e.ctrlKey && !e.altKey && !e.metaKey;
  if (mod === 'alt') return e.altKey && !e.ctrlKey && !e.metaKey;
  return !e.altKey && !e.ctrlKey && !e.metaKey;
};

/** Does this keydown match a combo string such as "Alt+F2"? */
export const matchesCombo = (e: KeyboardEvent, combo: string): boolean => {
  const { key, mod } = parseCombo(combo);
  return hotkeyMatches(e, key, mod);
};

/** F1 … F12 — these fire even while the user is typing, and Tally owns them. */
const isFunctionKey = (key: string): boolean => /^F([1-9]|1[0-2])$/.test(key.toUpperCase());

/**
 * The browser's own F-key actions (F3 find, F5 reload, F7 caret browsing, F10
 * menu, F11 fullscreen) must never fire over an accounting screen, whether or
 * not anything is bound to them. F12 is the one Chrome refuses to release, so
 * Alt+F12 carries Configure.
 */
const RESERVED = /^F([1-9]|1[01])$/;

/** True while any pop-up has bindings registered. */
export const tallyPopupIsOpen = (): boolean =>
  registrations.some((r) => r.bindings.some((b) => b.layer === 'popup'));

const dispatch = (e: KeyboardEvent): void => {
  if (RESERVED.test(e.key)) e.preventDefault();

  const typing = isTypingTarget(e.target);
  const layers = tallyPopupIsOpen() ? MODAL_LAYERS : LAYER_ORDER;

  for (const layer of layers) {
    const candidates = registrations
      .flatMap((r) => r.bindings.filter((b) => b.layer === layer).map((b) => ({ b, seq: r.seq })))
      // Later registration first: a pop-up opened on top of a pop-up is the
      // one that answers Esc. Screens are not nested, so this rarely bites.
      .sort((x, y) => y.seq - x.seq);

    for (const { b } of candidates) {
      const { key, mod } = parseCombo(b.combo);
      // A bare letter inside a text field belongs to the field, not the rail.
      if (typing && !mod && !isFunctionKey(key) && !b.allowInInput) continue;
      if (!hotkeyMatches(e, key, mod)) continue;
      if (b.when && !b.when()) continue;
      // Claimed either way — a greyed action still swallows its key.
      e.preventDefault();
      e.stopPropagation();
      if (b.disabled) return;
      b.run(e);
      return;
    }
  }
};

/**
 * Register bindings for as long as the component is mounted.
 *
 * Pass a fresh array each render; it is read through a ref at dispatch time, so
 * handlers see current state without the registration churning.
 */
export function useShortcuts(bindings: Binding[], enabled = true): void {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const registration: Registration = {
      seq: nextSeq++,
      get bindings() {
        return latest.current;
      },
    };
    registrations.push(registration);
    if (!listening) {
      document.addEventListener('keydown', dispatch, true);
      listening = true;
    }
    return () => {
      const at = registrations.indexOf(registration);
      if (at >= 0) registrations.splice(at, 1);
      if (registrations.length === 0 && listening) {
        document.removeEventListener('keydown', dispatch, true);
        listening = false;
      }
    };
  }, [enabled]);
}

/**
 * Every labelled binding currently live, highest layer first — the F1 Help
 * sheet reads this instead of a hand-maintained list that drifts out of date.
 */
export function shortcutRegistry(): Binding[] {
  const live = registrations.flatMap((r) => r.bindings).filter((b) => b.label && !b.disabled);
  const seen = new Set<string>();
  return LAYER_ORDER.flatMap((layer) =>
    live.filter((b) => {
      if (b.layer !== layer) return false;
      // One row per key — the first binding to claim it names it.
      const combo = b.combo.toUpperCase();
      if (seen.has(combo)) return false;
      seen.add(combo);
      return true;
    }),
  );
}
