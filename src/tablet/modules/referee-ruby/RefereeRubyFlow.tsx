import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, MessageSquarePlus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useReferralVisits,
  useRefereeFeedback,
  useRefereeFeedbackActions,
  type VisitReferralRow,
} from "./useRefereeFeedback";

const CATEGORY = "referee_feedback" as const;

function FeedbackImages({ patientId }: { patientId: string | null }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["referee-feedback-docs", patientId],
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
    return (
      <p className="text-xs text-muted-foreground">Loading feedback images…</p>
    );
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

function VisitCard({
  visit,
  feedback,
}: {
  visit: VisitReferralRow;
  feedback: ReturnType<typeof useRefereeFeedback>["data"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFeedback, uploadFeedbackFiles } = useRefereeFeedbackActions();

  const rows = feedback?.[visit.id] || [];
  const isAdm = !!visit.admissionDate;
  const dateLabel = isAdm
    ? format(new Date(visit.admissionDate!), "dd MMM yyyy")
    : visit.opdDate
    ? format(new Date(visit.opdDate), "dd MMM yyyy")
    : "—";

  const handleSaveComment = async () => {
    if (!comment.trim()) {
      toast.error("Enter a comment first.");
      return;
    }
    setSaving(true);
    try {
      await addFeedback({
        visitUuid: visit.id,
        visitId: visit.visitId,
        patientName: visit.patientName,
        howTheyKnew: comment,
      });
      toast.success("Feedback saved.");
      setComment("");
      setExpanded(true);
    } catch (error) {
      console.error("Failed to save referee feedback:", error);
      toast.error("Could not save feedback. Please retry.");
    } finally {
      setSaving(false);
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
      await uploadFeedbackFiles(Array.from(files), {
        patientId: visit.patientUuid,
        patientName: visit.patientName,
      });
      toast.success(`${files.length} file(s) uploaded.`);
      setExpanded(true);
    } catch (error) {
      console.error("Failed to upload referee feedback files:", error);
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
            {visit.relationshipManager
              ? ` · RM: ${visit.relationshipManager}`
              : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              rows.length > 0
                ? "bg-amber-100 text-amber-700"
                : "bg-muted text-muted-foreground",
            )}
          >
            {rows.length} note{rows.length === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-muted-foreground">
            {expanded ? "Hide" : "View"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t pt-3">
          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg bg-muted/50 p-2 text-xs"
                >
                  <p className="whitespace-pre-wrap text-foreground">
                    {row.how_they_knew}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {format(new Date(row.created_at), "dd MMM yyyy hh:mm a")}
                    {row.created_by ? ` · ${row.created_by}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}

          <FeedbackImages patientId={visit.patientUuid} />

          <div className="space-y-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How did the patient come to know about the hospital?"
              rows={3}
              className="text-base"
            />
            <div className="flex gap-2">
              <TabletButton
                className="h-11 min-h-0 flex-1 text-base"
                onClick={handleSaveComment}
                disabled={saving || !comment.trim()}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="mr-2 h-4 w-4" />
                )}
                {saving ? "Saving…" : "Add feedback"}
              </TabletButton>
              <TabletButton
                variant="outline"
                className="h-11 min-h-0 flex-1 text-base"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !visit.patientUuid}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {uploading ? "Uploading…" : "Upload statement/photo"}
              </TabletButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Comments are append-only and cannot be edited or deleted.
            </p>
          </div>
        </div>
      )}
    </TabletCard>
  );
}

/** Referee - Ruby: OPDs + recent admissions with the referee, feedback comments & uploads. */
export default function RefereeRubyFlow() {
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "admission" | "opd">("all");
  const visits = useReferralVisits();
  const feedback = useRefereeFeedback();

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (visits.data || []).filter((v) => {
      if (filter !== "all") {
        const isAdm = !!v.admissionDate;
        if (filter === "admission" && !isAdm) return false;
        if (filter === "opd" && isAdm) return false;
      }
      if (!q) return true;
      return (
        v.patientName.toLowerCase().includes(q) ||
        (v.visitId || "").toLowerCase().includes(q) ||
        (v.referee || "").toLowerCase().includes(q) ||
        (v.relationshipManager || "").toLowerCase().includes(q)
      );
    });
  }, [visits.data, term, filter]);

  return (
    <FlowScaffold
      heading="Referee - Ruby"
      subheading="How patients came to know about us"
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
          {(["all", "admission", "opd"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? "All" : f === "admission" ? "Admissions" : "OPD"}
            </button>
          ))}
        </div>

        {visits.isLoading || feedback.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No visits match your search.
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((visit) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                feedback={feedback.data}
              />
            ))}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}