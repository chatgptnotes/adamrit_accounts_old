import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Tally keeps one Current Period and one Current Date per company: change the
 * period in Ledger Vouchers and Trial Balance opens on the same dates, and it
 * survives closing the company. This context is that single period, shared by
 * every accounting screen through `useTallyReport`.
 */

export interface AccountingPeriod {
  from: string;
  to: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD" in local time (never via toISOString, which shifts UTC). */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = (): string => isoDate(new Date());

/** Move an ISO date by whole days — negative goes back. */
export const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

/** The day before an ISO date — the cut-off for a period's opening balance. */
export const dayBefore = (iso: string): string => addDays(iso, -1);

/** The financial year (1-Apr → 31-Mar) containing `on` — Tally's Current Period. */
export const currentFinancialYear = (on: Date = new Date()): AccountingPeriod => {
  const year = on.getMonth() >= 3 ? on.getFullYear() : on.getFullYear() - 1;
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
};

/** Calendar year the financial year starts in — for month grids keyed to the FY. */
export const financialYearStartYear = (period: AccountingPeriod): number =>
  Number(period.from.slice(0, 4)) - (Number(period.from.slice(5, 7)) >= 4 ? 0 : 1);

/**
 * PgDn / PgUp: shift the period forward or back by its own length. A period of
 * whole months moves a whole month at a time (Tally's behaviour — Jul → Aug,
 * not Jul → 31 days later); anything else moves by its day count.
 */
export const stepPeriod = (period: AccountingPeriod, direction: 1 | -1): AccountingPeriod => {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return period;

  const lastDayOfMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
  const wholeMonths =
    from.getDate() === 1 && to.getDate() === lastDayOfMonth
      ? (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
      : 0;

  if (wholeMonths > 0) {
    const nextFrom = new Date(from.getFullYear(), from.getMonth() + direction * wholeMonths, 1);
    const nextTo = new Date(nextFrom.getFullYear(), nextFrom.getMonth() + wholeMonths, 0);
    return { from: isoDate(nextFrom), to: isoDate(nextTo) };
  }

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return { from: addDays(period.from, direction * days), to: addDays(period.to, direction * days) };
};

/**
 * The months a period covers, as Tally's monthly report rows. Each row is
 * clipped to the period, so a period ending mid-month stops there instead of
 * padding out to 31-Mar the way a hardcoded financial-year grid does.
 */
export const monthsInPeriod = (
  period: AccountingPeriod,
): { label: string; ym: string; from: string; upto: string }[] => {
  const start = new Date(`${period.from}T00:00:00`);
  const end = new Date(`${period.to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const out: { label: string; ym: string; from: string; upto: string }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  // 60 months is already far past what fits on a report page
  while (cursor <= end && out.length < 60) {
    const monthStart = cursor < start ? start : cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    out.push({
      label: cursor.toLocaleDateString('en-GB', { month: 'long', year: '2-digit' }).replace(' ', '-'),
      ym: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`,
      from: isoDate(monthStart),
      upto: isoDate(monthEnd > end ? end : monthEnd),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
};

/** "31-Mar-27" — how Tally writes a single date, everywhere. */
export const dayLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}-${d.toLocaleDateString('en-GB', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;
};

/** "1-Apr-26 to 31-Mar-27" — the caption Tally prints under every report title. */
export const periodLabel = (period: AccountingPeriod): string =>
  `${dayLabel(period.from)} to ${dayLabel(period.to)}`;

interface AccountingPeriodContextValue {
  period: AccountingPeriod;
  setPeriod: (period: AccountingPeriod) => void;
  /** Screen-specific periods survive report switching while Accounting stays mounted. */
  screenPeriods: Record<string, AccountingPeriod>;
  setScreenPeriod: (screenKey: string, period: AccountingPeriod) => void;
  /** Tally's Current Date — the Gateway clock and the Day Book's default day */
  currentDate: string;
  setCurrentDate: (date: string) => void;
}

const AccountingPeriodContext = createContext<AccountingPeriodContextValue | null>(null);

/**
 * Bumped from 'accounting-period' on 15 Aug 2026 to discard every period
 * already saved in a browser, once.
 *
 * The default here has always been the current financial year, but the saved
 * value wins — and Dr M's had been left on 14-Aug-26 to 14-Aug-26. One day.
 * Every report obeys it, so patient and RM ledgers, which post once or twice
 * in their lives, showed nothing at all and read as though the postings had
 * never happened. Cash looked fine beside them because cash posts daily.
 *
 * Renaming the key is the whole reset: the old value is not read, so everyone
 * lands on this financial year on their next load without touching a button.
 * The old key is then removed so it does not sit in storage for ever.
 *
 * Periods still persist. Choosing one deliberately -- a month-end job, an audit
 * window -- survives a reload exactly as Tally's does, because that is the
 * behaviour this context exists to reproduce. What does not survive is a
 * narrow period nobody remembers setting.
 */
const STORAGE_KEY = 'accounting-period-fy';
const LEGACY_STORAGE_KEY = 'accounting-period';

const storedPeriod = (): AccountingPeriod => {
  const fallback = currentFinancialYear();
  try {
    // Clear the pre-reset preference. Best-effort: a storage that refuses to
    // remove a key must not stop the accounts module loading.
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const valid = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (raw && valid(raw.from) && valid(raw.to) && raw.from <= raw.to) return { from: raw.from, to: raw.to };
  } catch {
    // corrupt preference — fall through to the current financial year
  }
  return fallback;
};

export const AccountingPeriodProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [period, setPeriodState] = useState<AccountingPeriod>(storedPeriod);
  const [screenPeriods, setScreenPeriods] = useState<Record<string, AccountingPeriod>>({});
  const [currentDate, setCurrentDate] = useState<string>(todayISO);

  const setPeriod = useCallback((next: AccountingPeriod) => {
    setPeriodState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // private mode / quota — the period still applies for this session
    }
  }, []);

  const setScreenPeriod = useCallback((screenKey: string, next: AccountingPeriod) => {
    setScreenPeriods((current) => ({ ...current, [screenKey]: next }));
  }, []);

  const value = useMemo(
    () => ({ period, setPeriod, screenPeriods, setScreenPeriod, currentDate, setCurrentDate }),
    [period, setPeriod, screenPeriods, setScreenPeriod, currentDate],
  );

  return <AccountingPeriodContext.Provider value={value}>{children}</AccountingPeriodContext.Provider>;
};

/** Null outside the provider, so a screen rendered on its own still works. */
export const useAccountingPeriodOptional = (): AccountingPeriodContextValue | null =>
  useContext(AccountingPeriodContext);

export const useAccountingPeriod = (): AccountingPeriodContextValue => {
  const context = useContext(AccountingPeriodContext);
  if (!context) throw new Error('useAccountingPeriod must be used inside AccountingPeriodProvider');
  return context;
};
