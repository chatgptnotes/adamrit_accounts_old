import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput } from "@/tablet/ui/TabletInput";
import {
  REFERRAL_EXPENSE_CODE,
  useApproveImplantReferral,
  useImplantReferralRows,
  useReferralExpenseLedger,
  type ImplantReferralRow,
} from "./useImplantReferral";

const rupees = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Every implant and referral commission waiting to be billed to the manager
 * who earned it.
 *
 * The debit is fixed — one expense head for the lot — and the credit comes
 * from the manager's mapping, so there is no ledger to choose here. A row
 * whose manager is unmapped is shown and counted but cannot be approved: the
 * fix is on the Relationship Manager master, not on this screen.
 *
 * Approving raises PENDING expense invoices; nothing reaches the day book
 * until those are approved in the bill approvals list. Whoever works this
 * screen approves them — a super admin is not required.
 */
export function ImplantReferralApproval() {
  const { data: rows = [], isLoading, isError } = useImplantReferralRows();
  const { data: expenseLedger } = useReferralExpenseLedger();
  const approve = useApproveImplantReferral();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.patientName, row.uhid, row.billNumber, row.consultant, row.rmName, row.ledgerName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  const approvable = filtered.filter((row) => row.ledgerId);
  const blocked = filtered.filter((row) => !row.ledgerId);
  const total = approvable.reduce((sum, row) => sum + row.amount, 0);
  const debitName = expenseLedger?.account_name || "Referral & Implant Commission";

  const onApprove = async () => {
    try {
      const result = await approve.mutateAsync(approvable);
      toast.success(
        `${result.invoices} pending expense invoice(s) raised for Rs. ${rupees(result.total)}. ` +
          `They post to the day book when approved in the bill approvals list.`,
      );
    } catch (error: any) {
      toast.error(error?.message || "Could not raise the invoices");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading pending implant and referral records
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-12 text-center text-destructive">
        Could not load the pending records. Check the connection and try again.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search patient, UHID, bill, consultant or manager"
          className="pl-12"
        />
      </div>

      {!expenseLedger && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Ledger {REFERRAL_EXPENSE_CODE} Referral &amp; Implant Commission does not exist yet, so
          nothing can be approved. Run the implant referral migration first.
        </p>
      )}

      {blocked.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {blocked.length} record(s) belong to a manager with no ledger and are excluded from the
          totals. Map them on the Relationship Manager master and they will become approvable.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-left">
              <Th>Patient</Th>
              <Th>UHID</Th>
              <Th>Bill No.</Th>
              <Th>Consultant</Th>
              <Th>Relationship Manager</Th>
              <Th>Ledger</Th>
              <Th>Debit</Th>
              <Th>Credit</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-muted-foreground">
                  {rows.length === 0
                    ? "No implant or referral commission is waiting to be billed."
                    : "No record matches that search."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => <Row key={row.id} row={row} debitName={debitName} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 mt-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Records </span>
              <span className="font-semibold">{approvable.length}</span>
              {blocked.length > 0 && (
                <span className="text-muted-foreground"> (+{blocked.length} blocked)</span>
              )}
            </span>
            <span>
              <span className="text-muted-foreground">Total debit </span>
              <span className="font-semibold">Rs. {rupees(total)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Total credit </span>
              <span className="font-semibold">Rs. {rupees(total)}</span>
            </span>
          </div>

          <TabletButton
            onClick={() => void onApprove()}
            disabled={approvable.length === 0 || approve.isPending || !expenseLedger}
          >
            {approve.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-5 w-5" />
            )}
            Approve {approvable.length} record(s)
          </TabletButton>
        </div>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold", className)}>
      {children}
    </th>
  );
}

function Row({ row, debitName }: { row: ImplantReferralRow; debitName: string }) {
  const blocked = !row.ledgerId;
  return (
    <tr className={cn("border-t", blocked && "bg-amber-50/60")}>
      <Td className="font-medium">{row.patientName}</Td>
      <Td>{row.uhid || "—"}</Td>
      <Td>{row.billNumber || "—"}</Td>
      <Td>{row.consultant || "—"}</Td>
      <Td>{row.rmName || "—"}</Td>
      <Td>{row.ledgerName || <span className="text-amber-700">Not mapped</span>}</Td>
      <Td className="text-muted-foreground">{debitName}</Td>
      <Td className="text-muted-foreground">{row.ledgerName || "—"}</Td>
      <Td className="text-right font-mono">{rupees(row.amount)}</Td>
      <Td>
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
            blocked ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
          )}
        >
          {blocked ? "Needs a ledger" : "Pending"}
        </span>
      </Td>
    </tr>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-2", className)}>{children}</td>;
}
