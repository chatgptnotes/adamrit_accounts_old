import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, ShieldAlert, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { inr, todayISO } from "@/tablet/lib/format";
import {
  useDailyPaymentSchedule,
  useFundAccounts,
} from "@/hooks/useDailyPaymentAllocation";

interface Props {
  /** Live `pendingApprovals` count from useDirectorKpis. */
  pendingApprovals: number | null;
  /** Hospital slug ("hope" / "ayushman") used to scope today's schedule. */
  hospital: string;
}

interface ChipProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "red" | "amber" | "green" | "neutral";
  onClick?: () => void;
}

const TONE: Record<ChipProps["tone"], string> = {
  red: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  amber: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  green: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  neutral: "border-border bg-card text-foreground/80",
};

function Chip({ icon: Icon, label, value, tone, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex min-w-[10rem] shrink-0 items-center gap-3 rounded-2xl border p-3 text-left transition-transform",
        TONE[tone],
        onClick && "cursor-pointer active:scale-[0.98]",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sm font-bold">{value}</span>
      </span>
    </button>
  );
}

/**
 * Three at-a-glance alert chips: overdue obligations, pending bill approvals,
 * cash-vs-today's-obligations delta. Tap each to drill into the editor page.
 */
export function AlertStrip({ pendingApprovals, hospital }: Props) {
  const navigate = useNavigate();
  const today = todayISO();

  const { schedule } = useDailyPaymentSchedule(today, hospital);

  // Money that left a phone or a bank with no bill behind it. The rule is that
  // a payment needs a bill, so this chip is red the moment there is one.
  const unbilled = useQuery({
    queryKey: ["director-unbilled-payments"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("v_recon_alerts")
        .select("amount")
        .limit(500);
      const rows = data || [];
      return {
        count: rows.length,
        value: rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0),
      };
    },
  });
  const { funds } = useFundAccounts(today);

  const overdueRows = schedule.filter((s) => s.days_overdue > 0 && s.status !== "paid");
  const overdueAmount = overdueRows.reduce((s, r) => s + Number(r.total_due || 0), 0);

  const todayDue = schedule
    .filter((s) => s.status !== "paid" && s.status !== "skipped")
    .reduce((s, r) => s + Number(r.total_due || 0), 0);
  const cashAvailable = funds.totalActual || funds.totalLedger;
  const delta = cashAvailable - todayDue;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      <Chip
        icon={AlertTriangle}
        label="Overdue dues"
        value={
          overdueRows.length
            ? `${overdueRows.length} · ${inr(overdueAmount)}`
            : "None"
        }
        tone={overdueRows.length ? "red" : "green"}
        onClick={() => navigate("/daily-payment-allocation")}
      />
      <Chip
        icon={ClipboardCheck}
        label="Bills pending approval"
        value={pendingApprovals == null ? "—" : String(pendingApprovals)}
        tone={
          pendingApprovals == null
            ? "neutral"
            : pendingApprovals > 5
              ? "amber"
              : pendingApprovals > 0
                ? "neutral"
                : "green"
        }
        onClick={() => navigate("/bill-approvals")}
      />
      <Chip
        icon={ShieldAlert}
        label="Payments with no bill"
        value={
          unbilled.data?.count
            ? `${unbilled.data.count} · ${inr(unbilled.data.value)}`
            : unbilled.isLoading
              ? "—"
              : "None"
        }
        tone={unbilled.data?.count ? "red" : "green"}
        onClick={() => navigate("/t/reconciliation-tilak")}
      />
      <Chip
        icon={Wallet}
        label="Cash vs today's dues"
        value={`${inr(cashAvailable)} · ${delta >= 0 ? "+" : ""}${inr(delta)}`}
        tone={delta >= 0 ? "green" : "red"}
        onClick={() => navigate("/daily-payment-allocation")}
      />
    </div>
  );
}
