import { useState } from 'react';
import { format, startOfMonth, subDays } from 'date-fns';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { ML_COMPANY_KEY, isMlUnlocked } from '@/lib/ml-lock';
import { mergedLedgerBalances } from '@/lib/mergedLedgerBalances';
import {
  ASSET_HEADS,
  LIABILITY_HEADS,
  PL_EXPENSE_HEADS,
  PL_INCOME_HEADS,
  TRADING_EXPENSE_HEADS,
  TRADING_INCOME_HEADS,
} from '@/components/accounting/tally/heads';

const INCOME_HEADS = new Set([...TRADING_INCOME_HEADS, ...PL_INCOME_HEADS]);
const EXPENSE_HEADS = new Set([...TRADING_EXPENSE_HEADS, ...PL_EXPENSE_HEADS]);
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// Ask the books in plain language. The AI NEVER writes SQL — it only picks
// one of these safe templates and its parameters; the client runs the query.

export type Template =
  | { template: 'party_paid'; party: string; from: string; to: string }
  | { template: 'day_totals'; date: string }
  | { template: 'ledger_activity'; ledger: string; from: string; to: string }
  // A day's totals over any span — "this month's receipts", "receipts for the year".
  | { template: 'period_totals'; from: string; to: string }
  // Income against expenditure for a period, off the same ledger heads the
  // Profit & Loss screen uses, so the two can never disagree.
  | { template: 'profit_loss'; from: string; to: string }
  // What the hospital owns against what it owes, as at a date.
  | { template: 'balance_sheet'; upto: string }
  // The biggest spends of a period, ledger by ledger.
  | { template: 'top_expenses'; from: string; to: string };

