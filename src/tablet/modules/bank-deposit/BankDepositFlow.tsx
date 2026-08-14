import { ChangeEvent, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Camera, Check, Landmark, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { inr } from "@/tablet/lib/format";
import { canDepositCash } from "@/lib/accounting-access";
import {
  VOUCHER_PAYMENT_PROOF_CATEGORY,
  linkVoucherAttachments,
  uploadVoucherAttachments,
} from "@/lib/voucher-attachments";

// DATA SOURCE: post_cash_bank_entry (the same posting the Bank & Cash tile
// uses, so a deposit is one accounting entry however it was recorded) +
// file_uploads for the slip + notifications for the directors.

/**
 * Paying the day's cash into the bank.
 *
 * Bank & Cash could already post a deposit, but it recorded only the figure:
 * no evidence it happened, no note of which branch the money was carried to,
 * and nobody told. Cash leaving the building on somebody's word is precisely
 * the gap that made handovers untraceable, so this asks for the slip and tells
 * the directors.
 *
 * The posting itself goes through post_cash_bank_entry unchanged. One deposit,
 * one voucher, no second record to reconcile against the first.
 */
export default function BankDepositFlow() {
  const { user, hospitalType } = useAuth();
  const [hospital, setHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [bank, setBank] = useState<{ id: string; account_name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [branch, setBranch] = useState("");
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<File | null>(null);

  const allowed = canDepositCash(user);

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-deposit-banks", hospital],
    enabled: allowed,
    queryFn: async () => {
      const wanted = hospital === "ayushman" ? "ayushman_nagpur" : "drm_pvt_ltd";
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", wanted).single();
      const { data, error } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name")
        .eq("is_active", true)
        .eq("company_id", company.id)
        .or("account_group.ilike.%bank%,account_name.ilike.%bank%")
        .order("account_name")
        .limit(20);
      if (error) throw error;
      return (data || []) as { id: string; account_name: string }[];
    },
  });

  const deposit = useMutation({
    mutationFn: async () => {
      const value = parseFloat(amount);
      if (!bank) throw new Error("Pick the bank the cash went into");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount deposited");
      // Demanded before posting, not after: a deposit with no slip is exactly
      // the unevidenced movement this screen exists to stop.
      if (!slip) throw new Error("Add a photo of the deposit slip");

      const narration = [
        `Cash deposited at ${bank.account_name}`,
        branch.trim() ? `branch: ${branch.trim()}` : null,
        note.trim() || null,
      ].filter(Boolean).join(" — ");

      const { data, error } = await (supabase as any).rpc("post_cash_bank_entry", {
        p_kind: "DEPOSIT",
        p_hospital_type: hospital,
        p_bank_account_id: bank.id,
        p_amount: value,
        p_narration: narration,
        p_user: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      const voucherId = (data as any)?.voucherId as string;
      const voucherNo = (data as any)?.voucherNumber as string;

      // The slip is attached after the posting, so a failed upload leaves a
      // correct ledger rather than a lost deposit. It is reported loudly if it
      // fails, because a deposit without its slip has to be chased.
      let slipWarning: string | null = null;
      try {
        const uploaded = await uploadVoucherAttachments([slip], VOUCHER_PAYMENT_PROOF_CATEGORY);
        await linkVoucherAttachments(voucherId, uploaded.map((u) => ({ ...u, id: undefined })), user?.id || null);
      } catch (e) {
        slipWarning = e instanceof Error ? e.message : "the slip did not upload";
      }

      // Tell the directors. One row each rather than a broadcast: the bell
      // shows a null recipient to everybody, and this is not everybody's news.
      const { data: directors } = await (supabase as any)
        .from("User")
        .select("id")
        .in("role", ["superadmin", "super_admin"])
        .or("is_active.is.null,is_active.eq.true");

      const rows = (directors ?? []).map((d: any) => ({
        notification_type: "bank_deposit",
        title: `Cash deposited — ${inr(value)}`,
        message: `${user?.username || user?.email || "A cashier"} deposited ${inr(value)} into ${bank.account_name}`
          + (branch.trim() ? ` (${branch.trim()})` : "")
          + `. Voucher ${voucherNo}.`,
        recipient_user_id: d.id,
        recipient_role: "superadmin",
        hospital_name: hospital,
        source_table: "vouchers",
        source_id: voucherId,
      }));
      if (rows.length) {
        const { error: notifyError } = await (supabase as any).from("notifications").insert(rows);
        // A failed alert must not undo a real deposit.
        if (notifyError) console.warn("Directors were not alerted:", notifyError.message);
      }

      return { voucherNo, slipWarning, told: rows.length };
    },
    onSuccess: ({ voucherNo, slipWarning, told }) => {
      if (slipWarning) {
        toast.warning(`Deposit ${voucherNo} posted, but ${slipWarning}. Add the slip from Bank & Cash.`);
      } else {
        toast.success(`Deposit ${voucherNo} recorded. ${told} director${told === 1 ? "" : "s"} told.`);
      }
      setAmount(""); setBranch(""); setNote(""); setSlip(null); setBank(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the deposit"),
  });

  if (!allowed) {
    return (
      <FlowScaffold heading="Bank Deposit" subheading="Restricted to cashiers and accounts.">
        <TabletCard className="bg-amber-50">
          <p className="text-base font-semibold text-amber-900">You cannot record deposits.</p>
          <p className="mt-2 text-sm text-amber-900">
            Only cashiers and the accounts desk pay cash into the bank. Ask the director if
            this should be part of your job.
          </p>
        </TabletCard>
      </FlowScaffold>
    );
  }

  const value = parseFloat(amount) || 0;

  return (
    <FlowScaffold
      heading="Bank Deposit"
      subheading="Record cash paid into the bank, with the slip. The directors are told."
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {(["hope", "ayushman"] as const).map((h) => (
            <TabletButton
              key={h}
              variant={hospital === h ? "default" : "outline"}
              className="flex-1 capitalize"
              onClick={() => { setHospital(h); setBank(null); }}
            >
              {h}
            </TabletButton>
          ))}
        </div>

        <div>
          <TabletLabel htmlFor="bd-amount">Amount deposited</TabletLabel>
          <TabletInput
            id="bd-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
          />
        </div>

        <div>
          <TabletLabel>Which bank did the cash go into?</TabletLabel>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {banks.map((b) => (
              <TabletButton
                key={b.id}
                variant={bank?.id === b.id ? "default" : "outline"}
                className="justify-start text-left"
                onClick={() => setBank(b)}
              >
                <Landmark className="mr-2 h-5 w-5 flex-shrink-0" />
                <span className="truncate">{b.account_name}</span>
              </TabletButton>
            ))}
            {banks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No bank ledgers found for this hospital.
              </p>
            )}
          </div>
        </div>

        <div>
          <TabletLabel htmlFor="bd-branch">Branch you went to (optional)</TabletLabel>
          <TabletInput
            id="bd-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="e.g. Kamptee Road branch"
          />
        </div>

        <div>
          <TabletLabel>Photo of the deposit slip</TabletLabel>
          <label className="mt-1 flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-background px-4 text-sm font-semibold">
            {slip ? <Check className="h-5 w-5 text-emerald-600" /> : <Camera className="h-5 w-5" />}
            <span className="truncate">{slip ? slip.name : "Take or choose a photo"}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSlip(e.target.files?.[0] || null)}
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Required. The slip is the evidence the cash reached the bank.
          </p>
        </div>

        <div>
          <TabletLabel htmlFor="bd-note">Note (optional)</TabletLabel>
          <TabletInput
            id="bd-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the directors should know"
          />
        </div>

        <TabletCard className="bg-muted/40">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Depositing</span>
            <span className="text-2xl font-bold">{inr(value)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Posts one deposit voucher, attaches the slip to it, and tells the directors.
          </p>
        </TabletCard>

        <TabletButton
          className="w-full"
          disabled={deposit.isPending || value <= 0 || !bank || !slip}
          onClick={() => deposit.mutate()}
        >
          {deposit.isPending ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Banknote className="mr-2 h-5 w-5" />
          )}
          Record the deposit
        </TabletButton>
      </div>
    </FlowScaffold>
  );
}
