import { ChangeEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCashHandoverAccess } from "@/tablet/hooks/useCashHandoverAccess";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { inr, shortDate } from "@/tablet/lib/format";
import {
  uploadVoucherAttachments,
  linkVoucherAttachments,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
} from "@/lib/voucher-attachments";

// DATA SOURCE: v_payments_without_proof (payment vouchers carrying no
// voucher_payment_proof attachment) + file_uploads for the attachment itself.

/**
 * Attaching the payment confirmation, on a tablet.
 *
 * The desktop has done this since 15-Aug: open the voucher from the Day Book in
 * alter mode and upload into "PhonePe / Bank Payment Screenshot". A tablet had
 * no such screen at all — the payout and deposit tiles capture their evidence at
 * the moment of paying, and anything paid without it could never be documented
 * afterwards by somebody who only has a tablet.
 *
 * That gap is why the nightly report can name 1,300 undocumented payments and
 * most of the people who made them cannot act on it (Dr M, 19 Aug).
 *
 * The voucher is never altered here. Only a file is added against it, which is
 * what the desktop does too — the ledger entries are not touched, so this cannot
 * change a figure.
 */

interface UnprovenPayment {
  voucher_id: string;
  voucher_number: string;
  voucher_date: string;
  total_amount: number;
  paid_to: string | null;
  company_name: string | null;
  narration: string | null;
  hours_undocumented: number;
}

export default function PaymentProofFlow() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Hiding the tile is not access control — the URL is still typeable, and this
  // writes a document against a payment voucher. Same roster and same refusal
  // as the other cash screens.
  const access = useCashHandoverAccess();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UnprovenPayment | null>(null);
  // Several files, not one: a bank transfer often has the request screen and
  // the confirmation, and a cash payment can have a signed slip as well as a
  // photo (Dr M, 20 Aug).
  const [files, setFiles] = useState<File[]>([]);

  const payments = useQuery({
    queryKey: ["payments-without-proof"],
    staleTime: 30_000,
    queryFn: async (): Promise<UnprovenPayment[]> => {
      // The recent ones. A payment from three weeks ago is a matter for
      // accounts on a desktop, not for a cashier standing at a counter.
      const { data, error } = await (supabase as any)
        .from("v_payments_without_proof")
        .select("voucher_id, voucher_number, voucher_date, total_amount, paid_to, company_name, narration, hours_undocumented")
        .order("voucher_date", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return (data || []) as UnprovenPayment[];
    },
  });

  const attach = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick the payment first");
      if (!files.length) throw new Error("Take or choose a photo of the confirmation");
      const uploaded = await uploadVoucherAttachments(files, VOUCHER_PAYMENT_PROOF_CATEGORY);
      await linkVoucherAttachments(
        selected.voucher_id,
        uploaded.map((u) => ({ ...u, id: undefined })),
        user?.id || null,
      );
      return selected.voucher_number;
    },
    onSuccess: (voucherNo) => {
      toast.success(
        `${voucherNo} now has ${files.length === 1 ? "its confirmation" : `${files.length} confirmations`} attached.`,
      );
      setSelected(null);
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["payments-without-proof"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not attach the confirmation"),
  });

  const term = search.trim().toLowerCase();
  const rows = (payments.data || []).filter(
    (p) =>
      !term ||
      [p.voucher_number, p.paid_to, p.narration, p.company_name]
        .some((field) => (field || "").toLowerCase().includes(term)),
  );

  if (!access.isLoading && !access.allowed) {
    return (
      <FlowScaffold
        heading="Attach Payment Proof Avani"
        subheading="Restricted to the people named on the cash roster."
      >
        <TabletCard className="bg-amber-50">
          <p className="text-base font-semibold text-amber-900">
            You are not on the cash handover roster.
          </p>
          <p className="mt-2 text-sm text-amber-900">
            Attaching a payment confirmation records evidence against a voucher, so
            it is kept to the people who handle payments. Ask the director or the
            accounts desk if you need it.
          </p>
        </TabletCard>
      </FlowScaffold>
    );
  }

  return (
    <FlowScaffold
      heading="Attach Payment Proof Avani"
      subheading="Payments with no confirmation attached yet. Pick one and add the screenshot."
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={search}
            className="pl-10"
            placeholder="Search a voucher number or who was paid"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {selected ? (
          <TabletCard className="space-y-3 border-primary">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{selected.paid_to || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">
                  {selected.voucher_number} · {shortDate(selected.voucher_date)}
                  {selected.company_name ? ` · ${selected.company_name}` : ""}
                </p>
              </div>
              <span className="flex-shrink-0 text-2xl font-bold">{inr(selected.total_amount)}</span>
            </div>

            <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-background px-4 text-sm font-semibold">
              {files.length ? <Check className="h-5 w-5 text-emerald-600" /> : <Camera className="h-5 w-5" />}
              <span className="truncate">
                {files.length ? "Add another" : "Take or choose the confirmation"}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  // Added to what is already there, not replacing it: the request
                  // screen comes from the gallery and the confirmation from the
                  // camera, and they arrive in two goes.
                  const picked = Array.from(event.target.files || []);
                  if (picked.length) {
                    setFiles((current) => [...current, ...picked]);
                  }
                  // Cleared, or choosing the same file twice in a row does
                  // nothing — the input fires no change for an unchanged value.
                  event.target.value = '';
                }}
              />
            </label>

            {files.length > 0 ? (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                      title="Remove this one"
                      onClick={() => setFiles((current) => current.filter((_, n) => n !== i))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex gap-2">
              <TabletButton
                variant="outline"
                className="flex-1"
                onClick={() => { setSelected(null); setFiles([]); }}
              >
                Cancel
              </TabletButton>
              <TabletButton
                className="flex-1"
                disabled={!files.length || attach.isPending}
                onClick={() => attach.mutate()}
              >
                {attach.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
                {attach.isPending ? "Attaching…" : files.length > 1 ? `Attach ${files.length}` : "Attach"}
              </TabletButton>
            </div>
            <p className="text-xs text-muted-foreground">
              Only the photos are added. The voucher and its ledger entries are not changed.
            </p>
          </TabletCard>
        ) : null}

        {payments.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {term
              ? "No payment matches that."
              : "Every recent payment has its confirmation attached."}
          </p>
        ) : (
          <div className="space-y-2 pb-4">
            {rows.map((p) => (
              <TabletCard
                key={p.voucher_id}
                className={`cursor-pointer ${selected?.voucher_id === p.voucher_id ? "border-primary" : ""}`}
                onClick={() => { setSelected(p); setFiles([]); }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.paid_to || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.voucher_number} · {shortDate(p.voucher_date)}
                    </p>
                    {/* How long it has been undocumented, because the oldest are
                        the ones nobody will remember the details of. */}
                    <p className="text-xs text-amber-700">
                      {p.hours_undocumented < 24
                        ? "Waiting since today"
                        : `Waiting ${Math.floor(p.hours_undocumented / 24)} day(s)`}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-lg font-bold">{inr(p.total_amount)}</span>
                </div>
              </TabletCard>
            ))}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}
