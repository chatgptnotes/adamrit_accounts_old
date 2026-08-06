import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Circle, Loader2, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";
import { SCHEME_LABEL, dialysisScheme } from "@/lib/dialysis/scheme";

// DATA SOURCE: visits (patient_type = 'Dialysis', registered in the last 24h)
//   + dialysis_front_office (the thumb) + file_uploads (the thumb image)

const HOSPITAL = "hope";
const THUMB_CATEGORY = "dialysis";
const THUMB_NOTE = "DIALYSIS_THUMB";

interface FrontOfficeRow {
  visitId: string;
  visitCode: string | null;
  visitDate: string;
  registeredAt: string | null;
  patientId: string;
  patientName: string;
  patientsId: string | null;
  phone: string | null;
  scheme: ReturnType<typeof dialysisScheme>;
  thumbDoneAt: string | null;
  thumbUrl: string | null;
}

/**
 * Diksha's tile: the thumb comes first.
 *
 * Every dialysis patient registered in the last 24 hours is listed with
 * whether their thumb impression has been taken. Taking it uploads the photo
 * against the patient and prints the slip the patient carries to Rakesh — the
 * slip IS the authority to start the session, which is the whole point of
 * doing this before dialysis rather than after.
 */
export default function DialysisFrontOfficeFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [busyVisit, setBusyVisit] = useState<string | null>(null);
  const pendingRow = useRef<FrontOfficeRow | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dialysis-front-office", HOSPITAL],
    staleTime: 30_000,
    queryFn: async (): Promise<FrontOfficeRow[]> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: visits, error } = await supabase
        .from("visits")
        .select(
          "id, visit_id, visit_date, created_at, patient_id, patients!inner(id, name, patients_id, phone, corporate, hospital_name)",
        )
        .eq("patient_type", "Dialysis")
        .eq("patients.hospital_name", HOSPITAL)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const visitIds = (visits ?? []).map((v: any) => v.id);
      const { data: office } = visitIds.length
        ? await (supabase as any)
            .from("dialysis_front_office")
            .select("visit_id, thumb_done_at, thumb_file_url")
            .in("visit_id", visitIds)
        : { data: [] as any[] };
      const byVisit = new Map<string, { thumb_done_at: string | null; thumb_file_url: string | null }>(
        (office ?? []).map((o: any) => [
          o.visit_id as string,
          { thumb_done_at: o.thumb_done_at ?? null, thumb_file_url: o.thumb_file_url ?? null },
        ]),
      );

      return ((visits ?? []) as any[]).map((visit) => {
        const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
        const record = byVisit.get(visit.id);
        return {
          visitId: visit.id,
          visitCode: visit.visit_id ?? null,
          visitDate: visit.visit_date,
          registeredAt: visit.created_at ?? null,
          patientId: patient?.id ?? visit.patient_id,
          patientName: patient?.name ?? "Unknown patient",
          patientsId: patient?.patients_id ?? null,
          phone: patient?.phone ?? null,
          scheme: dialysisScheme(patient?.corporate),
          thumbDoneAt: record?.thumb_done_at ?? null,
          thumbUrl: record?.thumb_file_url ?? null,
        };
      });
    },
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.patientName, r.patientsId, r.phone, r.visitCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  const doneCount = visible.filter((r) => r.thumbDoneAt).length;

  const saveThumb = useMutation({
    mutationFn: async ({ row, file }: { row: FrontOfficeRow; file: File }) => {
      await uploadPatientDocs([file], {
        patientId: row.patientId,
        patientName: row.patientName,
        category: THUMB_CATEGORY,
        uploadedBy: user?.id ?? null,
        notes: THUMB_NOTE,
      });
      // The uploaded row carries the public URL; read it back so the card can
      // show the thumb without a second upload path of its own.
      const { data: uploaded } = await supabase
        .from("file_uploads")
        .select("file_url")
        .eq("patient_id", row.patientId)
        .eq("category", THUMB_CATEGORY)
        .eq("notes", THUMB_NOTE)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await (supabase as any).from("dialysis_front_office").upsert(
        {
          visit_id: row.visitId,
          patient_id: row.patientId,
          hospital_name: HOSPITAL,
          thumb_done_at: new Date().toISOString(),
          thumb_file_url: (uploaded as any)?.file_url ?? null,
          thumb_by: user?.email || user?.id || null,
        },
        { onConflict: "visit_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, { row }) => {
      toast.success(`Thumb recorded for ${row.patientName}. Print the slip.`);
      queryClient.invalidateQueries({ queryKey: ["dialysis-front-office"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the thumb"),
  });

  const onCapture = async (file?: File) => {
    const row = pendingRow.current;
    if (!file || !row) return;
    setBusyVisit(row.visitId);
    try {
      await saveThumb.mutateAsync({ row, file });
    } finally {
      setBusyVisit(null);
      pendingRow.current = null;
      if (cameraInput.current) cameraInput.current.value = "";
    }
  };

  const printSlip = async (row: FrontOfficeRow) => {
    if (!row.thumbDoneAt) {
      toast.error("Take the thumb impression first — the slip is what authorises the session.");
      return;
    }
    const win = window.open("", "_blank", "width=420,height=620");
    if (!win) {
      toast.error("Allow pop-ups to print the slip.");
      return;
    }
    const esc = (value: string | null) =>
      String(value ?? "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
    win.document.write(`<!doctype html><html><head><title>Dialysis slip</title>
      <style>
        body{font-family:Helvetica,Arial,sans-serif;padding:18px;color:#111}
        h1{font-size:17px;margin:0 0 2px}
        .sub{font-size:11px;color:#555;margin:0 0 12px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        td{padding:5px 0;vertical-align:top}
        td.k{color:#555;width:42%}
        .ok{margin-top:14px;padding:10px;border:1.5px solid #15803d;border-radius:6px;
            color:#15803d;font-weight:700;text-align:center;font-size:13px}
        .foot{margin-top:16px;font-size:10px;color:#666}
      </style></head><body>
      <h1>Hope Multi-Speciality Hospital</h1>
      <p class="sub">Dialysis authorisation slip</p>
      <table>
        <tr><td class="k">Patient</td><td><strong>${esc(row.patientName)}</strong></td></tr>
        <tr><td class="k">Patient ID</td><td>${esc(row.patientsId)}</td></tr>
        <tr><td class="k">Visit</td><td>${esc(row.visitCode)}</td></tr>
        <tr><td class="k">Visit date</td><td>${esc(shortDate(row.visitDate))}</td></tr>
        <tr><td class="k">Scheme</td><td>${esc(SCHEME_LABEL[row.scheme])}</td></tr>
        <tr><td class="k">Thumb taken</td><td>${esc(new Date(row.thumbDoneAt).toLocaleString("en-IN"))}</td></tr>
      </table>
      <div class="ok">Thumb impression done — dialysis may be performed</div>
      <p class="foot">Front office: ${esc(user?.email ?? null)} · Printed ${new Date().toLocaleString("en-IN")}</p>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();

    await (supabase as any)
      .from("dialysis_front_office")
      .update({ slip_printed_at: new Date().toISOString() })
      .eq("visit_id", row.visitId);
  };

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Dialysis Front Office - Diksha"
      subheading="Registered in the last 24 hours — thumb first, then the slip"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient name, ID, phone or visit…"
            className="pl-10"
          />
        </div>

        {visible.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {doneCount} of {visible.length} thumb{visible.length === 1 ? "" : "s"} done.
          </p>
        )}

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void onCapture(e.target.files?.[0])}
        />

        {isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading today's registrations…</p>
        ) : visible.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
            Nobody registered for dialysis in the last 24 hours.
          </TabletCard>
        ) : (
          visible.map((row) => {
            const busy = busyVisit === row.visitId;
            return (
              <TabletCard key={row.visitId} variant="flat" className="space-y-2">
                <div className="flex items-start gap-3">
                  {row.thumbDoneAt ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 fill-red-500 text-red-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{row.patientName}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[row.patientsId, row.visitCode, SCHEME_LABEL[row.scheme]]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium uppercase",
                      row.thumbDoneAt
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700",
                    )}
                  >
                    {row.thumbDoneAt ? "Thumb done" : "Thumb pending"}
                  </span>
                </div>

                {row.thumbUrl && (
                  <a href={row.thumbUrl} target="_blank" rel="noreferrer">
                    <img
                      src={row.thumbUrl}
                      alt={`Thumb impression for ${row.patientName}`}
                      className="h-24 rounded-md border object-cover"
                    />
                  </a>
                )}

                <div className="flex flex-wrap gap-2">
                  <TabletButton
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      pendingRow.current = row;
                      cameraInput.current?.click();
                    }}
                  >
                    {busy ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="mr-1 h-4 w-4" />
                    )}
                    {row.thumbDoneAt ? "Retake thumb" : "Take thumb"}
                  </TabletButton>
                  <TabletButton
                    size="sm"
                    disabled={!row.thumbDoneAt || busy}
                    onClick={() => void printSlip(row)}
                    title={row.thumbDoneAt ? undefined : "Take the thumb impression first"}
                  >
                    <Printer className="mr-1 h-4 w-4" />
                    Print slip
                  </TabletButton>
                </div>

                {!row.thumbDoneAt && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Dialysis must not start until the thumb is taken and this patient carries the
                    printed slip to Rakesh.
                  </p>
                )}
              </TabletCard>
            );
          })
        )}
      </div>
    </FlowScaffold>
  );
}
