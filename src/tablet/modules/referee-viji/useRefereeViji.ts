import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";
import {
  useReferralVisits,
  type VisitReferralRow,
} from "@/tablet/modules/referee-ruby/useRefereeFeedback";

export type ReviewAction = "approved" | "rejected" | "commented";

/** Append-only review row. The newest non-comment row is the "current status". */
export interface VijiReviewRow {
  id: string;
  visit_uuid: string | null;
  visit_id: string | null;
  patient_name: string | null;
  action: ReviewAction;
  comment: string | null;
  created_by: string | null;
  created_at: string;
}

export type { VisitReferralRow };

const table = () => (supabase as any).from("referee_viji_reviews");

/** All review rows (newest first), grouped by visit UUID. */
export function useVijiReviews() {
  return useQuery({
    queryKey: ["referee-viji-reviews"],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<Record<string, VijiReviewRow[]>> => {
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const grouped: Record<string, VijiReviewRow[]> = {};
      for (const row of (data || []) as VijiReviewRow[]) {
        const key = row.visit_uuid || row.visit_id || "";
        (grouped[key] ||= []).push(row);
      }
      return grouped;
    },
  });
}

/** Derive the current status (latest approved/rejected) for a visit. */
export function currentStatus(
  rows: VijiReviewRow[] | undefined,
): ReviewAction | "commented" | null {
  if (!rows || rows.length === 0) return null;
  const latest = rows.find((r) => r.action !== "commented");
  return latest ? latest.action : "commented";
}

export interface AddReviewArgs {
  visitUuid: string;
  visitId: string | null;
  patientName: string;
  action: ReviewAction;
  comment: string;
  patientUuid?: string | null;
}

export function useVijiReviewActions() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const addReview = async (args: AddReviewArgs) => {
    const { error } = await table().insert({
      visit_uuid: args.visitUuid,
      visit_id: args.visitId ?? null,
      patient_name: args.patientName ?? null,
      action: args.action,
      comment: args.comment.trim() || null,
      created_by: user?.email || user?.username || null,
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["referee-viji-reviews"] });
  };

  const uploadReviewFiles = async (
    files: File[],
    args: { patientId: string; patientName: string },
  ) => {
    await uploadPatientDocs(files, {
      patientId: args.patientId,
      patientName: args.patientName,
      category: "referee_viji",
      uploadedBy: user?.email || user?.username || null,
    });
    await qc.invalidateQueries({ queryKey: ["referee-viji-docs", args.patientId] });
  };

  return { addReview, uploadReviewFiles };
}

/** Re-export the visits query so Viji's flow doesn't duplicate Ruby's fetch. */
export function useRefereeVijiVisits(limitPerType = 50) {
  return useReferralVisits(limitPerType);
}