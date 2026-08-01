import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  headOfType,
  normalizeGroup,
  TRADING_INCOME_HEADS,
  PL_INCOME_HEADS,
  TRADING_EXPENSE_HEADS,
  PL_EXPENSE_HEADS,
} from '@/components/accounting/tally/heads';

// Feeds the director dashboard's "Sys" figures from the accounting ledgers —
// the same book the Trial Balance reads: chart_of_accounts opening balances
// (Tally's close at the 2026-07-25 cutover) plus AUTHORISED voucher movements.
// All companies together, because the owner is looking at the whole business.
//
// Months are calendar months of the given year. Flow figures (income, expense)
// are that month's movement; position figures (receivables, payables) are the
// balance as on the 1st of the month, and cash is the balance at month end.
// Months that have not started yet stay undefined, which the matrix shows
// as "—" rather than a misleading zero.

/** monthIndex (0-11) → ₹ */
export type MonthValues = Record<number, number>;
/** row label → monthIndex → ₹ */
export type RowValues = Record<string, MonthValues>;

export interface DirectorLedgerFigures {
  /** Ledger-derived income rows (group names), largest year total first. */
  incomeRows: string[];
  income: RowValues;
  expenseRows: string[];
  expense: RowValues;
  receivableRows: string[];
  receivables: RowValues;
  payableRows: string[];
  payables: RowValues;
  cash: RowValues;
  marketing: RowValues;
}

interface AccountRow {
  id: string;
  account_name: string;
  account_type: string;
  account_group: string | null;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

const INCOME_HEADS = new Set([...TRADING_INCOME_HEADS, ...PL_INCOME_HEADS]);
const EXPENSE_HEADS = new Set([...TRADING_EXPENSE_HEADS, ...PL_EXPENSE_HEADS]);

/**
 * Does this account's group chain pass through one of the target groups?
 * Custom Tally groups ("Consultant", "Pharmacy Vendor") descend from primary
 * groups ("Sundry Creditors") via tally_groups.parent_group.
 */
const chainReaches = (
  group: string | null,
  parents: Map<string, string>,
  matches: (key: string) => boolean,
): boolean => {
  let current = group;
  const seen = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    const key = normalizeGroup(current);
    if (!key || seen.has(key)) return false;
    if (matches(key)) return true;
    seen.add(key);
    const parent = parents.get(key);
    if (!parent) return false;
    current = parent;
  }
  return false;
};

// Group names are typed by people — "Sundry Creditors", "Sundary Creditor -
// Contractor" — so match on the word, not the exact name.
const isDebtorGroup = (key: string) => key.includes('debtor');
const isCreditorGroup = (key: string) => key.includes('creditor');
const isCashGroup = (key: string) => key.includes('cash in hand') || key === 'cash';
const isBankGroup = (key: string) => key === 'bank accounts' || key === 'bank';

const add = (values: RowValues, row: string, month: number, amount: number) => {
  if (!amount) return;
  values[row] = { ...(values[row] ?? {}) };
  values[row][month] = (values[row][month] ?? 0) + amount;
};

