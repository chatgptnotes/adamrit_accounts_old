import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Camera, Check, ChevronLeft, Loader2, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: visits (discharged, both hospitals) + implant_calculations
//   -> record_implant_calculation (ML Enterprises implant mechanism)

interface DischargedRow {
  id: string;
  visit_id: string;
  discharge_date: string;
  patients: { name: string; hospital_name: string | null } | null;
  referees: { name: string } | null;
}

interface Settlement {
  visit_uuid: string;
  decision: string;
  cut_amount: number;
  ml_invoice_number: string | null;
}

interface CalcSheet {
  name: string;
  url: string;
  path: string;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

async function uploadSheet(file: File): Promise<CalcSheet> {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: file must be 12 MB or smaller`);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `implant-calc/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
  const { error } = await supabase.storage.from("uploads").upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("uploads").getPublicUrl(path);
  return { name: file.name, url: data.publicUrl, path };
}

/**
 * Azhar's discharge settlement: every discharged patient of both hospitals,
 * per day. Decide direct (no cut) or referred with a cut, photograph the
 * handwritten calculation, approve — a referred approval raises the M.L.
 * Enterprises implant invoice and journals, with the photo as the invoice's
 * document. One decision per visit.
 */
export default function ImplantCalculationFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [day, setDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [settling, setSettling] = useState<DischargedRow | null>(null);
  const [decision, setDecision] = useState<"DIRECT" | "REFERRED" | null>(null);
  const [referee, setReferee] = useState("");
  const [cut, setCut] = useState("");
  const [sheets, setSheets] = useState<CalcSheet[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["implant-discharges", day],
    queryFn: async (): Promise<DischargedRow[]> => {
      const { data, error } = await (supabase as any)
        .from("visits")
        .select("id, visit_id, discharge_date, patients!inner(name, hospital_name), referees(name)")
        .gte("discharge_date", `${day}T00:00:00`)
        .lte("discharge_date", `${day}T23:59:59.999`)
        .order("discharge_date");
      if (error) throw error;
      return (data || []) as DischargedRow[];
    },
  });

  const { data: settlements = [] } = useQuery({
    queryKey: ["implant-settlements", day, rows.length],
    enabled: rows.length > 0,
    queryFn: async (): Promise<Settlement[]> => {
      const { data, error } = await (supabase as any)
        .from("implant_calculations")
        .select("visit_uuid, decision, cut_amount, ml_invoice_number")
        .in("visit_uuid", rows.map((r) => r.id));
      if (error) throw error;
      return (data || []) as Settlement[];
    },
  });
  const settledByVisit = new Map(settlements.map((s) => [s.visit_uuid, s]));

