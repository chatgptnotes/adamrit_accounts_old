import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Paperclip,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { importStatement } from "@/lib/recon/statementScan";
import {
  fetchSettlementDays,
  fetchSettlementDocs,
  settlementDateLabel,
  uploadSettlementDocs,
} from "@/lib/recon/settlementDays";

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

  // What the phone took, day by day. Derived from the transactions already read
  // off the history screens, so it cannot drift from them.
  const days = useQuery({
    queryKey: ["recon-settlement-days", source.data?.id],
    enabled: !!source.data?.id,
    queryFn: () => fetchSettlementDays(source.data.id),
    staleTime: 30_000,
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
      await queryClient.invalidateQueries({ queryKey: ["recon-settlement-days"] });
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

        {days.isError && (
          <TabletCard variant="flat" className="border-red-300 bg-red-50">
            <p className="text-sm text-red-800">
              Could not load the daily totals: {(days.error as Error)?.message}
            </p>
          </TabletCard>
        )}

        {(days.data?.length ?? 0) > 0 && (
          <TabletCard variant="flat" className="space-y-2">
            <p className="text-sm font-semibold">Settlement by date</p>
            <p className="text-xs text-muted-foreground">
              Totalled from the history already sent. Tap a day to attach the slips or
              photograph them.
            </p>
            {days.data!.map((d) => (
              <SettlementDayRow
                key={d.settlementDate}
                sourceId={source.data!.id}
                day={d}
                uploadedBy={user?.email || user?.id || null}
                onChanged={() =>
                  queryClient.invalidateQueries({ queryKey: ["recon-settlement-days"] })
                }
              />
            ))}
          </TabletCard>
        )}

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

/**
 * One settlement day: the totals, and the documents filed against it.
 *
 * Money in and money out are shown separately as well as the net. A single
 * figure that quietly nets a refund against the day's takings is how a short
 * day comes to look normal.
 */
function SettlementDayRow({
  sourceId,
  day,
  uploadedBy,
  onChanged,
}: {
  sourceId: string;
  day: {
    settlementDate: string;
    txnCount: number;
    moneyIn: number;
    moneyOut: number;
    netTotal: number;
    docCount: number;
  };
  uploadedBy: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const camInput = useRef<HTMLInputElement>(null);

  const docs = useQuery({
    queryKey: ["recon-settlement-docs", sourceId, day.settlementDate],
    enabled: open,
    queryFn: () => fetchSettlementDocs(sourceId, day.settlementDate),
  });

  const inr = (n: number) =>
    n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const { saved, failed } = await uploadSettlementDocs({
        sourceId,
        settlementDate: day.settlementDate,
        files,
        uploadedBy,
      });
      if (saved > 0) {
        toast.success(
          `${saved} document${saved === 1 ? "" : "s"} saved against ${settlementDateLabel(day.settlementDate)}`,
        );
      }
      // Never silent: a file that did not save says so, by name.
      if (failed.length > 0) toast.error(failed.join("; "));
      await docs.refetch();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not save the documents");
    } finally {
      setBusy(false);
      // Cleared so the same file can be picked twice running.
      if (filesInput.current) filesInput.current.value = "";
      if (camInput.current) camInput.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{settlementDateLabel(day.settlementDate)}</span>
          <span className="block text-xs text-muted-foreground">
            {day.txnCount} transaction{day.txnCount === 1 ? "" : "s"}
            {day.moneyOut > 0 ? ` \u00b7 in ${inr(day.moneyIn)} \u00b7 out ${inr(day.moneyOut)}` : ""}
            {day.docCount > 0
              ? ` \u00b7 ${day.docCount} document${day.docCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-lg font-bold tabular-nums">{inr(day.netTotal)}</span>
          <span className="block text-[11px] text-muted-foreground">settled</span>
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <div className="flex gap-2">
            <TabletButton className="flex-1" disabled={busy} onClick={() => camInput.current?.click()}>
              {busy ? (
                <Loader2 className="mr-1 h-5 w-5 animate-spin" />
              ) : (
                <Camera className="mr-1 h-5 w-5" />
              )}
              Photograph
            </TabletButton>
            <TabletButton
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => filesInput.current?.click()}
            >
              <Paperclip className="mr-1 h-5 w-5" /> Attach files
            </TabletButton>
          </div>

          {docs.isLoading && <p className="text-xs text-muted-foreground">Loading documents...</p>}
          {docs.isError && (
            <p className="text-xs text-red-700">
              Could not load the documents: {(docs.error as Error)?.message}
            </p>
          )}
          {!docs.isLoading && !docs.isError && (docs.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">Nothing attached to this day yet.</p>
          )}
          {(docs.data ?? []).map((d) => (
            <a
              key={d.id}
              href={d.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md bg-muted/40 p-2 text-xs hover:bg-muted"
            >
              {d.fileType?.startsWith("image/") ? (
                <img src={d.fileUrl} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{d.fileName}</span>
              <span className="shrink-0 text-muted-foreground">
                {d.uploadedAt ? new Date(d.uploadedAt).toLocaleString("en-IN") : ""}
              </span>
            </a>
          ))}

          {/* Two inputs: `capture` opens the camera but forces a single file,
              so it cannot also be the multi-select picker. */}
          <input
            ref={camInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <input
            ref={filesInput}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}

export default PhonePeUploadFlow;
