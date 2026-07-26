import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** One obligation due today, as daily_payment_schedule holds it. */
export interface DuePayment {
  id: string;
  obligationId: string;
  party: string;
  category: string;
  dailyAmount: number;
  carryforward: number;
  totalDue: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  status: string;
  voucherId: string | null;
}

/** Today in the local timezone, not UTC, so a late evening does not roll over. */
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const rows = (data: any[]): DuePayment[] =>
  (data ?? []).map((r) => {
    const totalDue = Number(r.total_due) || 0;
    const paid = Number(r.paid_amount) || 0;
    return {
      id: r.id,
      obligationId: r.obligation_id,
      party: r.party_name ?? "",
      category: r.category ?? "",
      dailyAmount: Number(r.daily_amount) || 0,
      carryforward: Number(r.carryforward_amount) || 0,
      totalDue,
      paid,
      outstanding: Math.max(totalDue - paid, 0),
      daysOverdue: Number(r.days_overdue) || 0,
      status: r.status ?? "",
      voucherId: r.voucher_id ?? null,
    };
  });

/**
 * What is due today. generate_daily_payment_schedule is called first because
 * the schedule is built on demand rather than by a cron, so a tablet opened
 * before anyone has touched the desktop screen would otherwise show nothing.
 */
export function usePaymentsDue(date: string) {
  const { hospitalConfig } = useAuth();
  const hospital = hospitalConfig?.name ?? "hope";

  return useQuery({
    queryKey: ["tablet-payments-due", date, hospital],
    queryFn: async (): Promise<DuePayment[]> => {
      await (supabase as any).rpc("generate_daily_payment_schedule", {
        p_date: date,
        p_hospital: hospital,
      });

      const { data, error } = await (supabase as any)
        .from("daily_payment_schedule")
        .select("*")
        .eq("schedule_date", date)
        .eq("hospital_name", hospital)
        .order("days_overdue", { ascending: false })
        .order("party_name", { ascending: true });
      if (error) throw error;
      return rows(data);
    },
  });
}

/**
 * Record a payment. mark_obligation_paid does the accounting: it debits the
 * obligation's expense head, credits Cash in Hand, and writes the voucher back
 * onto the schedule row. It returns the voucher id.
 */
export function useMarkPaid(date: string) {
  const qc = useQueryClient();
  const { user, hospitalConfig } = useAuth();
  const hospital = hospitalConfig?.name ?? "hope";

  return useMutation({
    mutationFn: async ({ scheduleId, amount }: { scheduleId: string; amount: number }) => {
      const { data, error } = await (supabase as any).rpc("mark_obligation_paid", {
        p_schedule_id: scheduleId,
        p_amount: amount,
        p_user_id: user?.email ?? "tablet",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-payments-due", date, hospital] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
  });
}