  const approve = useMutation({
    mutationFn: async () => {
      if (!settling || !decision) throw new Error("Decide direct or referred first");
      const { data, error } = await (supabase as any).rpc("record_implant_calculation", {
        p_visit_uuid: settling.id,
        p_decision: decision,
        p_cut_amount: decision === "REFERRED" ? parseFloat(cut) : 0,
        p_referee_name: referee.trim() || null,
        p_calc_sheets: sheets,
        p_approved_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return data as { decision: string; invoiceNumber?: string };
    },
    onSuccess: (result) => {
      toast.success(
        result.decision === "DIRECT"
          ? `${settling?.patients?.name} marked direct — no cut.`
          : `Cut approved — invoice ${result.invoiceNumber} raised for ${settling?.patients?.name}.`,
      );
      setSettling(null);
      setDecision(null);
      setReferee("");
      setCut("");
      setSheets([]);
      queryClient.invalidateQueries({ queryKey: ["implant-settlements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
  });

  const addSheets = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const next: CalcSheet[] = [];
      for (const file of Array.from(files)) next.push(await uploadSheet(file));
      setSheets((prev) => [...prev, ...next]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  };

  // ---- Settlement panel ----
  if (settling) {
    const hospital = settling.patients?.hospital_name || "";
    return (
      <FlowScaffold
        heading={settling.patients?.name || ""}
        subheading={`${settling.visit_id} · ${hospital}${settling.referees?.name ? ` · Referee ${settling.referees.name}` : ""}`}
        actions={
          <div className="flex w-full gap-3">
            <TabletButton
              variant="outline"
              onClick={() => {
                setSettling(null);
                setDecision(null);
                setSheets([]);
              }}
              disabled={approve.isPending}
            >
              <ChevronLeft className="mr-1 h-5 w-5" /> Back
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={!decision || approve.isPending || (decision === "REFERRED" && !parseFloat(cut))}
              onClick={() => approve.mutate()}
            >
              <Check className="mr-2 h-5 w-5" />
              {approve.isPending
                ? "Posting…"
                : decision === "REFERRED"
                  ? `Approve cut ${cut ? rupees(parseFloat(cut)) : ""}`
                  : "Approve — direct patient"}
            </TabletButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TabletButton
              variant={decision === "DIRECT" ? "default" : "outline"}
              className="min-h-[64px]"
              onClick={() => setDecision("DIRECT")}
            >
              Direct patient — no cut
            </TabletButton>
            <TabletButton
              variant={decision === "REFERRED" ? "default" : "outline"}
              className="min-h-[64px]"
              onClick={() => {
                setDecision("REFERRED");
                if (!referee) setReferee(settling.referees?.name || "");
              }}
            >
              Referred — pass on a cut
            </TabletButton>
          </div>

          {decision === "REFERRED" && (
            <>
              <div>
                <TabletLabel>Referee</TabletLabel>
                <TabletInput
                  value={referee}
                  onChange={(e) => setReferee(e.target.value)}
                  placeholder="Referee's name"
                />
              </div>
              <div>
                <TabletLabel>Cut to pass on</TabletLabel>
                <TabletInput
                  type="number"
                  inputMode="decimal"
                  value={cut}
                  onChange={(e) => setCut(e.target.value)}
                  placeholder="0.00"
                  className="max-w-[200px] font-mono text-xl"
                />
              </div>
            </>
          )}

          <div>
            <TabletLabel>Handwritten calculation sheet</TabletLabel>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void addSheets(e.target.files)} />
            <input ref={galleryRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void addSheets(e.target.files)} />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <TabletButton variant="outline" disabled={uploading} onClick={() => cameraRef.current?.click()}>
                {uploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
                Take a snap
              </TabletButton>
              <TabletButton variant="outline" disabled={uploading} onClick={() => galleryRef.current?.click()}>
                <Upload className="mr-2 h-5 w-5" /> Upload file
              </TabletButton>
            </div>
            {sheets.length > 0 && (
              <div className="mt-2 space-y-1">
                {sheets.map((sheet, index) => (
                  <div key={sheet.path} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{sheet.name}</span>
                    <button
                      type="button"
                      className="text-xs text-destructive"
                      onClick={() => setSheets((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {decision === "REFERRED" && sheets.length === 0 && (
              <p className="mt-1 text-sm text-amber-600">
                Upload the calculated sheet — it becomes the invoice's document.
              </p>
            )}
          </div>
        </div>
      </FlowScaffold>
    );
  }

  // ---- List ----
  return (
    <FlowScaffold
      heading="Implant Calculation"
      subheading="Discharged patients of both hospitals — settle each as direct or referred"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <TabletLabel>Discharge day</TabletLabel>
          <TabletInput type="date" value={day} onChange={(e) => setDay(e.target.value)} className="max-w-[200px]" />
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading discharges…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No discharges on this day.</p>
        ) : (
          <div className="grid gap-2">
            {rows.map((row) => {
              const settled = settledByVisit.get(row.id);
              const hospital = (row.patients?.hospital_name || "").toLowerCase().includes("ayush")
                ? "Ayushman"
                : "Hope";
              return (
                <TabletCard key={row.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{row.patients?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.visit_id} ·{" "}
                      <span className={hospital === "Ayushman" ? "text-violet-600" : "text-emerald-600"}>
                        {hospital}
                      </span>
                      {row.referees?.name ? ` · Referee ${row.referees.name}` : " · no referee recorded"}
                    </p>
                  </div>
                  {settled ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                        settled.decision === "DIRECT"
                          ? "bg-slate-100 text-slate-700"
                          : "bg-emerald-100 text-emerald-800",
                      )}
                    >
                      {settled.decision === "DIRECT"
                        ? "Direct"
                        : `Cut ${rupees(Number(settled.cut_amount))}${settled.ml_invoice_number ? ` · ${settled.ml_invoice_number}` : ""}`}
                    </span>
                  ) : (
                    <TabletButton
                      size="default"
                      className="min-h-[44px] shrink-0 text-sm"
                      onClick={() => setSettling(row)}
                    >
                      Settle
                    </TabletButton>
                  )}
                </TabletCard>
              );
            })}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}