export async function aiPickTemplate(question: string): Promise<Template | null> {
  const today = format(new Date(), 'yyyy-MM-dd');
  try {
    const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              `Today is ${today}. A hospital director asks about the account books: "${question}". ` +
              'Map it to EXACTLY one JSON template (no other text): ' +
              '{"template":"party_paid","party":<name>,"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} for how much was paid to someone; ' +
              '{"template":"day_totals","date":"YYYY-MM-DD"} for a single day\'s receipts/payments; ' +
              '{"template":"period_totals","from":...,"to":...} for receipts/payments over a month, year or any span; ' +
              '{"template":"ledger_activity","ledger":<name>,"from":...,"to":...} for activity in one ledger; ' +
              '{"template":"profit_loss","from":...,"to":...} for profit, loss, income vs expenditure, or earnings; ' +
              '{"template":"top_expenses","from":...,"to":...} for the biggest expenses or where money went; ' +
              '{"template":"balance_sheet","upto":"YYYY-MM-DD"} for assets, liabilities, or what we own and owe. ' +
              'Resolve relative periods yourself: "this month" is the 1st to today, "this year" is 1 April of the ' +
              'current Indian financial year to today. Default period: last 30 days. ' +
              'If unmappable return {"template":null}.',
          }],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = text ? JSON.parse(text) : null;
    return parsed?.template ? (parsed as Template) : null;
  } catch (error) {
    // Swallowing this made a dead proxy, a quota block and an unanswerable
    // question all look identical — "try rephrasing" — which is why the card
    // read as broken. Let the caller tell them apart.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function runTemplate(t: Template): Promise<string> {
  // Receipts / payments / journals across a span of days.
  if (t.template === 'period_totals') {
    const { data } = await (supabase as any)
      .from('vouchers')
      .select('total_amount, voucher_types(voucher_category), companies!vouchers_company_id_fkey(company_key)')
      .gte('voucher_date', t.from)
      .lte('voucher_date', t.to)
      .neq('status', 'CANCELLED')
      .limit(20000);
    const rows = ((data || []) as any[]).filter(
      (r) => isMlUnlocked() || r.companies?.company_key !== ML_COMPANY_KEY,
    ) as { total_amount: number; voucher_types: { voucher_category: string } | null }[];
    const sum = (c: string) =>
      rows.filter((r) => r.voucher_types?.voucher_category === c)
        .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return `${t.from} to ${t.to}: receipts ${rupees(sum('RECEIPT'))}, payments ${rupees(sum('PAYMENT'))}, journals ${rupees(sum('JOURNAL'))} — ${rows.length} vouchers.`;
  }

  // Income vs expenditure, off the same ledger heads the P&L screen uses.
  if (t.template === 'profit_loss' || t.template === 'top_expenses') {
    // Adamrit rows only. mergedLedgerBalances date-filters those, but Tally
    // rows are an undated snapshot of the last sync — mixing them in makes a
    // ten-day "profit this month" almost equal the whole year's.
    const balances = (await mergedLedgerBalances({ from: t.from, upto: t.to }))
      .filter((r) => r.source === 'adamrit');
    if (t.template === 'top_expenses') {
      const spends = balances
        .filter((r) => EXPENSE_HEADS.has(r.head) && r.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 8);
      if (!spends.length) return `No expenses recorded between ${t.from} and ${t.to}.`;
      return `Biggest spends ${t.from} to ${t.to} — ${spends.map((r) => `${r.name} ${rupees(r.balance)}`).join('; ')}. (Adamrit-posted entries only.)`;
    }
    // balance is Debit-positive, so income (a credit balance) flips sign.
    const income = balances.filter((r) => INCOME_HEADS.has(r.head))
      .reduce((s, r) => s - r.balance, 0);
    const expense = balances.filter((r) => EXPENSE_HEADS.has(r.head))
      .reduce((s, r) => s + r.balance, 0);
    const profit = income - expense;
    return `${t.from} to ${t.to}: income ${rupees(income)}, expenditure ${rupees(expense)}, ${profit >= 0 ? 'profit' : 'loss'} ${rupees(Math.abs(profit))}. (Adamrit-posted entries; Tally-imported balances are not date-bounded and are excluded.)`;
  }

  // What is owned against what is owed, as at a date.
  if (t.template === 'balance_sheet') {
    const balances = await mergedLedgerBalances({ upto: t.upto });
    const assetHeads = new Set(ASSET_HEADS);
    const liabilityHeads = new Set(LIABILITY_HEADS);
    const assets = balances.filter((r) => assetHeads.has(r.head))
      .reduce((s, r) => s + r.balance, 0);
    // Liabilities sit as credit balances; show them positive.
    const liabilities = balances.filter((r) => liabilityHeads.has(r.head))
      .reduce((s, r) => s - r.balance, 0);
    return `As at ${t.upto}: assets ${rupees(assets)}, liabilities ${rupees(liabilities)}, difference ${rupees(assets - liabilities)}. (Adamrit and Tally balances combined, as the Balance Sheet screen shows them.)`;
  }

  if (t.template === 'day_totals') {
    const { data } = await (supabase as any)
      .from('vouchers')
      .select('total_amount, voucher_types(voucher_category), companies!vouchers_company_id_fkey(company_key)')
      .eq('voucher_date', t.date)
      .neq('status', 'CANCELLED')
      .limit(3000);
    const rows = ((data || []) as any[]).filter(
      (r) => isMlUnlocked() || r.companies?.company_key !== ML_COMPANY_KEY,
    ) as { total_amount: number; voucher_types: { voucher_category: string } | null }[];
    const sum = (c: string) =>
      rows.filter((r) => r.voucher_types?.voucher_category === c)
        .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return `On ${t.date}: receipts ₹${sum('RECEIPT').toLocaleString('en-IN')}, payments ₹${sum('PAYMENT').toLocaleString('en-IN')}, journals ₹${sum('JOURNAL').toLocaleString('en-IN')} (${rows.length} vouchers).`;
  }
  // party_paid and ledger_activity both resolve a ledger by name and total its entries.
  const name = t.template === 'party_paid' ? t.party : t.ledger;
  const { data: ledgerRows } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id, account_name, companies!chart_of_accounts_company_id_fkey(company_key)')
    .ilike('account_name', `%${name}%`)
    .eq('is_active', true)
    .limit(6);
  const ledgers = ((ledgerRows || []) as any[])
    .filter((l) => isMlUnlocked() || l.companies?.company_key !== ML_COMPANY_KEY)
    .slice(0, 3);
  if (!ledgers?.length) return `No ledger matching "${name}" found.`;
  const parts: string[] = [];
  for (const ledger of ledgers) {
    const { data: entries } = await (supabase as any)
      .from('voucher_entries')
      .select('debit_amount, credit_amount, vouchers!inner(voucher_date, status)')
      .eq('account_id', ledger.id)
      .gte('vouchers.voucher_date', t.from)
      .lte('vouchers.voucher_date', t.to)
      .neq('vouchers.status', 'CANCELLED')
      .limit(2000);
    const rows = (entries || []) as { debit_amount: number; credit_amount: number }[];
    const dr = rows.reduce((s, r) => s + Number(r.debit_amount || 0), 0);
    const cr = rows.reduce((s, r) => s + Number(r.credit_amount || 0), 0);
    if (rows.length) {
      parts.push(
        t.template === 'party_paid'
          ? `${ledger.account_name}: paid ₹${dr.toLocaleString('en-IN')} across ${rows.filter((r) => Number(r.debit_amount) > 0).length} payment(s), billed ₹${cr.toLocaleString('en-IN')} (${t.from} to ${t.to})`
          : `${ledger.account_name}: Dr ₹${dr.toLocaleString('en-IN')} / Cr ₹${cr.toLocaleString('en-IN')} in ${rows.length} entries (${t.from} to ${t.to})`,
      );
    }
  }
  return parts.length ? parts.join('. ') : `No entries for "${name}" between ${t.from} and ${t.to}.`;
}

