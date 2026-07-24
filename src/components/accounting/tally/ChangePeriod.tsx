import React, { useEffect, useRef, useState } from 'react';
import { TALLY_FONT } from './TallyChrome';

/**
 * F2 — Tally's Change Period / Change Date pop-up: the report behind it greys
 * out, a small bordered box takes the From / To dates in Tally's d-m-yyyy
 * style, and the bottom key bar becomes Q: Quit · A: Accept.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "1-4-2026", "1-Apr-2026", "01/04/26" → "2026-04-01" (null when unparseable) */
export const parseTallyDate = (text: string): string | null => {
  const parts = text.trim().split(/[-/.\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const day = Number(parts[0]);
  const monthText = parts[1].toLowerCase();
  const month = /^\d+$/.test(monthText) ? Number(monthText) : MONTHS.indexOf(monthText.slice(0, 3)) + 1;
  let year = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(day) || !month) return null;
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** "2026-04-01" → "1-4-2026", the format Tally types back into the field */
export const toTallyDateInput = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}-${Number(m)}-${y}`;
};

interface ChangePeriodProps {
  /** 'period' asks From + To; 'date' asks a single date (Gateway's F2) */
  mode?: 'period' | 'date';
  from: string;
  to?: string;
  onAccept: (from: string, to: string) => void;
  onClose: () => void;
}

const ChangePeriod: React.FC<ChangePeriodProps> = ({ mode = 'period', from, to, onAccept, onClose }) => {
  const [fromText, setFromText] = useState(() => toTallyDateInput(from));
  const [toText, setToText] = useState(() => (to ? toTallyDateInput(to) : ''));
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fromRef.current?.focus();
    fromRef.current?.select();
  }, []);

  const accept = () => {
    const nextFrom = parseTallyDate(fromText);
    if (!nextFrom) {
      fromRef.current?.focus();
      fromRef.current?.select();
      return;
    }
    if (mode === 'date') {
      onAccept(nextFrom, nextFrom);
      return;
    }
    const nextTo = parseTallyDate(toText);
    if (!nextTo) {
      toRef.current?.focus();
      toRef.current?.select();
      return;
    }
    onAccept(nextFrom, nextTo);
  };

  // Esc quits before any screen-level Esc handling runs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    ref: React.RefObject<HTMLInputElement>,
    onEnter: () => void,
  ) => (
    <div className="flex items-center py-0.5">
      <span className="w-16">{label}</span>
      <span className="pr-2">:</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-[70px] border border-[#c8a020] bg-[#ffe9a8] px-1 text-[13px] font-semibold text-black focus:outline-none"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[95] bg-[#9aa2ab]/55" onMouseDown={onClose}>
      <div
        style={TALLY_FONT}
        className="absolute left-1/2 top-[45%] w-[170px] -translate-x-1/2 -translate-y-1/2 border border-[#7f7f7f] bg-[#eef2f7] p-2 text-[13px] shadow-[2px_2px_6px_rgba(0,0,0,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pb-2 text-center font-bold">{mode === 'date' ? 'Change Date' : 'Change Period'}</div>
        {field('From', fromText, setFromText, fromRef, () => (mode === 'date' ? accept() : toRef.current?.focus()))}
        {mode === 'period' && field('To', toText, setToText, toRef, accept)}
      </div>

      {/* Tally swaps the key bar for Quit / Accept while the pop-up is open */}
      <div
        style={TALLY_FONT}
        className="absolute inset-x-0 bottom-0 flex items-stretch gap-px border-t border-[#9db8d8] bg-[#cfe0f1] px-1 py-0.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {[
          { hotkey: 'Q', label: 'Quit', onClick: onClose },
          { hotkey: 'A', label: 'Accept', onClick: accept },
        ].map((b) => (
          <button
            key={b.hotkey}
            type="button"
            onClick={b.onClick}
            className="flex min-h-8 items-center border border-[#9db8d8] bg-white px-3 py-0.5 text-[13px] text-black hover:bg-[#fdf6d8]"
          >
            <span className="inline-flex w-11 shrink-0 font-semibold text-[#1d5aa8]">
              <span className="underline">{b.hotkey}</span>:
            </span>{' '}
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChangePeriod;
