import React, { useState } from 'react';
import { TallyPopup, TallyTextField } from './TallyPopup';
import { periodLabel } from './PeriodContext';

/**
 * F2 — Tally's Change Period / Change Date pop-up: the report behind it greys
 * out, a small bordered box takes the From / To dates in Tally's d-m-yyyy
 * style, and the bottom key bar becomes Q: Quit · A: Accept.
 *
 * Tally accepts a partial date and fills in the rest: a month ("apr", "4-26")
 * becomes the 1st in From and the month end in To, a bare year becomes the
 * whole financial year. The box refuses to close on a date it cannot read or
 * on a To that falls before the From.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Month number (1-12) from "4", "apr" or "april"; 0 when it is neither. */
const monthNumber = (text: string): number => {
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= 12 ? n : 0;
  }
  return MONTHS.indexOf(text.slice(0, 3)) + 1;
};

const fullYear = (year: number): number => (year < 100 ? year + 2000 : year);

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const lastDayOf = (year: number, month: number): number => new Date(year, month, 0).getDate();

/** "1-4-2026", "1-Apr-2026", "01/04/26" → "2026-04-01" (null when unparseable) */
export const parseTallyDate = (text: string): string | null => {
  const parts = text.trim().split(/[-/.\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const day = Number(parts[0]);
  const month = monthNumber(parts[1].toLowerCase());
  const year = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(day) || !month) return null;
  if (day < 1 || day > 31) return null;
  return iso(fullYear(year), month, day);
};

/** "2026-04-01" → "1-4-2026", the format Tally types back into the field */
export const toTallyDateInput = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}-${Number(m)}-${y}`;
};

/**
 * Read a whole or partial date the way Tally does. `edge` decides which end of
 * an incomplete entry to take: 'from' → the first day, 'to' → the last.
 * `reference` supplies the year for a bare month name.
 */
export const expandTallyDate = (text: string, edge: 'from' | 'to', reference: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const exact = parseTallyDate(trimmed);
  if (exact) return exact;

  const parts = trimmed.toLowerCase().split(/[-/.\s]+/).filter(Boolean);
  const fyStartYear = Number(reference.slice(0, 4)) - (Number(reference.slice(5, 7)) >= 4 ? 0 : 1);

  // "4-26", "apr 2026" → that whole month
  if (parts.length === 2) {
    const month = monthNumber(parts[0]);
    const year = Number(parts[1]);
    if (!month || !Number.isFinite(year)) return null;
    const y = fullYear(year);
    return edge === 'from' ? iso(y, month, 1) : iso(y, month, lastDayOf(y, month));
  }

  if (parts.length === 1) {
    // A bare year is the financial year that starts in it
    if (/^\d{2}$|^\d{4}$/.test(parts[0])) {
      const y = fullYear(Number(parts[0]));
      return edge === 'from' ? `${y}-04-01` : `${y + 1}-03-31`;
    }
    // A bare month name lands in whichever year keeps it inside the current
    // financial year — "feb" during FY 2026-27 means Feb 2027, not Feb 2026.
    const month = monthNumber(parts[0]);
    if (!month) return null;
    const y = month >= 4 ? fyStartYear : fyStartYear + 1;
    return edge === 'from' ? iso(y, month, 1) : iso(y, month, lastDayOf(y, month));
  }

  return null;
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
  const [error, setError] = useState('');

  const nextFrom = expandTallyDate(fromText, 'from', from);
  const nextTo = mode === 'date' ? nextFrom : expandTallyDate(toText, 'to', from);

  const accept = () => {
    if (!nextFrom) {
      setError(mode === 'date' ? 'Enter a date, e.g. 1-4-2026' : 'Enter a From date, e.g. 1-4-2026');
      return;
    }
    if (mode === 'date') {
      onAccept(nextFrom, nextFrom);
      return;
    }
    if (!nextTo) {
      setError('Enter a To date, e.g. 31-3-2027');
      return;
    }
    if (nextTo < nextFrom) {
      setError('To date cannot be before the From date');
      return;
    }
    onAccept(nextFrom, nextTo);
  };

  return (
    <TallyPopup
      title={mode === 'date' ? 'Change Date' : 'Change Period'}
      width={mode === 'date' ? 190 : 230}
      onAccept={accept}
      onClose={onClose}
    >
      <TallyTextField
        label="From"
        labelWidth={54}
        width={86}
        value={fromText}
        onChange={(v) => {
          setFromText(v);
          setError('');
        }}
      />
      {mode === 'period' && (
        <TallyTextField
          label="To"
          labelWidth={54}
          width={86}
          value={toText}
          onChange={(v) => {
            setToText(v);
            setError('');
          }}
        />
      )}
      {error ? (
        <div className="pt-1 text-[11px] font-semibold text-[#b00020]">{error}</div>
      ) : (
        nextFrom &&
        nextTo && (
          <div className="pt-1 text-[11px] italic text-gray-600">
            {mode === 'date' ? periodLabel({ from: nextFrom, to: nextFrom }).split(' to ')[0] : periodLabel({ from: nextFrom, to: nextTo })}
          </div>
        )
      )}
    </TallyPopup>
  );
};

export default ChangePeriod;
