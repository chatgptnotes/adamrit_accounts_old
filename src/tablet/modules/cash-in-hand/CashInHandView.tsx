import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Banknote, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inr, todayISO } from "@/tablet/lib/format";
import { TabletCard } from "@/tablet/ui/TabletCard";

interface CashEntry {
  id: string;
  debit_amount: number;
  credit_amount: number;
  narration: string | null;
  voucher_date: string;
  voucher_number: string | null;
}

interface CashSnapshot {
  receipts: number;
  payments: number;
  entries: CashEntry[];
  accountFound: boolean;
}

/** Module 11 — today's Cash-in-Hand position (read-only). */
export default function CashInHandView() {
  const today = todayISO();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tablet-cash-in-hand", today],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<CashSnapshot> => {
      const { data: acct } = await supabase
        .from("chart_of_accounts")
        .select("id, account_name")
        .ilike("account_name", "%cash in hand%")
        .limit(1)
        .maybeSingle();
      if (!acct) return { receipts: 0, payments: 0, entries: [], accountFound: false };

      // Today's entries filtered on the SERVER. The old shape took 300 rows
      // ordered by UUID — effectively 300 random entries from all history —
      // and kept whichever happened to be today's, so the totals drifted.
      const { data: rows, error } = await supabase
        .from("voucher_entries")
        .select(
          "id, debit_amount, credit_amount, narration, voucher:vouchers!inner(voucher_date, voucher_number)",
        )
        .eq("account_id", acct.id)
        // Cash transactions only — the pharmacy sale JVs belong to the
        // pharmacy's own ledger, as on the accounting Cash/Bank screens.
        .eq("voucher.is_optional", false)
        .eq("voucher.voucher_date", today)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;

      const entries: CashEntry[] = (rows || []).map((r: any) => ({
        id: r.id,
        debit_amount: Number(r.debit_amount) || 0,
        credit_amount: Number(r.credit_amount) || 0,
        narration: r.narration,
        voucher_date: r.voucher?.voucher_date || "",
        voucher_number: r.voucher?.voucher_number || null,
      }));

      return {
        accountFound: true,
        entries,
        receipts: entries.reduce((s, e) => s + e.debit_amount, 0),
        payments: entries.reduce((s, e) => s + e.credit_amount, 0),
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-destructive">
        Could not load cash entries.
      </div>
    );
  }
  if (!data.accountFound) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
        No "Cash in Hand" account found in the chart of accounts.
      </div>
    );
  }

  const net = data.receipts - data.payments;

  return (
    <div className="tablet-no-scrollbar h-full overflow-y-auto p-4">
      <TabletCard className="mb-4 flex items-center gap-4 bg-green-50">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100">
          <Banknote className="h-7 w-7 text-green-600" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Net cash movement today</p>
          <p className="text-3xl font-bold">{inr(net)}</p>
        </div>
      </TabletCard>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <TabletCard>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowDownCircle className="h-4 w-4 text-emerald-600" /> Receipts
          </p>
          <p className="text-2xl font-bold text-emerald-700">{inr(data.receipts)}</p>
        </TabletCard>
        <TabletCard>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowUpCircle className="h-4 w-4 text-rose-600" /> Payments
          </p>
          <p className="text-2xl font-bold text-rose-700">{inr(data.payments)}</p>
        </TabletCard>
      </div>

      <h3 className="mb-2 font-semibold">Today's entries</h3>
      {data.entries.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No cash entries recorded today.
        </p>
      ) : (
        <div className="space-y-2">
          {data.entries.map((e) => {
            const isReceipt = e.debit_amount > 0;
            return (
              <TabletCard key={e.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.narration || e.voucher_number || "Cash entry"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.voucher_number || "—"}
                  </p>
                </div>
                <span
                  className={
                    isReceipt
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-rose-700"
                  }
                >
                  {isReceipt ? "+" : "−"}
                  {inr(isReceipt ? e.debit_amount : e.credit_amount)}
                </span>
              </TabletCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
