import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  QrCode,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { fetchLedgerQr, saveLedgerQr } from "@/lib/expense-bills/paymentEvidence";
import {
  uploadVoucherAttachments,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
} from "@/lib/voucher-attachments";

// DATA SOURCE: goods_received_notes (POSTED) + suppliers + the purchase
// voucher the GRN raised -> post_grn_vendor_payment().
//
// Lalit's tile is the vendor side of the pharmacy. Receiving the goods already
// booked what the hospital owes (Dr Medicine Purchase / Cr the supplier, posted
// by trg_grn_supplier_bill the moment the GRN is posted). This screen is the
// other half: scan the vendor's QR, pay, photograph the confirmation, and the
// payment voucher (Dr the supplier / Cr Cash or Canara Bank) is posted for you.

interface VendorBill {
  id: string;
  grnNumber: string;
  grnDate: string;
  invoiceNumber: string | null;
  supplierId: number | null;
  supplierName: string;
  supplierLedgerId: string | null;
  amount: number;
  paidAt: string | null;
  paidAmount: number | null;
  paymentVoucherNo: string | null;
  paymentMode: string | null;
  proofUrl: string | null;
  purchaseVoucher: string | null;
}

const MODES = ["CASH", "UPI", "NEFT", "CHEQUE"] as const;

// High enough for every posted GRN today (438) with room to grow; if it is
// ever reached the count line says so rather than quietly dropping the rest.
const BILL_LIMIT = 1000;

