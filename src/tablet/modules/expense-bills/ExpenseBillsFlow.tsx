import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, FileText, Loader2, Paperclip, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { LedgerPicker } from "./LedgerPicker";
import { BillPaymentSheet } from "./BillPaymentSheet";
import {
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

function OutstandingList({ onPay }: { onPay: (bill: OutstandingBill) => void }) {
  const { data: bills = [], isLoading } = useOutstandingBills();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading bills
      </div>
    );
  }

  if (bills.length === 0) {
    return (
      <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
        No invoices recorded yet.
      </TabletCard>
    );
  }

  return (
    <div className="space-y-3">
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
                {b.billNumber} · {b.expenseHead}
              </p>
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
              <p className="text-[11px] text-muted-foreground">
                {b.outstanding > 0.005 ? "tap to pay" : "settled"}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Billed {rupees(b.billed)}
              {b.paid > 0 ? ` · paid ${rupees(b.paid)}` : ""}
            </span>
            {b.documentUrl && (
              <a
                href={b.documentUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-medium text-primary"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Invoice
              </a>
            )}
          </div>
        </TabletCard>
      ))}
    </div>
  );
}

export default function ExpenseBillsFlow() {
  const [showForm, setShowForm] = useState(false);
  const [paying, setPaying] = useState<OutstandingBill | null>(null);
  const [party, setParty] = useState<LedgerOption | null>(null);
  const [head, setHead] = useState<LedgerOption | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const record = useRecordExpenseBill();

  const amountValue = useMemo(() => Number(amount.replace(/,/g, "")) || 0, [amount]);
  const canSave =
    !!party && !!head && billNumber.trim().length > 0 && amountValue > 0 && !record.isPending;

  const reset = () => {
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
    if (!canSave || !party || !head) return;
    record.mutate(
      {
        billNumber,
        billDate,
        dueDate: dueDate || null,
        partyLedgerId: party.id,
        expenseLedgerId: head.id,
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
        <LedgerPicker
          label="Who is the bill from"
          placeholder="Search suppliers and creditors"
          selected={party}
          onSelect={setParty}
          useOptions={usePartyLedgers}
        />

        <LedgerPicker
          label="What is it for"
          placeholder="Search expense heads"
          selected={head}
          onSelect={setHead}
          useOptions={useExpenseLedgers}
        />

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
          <TabletLabel>Approved invoice</TabletLabel>
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
              <TabletButton variant="outline" onClick={() => cameraRef.current?.click()}>
                <Camera className="mr-2 h-5 w-5" />
                Photo
              </TabletButton>
              <TabletButton variant="outline" onClick={() => fileRef.current?.click()}>
                <Paperclip className="mr-2 h-5 w-5" />
                File
              </TabletButton>
            </div>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
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
          Cancel
        </TabletButton>
        <TabletButton className="flex-[2]" disabled={!canSave} onClick={save}>
          {record.isPending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Recording
            </>
          ) : (
            "Record invoice"
          )}
        </TabletButton>
      </div>
    </div>
  );
}