export function useDirectorLedgerFigures(year: number) {
  return useQuery({
    queryKey: ['director-ledger-figures', year],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DirectorLedgerFigures> => {
      const [accounts, groupRows, entries, revenueRows] = await Promise.all([
        fetchActiveAccounts<AccountRow>({
          columns:
            'id, account_name, account_type, account_group, opening_balance, opening_balance_type',
        }),
        fetchAllRows<{ name: string | null; parent_group: string | null }>((from, to) =>
          (supabase as any).from('tally_groups').select('name, parent_group').range(from, to),
        ),
        // Every authorised movement up to the year end. The live book starts
        // at the 2026-07-25 cutover, so this stays small.
        fetchAllRows<{
          account_id: string;
          debit_amount: number | null;
          credit_amount: number | null;
          voucher: { voucher_date: string };
        }>((from, to) =>
          (supabase as any)
            .from('voucher_entries')
            .select('account_id, debit_amount, credit_amount, voucher:vouchers!inner(voucher_date, status)')
            .eq('voucher.status', 'AUTHORISED')
            .lte('voucher.voucher_date', `${year}-12-31`)
            .range(from, to),
        ),
        fetchAllRows<{ rm_name: string | null; cost: number | null; entry_date: string }>(
          (from, to) =>
            (supabase as any)
              .from('daily_revenue_entries')
              .select('rm_name, cost, entry_date')
              .eq('is_hidden', false)
              .gte('entry_date', `${year}-01-01`)
              .lte('entry_date', `${year}-12-31`)
              .range(from, to),
        ),
      ]);

      const parents = new Map<string, string>();
      for (const g of groupRows) {
        const key = normalizeGroup(g.name);
        if (key && g.parent_group) parents.set(key, g.parent_group);
      }

      // Per-account movement buckets: pre-year total plus one per month.
      const movement = new Map<string, { pre: number; months: number[] }>();
      for (const e of entries) {
        const signed = (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0);
        if (!signed) continue;
        const date = new Date(e.voucher.voucher_date);
        const bucket = movement.get(e.account_id) ?? { pre: 0, months: Array(12).fill(0) };
        if (date.getFullYear() < year) bucket.pre += signed;
        else bucket.months[date.getMonth()] += signed;
        movement.set(e.account_id, bucket);
      }

      const now = new Date();
      const lastFlowMonth =
        year < now.getFullYear() ? 11 : year > now.getFullYear() ? -1 : now.getMonth();
      // A position "as on the 1st" exists once that 1st has arrived.
      const lastPositionMonth = lastFlowMonth;

      const income: RowValues = {};
      const expense: RowValues = {};
      const receivables: RowValues = {};
      const payables: RowValues = {};
      const cash: RowValues = {};
      const incomeTotals = new Map<string, number>();
      const expenseTotals = new Map<string, number>();
      const receivableTotals = new Map<string, number>();
      const payableTotals = new Map<string, number>();

      for (const account of accounts) {
        const head = headOfType(account.account_type);
        const m = movement.get(account.id);
        const groupLabel = (account.account_group || '').trim() || head || 'Ungrouped';

        if (head && INCOME_HEADS.has(head)) {
          for (let month = 0; month <= lastFlowMonth; month += 1) {
            const earned = -(m?.months[month] ?? 0); // income is credit-natured
            add(income, groupLabel, month, earned);
            incomeTotals.set(groupLabel, (incomeTotals.get(groupLabel) ?? 0) + earned);
          }
          continue;
        }
        if (head && EXPENSE_HEADS.has(head)) {
          for (let month = 0; month <= lastFlowMonth; month += 1) {
            const spent = m?.months[month] ?? 0;
            add(expense, groupLabel, month, spent);
            expenseTotals.set(groupLabel, (expenseTotals.get(groupLabel) ?? 0) + spent);
          }
          continue;
        }

        const isDebtor = chainReaches(account.account_group, parents, isDebtorGroup);
        const isCreditor = !isDebtor && chainReaches(account.account_group, parents, isCreditorGroup);
        const isCash = !isDebtor && !isCreditor && chainReaches(account.account_group, parents, isCashGroup);
        const isBank =
          !isDebtor && !isCreditor && !isCash && chainReaches(account.account_group, parents, isBankGroup);
        if (!isDebtor && !isCreditor && !isCash && !isBank) continue;

        const opening =
          (Number(account.opening_balance) || 0) *
          (account.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
        let running = opening + (m?.pre ?? 0);

        for (let month = 0; month <= Math.max(lastPositionMonth, lastFlowMonth); month += 1) {
          // `running` here is the balance as on the 1st of `month`.
          if (isDebtor && month <= lastPositionMonth) {
            add(receivables, groupLabel, month, running);
            receivableTotals.set(groupLabel, (receivableTotals.get(groupLabel) ?? 0) + Math.abs(running));
          }
          if (isCreditor && month <= lastPositionMonth) {
            add(payables, groupLabel, month, -running);
            payableTotals.set(groupLabel, (payableTotals.get(groupLabel) ?? 0) + Math.abs(running));
          }
          running += m?.months[month] ?? 0;
          // And now it is the balance at the end of `month`.
          if ((isCash || isBank) && month <= lastFlowMonth) {
            add(cash, isCash ? 'Cash in Hand (Tilak)' : 'Cash in Bank (Tilak)', month, running);
          }
        }
      }

      // Marketing executive revenue: business brought in per RM, from the
      // Daily Revenue Report entries.
      const marketing: RowValues = {};
      for (const r of revenueRows) {
        const name = (r.rm_name || '').trim();
        if (!name) continue;
        add(marketing, name.toLowerCase(), new Date(r.entry_date).getMonth(), Number(r.cost) || 0);
      }

      const rowsByTotal = (totals: Map<string, number>) =>
        Array.from(totals.entries())
          .filter(([, total]) => Math.abs(total) >= 0.5)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .map(([label]) => label);

      return {
        incomeRows: rowsByTotal(incomeTotals),
        income,
        expenseRows: rowsByTotal(expenseTotals),
        expense,
        receivableRows: rowsByTotal(receivableTotals),
        receivables,
        payableRows: rowsByTotal(payableTotals),
        payables,
        cash,
        marketing,
      };
    },
  });
}
