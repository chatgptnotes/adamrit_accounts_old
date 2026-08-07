import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { importStatement } from "@/lib/recon/statementScan";

// DATA SOURCE: recon_sources (this holder's phone) -> recon_uploads +
// recon_transactions, read off the screenshot by the AI rail.
//
// The phones are handed back each evening and the rule is that the day's
// PhonePe history goes in first. This screen does that one job: photograph or
// pick the history screen, and it is read, saved and matched against the
// payments the books already carry. What it cannot match becomes an exception
// on Tilak's reconciliation tile — nobody is asked to judge that here.

export function PhonePeUploadFlow({ holder }: { holder: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const source = useQuery({
    queryKey: ["recon-source", holder],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recon_sources")
        .select("id, label, holder")
        .eq("kind", "UPI_PHONE")
        .ilike("holder", holder)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const today = useQuery({
    queryKey: ["recon-handover", holder],
    enabled: !!source.data?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("v_recon_handover_today")
        .select("handed_in, uploaded_at, uploaded_by")
        .eq("source_id", source.data.id)
        .maybeSingle();
      return data;
    },
  });

  const recent = useQuery({
    queryKey: ["recon-recent", holder],
    enabled: !!source.data?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("recon_uploads")
        .select("id, created_at, period_start, period_end, uploaded_by")
        .eq("source_id", source.data.id)
        .order("created_at", { ascending: false })
        .limit(8);
      return data || [];
    },
  });

  const onFile = async (file?: File) => {
    if (!file || !source.data?.id) return;
    setBusy(true);
    try {
      const result = await importStatement({
        sourceId: source.data.id,
        file,
        uploadedBy: user?.email || user?.id || null,
      });
      toast.success(
        `${result.read} transaction${result.read === 1 ? "" : "s"} read` +
          (result.duplicates ? `, ${result.duplicates} already on file` : "") +
          (result.unmatched ? `. ${result.unmatched} need a bill.` : ". All matched to bills."),
      );
      await queryClient.invalidateQueries({ queryKey: ["recon-handover", holder] });
      await queryClient.invalidateQueries({ queryKey: ["recon-recent", holder] });
    } catch (error: any) {
      toast.error(error?.message || "Could not read the screenshot");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  };

  const handedIn = today.data?.handed_in === true;

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading={`PhonePe History - ${holder}`}
      subheading="Upload today's history before handing the phone back"
    >
      <div className="space-y-3">
        <TabletCard
          variant="flat"
          className={handedIn ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}
        >
          <div className="flex items-center gap-3">
            {handedIn ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            ) : (
              <Clock className="h-6 w-6 shrink-0 text-amber-600" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">
                {handedIn ? "Today's history is in" : "Today's history is not in yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {handedIn && today.data?.uploaded_at
                  ? `Uploaded ${new Date(today.data.uploaded_at).toLocaleTimeString("en-IN")}`
                  : "Upload the PhonePe history screen before handing the phone over"}
              </p>
            </div>
          </div>
        </TabletCard>

        <div className="flex gap-2">
          <TabletButton className="flex-1" disabled={busy || !source.data} onClick={() => cameraInput.current?.click()}>
            {busy ? <Loader2 className="mr-1 h-5 w-5 animate-spin" /> : <Camera className="mr-1 h-5 w-5" />}
            Photograph history
          </TabletButton>
          <TabletButton
            variant="outline"
            className="flex-1"
            disabled={busy || !source.data}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-1 h-5 w-5" /> Pick screenshot
          </TabletButton>
        </div>

        <p className="text-xs text-muted-foreground">
          One screen at a time. Scroll the PhonePe history and send each screen — a transaction
          already sent is recognised and not counted twice.
        </p>

        {(recent.data?.length ?? 0) > 0 && (
          <TabletCard variant="flat" className="space-y-1">
            <p className="text-sm font-semibold">Sent recently</p>
            {recent.data.map((u: any) => (
              <p key={u.id} className="text-xs text-muted-foreground">
                {new Date(u.created_at).toLocaleString("en-IN")}
                {u.period_start ? ` · ${u.period_start} to ${u.period_end}` : ""}
              </p>
            ))}
          </TabletCard>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
    </FlowScaffold>
  );
}

export default PhonePeUploadFlow;
