import React, { useState } from 'react';
import { TallyPopup, TallyTextField, TallyChoiceField } from './TallyPopup';
import { parseTallyDate, toTallyDateInput } from './ChangePeriod';
import { dayLabel, isoDate } from './PeriodContext';

/**
 * C: New Column / A: Alter Column — a second period shown beside the report's
 * own figures. N: Auto Column fills the period with a month / quarter / year
 * breakup in one go.
 */

export interface PeriodColumn {
  id: string;
  title: string;
  from: string;
  to: string;
}

/**
 * Shift an ISO date back a whole year — Tally's default comparison column.
 *
 * Formatted with `isoDate`, not `toISOString`: the latter converts to UTC
 * first, so east of Greenwich every column date came out a day early.
 */
export const shiftYear = (iso: string, years = -1): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return isoDate(d);
};

export const columnTitle = (from: string, to: string): string => `${dayLabel(from)} to ${dayLabel(to)}`;

export const ColumnBox: React.FC<{
  title: string;
  column: Omit<PeriodColumn, 'id'>;
  onAccept: (column: Omit<PeriodColumn, 'id'>) => void;
  onClose: () => void;
}> = ({ title, column, onAccept, onClose }) => {
  const [fromText, setFromText] = useState(() => toTallyDateInput(column.from));
  const [toText, setToText] = useState(() => toTallyDateInput(column.to));
  const [heading, setHeading] = useState(column.title);

  return (
    <TallyPopup
      title={title}
      width={310}
      onClose={onClose}
      onAccept={() => {
        const from = parseTallyDate(fromText);
        const to = parseTallyDate(toText);
        if (!from || !to) return;
        onAccept({ from, to, title: heading.trim() || columnTitle(from, to) });
      }}
    >
      <TallyTextField label="From" labelWidth={72} width={96} value={fromText} onChange={setFromText} />
      <TallyTextField label="To" labelWidth={72} width={96} value={toText} onChange={setToText} />
      <TallyTextField label="Column heading" labelWidth={106} width={150} value={heading} onChange={setHeading} />
    </TallyPopup>
  );
};

const BREAKUPS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'] as const;
export type Breakup = (typeof BREAKUPS)[number];

const MONTHS_PER: Record<Breakup, number> = { Monthly: 1, Quarterly: 3, 'Half-Yearly': 6, Yearly: 12 };

/** Split [from, to] into consecutive columns of the chosen length. */
export const autoColumns = (from: string, to: string, breakup: Breakup): Omit<PeriodColumn, 'id'>[] => {
  const step = MONTHS_PER[breakup];
  const end = new Date(`${to}T00:00:00`);
  const out: Omit<PeriodColumn, 'id'>[] = [];
  let start = new Date(`${from}T00:00:00`);
  // 24 columns is already far past what fits on a report page
  while (start <= end && out.length < 24) {
    const stop = new Date(start.getFullYear(), start.getMonth() + step, 0);
    const colTo = stop > end ? end : stop;
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ from: iso(start), to: iso(colTo), title: columnTitle(iso(start), iso(colTo)) });
    start = new Date(start.getFullYear(), start.getMonth() + step, 1);
  }
  return out;
};

export const AutoColumnBox: React.FC<{
  from: string;
  to: string;
  onAccept: (columns: Omit<PeriodColumn, 'id'>[]) => void;
  onClose: () => void;
}> = ({ from, to, onAccept, onClose }) => {
  const [breakup, setBreakup] = useState<Breakup>('Monthly');
  const preview = autoColumns(from, to, breakup);

  return (
    <TallyPopup
      title="Auto Column"
      width={300}
      onClose={onClose}
      onAccept={() => onAccept(autoColumns(from, to, breakup))}
    >
      <TallyChoiceField<Breakup>
        label="Column period"
        value={breakup}
        options={BREAKUPS}
        onChange={setBreakup}
        width={110}
      />
      <div className="pt-2 text-[11px] italic text-gray-500">
        {preview.length} column{preview.length === 1 ? '' : 's'} over {columnTitle(from, to)}
      </div>
    </TallyPopup>
  );
};
