import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL_LITE } from '@/lib/gemini';

// Ask the books in plain language. The AI NEVER writes SQL — it only picks
// one of these safe templates and its parameters; the client runs the query.

export type Template =
  | { template: 'party_paid'; party: string; from: string; to: string }
  | { template: 'day_totals'; date: string }
  | { template: 'ledger_activity'; ledger: string; from: string; to: string };

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
              '{"template":"day_totals","date":"YYYY-MM-DD"} for a day\'s receipts/payments; ' +
              '{"template":"ledger_activity","ledger":<name>,"from":...,"to":...} for activity in a ledger. ' +
              'Default period: last 30 days. If unmappable return {"template":null}.',
          }],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = text ? JSON.parse(text) : null;
    return parsed?.template ? (parsed as Template) : null;
  } catch {
    return null;
  }
}

export async function runTemplate(t: Template): Promise<string> {
  if (t.template === 'day_totals') {
    const { data } = await (supabase as any)
      .from('vouchers')
      .select('total_amount, voucher_types(voucher_category)')
      .eq('voucher_date', t.date)
      .neq('status', 'CANCELLED')
      .limit(3000);
    const rows = (data || []) as { total_amount: number; voucher_types: { voucher_category: string } | null }[];
    const sum = (c: string) =>
      rows.filter((r) => r.voucher_types?.voucher_category === c)
        .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return `On ${t.date}: receipts ₹${sum('RECEIPT').toLocaleString('en-IN')}, payments ₹${sum('PAYMENT').toLocaleString('en-IN')}, journals ₹${sum('JOURNAL').toLocaleString('en-IN')} (${rows.length} vouchers).`;
  }
  // party_paid and ledger_activity both resolve a ledger by name and total its entries.
  const name = t.template === 'party_paid' ? t.party : t.ledger;
  const { data: ledgers } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id, account_name')
    .ilike('account_name', `%${name}%`)
    .eq('is_active', true)
    .limit(3);
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

export function AskTheBooksCard() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const template = await aiPickTemplate(question.trim());
      if (!template) {
        setAnswer('I can answer: how much we paid someone, a day\'s totals, or a ledger\'s activity. Try rephrasing.');
      } else {
        setAnswer(await runTemplate(template));
      }
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : 'Could not answer.');
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