/**
 * The questions a director actually asks, wired straight to a template.
 *
 * These deliberately skip the AI: the mapping is already known, so a click is
 * instant, costs no tokens, and still answers if the model is unreachable.
 */
function faqs(): { label: string; template: Template }[] {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  // Indian financial year: 1 April to 31 March.
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const yearStart = `${fyStartYear}-04-01`;
  return [
    { label: "Today's receipts", template: { template: 'day_totals', date: today } },
    { label: 'This month', template: { template: 'period_totals', from: monthStart, to: today } },
    { label: 'This year', template: { template: 'period_totals', from: yearStart, to: today } },
    { label: 'Profit this month', template: { template: 'profit_loss', from: monthStart, to: today } },
    { label: 'Profit this year', template: { template: 'profit_loss', from: yearStart, to: today } },
    { label: 'Biggest expenses', template: { template: 'top_expenses', from: monthStart, to: today } },
    { label: 'Assets & liabilities', template: { template: 'balance_sheet', upto: today } },
  ];
}

export function AskTheBooksCard() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const common = faqs();

  const run = async (template: Template, label: string) => {
    setBusy(true);
    setAnswer(null);
    setQuestion(label);
    try {
      setAnswer(await runTemplate(template));
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : 'Could not answer.');
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const template = await aiPickTemplate(question.trim());
      if (!template) {
        setAnswer('I could not turn that into a question about the books. Try one of the buttons above, or name a ledger, a party or a period.');
      } else {
        setAnswer(await runTemplate(template));
      }
    } catch (e) {
      setAnswer(
        `${e instanceof Error ? e.message : 'Could not answer.'} — the buttons above still work; they do not use AI.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleQuestion className="h-5 w-5 text-violet-700" /> Ask the books
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="flex flex-wrap gap-1.5">
          {common.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => void run(f.template, f.label)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ask()}
            placeholder={`e.g. how much did we pay Noble since ${format(subDays(new Date(), 30), 'd MMM')}?`}
          />
          <Button disabled={busy || !question.trim()} onClick={() => void ask()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {answer && <p className="rounded border bg-slate-50 px-3 py-2 text-sm">{answer}</p>}
        <p className="text-[11px] text-muted-foreground">
          AI only picks from safe query templates — it never writes its own SQL.
        </p>
      </CardContent>
    </Card>
  );
}

export default AskTheBooksCard;