export default function PharmacyVendorLalitFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<VendorBill | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("CASH");
  const [reference, setReference] = useState("");
  const [vendorQr, setVendorQr] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const totalPostedRef = useRef(0);
  const proofInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["lalit-vendor-bills"],
    staleTime: 30_000,
    queryFn: async (): Promise<VendorBill[]> => {
      // Every posted GRN, not a slice of them: at 300 the list silently hid
      // 138 bills and still reported "300 of 300 still to pay".
      const { data: grns, error, count } = await (supabase as any)
        .from("goods_received_notes")
        .select(
          "id, grn_number, grn_date, invoice_number, invoice_amount, total_amount, supplier_id, " +
            "paid_at, paid_amount, payment_mode, payment_voucher_no, payment_proof_url",
          { count: "exact" },
        )
        .eq("status", "POSTED")
        .order("grn_date", { ascending: false })
        .limit(BILL_LIMIT);
      if (error) throw error;
      totalPostedRef.current = count ?? (grns ?? []).length;

      const supplierIds = [...new Set((grns || []).map((g: any) => g.supplier_id).filter(Boolean))];
      const { data: suppliers } = supplierIds.length
        ? await (supabase as any)
            .from("suppliers")
            .select("id, supplier_name, ledger_account_id")
            .in("id", supplierIds)
        : { data: [] as any[] };
      const supplierById = new Map<number, any>((suppliers || []).map((s: any) => [s.id, s]));

      // The purchase voucher each GRN raised — its id is the reference.
      const grnIds = (grns || []).map((g: any) => g.id);
      const { data: vouchers } = grnIds.length
        ? await (supabase as any)
            .from("vouchers")
            .select("voucher_number, reference_number")
            .in("reference_number", grnIds)
            .neq("status", "CANCELLED")
        : { data: [] as any[] };
      const voucherByRef = new Map<string, string>(
        (vouchers || []).map((v: any) => [v.reference_number, v.voucher_number]),
      );

      return (grns || []).map((g: any) => {
        const supplier = supplierById.get(g.supplier_id);
        return {
          id: g.id,
          grnNumber: g.grn_number,
          grnDate: g.grn_date,
          invoiceNumber: g.invoice_number ?? null,
          supplierId: g.supplier_id ?? null,
          supplierName: supplier?.supplier_name?.trim() || "Unmapped supplier",
          supplierLedgerId: supplier?.ledger_account_id ?? null,
          amount: g.invoice_amount ?? g.total_amount ?? 0,
          paidAt: g.paid_at ?? null,
          paidAmount: g.paid_amount ?? null,
          paymentVoucherNo: g.payment_voucher_no ?? null,
          paymentMode: g.payment_mode ?? null,
          proofUrl: g.payment_proof_url ?? null,
          purchaseVoucher: voucherByRef.get(g.id) ?? null,
        };
      });
    },
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return bills;
    return bills.filter((b) =>
      [b.supplierName, b.grnNumber, b.invoiceNumber, b.paymentVoucherNo]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [bills, search]);

  const unpaidCount = visible.filter((b) => !b.paidAt).length;

  const openPayment = async (bill: VendorBill) => {
    setPaying(bill);
    setAmount(String(bill.amount || ""));
    setMode("CASH");
    setReference("");
    setProofFile(null);
    setVendorQr(null);
    if (bill.supplierLedgerId) {
      try {
        const qr = await fetchLedgerQr(bill.supplierLedgerId);
        setVendorQr(qr?.qrUrl ?? null);
      } catch {
        setVendorQr(null);
      }
    }
  };

  const onVendorQr = async (file?: File) => {
    if (!file || !paying?.supplierLedgerId) return;
    setBusy(true);
    try {
      const url = await saveLedgerQr(paying.supplierLedgerId, file, user?.email || null);
      setVendorQr(url);
      toast.success(`QR saved for ${paying.supplierName}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the QR");
    } finally {
      setBusy(false);
      if (qrInput.current) qrInput.current.value = "";
    }
  };

  const pay = useMutation({
    mutationFn: async () => {
      if (!paying) throw new Error("Pick the bill to pay");
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount paid");

      const { data, error } = await (supabase as any).rpc("post_grn_vendor_payment", {
        p_grn_id: paying.id,
        p_mode: mode,
        p_amount: value,
        p_reference: reference || null,
        p_user: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      if (!data?.posted) {
        throw new Error(data?.reason || `Already paid — voucher ${data?.voucher_number}`);
      }

      // Evidence goes on the bill it paid.
      if (proofFile) {
        const [uploaded] = await uploadVoucherAttachments([proofFile], VOUCHER_PAYMENT_PROOF_CATEGORY);
        const { error: proofError } = await (supabase as any)
          .from("goods_received_notes")
          .update({
            payment_proof_path: uploaded.storagePath,
            payment_proof_url: uploaded.fileUrl,
          })
          .eq("id", paying.id);
        if (proofError) throw new Error(proofError.message);
      }
      return data.voucher_number as string;
    },
    onSuccess: (voucherNumber) => {
      toast.success(`Paid ${paying?.supplierName} — payment voucher ${voucherNumber} posted.`);
      setPaying(null);
      queryClient.invalidateQueries({ queryKey: ["lalit-vendor-bills"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the payment"),
  });

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Pharmacy Vendors - Lalit"
      subheading="Vendor bills from posted GRNs — scan the QR, pay, attach the confirmation"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, GRN or invoice…"
            className="pl-10"
          />
        </div>

        {visible.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {unpaidCount} of {visible.length} bill{visible.length === 1 ? "" : "s"} still to pay.
            {totalPostedRef.current > bills.length && (
              <> Showing the {bills.length} most recent of {totalPostedRef.current} posted GRNs.</>
            )}
          </p>
        )}

        {isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading vendor bills…</p>
        ) : visible.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
            No posted GRNs to show.
          </TabletCard>
        ) : (
          visible.map((bill) => (
            <TabletCard key={bill.id} variant="flat" className="space-y-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold">{bill.supplierName}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      bill.grnNumber,
                      bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : null,
                      shortDate(bill.grnDate),
                      bill.purchaseVoucher ? `Booked ${bill.purchaseVoucher}` : "Not booked",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {/* A GRN dated in the future is a typo at entry, and it
                      sorts above everything until someone corrects it. */}
                  {bill.grnDate > new Date().toISOString().slice(0, 10) && (
                    <p className="mt-0.5 text-xs text-amber-700">
                      Dated in the future — check the GRN date
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold">₹{Number(bill.amount).toLocaleString("en-IN")}</p>
                  <span
                    className={
                      bill.paidAt
                        ? "rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-700"
                        : "rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium uppercase text-amber-700"
                    }
                  >
                    {bill.paidAt ? "Paid" : "To pay"}
                  </span>
                </div>
              </div>

              {bill.paidAt ? (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {bill.paymentMode} · {bill.paymentVoucherNo}
                  </span>
                  {bill.proofUrl && (
                    <a
                      href={bill.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" /> Confirmation
                    </a>
                  )}
                </div>
              ) : (
                <TabletButton size="sm" onClick={() => void openPayment(bill)}>
                  <QrCode className="mr-1 h-4 w-4" /> Pay vendor
                </TabletButton>
              )}
            </TabletCard>
          ))
        )}
      </div>

      {/* Pay: the vendor's QR to scan, the confirmation to attach */}
      {paying && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl bg-background p-4 shadow-xl">
            <h3 className="text-lg font-semibold">Pay {paying.supplierName}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {paying.grnNumber}
              {paying.invoiceNumber ? ` · Invoice ${paying.invoiceNumber}` : ""}
            </p>

            <div className="mt-3 rounded-md border p-3 text-center">
              {vendorQr ? (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">Scan to pay {paying.supplierName}</p>
                  <img
                    src={vendorQr}
                    alt={`Payment QR for ${paying.supplierName}`}
                    className="mx-auto max-h-56 object-contain"
                  />
                  <TabletButton
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={busy || !paying.supplierLedgerId}
                    onClick={() => qrInput.current?.click()}
                  >
                    Replace QR
                  </TabletButton>
                </>
              ) : (
                <>
                  <QrCode className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {paying.supplierLedgerId
                      ? "No QR held for this vendor yet."
                      : "This vendor has no ledger mapped, so no QR can be stored against it."}
                  </p>
                  <TabletButton
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={busy || !paying.supplierLedgerId}
                    onClick={() => qrInput.current?.click()}
                  >
                    <Upload className="mr-1 h-4 w-4" /> Upload vendor QR
                  </TabletButton>
                </>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <TabletLabel>Amount paid</TabletLabel>
                <TabletInput
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div>
                <TabletLabel>Paid by</TabletLabel>
                <div className="grid grid-cols-4 gap-2">
                  {MODES.map((m) => (
                    <TabletButton
                      key={m}
                      size="sm"
                      variant={mode === m ? "default" : "outline"}
                      onClick={() => setMode(m)}
                    >
                      {m}
                    </TabletButton>
                  ))}
                </div>
              </div>

              <div>
                <TabletLabel>Reference (optional)</TabletLabel>
                <TabletInput
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="UTR / cheque number"
                />
              </div>

              <div className="rounded-md border p-3">
                <p className="mb-2 text-xs text-muted-foreground">Payment confirmation</p>
                <div className="flex items-center gap-2">
                  <TabletButton variant="outline" size="sm" onClick={() => proofInput.current?.click()}>
                    <Upload className="mr-1 h-4 w-4" /> Upload
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    size="sm"
                    onClick={() => cameraInput.current?.click()}
                    title="Photograph the confirmation"
                    aria-label="Photograph the confirmation"
                  >
                    <Camera className="h-4 w-4" />
                  </TabletButton>
                  {proofFile && (
                    <span className="text-xs text-emerald-700">{proofFile.name}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <TabletButton variant="outline" onClick={() => setPaying(null)} disabled={pay.isPending}>
                Cancel
              </TabletButton>
              <TabletButton onClick={() => pay.mutate()} disabled={pay.isPending}>
                {pay.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting…
                  </>
                ) : (
                  "Record payment"
                )}
              </TabletButton>
            </div>
          </div>
        </div>
      )}

      <input
        ref={proofInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={qrInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onVendorQr(e.target.files?.[0])}
      />
    </FlowScaffold>
  );
}
