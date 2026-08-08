import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { Camera, FileText, Loader2, Paperclip, Plus, QrCode, Search, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { saveLedgerQr, savePaymentProof } from "@/lib/expense-bills/paymentEvidence";
import { openStoredDocument } from "@/lib/openStoredDocument";
import { shortDate } from "@/tablet/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { LedgerPicker } from "./LedgerPicker";
import { BillPaymentSheet } from "./BillPaymentSheet";
import { InvoiceCamera } from "./InvoiceCamera";
import { ImplantReferralApproval } from "./ImplantReferralApproval";
import {
  useExpenseBillCompanyId,
  useExpenseLedgerByName,
  useExpenseLedgers,
  useOutstandingBills,
  usePartyLedgers,
  useRecordExpenseBill,
  type LedgerOption,
  type OutstandingBill,
} from "./useExpenseBills";

const rupees = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

// Same three states the desktop register shows, worked out the same way.
type PaymentStatus = "unpaid" | "partial" | "paid";

const statusOf = (b: OutstandingBill): PaymentStatus =>
  b.outstanding <= 0.005 ? "paid" : b.paid > 0.005 ? "partial" : "unpaid";

const STATUS_STYLE: Record<PaymentStatus, string> = {
  unpaid: "bg-red-100 text-red-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
};

type ExpenseCategory =
  | "rent"
  | "implant"
  | "implant_referral"
  | "salary"
  | "consultant"
  | "other";

const EXPENSE_CATEGORIES: Array<{
  value: ExpenseCategory;
  label: string;
  ledgerName: string | null;
}> = [
  { value: "rent", label: "Rent", ledgerName: "Rent" },
  { value: "implant", label: "Implant", ledgerName: "Implant Purchase" },
  // Not a bill anyone hands in: the commission is already computed per visit,
  // so this category opens the approval dashboard instead of the form.
  { value: "implant_referral", label: "Implant (Referral)", ledgerName: null },
  { value: "salary", label: "Salary", ledgerName: "Staff Salary" },
  {
    value: "consultant",
    label: "Consultant Payment",
    ledgerName: "Consultancy Fees",
  },
  { value: "other", label: "Other", ledgerName: null },
];

/**
 * The payee's QR to scan and the confirmation to upload, on the bill itself.
 * The QR is held against the party's LEDGER, so it is the same code the
 * desktop register shows and the same one every future bill for that party
 * will use. Stops propagation throughout: the card behind opens the payment
 * sheet, and scanning or uploading must not start a payment.
 */
function PayEvidenceRow({ bill }: { bill: OutstandingBill }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showQr, setShowQr] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const proofInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["expense-bills-outstanding"] });

  const onProof = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      await savePaymentProof(bill.id, file);
      toast.success(`Payment proof saved against ${bill.billNumber}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the proof");
    } finally {
      setBusy(false);
      if (proofInput.current) proofInput.current.value = "";
    }
  };

  const onQr = async (file?: File) => {
    if (!file || !bill.partyLedgerId) return;
    setBusy(true);
    try {
      await saveLedgerQr(bill.partyLedgerId, file, user?.email || null);
      toast.success(`QR saved for ${bill.party}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the QR");
    } finally {
      setBusy(false);
      if (qrInput.current) qrInput.current.value = "";
    }
  };

  const stop = (e: MouseEvent<HTMLDivElement>) => e.stopPropagation();

  return (
    <div onClick={stop} className="space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <TabletButton
          variant="outline"
          size="sm"
          disabled={busy || (!bill.partyQrUrl && !bill.partyLedgerId)}
          onClick={() => (bill.partyQrUrl ? setShowQr((v) => !v) : qrInput.current?.click())}
        >
          <QrCode className="mr-1 h-4 w-4" />
          {bill.partyQrUrl ? (showQr ? "Hide QR" : "Scan QR") : "Add QR"}
        </TabletButton>

        {bill.paymentProofUrl ? (
          <TabletButton
            variant="outline"
            size="sm"
            onClick={() => setShowProof((v) => !v)}
            className="text-emerald-700"
          >
            <FileText className="mr-1 h-4 w-4" />
            {showProof ? "Hide proof" : "Proof uploaded"}
          </TabletButton>
        ) : (
          <>
            <TabletButton
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => proofInput.current?.click()}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              Upload proof
            </TabletButton>
            {/* Same destination, camera straight away — on a phone the
                confirmation is on the screen you are holding. */}
            <TabletButton
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => cameraInput.current?.click()}
              aria-label="Photograph the payment confirmation"
            >
              <Camera className="h-4 w-4" />
            </TabletButton>
          </>
        )}
      </div>

      {showQr && bill.partyQrUrl && (
        <div className="space-y-2">
          <img
            src={bill.partyQrUrl}
            alt={`Payment QR for ${bill.party}`}
            className="mx-auto w-full max-w-[240px] rounded-md border"
          />
          <p className="text-center text-xs text-muted-foreground">
            {bill.party} · {rupees(bill.outstanding)} outstanding
          </p>
          <TabletButton
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => qrInput.current?.click()}
          >
            Replace QR
          </TabletButton>
        </div>
      )}

      {/* The confirmation opens on the card itself, the same way the QR does —
          nobody has to leave the list to check a payment went through. */}
      {showProof && bill.paymentProofUrl && (
        bill.paymentProofUrl.split("?")[0].toLowerCase().endsWith(".pdf") ? (
          <iframe
            src={bill.paymentProofUrl}
            title={`Payment proof for ${bill.billNumber}`}
            className="h-[50vh] w-full rounded-md border"
          />
        ) : (
          <img
            src={bill.paymentProofUrl}
            alt={`Payment proof for ${bill.billNumber}`}
            className="mx-auto w-full rounded-md border"
          />
        )
      )}

      <input
        ref={proofInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void onProof(e.target.files?.[0])}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onProof(e.target.files?.[0])}
      />
      <input
        ref={qrInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onQr(e.target.files?.[0])}
      />
    </div>
  );
}

