import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { Check, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { suggestExpenseLedger } from "@/lib/accounting-ai";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: record_quick_paid_bill — one tap raises the bill, posts its
// JV and pays it in cash, with a built-in same-party-same-amount duplicate
// guard (the trap behind the twin Rs 5,000 Rehan payments).

interface Ledger {
  id: string;
  account_name: string;
}

export default function QuickPayAvniFlow() {
  const { user, hospitalType } = useAuth();
  const [hospital, setHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [party, setParty] = useState<Ledger | null>(null);
  const [expense, setExpense] = useState<Ledger | null>(null);
  const [picking, setPicking] = useState<"party" | "expense" | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [debounced] = useDebounce(search, 250);

  const companyKey = hospital === "ayushman" ? "ayushman_nagpur" : "drm_pvt_ltd";
  const { data: options = [] } = useQuery({
    queryKey: ["avni-ledgers", companyKey, picking, debounced],
    enabled: !!picking && debounced.trim().length >= 2,
    queryFn: async (): Promise<Ledger[]> => {
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", companyKey).single();
      let query = (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name")
        .eq("is_active", true)
        .ilike("account_name", `%${debounced.trim()}%`)
        .or(`company_id.eq.${company.id},company_id.is.null`)
        .order("account_name")
        .limit(10);
      if (picking === "expense") {
        query = query.in("account_type", ["DIRECT_EXPENSES", "INDIRECT_EXPENSES", "EXPENSES"]);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Ledger[];
    },
  });

  const pay = useMutation({
    mutationFn: async (force: boolean) => {
      const value = parseFloat(amount);
      if (!party || !expense) throw new Error("Pick who was paid and what it was for");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount");
      const { data, error } = await (supabase as any).rpc("record_quick_paid_bill", {
        p_hospital_type: hospital,
        p_party_account_id: party.id,
        p_expense_account_id: expense.id,
        p_amount: value,
        p_narration: note.trim() || null,
        p_user: user?.email || user?.id || null,
        p_force: force,
      });
      if (error) throw new Error(error.message);
      return data as { billNumber: string };
    },
    onSuccess: (result) => {
      toast.success(`Paid — bill ${result.billNumber} raised, JV and payment voucher posted.`);
      setParty(null);
      setExpense(null);
      setAmount("");
      setNote("");
      setDuplicateWarning(null);
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Payment failed";
      if (message.includes("DUPLICATE_WARNING")) {
        setDuplicateWarning(message.replace("DUPLICATE_WARNING: ", ""));
      } else {
        toast.error(message);
      }
    },
  });

  const aiSuggest = async () => {
    if (!party) {
      toast.error("Pick who was paid first");
      return;
    }
    setSuggesting(true);
    try {
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", companyKey).single();
      const { data: ledgers } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name")
        .eq("is_active", true)
        .in("account_type", ["DIRECT_EXPENSES", "INDIRECT_EXPENSES", "EXPENSES"])
        .or(`company_id.eq.${company.id},company_id.is.null`)
        .limit(80);
      const result = await suggestExpenseLedger(
        note || "(no narration)",
        party.account_name,
        (ledgers || []).map((l: any) => l.account_name),
      );
      const match = result?.ledger
        ? (ledgers || []).find((l: any) => l.account_name.toLowerCase() === result.ledger!.toLowerCase())
        : null;
      if (match) {
        setExpense(match);
        toast.success(`AI suggests: ${match.account_name}`);
      } else {
        toast.info("No confident suggestion — pick manually.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const pickerButton = (which: "party" | "expense", value: Ledger | null, label: string) => (
    <div>
      <TabletLabel>{label}</TabletLabel>
      <TabletButton
        variant="outline"
        size="default"
        className="mt-1 min-h-[44px] w-full justify-start text-sm"
        onClick={() => {
          setPicking(which);
          setSearch("");
        }}
      >
        {value?.account_name || "Tap to search…"}
      </TabletButton>
    </div>
  );

  return (
    <FlowScaffold
      heading="Quick Pay - Avni"
      subheading="Bill, journal and payment voucher in one tap — with a duplicate guard"
      actions={
        <TabletButton
          className="w-full"
          disabled={pay.isPending}
          onClick={() => {
            setDuplicateWarning(null);
            pay.mutate(false);
          }}
        >
          <Zap className="mr-2 h-5 w-5" />
          {pay.isPending ? "Posting…" : "Pay & post everything"}
        </TabletButton>
      }
    >
      <div className="space-y-4">
        {duplicateWarning && (
          <TabletCard className="space-y-2 border-red-400 p-4">
            <p className="flex items-start gap-2 text-sm font-medium text-red-700">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /> {duplicateWarning}
            </p>
            <TabletButton
              variant="outline"
              size="default"
              className="min-h-[44px] w-full border-red-400 text-sm text-red-700"
              disabled={pay.isPending}
              onClick={() => pay.mutate(true)}
            >
              This is NOT a duplicate — pay anyway
            </TabletButton>
          </TabletCard>
        )}
        <div className="flex gap-2">
          {(["hope", "ayushman"] as const).map((h) => (
            <TabletButton
              key={h}
              size="default"
              variant={hospital === h ? "default" : "outline"}
              className="min-h-[44px] flex-1 text-sm"
              onClick={() => {
                setHospital(h);
                setParty(null);
                setExpense(null);
              }}
            >
              {h === "hope" ? "Hope" : "Ayushman"}
            </TabletButton>
          ))}
        </div>
        {pickerButton("party", party, "Paid to")}
        {pickerButton("expense", expense, "What it is for")}
        <TabletButton
          variant="outline"
          size="default"
          className="min-h-[40px] w-full text-sm"
          disabled={suggesting}
          onClick={() => void aiSuggest()}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {suggesting ? "Thinking…" : "AI: suggest the expense ledger"}
        </TabletButton>
        {picking && (
          <div className="rounded-lg border p-2">
            <TabletInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type at least 2 letters…"
              autoFocus
            />
            <div className="mt-2 grid gap-1">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="rounded border px-3 py-2 text-left text-sm active:bg-muted"
                  onClick={() => {
                    if (picking === "party") setParty(option);
                    else setExpense(option);
                    setPicking(null);
                  }}
                >
                  {option.account_name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <TabletInput
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="max-w-[160px] font-mono text-xl"
          />
          <TabletInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was this payment for?"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          <Check className="mr-1 inline h-4 w-4" />
          Raises the invoice, posts its journal, pays it from Cash — three vouchers, one tap.
          Same party + same amount within 3 days is stopped for confirmation.
        </p>
      </div>
    </FlowScaffold>
  );
}
