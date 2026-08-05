import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { explainAnomalies } from '@/lib/accounting-ai';

// DATA SOURCE: voucher_anomalies via run_anomaly_scan() — duplicates,
// outsized payments, near-ceiling spots, odd-hour entries.

interface Anomaly {
  id: string;
  kind: string;
  detail: string;
  amount: number;
  voucher_numbers: string | null;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  DUPLICATE: 'Possible duplicate',
  OUTSIZED: 'Far above usual',
  NEAR_CEILING: 'Near spot ceiling',
  ODD_HOURS: 'Odd-hour entry',
};

/** The AI anomaly guard: deterministic checks, AI tells you where to look first. */
export function AnomalyGuardCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const { data: anomalies = [], isLoading, isError } = useQuery({
    queryKey: ['voucher-anomalies'],
    queryFn: async (): Promise<Anomaly[]> => {
      const { data, error } = await (supabase as any)
        .from('voucher_anomalies')
        .select('id, kind, detail, amount, voucher_numbers, created_at')
        .eq('status', 'OPEN')
        .order('amount', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data || []) as Anomaly[];
    },
    staleTime: 60_000,
  });

  const scan = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('run_anomaly_scan', { p_days: 3 });
      if (error) throw new Error(error.message);
      return data as { new: number; open: number };
    },
    onSuccess: (result) => {
      toast.success(`Scan done — ${result.new} new finding(s), ${result.open} open.`);
      queryClient.invalidateQueries({ queryKey: ['voucher-anomalies'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Scan failed'),
  });

  const review = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('voucher_anomalies')
        .update({ status: 'REVIEWED', reviewed_by: user?.email || null })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['voucher-anomalies'] }),
  });

  const askAi = async () => {
    setAiBusy(true);
    const summary = await explainAnomalies(
      anomalies.map((a) => ({ kind: a.kind, detail: a.detail, amount: Number(a.amount) })),
    );
    setAiSummary(summary || 'AI could not summarise — review the list below directly.');
    setAiBusy(false);
  };

  return (
    <Card className={anomalies.length > 0 ? 'border-red-400' : 'border-emerald-300'}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {anomalies.length > 0 ? (
            <ShieldAlert className="h-5 w-5 text-red-600" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          )}
          Anomaly guard
          <span className="ml-auto flex items-center gap-2">
            {anomalies.length > 0 && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={aiBusy} onClick={() => void askAi()}>
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                What first?
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={scan.isPending} onClick={() => scan.mutate()}>
              {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Scan now
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {aiSummary && (
          <p className="mb-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">{aiSummary}</p>
        )}
        {isError ? (
          <p className="text-sm font-medium text-amber-700">
            Could not check the anomalies table — this is NOT an all-clear. Try Scan now, or tell Claude.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open findings. Duplicates, outsized payments, near-ceiling spots and odd-hour
            entries are all clear.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {anomalies.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap font-semibold text-red-700">
                      {KIND_LABEL[a.kind] || a.kind}
                    </td>
                    <td className="py-1 pr-2">{a.detail}
                      {a.voucher_numbers ? <span className="text-muted-foreground"> ({a.voucher_numbers})</span> : null}
                      <span className="ml-1 text-muted-foreground">
                        · {format(new Date(a.created_at), 'dd MMM')}
                      </span>
                    </td>
                    <td className="py-1 text-right">
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" disabled={review.isPending} onClick={() => review.mutate(a.id)}>
                        <Check className="h-3 w-3" /> Reviewed
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AnomalyGuardCard;
