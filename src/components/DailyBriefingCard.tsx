import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2, Newspaper, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dailyBooksBriefing } from '@/lib/accounting-ai';
import { ML_COMPANY_KEY, isMlUnlocked } from '@/lib/ml-lock';

// DATA SOURCE: today's vouchers, aggregated, narrated by AI in 3 sentences.

export function DailyBriefingCard() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const cacheKey = `adamrit_briefing_${today}`;
  const [briefing, setBriefing] = useState<string | null>(() => sessionStorage.getItem(cacheKey));
  const [busy, setBusy] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['daily-briefing-stats', today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('vouchers')
        .select('total_amount, is_auto, voucher_types(voucher_category), companies!vouchers_company_id_fkey(company_key)')
        .eq('voucher_date', today)
        .neq('status', 'CANCELLED')
        .limit(3000);
      if (error) throw error;
      // The ML books stay behind their PIN, in the briefing too.
      const rows = ((data || []) as any[]).filter(
        (r) => isMlUnlocked() || r.companies?.company_key !== ML_COMPANY_KEY,
      ) as { total_amount: number; is_auto: boolean; voucher_types: { voucher_category: string } | null }[];
      const bucket = (category: string) => {
        const of = rows.filter((r) => (r.voucher_types?.voucher_category || '') === category);
        return { count: of.length, total: of.reduce((s, r) => s + Number(r.total_amount || 0), 0) };
      };
      const { count: openAnomalies } = await (supabase as any)
        .from('voucher_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'OPEN');
      return {
        date: today,
        receipts: bucket('RECEIPT'),
        payments: bucket('PAYMENT'),
        journals: bucket('JOURNAL'),
        manualCount: rows.filter((r) => !r.is_auto).length,
        openAnomalies: openAnomalies ?? 0,
      };
    },
    staleTime: 120_000,
  });

  const generate = async () => {
    if (!stats) return;
    setBusy(true);
    const text = await dailyBooksBriefing(stats);
    const final =
      text ||
      `Today: ${stats.receipts.count} receipts (₹${stats.receipts.total.toLocaleString('en-IN')}), ${stats.payments.count} payments (₹${stats.payments.total.toLocaleString('en-IN')}), ${stats.manualCount} manual entries, ${stats.openAnomalies} open anomalies.`;
    setBriefing(final);
    sessionStorage.setItem(cacheKey, final);
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Newspaper className="h-5 w-5 text-blue-700" />
          Today's books, in plain language
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 gap-1 text-xs"
            disabled={busy || !stats}
            onClick={() => void generate()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {briefing ? 'Refresh' : 'Brief me'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {briefing ? (
          <p className="text-sm leading-relaxed">{briefing}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {stats
              ? `${stats.receipts.count + stats.payments.count + stats.journals.count} vouchers so far today. Tap "Brief me" for the three-sentence summary.`
              : "Loading today's numbers…"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default DailyBriefingCard;
