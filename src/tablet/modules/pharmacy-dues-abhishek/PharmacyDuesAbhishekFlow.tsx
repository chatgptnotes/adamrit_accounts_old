import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ReceiptIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: v_expense_bills_outstanding -> record_expense_bill_payment.
// Abhishek pays supplier dues (part payments welcome) in cash from the
// counter; every payment is a proper PV against its invoice.

interface OutstandingBill {
  id: string;
  bill_number: string;
  bill_date: string;
  party_name: string;
  amount: number;
  outstanding: number;
  company_id: string;
}

export default function PharmacyDuesAbhishekFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<OutstandingBill | null>(null);
  const [amount, setAmount] = useState("");

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["abhishek-outstanding"],
    queryFn: async (): Promise<OutstandingBill[]> => {
      const { data, error } = await (supabase as any)
        .from("v_expense_bills_outstanding")
        .select("id, bill_number, bill_date, party_name, amount, outstanding, company_id")
        .gt("outstanding", 0)
        .order("bill_date")
        .limit(200);
      if (error) throw error;
      return (data || []) as OutstandingBill[];
    },
  });

  const visible = useMemo(
    () =>
      bills.filter(
        (b) =>
          !search.trim() ||
          b.party_name?.toLowerCase().includes(search.trim().toLowerCase()) ||
          b.bill_number?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [bills, search],
  );

  const pay = useMutation({
    mutationFn: async () => {
      if (!paying) throw new Error("Pick the invoice");
      const value = parseFloat(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount to pay");
      const { data: cash } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id")
        .eq("company_id", paying.company_id)
        .eq("is_active", true)
        .or("account_name.ilike.cash,account_group.ilike.%cash-in-hand%")
        .order("created_at")
        .limit(1);
      if (!cash?.[0]?.id) throw new Error("No Cash ledger found for this company");
      const { data, error } = await (supabase as any).rpc("record_expense_bill_payment", {
        p_bill_id: paying.id,
        p_amount: value,
        p_bank_account_id: cash[0].id,
        p_payment_date: new Date().toISOString().slice(0, 10),
        p_created_by: user?.email || user?.id || null,
        p_remarks: "Paid at counter (Abhishek dues tile)",
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (result) => {
      toast.success(String(result || "Payment posted."));
      setPaying(null);
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["abhishek-outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["expense-bills-outstanding"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  if (paying) {
    return (
      <FlowScaffold
        heading={paying.party_name}
        subheading={`Invoice ${paying.bill_number} · outstanding ₹${Number(paying.outstanding).toLocaleString("en-IN")}`}
        actions={
          <div className="flex w-full gap-3">
            <TabletButton variant="outline" onClick={() => setPaying(null)} disabled={pay.isPending}>
              Back
            </TabletButton>
            <TabletButton className="flex-1" disabled={pay.isPending} onClick={() => pay.mutate()}>
              <Check className="mr-2 h-5 w-5" />
              {pay.isPending ? "Posting…" : `Pay ₹${amount ? parseFloat(amount).toLocaleString("en-IN") : ""} in cash`}
            </TabletButton>
          </div>
        }
      >
        <div className="space-y-3">
          <TabletLabel>Amount (part payment is fine)</TabletLabel>
          <TabletInput
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(paying.outstanding)}
            className="max-w-[220px] font-mono text-2xl"
            autoFocus
          />
          <TabletButton
            variant="outline"
            size="default"
            className="min-h-[40px] text-sm"
            onClick={() => setAmount(String(paying.outstanding))}
          >
            Full outstanding — ₹{Number(paying.outstanding).toLocaleString("en-IN")}
          </TabletButton>
          <p className="text-sm text-muted-foreground">
            Posts a payment voucher against invoice {paying.bill_number}. Whatever remains stays
            on this list until cleared.
          </p>
        </div>
      </FlowScaffold>
    );
  }

  return (
    <FlowScaffold
      heading="Supplier Dues - Abhishek"
      subheading="Outstanding invoices, oldest first — tap one to pay"
    >
      <div className="space-y-3">
        <TabletInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search supplier or invoice number…"
          autoFocus
        />
        {isLoading ? (
          <p className="py-8 text-center text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading dues…
          </p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Nothing outstanding{search ? " for that search" : " — all suppliers are settled"}.
          </p>
        ) : (
          <div className="grid gap-2">
            {visible.map((bill) => (
              <TabletCard
                key={bill.id}
                className="flex cursor-pointer items-center justify-between gap-3 p-4 active:scale-[0.99]"
                onClick={() => {
                  setPaying(bill);
                  setAmount(String(bill.outstanding));
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold">{bill.party_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {bill.bill_number} · {bill.bill_date}
                  </span>
                </span>
                <span className="flex items-center gap-1 font-mono text-lg font-bold">
                  <ReceiptIndianRupee className="h-4 w-4 text-muted-foreground" />
                  {Number(bill.outstanding).toLocaleString("en-IN")}
                </span>
              </TabletCard>
            ))}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}
