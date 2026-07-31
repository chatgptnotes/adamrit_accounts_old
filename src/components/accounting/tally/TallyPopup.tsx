import React, { useEffect, useRef } from 'react';
import { TALLY_FONT } from './TallyChrome';
import { useShortcuts } from './keyboard';
import { useFieldRing } from './useFieldRing';

/**
 * The shell every Tally pop-up shares — grey scrim over the report, a small
 * bordered box, and a bottom key bar that becomes Q: Quit · A: Accept while it
 * is open. Arrow keys walk the fields, so the pop-ups need no mouse.
 */

interface TallyPopupProps {
  title: string;
  /** Box width in px — Tally sizes each pop-up to its longest field */
  width?: number;
  onAccept?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export const TallyPopup: React.FC<TallyPopupProps> = ({ title, width = 260, onAccept, onClose, children }) => {
  const boxRef = useRef<HTMLDivElement>(null);

  // Focus the first field so typing and arrows work straight away
  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>('[data-tally-field]');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, []);

  // Registering on the `popup` layer is what takes the keyboard from the report
  // behind: it no longer sees Esc, or the arrow keys as row movement.
  useShortcuts([
    { combo: 'Esc', layer: 'popup', allowInInput: true, label: 'Quit the pop-up', run: onClose },
    ...(onAccept ? [{ combo: 'A', layer: 'popup' as const, label: 'Accept the pop-up', run: onAccept }] : []),
  ]);

  // Up / Down step between fields and Enter walks forward, like Tally's field
  // cursor; Enter on the last field accepts the pop-up.
  useFieldRing({ containerRef: boxRef, onAccept, arrows: true });

  return (
    <div className="fixed inset-0 z-[95] bg-[#9aa2ab]/55" onMouseDown={onClose}>
      <div
        ref={boxRef}
        style={{ ...TALLY_FONT, width }}
        className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 border border-[#7f7f7f] bg-[#eef2f7] p-2 text-[13px] shadow-[2px_2px_6px_rgba(0,0,0,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pb-2 text-center font-bold">{title}</div>
        {children}
      </div>

      {/* Tally swaps the key bar for Quit / Accept while the pop-up is open */}
      <div
        style={TALLY_FONT}
        className="absolute inset-x-0 bottom-0 flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {[
          { hotkey: 'Q', label: 'Quit', onClick: onClose },
          ...(onAccept ? [{ hotkey: 'A', label: 'Accept', onClick: onAccept }] : []),
        ].map((b) => (
          <button
            key={b.hotkey}
            type="button"
            onClick={b.onClick}
            className="flex min-h-8 items-center border border-[#9db8d8] bg-white px-3 py-0.5 text-[13px] text-black hover:bg-[#fdf6d8]"
          >
            <span className="inline-flex min-w-[44px] shrink-0 pr-1 font-semibold text-[#1d5aa8]">
              <span className="underline">{b.hotkey}</span>:
            </span>{' '}
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
};

/** A "Label : value" row whose value is typed into an amber field. */
export const TallyTextField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: number;
  labelWidth?: number;
}> = ({ label, value, onChange, width = 90, labelWidth = 110 }) => (
  <div className="flex items-center py-0.5">
    <span style={{ width: labelWidth }}>{label}</span>
    <span className="pr-2">:</span>
    <input
      data-tally-field
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className="border border-[#c8a020] bg-[#ffe9a8] px-1 text-[13px] font-semibold text-black focus:outline-none"
    />
  </div>
);

/** A "Label : value" row whose value cycles through a fixed list of choices. */
export function TallyChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
  width = 90,
  labelWidth = 110,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  width?: number;
  labelWidth?: number;
}) {
  const step = (delta: number) => {
    const at = options.indexOf(value);
    onChange(options[(at + delta + options.length) % options.length]);
  };
  return (
    <div className="flex items-center py-0.5">
      <span style={{ width: labelWidth }}>{label}</span>
      <span className="pr-2">:</span>
      <button
        data-tally-field
        type="button"
        onClick={() => step(1)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            step(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            step(-1);
          }
        }}
        style={{ width }}
        title="Enter / ← → to change"
        className="border border-[#c8a020] bg-[#ffe9a8] px-1 text-left text-[13px] font-semibold text-black focus:bg-[#ffd76a] focus:outline-none"
      >
        {value}
      </button>
    </div>
  );
}

/** Tally's keyboard-walked "List of …" pop-up: arrows move, Enter picks. */
export const TallyList: React.FC<{
  title: string;
  items: { label: string; onSelect: () => void; active?: boolean }[];
  onClose: () => void;
  width?: number;
}> = ({ title, items, onClose, width = 300 }) => {
  const [cursor, setCursor] = React.useState(() => Math.max(0, items.findIndex((i) => i.active)));

  useShortcuts([
    { combo: 'Esc', layer: 'popup', allowInInput: true, run: onClose },
    { combo: 'Q', layer: 'popup', label: 'Quit the list', run: onClose },
    {
      combo: 'ArrowDown',
      layer: 'popup',
      allowInInput: true,
      run: () => setCursor((c) => Math.min(items.length - 1, c + 1)),
    },
    { combo: 'ArrowUp', layer: 'popup', allowInInput: true, run: () => setCursor((c) => Math.max(0, c - 1)) },
    { combo: 'Enter', layer: 'popup', allowInInput: true, run: () => items[cursor]?.onSelect() },
  ]);

  return (
    <div className="fixed inset-0 z-[95] bg-[#9aa2ab]/55" onMouseDown={onClose}>
      <div
        style={{ ...TALLY_FONT, width }}
        className="absolute left-1/2 top-[40%] max-h-[70vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-[#8fb0d4] bg-[#dfeaf7] shadow-[2px_2px_6px_rgba(0,0,0,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bg-[#2a68a8] py-[3px] text-center text-[13px] font-semibold text-white">{title}</div>
        <div className="py-1">
          {items.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={item.onSelect}
              className={`block w-full px-4 py-[2px] text-left text-[13px] leading-[18px] ${
                i === cursor ? 'bg-[#ffc423] text-black' : 'text-[#1a4d8f]'
              }`}
            >
              {item.label}
              {item.active && <span className="pl-2 text-[11px] italic">(current)</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
