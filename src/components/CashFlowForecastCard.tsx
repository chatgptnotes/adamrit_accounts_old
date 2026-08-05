import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, subDays } from 'date-fns';
import { Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL_LITE } from '@/lib/gemini';

// 7-day cash outlook: committed daily obligations vs what a typical day
// actually collects (14-day average), with an AI one-liner on the risk.

export function CashFlowForecastCard() {
  const [aiLine, setAiLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['cash-flow-forecast'],
    staleTime: 300_000,
    queryFn: async () => {
      const since = format(subDays(new Date(), 14), 'yyyy-MM-dd');
      const [{ data: obligations }, { data: receipts }] = await Promise.all([
        (supabase as any)
          .from('payment_obligations')
          .select('party_name, default_daily_amount')
          .eq('is_active', true)
          .not('notes', 'ilike', 'DAILY_ALLOCATION_EXECUTION%')
          .not('notes', 'ilike', 'Created from Daily Allocation%'),
        (supabase as any)
          .from('vouchers')
          .select('voucher_date, total_amount, voucher_types!inner(voucher_category)')
          .eq('voucher_types.voucher_category', 'RECEIPT')
          .gte('voucher_date', since)
          .neq('status', 'CANCELLED')
          .limit(3000),
      ]);
      const dailyOut = (obligations || []).reduce(
        (sum: number, o: any) => sum + Number(o.default_daily_amount || 0), 0);
      const byDay = new Map<string, number>();
      for (const r of receipts || []) {
        byDay.set(r.voucher_date, (byDay.get(r.voucher_date) || 0) + Number(r.total_amount || 0));
      }
      const days = byDay.size || 1;
      const dailyIn = [...byDay.values()].reduce((a, b) => a + b, 0) / days;
      return {
        dailyOut,
        dailyIn: Math.round(dailyIn),
        obligationCount: (obligations || []).length,
        week: Array.from({ length: 7 }, (_, i) => ({
          day: format(addDays(new Date(), i), 'EEE d'),
          net: Math.round(dailyIn - dailyOut),
        })),
      };
    },
  });

  const explain = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text:
                `Hospital cash outlook: committed daily obligations Rs ${data.dailyOut} across ${data.obligationCount} parties; ` +
                `typical daily collections Rs ${data.dailyIn} (14-day average). ` +
                'Return ONLY JSON {"line": string} - one sentence for the director: is the week comfortable, tight, or short, and roughly by how much per day.',
            }],
          }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      });
      const body = await response.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      setAiLine(text ? JSON.parse(text).line : null);
    } catch {
      setAiLine(null);
    } finally {
      setBusy(false);
    }
  };

  const net = data ? data.dailyIn - data.dailyOut : 0;

  return (
    <Card className={data && net < 0 ? 'border-amber-400' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-5 w-5 text-emerald-700" /> Cash outlook, next 7 days
          <Button
            variant="outline" size="sm" className="ml-auto h-7 gap-1 text-xs"
            disabled={busy || !data} onClick={() => void explain()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Explain
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!data ? (
          <p className="text-sm text-muted-foreground">Working it out…</p>
        ) : (
          <>
            <p className="text-sm">
              Committed obligations <b>₹{data.dailyOut.toLocaleString('en-IN')}/day</b> ({data.obligationCount} parties)
              against typical collections <b>₹{data.dailyIn.toLocaleString('en-IN')}/day</b> —{' '}
              <b className={net < 0 ? 'text-amber-700' : 'text-emerald-700'}>
                {net < 0 ? `short ₹${Math.abs(net).toLocaleString('en-IN')}/day` : `headroom ₹${net.toLocaleString('en-IN')}/day`}
              </b>.
            </p>
            {aiLine && <p className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">{aiLine}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default CashFlowForecastCard;