function OutstandingList({ onPay }: { onPay: (bill: OutstandingBill) => void }) {
  // Without a term the tile shows the recent slice; searching widens the
  // window so an invoice raised days ago is reachable without scrolling.
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 250);
  const { data: bills = [], isLoading } = useOutstandingBills(25, debouncedSearch);
  const searching = debouncedSearch.trim().length > 0;

  const searchBar = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <TabletInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search patient, centre / vendor, bill no or amount…"
        className="pl-10"
      />
      {search && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setSearch("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {searchBar}
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading bills
        </div>
      </div>
    );
  }

  if (bills.length === 0) {
    return (
      <div className="space-y-3">
        {searchBar}
        <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
          {searching
            ? `No invoice matches "${debouncedSearch.trim()}".`
            : "No invoices recorded yet."}
        </TabletCard>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {searchBar}
      {searching && (
        <p className="text-xs text-muted-foreground">
          {bills.length} invoice{bills.length === 1 ? "" : "s"} matching “{debouncedSearch.trim()}”
        </p>
      )}
      {bills.map((b) => (
        <TabletCard
          key={b.id}
          variant="flat"
          interactive={b.outstanding > 0.005}
          onClick={b.outstanding > 0.005 ? () => onPay(b) : undefined}
          className="space-y-2"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold">{b.party}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {b.billNumber} · {shortDate(b.billDate)} · {b.expenseHead}
              </p>
              {b.patientName && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Patient: {b.patientName}
                  {b.patientType ? ` (${b.patientType})` : ""}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div
                className={cn(
                  "text-base font-bold tabular-nums",
                  b.outstanding > 0 ? "text-amber-700" : "text-emerald-700",
                )}
              >
                {rupees(b.outstanding)}
              </div>
              <span
                className={cn(
                  "mt-0.5 inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase",
                  STATUS_STYLE[statusOf(b)],
                )}
              >
                {statusOf(b)}
              </span>
              <p className="text-[11px] text-muted-foreground">
                {b.outstanding > 0.005 ? "tap to pay" : "settled"}
              </p>
            </div>
          </div>

          {(b.pointOfContact || b.relationshipManager) && (
            <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              {b.pointOfContact && <span>POC: {b.pointOfContact}</span>}
              {b.relationshipManager && <span>RM: {b.relationshipManager}</span>}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Billed {rupees(b.billed)}
              {b.paid > 0 ? ` · paid ${rupees(b.paid)}` : ""}
            </span>
            {b.documentUrl && (
              <button
                type="button"
                onClick={(e) => {
                  // The card itself opens the payment sheet — viewing the
                  // invoice should not also start a payment.
                  e.stopPropagation();
                  void openStoredDocument(b.documentUrl!).catch((err) => toast.error(err.message));
                }}
                className="flex items-center gap-1 font-medium text-primary"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Invoice
              </button>
            )}
            {b.signedVoucherUrl && (
              <a
                href={b.signedVoucherUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Payment voucher signed by the receiver of the cash"
                className="flex items-center gap-1 font-medium text-emerald-700"
              >
                <FileText className="h-3.5 w-3.5" />
                Signed PV
              </a>
            )}
          </div>

          <PayEvidenceRow bill={b} />
        </TabletCard>
      ))}
    </div>
  );
}

export default function ExpenseBillsFlow() {
  const [showForm, setShowForm] = useState(false);
  const [paying, setPaying] = useState<OutstandingBill | null>(null);
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [party, setParty] = useState<LedgerOption | null>(null);
  const [head, setHead] = useState<LedgerOption | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPrefillRef = useRef<ExpenseCategory | null>(null);

  const record = useRecordExpenseBill();
  const company = useExpenseBillCompanyId();
  const categoryConfig = EXPENSE_CATEGORIES.find((item) => item.value === category);
  const mappedLedgerName = categoryConfig?.ledgerName ?? null;
  const mappedHead = useExpenseLedgerByName(mappedLedgerName);

  useEffect(() => {
    if (
      category &&
      category !== "other" &&
      pendingPrefillRef.current === category &&
      mappedHead.data
    ) {
      setHead(mappedHead.data);
      pendingPrefillRef.current = null;
    }
  }, [category, mappedHead.data]);

  const amountValue = useMemo(() => Number(amount.replace(/,/g, "")) || 0, [amount]);
  const canSave =
    !!company.data &&
    !!category &&
    !!party &&
    !!head &&
    party.id !== head.id &&
    !!file &&
    billNumber.trim().length > 0 &&
    amountValue > 0 &&
    !record.isPending;

  const reset = () => {
    setCategory(null);
    setParty(null);
    setHead(null);
    setBillNumber("");
    setBillDate(today());
    setDueDate("");
    setAmount("");
    setNarration("");
    setFile(null);
  };

  const save = () => {
    if (!canSave || !company.data || !party || !head || !file) return;
    record.mutate(
      {
        billNumber,
        billDate,
        dueDate: dueDate || null,
        partyLedgerId: party.id,
        expenseLedgerId: head.id,
        companyId: company.data,
        amount: amountValue,
        narration,
        file,
      },
      {
        onSuccess: () => {
          toast.success(`Invoice ${billNumber.trim()} recorded and posted`);
          reset();
          setShowForm(false);
        },
        onError: (e: any) => toast.error(e?.message || "Could not record the invoice"),
      },
    );
  };

  if (paying) {
    return <BillPaymentSheet bill={paying} onClose={() => setPaying(null)} />;
  }

  if (!showForm) {
    return (
      <div className="flex h-full flex-col">
        <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">
            Invoices recorded here post their own accounting entry. Record the bill when it
            arrives, then tap it to pay when the money goes out.
          </p>

          <OutstandingList onPay={setPaying} />
        </div>

        <div className="tablet-safe-bottom flex-shrink-0 border-t bg-background/95 p-4 backdrop-blur">
          <TabletButton className="w-full" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-5 w-5" />
            Record an invoice
          </TabletButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
        {company.isError && (
          <TabletCard variant="flat" className="border-destructive/40 text-sm text-destructive">
            The accounting company could not be loaded. Close this screen and try again.
          </TabletCard>
        )}

        <div className="flex justify-end">
          <div className="w-full max-w-xs">
            <TabletLabel htmlFor="expense-category">Invoice category</TabletLabel>
            <Select
              value={category ?? undefined}
              onValueChange={(value: ExpenseCategory) => {
                setHead(null);
                pendingPrefillRef.current = value === "other" ? null : value;
                setCategory(value);
              }}
            >
              <SelectTrigger id="expense-category" className="min-h-12 w-full text-base">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {category === "implant_referral" ? (
          <ImplantReferralApproval />
        ) : (
        <>
        <LedgerPicker
          label="Who is the bill from"
          placeholder="Search vendors, consultants and salary payees"
          selected={party}
          onSelect={setParty}
          useOptions={usePartyLedgers}
        />

        <LedgerPicker
          label="What is it for"
          placeholder="Search expense heads"
          selected={head}
          onSelect={(ledger) => {
            pendingPrefillRef.current = null;
            setHead(ledger);
          }}
          useOptions={useExpenseLedgers}
        />
        {party && head && party.id === head.id ? (
          <p className="text-sm text-destructive">
            Bill From and What It Is For must use different ledgers.
          </p>
        ) : null}
        {category && category !== "other" && mappedHead.isLoading && !head ? (
          <p className="text-sm text-muted-foreground">
            Finding the suggested {mappedLedgerName} ledger. You can select another
            expense ledger now.
          </p>
        ) : !category ? (
          <p className="text-sm text-muted-foreground">
            Select an invoice category to suggest an expense ledger.
          </p>
        ) : null}

        <div>
          <TabletLabel htmlFor="bill-number">Invoice number</TabletLabel>
          <TabletInput
            id="bill-number"
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            placeholder="As printed on the invoice"
          />
        </div>

        <div>
          <TabletLabel htmlFor="amount">Amount</TabletLabel>
          <TabletInput
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="text-2xl font-semibold tabular-nums"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <TabletLabel htmlFor="bill-date">Invoice date</TabletLabel>
            <TabletInput
              id="bill-date"
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </div>
          <div>
            <TabletLabel htmlFor="due-date">Due date</TabletLabel>
            <TabletInput
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <TabletLabel htmlFor="narration">Note (optional)</TabletLabel>
          <TabletInput
            id="narration"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Anything worth recording"
          />
        </div>

        {/* The approved invoice, kept as evidence against the entry. */}
        <div>
          <TabletLabel>Approved invoice (required)</TabletLabel>
          {file ? (
            <TabletCard variant="flat" className="flex items-center gap-3">
              <FileText className="h-6 w-6 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="shrink-0 rounded-full p-2 active:bg-muted"
                aria-label="Remove the attached invoice"
              >
                <X className="h-5 w-5" />
              </button>
            </TabletCard>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <TabletButton variant="outline" onClick={() => setCameraOpen(true)}>
                <Camera className="mr-2 h-5 w-5" />
                Photo
              </TabletButton>
              <TabletButton variant="outline" onClick={() => fileRef.current?.click()}>
                <Paperclip className="mr-2 h-5 w-5" />
                File
              </TabletButton>
            </div>
          )}
          <InvoiceCamera
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={setFile}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {!file && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Attach a photo or PDF before recording the invoice.
            </p>
          )}
        </div>
        </>
        )}
      </div>

      <div className="tablet-safe-bottom flex flex-shrink-0 gap-3 border-t bg-background/95 p-4 backdrop-blur">
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={() => {
            reset();
            setShowForm(false);
          }}
        >
          {category === "implant_referral" ? "Close" : "Cancel"}
        </TabletButton>
        {/* The referral dashboard approves from its own sticky footer, where
            the totals it is approving are in view. */}
        {category !== "implant_referral" && (
          <TabletButton className="flex-[2]" disabled={!canSave} onClick={save}>
            {record.isPending || company.isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {record.isPending ? "Recording" : "Loading company"}
              </>
            ) : (
              "Record invoice"
            )}
          </TabletButton>
        )}
      </div>
    </div>
  );
}
