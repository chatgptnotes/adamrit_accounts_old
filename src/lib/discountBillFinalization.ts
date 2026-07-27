import { supabase } from "@/integrations/supabase/client";

export type DiscountDecision = "approved" | "rejected";

interface ResolveDiscountOptions {
  discountId: string;
  decision: DiscountDecision;
  approver: string;
  rejectionReason?: string | null;
}

/**
 * Resolve a patient-bill discount and finalize its waiting bill. The RPC keeps
 * both writes atomic. The migration must be applied before this UI is deployed;
 * deliberately do not fall back to separate writes because a partial approval
 * could leave the discount and accounting status inconsistent.
 */
export async function resolveDiscountAndFinalizeBill({
  discountId,
  decision,
  approver,
  rejectionReason = null,
}: ResolveDiscountOptions): Promise<void> {
  const { error } = await (supabase as any).rpc(
    "resolve_visit_discount_and_finalize_bill",
    {
      p_discount_id: discountId,
      p_decision: decision,
      p_approver: approver,
      p_rejection_reason: decision === "rejected" ? rejectionReason : null,
    },
  );

  if (error) throw error;
}
