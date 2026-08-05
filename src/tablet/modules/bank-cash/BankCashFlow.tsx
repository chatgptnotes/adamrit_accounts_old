import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { ArrowDownToLine, ArrowUpFromLine, Check, Landmark, Percent } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: post_cash_bank_entry — guided Contra / bank-charge / interest
// vouchers, replacing the last manual voucher types.

const KINDS = [
  { kind: "DEPOSIT", label: "Cash deposited into bank", icon: ArrowDownToLine },
  { kind: "WITHDRAW", label: "Cash withdrawn from bank", icon: ArrowUpFromLine },
  { kind: "BANK_CHARGE", label: "Bank charges", icon: Landmark },
  { kind: "BANK_INTEREST", label: "Bank interest received", icon: Percent },
] as const;

export default function BankCashFlow() {
  const { user, hospitalType } = useAuth();
  const [hospital, setHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [kind, setKind] = useState<(typeof KINDS)[number]["kind"] | null>(null);
  const [bank, setBank] = useState<{ id: string; account_name: string } | null>(null);
  const [bankSearch, setBankSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [debounced] = useDebounce(bankSearch, 250);

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-cash-banks", hospital, debounced],
    queryFn: async () => {
      let query = (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name, company_id, companies!chart_of_accounts_company_id_fkey(company_key)")
        .eq("is_active", true)
        .or("account_group.ilike.%bank%,account_name.ilike.%bank%")
        .order("account_name")
        .limit(12);
      if (debounced.trim()) query = query.ilike("account_name", `%${debounced.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      const wanted = hospital === "ayushman" ? "ayushman_nagpur" : "drm_pvt_ltd";
      return ((data || []) as any[]).filter((r) => r.companies?.company_key === wanted);
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const value = parseFloat(amount);
      if (!kind) throw new Error("Pick what happened");
      if (!bank) throw new Error("Pick the bank ledger");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount");
      const { data, error } = await (supabase as any).rpc("post_cash_bank_entry", {
        p_kind: kind,
        p_hospital_type: hospital,
        p_bank_account_id: bank.id,
        p_amount: value,
        p_narration: narration.trim() || null,
        p_user: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return (data as any)?.voucherNumber as string;
    },
    onSuccess: (voucherNo) => {
      toast.success(`Posted ${voucherNo} — ${KINDS.find((k) => k.kind === kind)?.label}.`);
      setKind(null);
      setBank(null);
      setAmount("");
      setNarration("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not post"),
  });

  return (
    <FlowScaffold
      heading="Bank & Cash"
      subheading="Deposits, withdrawals, charges and interest — posted straight to the books"
      actions={
        <TabletButton
          className="w-full"
          disabled={!kind || !bank || post.isPending}
          onClick={() => post.mutate()}
        >
          <Check className="mr-2 h-5 w-5" />
          {post.isPending ? "Posting…" : "Post voucher"}
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {(["hope", "ayushman"] as const).map((h) => (
            <TabletButton
              key={h}
              size="default"
              variant={hospital === h ? "default" : "outline"}
              className="min-h-[44px] flex-1 text-sm"
              onClick={() => {
                setHospital(h);
                setBank(null);
              }}
            >
              {h === "hope" ? "Hope" : "Ayushman"}
            </TabletButton>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map(({ kind: k, label, icon: Icon }) => (
            <TabletButton
              key={k}
              variant={kind === k ? "default" : "outline"}
              className="min-h-[60px] justify-start text-sm"
              onClick={() => setKind(k)}
            >
              <Icon className="mr-2 h-5 w-5" /> {label}
            </TabletButton>
          ))}
        </div>

        <div>
          <TabletLabel>Bank ledger</TabletLabel>
          {bank ? (
            <TabletCard className="mt-1 flex items-center justify-between p-3">
              <span className="font-semibold">{bank.account_name}</span>
              <button type="button" className="text-sm text-primary" onClick={() => setBank(null)}>
                Change
              </button>
            </TabletCard>
          ) : (
            <>
              <TabletInput
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Search the bank ledger…"
                className="mt-1"
              />
              <div className="mt-2 grid gap-2">
                {banks.map((b: any) => (
                  <TabletCard
                    key={b.id}
                    className="cursor-pointer p-3 active:scale-[0.99]"
                    onClick={() => setBank(b)}
                  >
                    {b.account_name}
                  </TabletCard>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <TabletLabel>Amount</TabletLabel>
          <TabletInput
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 max-w-[220px] font-mono text-xl"
          />
        </div>
        <div>
          <TabletLabel>Narration (optional)</TabletLabel>
          <TabletInput
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="e.g. evening counter cash"
            className="mt-1"
          />
        </div>
      </div>
    </FlowScaffold>
  );
}
