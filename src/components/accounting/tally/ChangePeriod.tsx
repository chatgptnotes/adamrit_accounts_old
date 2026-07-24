import React, { useState } from 'react';
import { TallyPopup, TallyTextField } from './TallyPopup';

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

  const accept = () => {
    const nextFrom = parseTallyDate(fromText);
    if (!nextFrom) return;
    if (mode === 'date') {
      onAccept(nextFrom, nextFrom);
      return;
    }
    const nextTo = parseTallyDate(toText);
    if (!nextTo) return;
    onAccept(nextFrom, nextTo);
  };

  return (
    <TallyPopup
      title={mode === 'date' ? 'Change Date' : 'Change Period'}
      width={190}
      onAccept={accept}
      onClose={onClose}
    >
      <TallyTextField label="From" labelWidth={54} width={86} value={fromText} onChange={setFromText} />
      {mode === 'period' && (
        <TallyTextField label="To" labelWidth={54} width={86} value={toText} onChange={setToText} />
      )}
    </TallyPopup>
  );
};

export default ChangePeriod;
