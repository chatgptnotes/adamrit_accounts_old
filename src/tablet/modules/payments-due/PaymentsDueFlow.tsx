import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { DuePayment, today, useMarkPaid, usePaymentsDue } from "./usePaymentsDue";

const rupees = (n: number) =>
  `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DueCard({ p, onPay }: { p: DuePayment; onPay: (p: DuePayment) => void }) {
  const settled = p.outstanding < 0.005;
  return (
    <TabletCard
      className="space-y-2"
      interactive={!settled}
      onClick={settled ? undefined : () => onPay(p)}
      onKeyDown={
        settled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPay(p);
              }
            }
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{p.party}</h3>
          <p className="text-sm capitalize text-muted-foreground">{p.category}</p>
        </div>
        {p.daysOverdue > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-3 w-3" />
            {p.daysOverdue}d late
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">
          {settled ? "Paid today" : "Outstanding"}
        </span>
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            settled ? "text-emerald-700" : "text-amber-700",
          )}
        >
          {rupees(settled ? p.paid : p.outstanding)}
        </span>
      </div>

      {p.paid > 0 && !settled && (
        <p className="text-xs text-muted-foreground">
          {rupees(p.paid)} already paid of {rupees(p.totalDue)}
        </p>
      )}
      {p.carryforward > 0 && (
        <p className="text-xs text-muted-foreground">
          includes {rupees(p.carryforward)} carried forward
        </p>
      )}
    </TabletCard>
  );
}

function PaySheet({
  p,
  date,
  onClose,
}: {
  p: DuePayment;
  date: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(p.outstanding.toFixed(2));
  const pay = useMarkPaid(date);

  const value = useMemo(() => Number(amount.replace(/,/g, "")) || 0, [amount]);
  const overpaying = value > p.outstanding + 0.005;
  const canPay = value > 0 && !overpaying && !pay.isPending;

  const submit = () => {
    pay.mutate(
      { scheduleId: p.id, amount: value },
      {
        onSuccess: (voucherId) => {
          toast.success(`${rupees(value)} to ${p.party} recorded`, {
            description: voucherId ? "Posted to the ledger" : undefined,
          });
          onClose();
        },
        onError: (e: any) => toast.error(e?.message || "Could not record the payment"),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
        <TabletCard variant="flat" className="space-y-1">
          <h2 className="text-lg font-semibold">{p.party}</h2>
          <p className="text-sm capitalize text-muted-foreground">{p.category}</p>
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-sm text-muted-foreground">Outstanding today</span>
            <span className="text-xl font-bold tabular-nums text-amber-700">
              {rupees(p.outstanding)}
            </span>
          </div>
          {p.daysOverdue > 0 && (
            <p className="text-sm text-amber-700">{p.daysOverdue} days overdue</p>
          )}
        </TabletCard>

        <div>
          <TabletLabel htmlFor="pay-amount">Paying now</TabletLabel>
          <TabletInput
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {overpaying && (
            <p className="mt-1 text-sm text-destructive">
              More than the {rupees(p.outstanding)} outstanding.
            </p>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          This posts the payment to the ledger against this obligation's expense head,
          paid out of cash. Nothing else needs entering.
        </p>
      </div>

      <div className="tablet-safe-bottom flex flex-shrink-0 gap-3 border-t bg-background/95 p-4 backdrop-blur">
        <TabletButton variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </TabletButton>
        <TabletButton className="flex-[2]" disabled={!canPay} onClick={submit}>
          {pay.isPending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Recording
            </>
          ) : (
            `Pay ${rupees(value)}`
          )}
        </TabletButton>
      </div>
    </div>
  );
}

export default function PaymentsDueFlow() {
  const [date] = useState(today());
  const [paying, setPaying] = useState<DuePayment | null>(null);
  const { data, isLoading, error } = usePaymentsDue(date);

  if (paying) {
    return <PaySheet p={paying} date={date} onClose={() => setPaying(null)} />;
  }

  const due = (data ?? []).filter((p) => p.outstanding > 0.005);
  const done = (data ?? []).filter((p) => p.outstanding <= 0.005 && p.paid > 0);
  const outstanding = due.reduce((s, p) => s + p.outstanding, 0);
  const paidToday = done.reduce((s, p) => s + p.paid, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          What is due today. Tap one to pay it, and the accounting entry is written for
          you.
        </p>

        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <TabletCard variant="flat">
            <p className="text-sm text-destructive">
              Could not load today's payments. {(error as any)?.message}
            </p>
          </TabletCard>
        )}

        {!isLoading && !error && due.length === 0 && done.length === 0 && (
          <TabletCard variant="flat">
            <p className="text-sm text-muted-foreground">Nothing is due today.</p>
          </TabletCard>
        )}

        {due.map((p) => (
          <DueCard key={p.id} p={p} onPay={setPaying} />
        ))}

        {done.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-emerald-600" />
              Paid today
            </div>
            {done.map((p) => (
              <DueCard key={p.id} p={p} onPay={setPaying} />
            ))}
          </>
        )}
      </div>

      <div className="tablet-safe-bottom flex-shrink-0 border-t bg-background/95 p-4 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">
            {due.length} still due{paidToday > 0 ? `, ${rupees(paidToday)} paid` : ""}
          </span>
          <span className="text-lg font-bold tabular-nums text-amber-700">
            {rupees(outstanding)}
          </span>
        </div>
      </div>
    </div>
  );
}
