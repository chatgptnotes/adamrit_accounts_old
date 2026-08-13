/**
 * Cash handover — the chain of custody for physical cash.
 *
 * Every amount here is computed by the database. The client sends the note
 * count and who is receiving the cash; it never supplies the expected figure,
 * because that is the number the count is being checked against.
 */
import { supabase } from "@/integrations/supabase/client";

/** The notes and coins a drawer can hold, largest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface HandoverLine {
  table: string;
  id: string;
  amount: number;
  at: string;
  who: string;
  patient: string | null;
  mine: boolean;
}

export interface HandoverPreview {
  cutoverAt: string;
  mineAmount: number;
  mineCount: number;
  unattributedAmount: number;
  unattributedCount: number;
  includeUnattributed: boolean;
  expectedCash: number;
  refUpiTotal: number;
  refCardTotal: number;
  lines: HandoverLine[];
}

export interface CashHandover {
  id: string;
  handover_no: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  expected_cash: number;
  counted_cash: number;
  variance: number;
  variance_reason: string | null;
  ref_upi_total: number;
  ref_card_total: number;
  source_count: number;
  included_unattributed: boolean;
  status: "SUBMITTED" | "ACCEPTED" | "VERIFIED" | "CANCELLED";
  submitted_at: string;
  accepted_at: string | null;
  accepted_by_name: string | null;
  verified_at: string | null;
  verified_by_name: string | null;
  verify_note: string | null;
  accept_note: string | null;
  cancel_reason: string | null;
  notes: string | null;
}

export interface CashPosition {
  holder_user_id: string | null;
  holder_name: string;
  net_cash: number;
  receipt_count: number;
  oldest_uncollected: string | null;
}

export interface Nominee {
  id: string;
  user_id: string;
  display_name: string;
  can_receive: boolean;
  can_verify: boolean;
  is_active: boolean;
}

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(fn, args);

export async function fetchPreview(
  userId: string,
  includeUnattributed: boolean,
): Promise<HandoverPreview> {
  const { data, error } = await rpc("cash_handover_preview", {
    p_user_id: userId,
    p_include_unattributed: includeUnattributed,
  });
  if (error) throw new Error(error.message);
  return data as HandoverPreview;
}

export async function submitHandover(input: {
  fromUserId: string;
  toUserId: string;
  denominations: { denomination: number; qty: number }[];
  hospitalType?: string | null;
  varianceReason?: string | null;
  includeUnattributed?: boolean;
  notes?: string | null;
}): Promise<{ handoverId: string; handoverNo: string; variance: number }> {
  const { data, error } = await rpc("submit_cash_handover", {
    p_from_user_id: input.fromUserId,
    p_to_user_id: input.toUserId,
    p_denominations: input.denominations.filter((d) => d.qty > 0),
    p_hospital_type: input.hospitalType ?? null,
    p_variance_reason: input.varianceReason ?? null,
    p_include_unattributed: input.includeUnattributed ?? false,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { handoverId: string; handoverNo: string; variance: number };
}

export async function acceptHandover(id: string, userId: string, note?: string) {
  const { data, error } = await rpc("accept_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function verifyHandover(id: string, userId: string, note?: string) {
  const { data, error } = await rpc("verify_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelHandover(id: string, userId: string, reason: string) {
  const { data, error } = await rpc("cancel_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchPositions(): Promise<CashPosition[]> {
  const { data, error } = await rpc("cash_position_by_holder", {});
  if (error) throw new Error(error.message);
  return (data ?? []) as CashPosition[];
}

export async function fetchNominees(): Promise<Nominee[]> {
  const { data, error } = await (supabase as any)
    .from("cash_handover_verifiers")
    .select("id, user_id, display_name, can_receive, can_verify, is_active")
    .eq("is_active", true)
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Nominee[];
}

export async function setNominee(input: {
  userId: string;
  canReceive: boolean;
  canVerify: boolean;
  isActive: boolean;
  actor?: string | null;
}) {
  const { data, error } = await rpc("set_cash_handover_verifier", {
    p_user_id: input.userId,
    p_can_receive: input.canReceive,
    p_can_verify: input.canVerify,
    p_is_active: input.isActive,
    p_actor: input.actor ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchHandovers(opts?: {
  status?: string[];
  toUserId?: string;
  limit?: number;
}): Promise<CashHandover[]> {
  let q = (supabase as any)
    .from("cash_handovers")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status?.length) q = q.in("status", opts.status);
  if (opts?.toUserId) q = q.eq("to_user_id", opts.toUserId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CashHandover[];
}

export async function fetchDenominations(handoverId: string) {
  const { data, error } = await (supabase as any)
    .from("cash_handover_denominations")
    .select("denomination, qty, line_total")
    .eq("handover_id", handoverId)
    .order("denomination", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { denomination: number; qty: number; line_total: number }[];
}
