import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// DATA SOURCE: vouchers with is_auto = false — anything typed by hand on the
// Tally Voucher Entry screen instead of posted by a tile or trigger.

interface ManualVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_amount: number;
  narration: string | null;
  created_by: string | null;
  last_modified_by: string | null;
  voucher_types: { voucher_type_name: string } | null;
  companies: { company_name: string } | null;
}

/**
 * The manual-voucher watchdog. Every transaction has an automated tile, so a
 * hand-typed voucher should be a rare, explainable correction — this card
 * keeps the last 7 days of them in the Director's face, with names attached.
 */
export function ManualVoucherWatchdog() {
  const since = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['manual-voucher-watchdog', since],
    queryFn: async (): Promise<ManualVoucher[]> => {
      const { data, error } = await (supabase as any)
        .from('vouchers')
        .select(
          'id, voucher_number, voucher_date, total_amount, narration, created_by, last_modified_by, voucher_types(voucher_type_name), companies!vouchers_company_id_fkey(company_name)',
        )
        .eq('is_auto', false)
        .neq('status', 'CANCELLED')
        .gte('voucher_date', since)
        .order('voucher_date', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ManualVoucher[];
    },
    staleTime: 60_000,
  });

  const total = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);

  return (
    <Card className={rows.length > 0 ? 'border-amber-400' : 'border-emerald-300'}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {rows.length > 0 ? (
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          )}
          Hand-typed vouchers, last 7 days
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {isLoading
              ? 'checking…'
              : rows.length === 0
                ? '100% automated'
                : `${rows.length} voucher(s) · ₹${total.toLocaleString('en-IN')}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isError ? (
          <p className="text-sm font-medium text-amber-700">
            Could not check the vouchers — this is NOT an all-clear.
          </p>
        ) : rows.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground">
            Every voucher this week was posted by a tile or trigger. Nothing to explain.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Voucher</th>
                  <th className="py-1 pr-2">Company</th>
                  <th className="py-1 pr-2">Typed by</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="py-1">Narration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {format(new Date(`${r.voucher_date}T00:00:00`), 'dd MMM')}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap font-medium">
                      {r.voucher_number}
                      <span className="ml-1 text-muted-foreground">
                        {(r.voucher_types?.voucher_type_name || '').replace(' Voucher', '')}
                      </span>
                    </td>
                    <td className="py-1 pr-2">{r.companies?.company_name || '—'}</td>
                    <td className="py-1 pr-2">
                      {r.created_by === 'system'
                        ? r.last_modified_by || 'system'
                        : r.created_by || '—'}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      ₹{Number(r.total_amount).toLocaleString('en-IN')}
                    </td>
                    <td className="max-w-[280px] truncate py-1" title={r.narration || ''}>
                      {r.narration}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          A hand-typed voucher should be a rare, approved correction — every routine
          transaction has its own tile. Ask the named typist why it could not go through one.
        </p>
      </CardContent>
    </Card>
  );
}

export default ManualVoucherWatchdog;
