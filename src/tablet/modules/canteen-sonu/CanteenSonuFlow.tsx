import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: record_canteen_collection — Sonu's daily canteen cash posts a
// receipt (Dr Cash / Cr Canteen Income) instead of a hand-typed voucher.

export default function CanteenSonuFlow() {
  const { user, hospitalType } = useAuth();
  const [hospital, setHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [day, setDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const record = useMutation({
    mutationFn: async () => {
      const value = parseFloat(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount collected");
      const { data, error } = await (supabase as any).rpc("record_canteen_collection", {
        p_hospital_type: hospital,
        p_amount: value,
        p_date: day,
        p_narration: note.trim() || null,
        p_user: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return (data as any)?.voucherNumber as string;
    },
    onSuccess: (voucherNo) => {
      toast.success(`Canteen collection posted — ${voucherNo}.`);
      setAmount("");
      setNote("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not post"),
  });

  return (
    <FlowScaffold
      heading="Canteen - Sonu"
      subheading="The day's canteen cash goes straight into the books"
      actions={
        <TabletButton className="w-full" disabled={record.isPending} onClick={() => record.mutate()}>
          <Check className="mr-2 h-5 w-5" />
          {record.isPending ? "Posting…" : "Post collection"}
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
              onClick={() => setHospital(h)}
            >
              {h === "hope" ? "Hope" : "Ayushman"}
            </TabletButton>
          ))}
        </div>
        <div>
          <TabletLabel>Collection day</TabletLabel>
          <TabletInput type="date" value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 max-w-[200px]" />
        </div>
        <div>
          <TabletLabel>Amount collected</TabletLabel>
          <TabletInput
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 max-w-[220px] font-mono text-2xl"
            autoFocus
          />
        </div>
        <div>
          <TabletLabel>Note (optional)</TabletLabel>
          <TabletInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. evening shift" className="mt-1" />
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UtensilsCrossed className="h-4 w-4" /> Posts Dr Cash / Cr Canteen Income as an AUTO receipt.
        </p>
      </div>
    </FlowScaffold>
  );
}
