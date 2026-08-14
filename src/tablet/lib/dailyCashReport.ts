/**
 * The day's cash for one counter, and the shortage or excess it is reported by.
 *
 * Every figure here is computed by the database. Avani picks a day and a
 * counter and nothing else: a report of a shortage must not be typed by the
 * person reporting it, which is the same rule the handover already runs on.
 *
 * The shortage itself is not a second reconciliation. It is the sum of the
 * variances on that day's handovers — the number the cashier already had to
 * explain when the drawer was counted. A parallel calculation here would give
 * the hospital two answers to "how much was missing" and no way to choose.
 */
import { supabase } from "@/integrations/supabase/client";

export const CASH_BOOKS = [
  { key: "hope", label: "DRM Hope Hospital" },
  { key: "ayushman", label: "Ayushman Nagpur" },
  { key: "pharmacy", label: "Hope Pharmacy" },
] as const;

export type CashBookKey = (typeof CASH_BOOKS)[number]["key"];

export const bookLabel = (key: string | null | undefined) =>
  CASH_BOOKS.find((b) => b.key === (key ?? "").trim().toLowerCase())?.label ?? key ?? "—";

export type DayKind = "SHORTAGE" | "EXCESS" | "BALANCED";

export interface DayHandover {
  handoverNo: string;
  from: string | null;
  to: string | null;
  expected: number;
  counted: number;
  locker: number;
  deposit: number;
  variance: number;
  reason: string | null;
  status: string;
  at: string | null;
}

export interface CashierLine {
  who: string;
  amount: number;
  count: number;
}

export interface DailyCashSummary {
  date: string;
  hospitalType: string;
  opening: number;
  collected: number;
  paidOut: number;
  deposited: number;
  handedOver: number;
  /** What should still be in the drawer if nothing is missing. */
  stillInDrawer: number;
  variance: number;
  kind: DayKind;
  byCashier: CashierLine[];
  handovers: DayHandover[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function fetchDailyCashSummary(
  date: string,
  hospitalType: string,
): Promise<DailyCashSummary> {
  const { data, error } = await (supabase as any).rpc("daily_cash_summary", {
    p_date: date,
    p_hospital_type: hospitalType,
  });
  if (error) throw new Error(error.message);
  const d = data as any;
  return {
    date: d.date,
    hospitalType: d.hospitalType,
    opening: num(d.opening),
    collected: num(d.collected),
    paidOut: num(d.paidOut),
    deposited: num(d.deposited),
    handedOver: num(d.handedOver),
    stillInDrawer: num(d.stillInDrawer),
    variance: num(d.variance),
    kind: d.kind as DayKind,
    byCashier: (d.byCashier ?? []).map((c: any) => ({
      who: c.who, amount: num(c.amount), count: Number(c.count ?? 0),
    })),
    handovers: (d.handovers ?? []).map((h: any) => ({
      handoverNo: h.handoverNo,
      from: h.from ?? null,
      to: h.to ?? null,
      expected: num(h.expected),
      counted: num(h.counted),
      locker: num(h.locker),
      deposit: num(h.deposit),
      variance: num(h.variance),
      reason: h.reason ?? null,
      status: h.status,
      at: h.at ?? null,
    })),
  };
}

export interface SentReport {
  id: string;
  reportDate: string;
  hospitalType: string;
  kind: DayKind;
  variance: number;
  note: string | null;
  reportedByName: string | null;
  directorsTold: number;
  createdAt: string;
}

/** What has already been sent for a day, so nobody reports it twice blind. */
export async function fetchSentReports(
  date: string,
  hospitalType: string,
): Promise<SentReport[]> {
  const { data, error } = await (supabase as any)
    .from("cash_daily_reports")
    .select("id, report_date, hospital_type, kind, variance, note, reported_by_name, directors_told, created_at")
    .eq("report_date", date)
    .eq("hospital_type", hospitalType)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    reportDate: r.report_date,
    hospitalType: r.hospital_type,
    kind: r.kind,
    variance: num(r.variance),
    note: r.note ?? null,
    reportedByName: r.reported_by_name ?? null,
    directorsTold: Number(r.directors_told ?? 0),
    createdAt: r.created_at,
  }));
}

/** Send the day to the directors. The database decides shortage or excess. */
export async function reportDailyCash(input: {
  date: string;
  hospitalType: string;
  userId: string | null;
  note: string | null;
}): Promise<{ kind: DayKind; variance: number; directorsTold: number }> {
  const { data, error } = await (supabase as any).rpc("report_daily_cash", {
    p_date: input.date,
    p_hospital_type: input.hospitalType,
    p_user_id: input.userId,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const d = data as any;
  return { kind: d.kind, variance: num(d.variance), directorsTold: Number(d.directorsTold ?? 0) };
}
