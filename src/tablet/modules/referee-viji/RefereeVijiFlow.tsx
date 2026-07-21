import { useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { format } from "date-fns";
import { CheckCircle2, Loader2, MessageSquarePlus, Search, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useRefereeVijiVisits,
  useVijiReviews,
  useVijiReviewActions,
  currentStatus,
  type VisitReferralRow,
} from "./useRefereeViji";

const CATEGORY = "referee_viji" as const;
const ALLOWED_ROLES = ["superadmin", "super_admin"];

function ReviewImages({ patientId }: { patientId: string | null }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["referee-viji-docs", patientId],
    enabled: !!patientId,
    staleTime: 1000 * 15,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select("id, file_url, file_name, file_type")
        .eq("patient_id", patientId)
        .eq("category", CATEGORY)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as {
        id: string;
        file_url: string;
        file_name: string;
        file_type: string | null;
      }[];
    },
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading files…</p>;
  }
  if (data.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((doc) => {
        const isImage = doc.file_type?.startsWith("image/");
        return (
          <a
            key={doc.id}
            href={doc.file_url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-border bg-muted"
          >
            {isImage ? (
              <img
                src={doc.file_url}
                alt={doc.file_name}
                className="h-16 w-16 object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center px-1 text-center text-[10px] font-medium text-muted-foreground">
                {doc.file_name || "File"}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof currentStatus> }) {
  const map: Record<string, { label: string; className: string }> = {
    approved: {
      label: "Approved",
      className: "bg-emerald-100 text-emerald-700",
    },
    rejected: {
      label: "Rejected",
      className: "bg-rose-100 text-rose-700",
    },
    commented: {
      label: "Commented",
      className: "bg-amber-100 text-amber-700",
    },
  };
  const entry = status ? map[status] : null;
  if (!entry) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Pending
      </span>
    );
  }
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", entry.className)}>
      {entry.label}
    </span>
  );
}

function VisitCard({
  visit,
  reviews,
}: {
  visit: VisitReferralRow;
  reviews: ReturnType<typeof useVijiReviews>["data"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState<"approved" | "rejected" | "commented" | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addReview, uploadReviewFiles } = useVijiReviewActions();

  const rows = reviews?.[visit.id] || [];
  const status = currentStatus(rows);
  const isAdm = !!visit.admissionDate;
  const dateLabel = isAdm
    ? format(new Date(visit.admissionDate!), "dd MMM yyyy")
    : visit.opdDate
    ? format(new Date(visit.opdDate), "dd MMM yyyy")
    : "—";

  const doReview = async (action: "approved" | "rejected" | "commented") => {
    if (action === "commented" && !comment.trim()) {
      toast.error("Enter a comment first.");
      return;
    }
    setSaving(action);
    try {
      await addReview({
        visitUuid: visit.id,
        visitId: visit.visitId,
        patientName: visit.patientName,
        action,
        comment,
      });
      toast.success(
        action === "approved"
          ? "Referral approved."
          : action === "rejected"
          ? "Referral rejected."
          : "Comment added.",
      );
      setComment("");
      setExpanded(true);
    } catch (error) {
      console.error("Failed to save referee viji review:", error);
      toast.error("Could not save. Please retry.");
    } finally {
      setSaving(null);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!visit.patientUuid) {
      toast.error("This visit has no linked patient to attach files to.");
      return;
    }
    setUploading(true);
    try {
      await uploadReviewFiles(Array.from(files), {
        patientId: visit.patientUuid,
        patientName: visit.patientName,
      });
      toast.success(`${files.length} file(s) uploaded.`);
      setExpanded(true);
    } catch (error) {
      console.error("Failed to upload referee viji files:", error);
      toast.error("Could not upload files. Please retry.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <TabletCard className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isAdm
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-emerald-100 text-emerald-700",
              )}
            >
              {isAdm ? "Admission" : "OPD"}
            </span>
            <p className="truncate font-semibold">{visit.patientName}</p>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {visit.visitId || "—"} · {dateLabel}
            {visit.age != null ? ` · ${visit.age}y` : ""}
            {visit.gender ? ` · ${visit.gender}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="text-xs">Referee:</span>{" "}
            <span className="font-medium text-foreground">
              {visit.referee || "—"}
            </span>
            {visit.relationshipManager ? ` · RM: ${visit.relationshipManager}` : ""}
          </p>
        </div>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {expanded ? "Hide" : "Review"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t pt-3">
          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg bg-muted/50 p-2 text-xs">
                  <div className="mb-0.5 flex items-center gap-2">
                    <StatusBadge status={row.action as any} />
                    <span className="text-muted-foreground">
                      {format(new Date(row.created_at), "dd MMM yyyy hh:mm a")}
                      {row.created_by ? ` · ${row.created_by}` : ""}
                    </span>
                  </div>
                  {row.comment && (
                    <p className="whitespace-pre-wrap text-foreground">{row.comment}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <ReviewImages patientId={visit.patientUuid} />

          <div className="space-y-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment (optional for approve/reject)"
              rows={2}
              className="text-base"
            />
            <div className="grid grid-cols-3 gap-2">
              <TabletButton
                className="h-11 min-h-0 bg-emerald-600 text-base hover:bg-emerald-700"
                onClick={() => doReview("approved")}
                disabled={!!saving || uploading}
              >
                {saving === "approved" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                Approve
              </TabletButton>
              <TabletButton
                variant="outline"
                className="h-11 min-h-0 border-rose-300 text-base text-rose-700 hover:bg-rose-50"
                onClick={() => doReview("rejected")}
                disabled={!!saving || uploading}
              >
                {saving === "rejected" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-1 h-4 w-4" />
                )}
                Reject
              </TabletButton>
              <TabletButton
                variant="outline"
                className="h-11 min-h-0 text-base"
                onClick={() => doReview("commented")}
                disabled={!!saving || uploading || !comment.trim()}
              >
                {saving === "commented" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="mr-1 h-4 w-4" />
                )}
                Comment
              </TabletButton>
            </div>
            <TabletButton
              variant="outline"
              className="h-11 min-h-0 w-full text-base"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !!saving || !visit.patientUuid}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload document/photo"}
            </TabletButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <p className="text-[11px] text-muted-foreground">
              Approvals, rejections & comments are append-only and cannot be edited or deleted.
            </p>
          </div>
        </div>
      )}
    </TabletCard>
  );
}

/** Referee - Viji: review (approve / reject / comment on) referrals + uploads. */
export default function RefereeVijiFlow() {
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "admission" | "opd" | "pending">("all");
  const visits = useRefereeVijiVisits();
  const reviews = useVijiReviews();

  if (!user?.role || !ALLOWED_ROLES.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (visits.data || []).filter((v) => {
      if (filter === "admission" && !v.admissionDate) return false;
      if (filter === "opd" && v.admissionDate) return false;
      if (filter === "pending") {
        const st = currentStatus(reviews.data?.[v.id]);
        if (st === "approved" || st === "rejected") return false;
      }
      if (!q) return true;
      return (
        v.patientName.toLowerCase().includes(q) ||
        (v.visitId || "").toLowerCase().includes(q) ||
        (v.referee || "").toLowerCase().includes(q) ||
        (v.relationshipManager || "").toLowerCase().includes(q)
      );
    });
  }, [visits.data, reviews.data, term, filter]);

  return (
    <FlowScaffold
      heading="Referee - Viji"
      subheading="Approve & comment on referrals"
      actions={
        <TabletButton variant="outline" className="flex-1" onClick={() => setTerm("")}>
          <Search className="mr-2 h-4 w-4" />
          Clear
        </TabletButton>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search patient, visit, referee…"
            className="h-14 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-lg text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="flex gap-2">
          {(["all", "pending", "admission", "opd"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "flex-1 rounded-lg px-2 py-2 text-sm font-medium capitalize transition",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? "All" : f === "pending" ? "Pending" : f === "admission" ? "Adm" : "OPD"}
            </button>
          ))}
        </div>

        {visits.isLoading || reviews.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No referrals match your filter.
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((visit) => (
              <VisitCard key={visit.id} visit={visit} reviews={reviews.data} />
            ))}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}