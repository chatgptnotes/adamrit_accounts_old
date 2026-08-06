import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import { Banknote, Bell, CheckCircle2, ChevronLeft, Download, FileImage, FileText, Loader2, Paperclip, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { DIALYSIS_BILLING_REMINDER_SESSIONS, DIALYSIS_SESSION_BILLING_QUERY_KEY, loadDialysisBillableSessions, markDialysisSessionBilled, pendingDialysisPatients, type DialysisBillableSession } from "@/lib/dialysisSessionBilling";

/**
 * Shashank Payment Received — corporate / panel / Yojana money as it lands.
 *
 * Pick the IPD patient the portal paid for, enter the amount received, and
 * attach a screenshot of the portal's payment details. One entry per payment,
 * recorded the day it arrives.
 */

const BUCKET = "uploads";
const todayIso = () => new Date().toISOString().slice(0, 10);
const rupees = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PanelVisit {
  id: string;
  visitCode: string;
  patientName: string;
  patientsId: string | null;
  corporate: string | null;
  hospitalName: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
}

interface Receipt {
  id: string;
  visitId: string | null;
  patientName: string;
  corporate: string | null;
  amount: number;
  receivedDate: string;
  reference: string | null;
  notes: string | null;
  screenshotUrl: string | null;
  createdBy: string | null;
}

const mapReceipt = (r: any): Receipt => ({
  id: r.id,
  visitId: r.visit_id,
  patientName: r.patient_name,
  corporate: r.corporate,
  amount: Number(r.amount) || 0,
  receivedDate: r.received_date,
  reference: r.reference,
  notes: r.notes,
  screenshotUrl: r.screenshot_url,
  createdBy: r.created_by,
});

/** IPD corporate/panel/Yojana visits matching the search — private patients settle themselves. */
function usePanelVisitSearch(term: string) {
  const { hospitalConfig } = useAuth();
  const safe = term.trim().replace(/[%,()]/g, " ").trim();
  return useQuery({
    queryKey: ["panel-payment-visit-search", hospitalConfig.name, safe],
    enabled: safe.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<PanelVisit[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(
          "id, visit_id, patient_type, admission_date, discharge_date, patients!inner(id, name, patients_id, corporate, hospital_name)",
        )
        .ilike("patient_type", "IPD")
        .eq("patients.hospital_name", hospitalConfig.name)
        .or(`name.ilike.%${safe}%,patients_id.ilike.%${safe}%`, { foreignTable: "patients" })
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((v) => {
          const patient = Array.isArray(v.patients) ? v.patients[0] : v.patients;
          return {
            id: v.id,
            visitCode: v.visit_id,
            patientName: patient?.name ?? "Unknown",
            patientsId: patient?.patients_id ?? null,
            corporate: patient?.corporate ?? null,
            hospitalName: patient?.hospital_name ?? null,
            admissionDate: v.admission_date ?? null,
            dischargeDate: v.discharge_date ?? null,
          };
        })
        // Panels and corporates only — a blank or "private" corporate has no
        // portal to pay from.
        .filter((v) => v.corporate && !v.corporate.toLowerCase().includes("private"))
        .slice(0, 15);
    },
  });
}

function useReceipts(visitCode: string | null) {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ["panel-payment-receipts", visitCode ?? "recent", hospitalConfig.name],
    queryFn: async (): Promise<Receipt[]> => {
      let q = (supabase as any)
        .from("panel_payment_receipts")
        .select("*")
        .order("received_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(25);
      if (visitCode) q = q.eq("visit_id", visitCode);
      else q = q.eq("hospital_name", hospitalConfig.name);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapReceipt);
    },
  });
}

function DialysisDateDocuments({ session }: { session: DialysisBillableSession }) {
  const documents = useQuery({
    queryKey: ["dialysis-billing-documents", session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select("id, file_name, file_url, category, created_at")
        .eq("patient_id", session.patientId)
        .in("category", ["dialysis", "lab_investigation", "clinic_notes", "monitor_chart", "radiology_investigation"])
        .or(`notes.eq.dialysis_visit:${session.id},notes.eq.clinic_notes:${session.patientId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (documents.isLoading) return <p className="text-xs text-muted-foreground">Loading documents…</p>;
  if (documents.isError) return <p className="text-xs text-red-600">Documents could not be loaded.</p>;
  if ((documents.data ?? []).length === 0) return <p className="text-xs text-muted-foreground">No documents uploaded for this dialysis date.</p>;

  return (
    <div className="space-y-1">
      {(documents.data ?? []).map((doc) => (
        <a
          key={doc.id}
          href={doc.file_url}
          download={doc.file_name || "dialysis-document"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium text-primary"
        >
          <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{doc.file_name || doc.category}</span></span>
          <Download className="h-4 w-4 shrink-0" />
        </a>
      ))}
    </div>
  );
}

function DialysisPendingBills({ onBack }: { onBack: () => void }) {
  const { user, hospitalConfig } = useAuth();
  const qc = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: [DIALYSIS_SESSION_BILLING_QUERY_KEY, hospitalConfig.name],
    queryFn: () => loadDialysisBillableSessions(hospitalConfig.name),
  });
  const pending = useMemo(() => {
    const byPatient = new Map<string, DialysisBillableSession[]>();
    for (const session of sessions.data ?? []) {
      if (session.billed) continue;
      const rows = byPatient.get(session.patientId) ?? [];
      rows.push(session);
      byPatient.set(session.patientId, rows);
    }
    return Array.from(byPatient.values()).sort((a, b) => b.length - a.length);
  }, [sessions.data]);

  const markDone = async (session: DialysisBillableSession) => {
    setSavingId(session.id);
    try {
      await markDialysisSessionBilled(hospitalConfig.name, session, user?.email ?? user?.username ?? "tablet");
      toast.success(`${session.patientName}'s dialysis date marked billed.`);
      await qc.invalidateQueries({ queryKey: [DIALYSIS_SESSION_BILLING_QUERY_KEY] });
    } catch (error: any) {
      toast.error(error?.message || "Could not mark this dialysis date billed.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <TabletButton variant="outline" onClick={onBack}><ChevronLeft className="mr-2 h-5 w-5" />Back to payments</TabletButton>
      <TabletCard variant="flat" className="border-amber-200 bg-amber-50">
        <p className="text-base font-bold text-amber-950">Dialysis pending bills</p>
        <p className="mt-1 text-sm text-amber-900">The notification starts after {DIALYSIS_BILLING_REMINDER_SESSIONS} unbilled dates. Each date is billed separately.</p>
      </TabletCard>
      {sessions.isLoading ? <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div> : pending.length === 0 ? (
        <TabletCard variant="flat" className="py-8 text-center text-sm text-muted-foreground">No dialysis dates are pending billing.</TabletCard>
      ) : pending.map((patientSessions) => {
        const patient = patientSessions[0];
        return <TabletCard key={patient.patientId} variant="flat" className="space-y-3">
          <div><p className="text-base font-bold">{patient.patientName}</p><p className="text-xs text-muted-foreground">{patient.patientsId || "No patient ID"} · {patientSessions.length} dates pending</p></div>
          {patientSessions.map((session) => <div key={session.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{new Date(`${session.visitDate}T00:00:00`).toLocaleDateString("en-IN")}</p><p className="text-xs text-muted-foreground">{session.visitCode || "No visit ID"}</p></div><span className="flex items-center gap-1 text-xs font-bold text-red-600"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Pending</span></div>
            <DialysisDateDocuments session={session} />
            <TabletButton className="w-full" disabled={savingId === session.id} onClick={() => void markDone(session)}>{savingId === session.id ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}Mark Billed Done</TabletButton>
          </div>)}
        </TabletCard>;
      })}
    </div>
  );
}

export default function PanelPaymentReceivedFlow() {
  const { user, hospitalConfig } = useAuth();
  const qc = useQueryClient();
  const [showDialysisBills, setShowDialysisBills] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [visit, setVisit] = useState<PanelVisit | null>(null);
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const results = usePanelVisitSearch(visit ? "" : debouncedSearch);
  const receipts = useReceipts(visit?.visitCode ?? null);

  const amountValue = useMemo(() => Number(amount.replace(/,/g, "")) || 0, [amount]);
  const canSave = Boolean(visit) && amountValue > 0 && !saving;
  const dialysisBills = useQuery({
    queryKey: [DIALYSIS_SESSION_BILLING_QUERY_KEY, hospitalConfig.name],
    queryFn: () => loadDialysisBillableSessions(hospitalConfig.name),
  });
  const dialysisReminderCount = pendingDialysisPatients(dialysisBills.data ?? []).length;

  const reset = () => {
    setAmount("");
    setReceivedDate(todayIso());
    setReference("");
    setNotes("");
    setScreenshot(null);
  };

  const save = async () => {
    if (!visit || !canSave) return;
    setSaving(true);
    let screenshotPath: string | null = null;
    try {
      let screenshotUrl: string | null = null;
      if (screenshot) {
        const ext = screenshot.name.split(".").pop() || "png";
        screenshotPath = `panel-payments/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(screenshotPath, screenshot);
        if (upErr) throw new Error(`Could not upload the screenshot: ${upErr.message}`);
        screenshotUrl = supabase.storage.from(BUCKET).getPublicUrl(screenshotPath).data?.publicUrl ?? null;
      }

      const { error } = await (supabase as any).from("panel_payment_receipts").insert({
        visit_id: visit.visitCode,
        patient_name: visit.patientName,
        corporate: visit.corporate,
        hospital_name: visit.hospitalName ?? hospitalConfig?.name ?? null,
        amount: amountValue,
        received_date: receivedDate,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        screenshot_path: screenshotPath,
        screenshot_url: screenshotUrl,
        created_by: user?.email ?? user?.username ?? "tablet",
      });
      if (error) {
        if (screenshotPath) await supabase.storage.from(BUCKET).remove([screenshotPath]);
        throw new Error(error.message);
      }
      toast.success(`₹${rupees(amountValue)} recorded for ${visit.patientName}`);
      reset();
      qc.invalidateQueries({ queryKey: ["panel-payment-receipts"] });
    } catch (error: any) {
      toast.error(error?.message || "Could not save the payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FlowScaffold
      heading="Shashank Payment Received"
      subheading="Record corporate / panel / Yojana payments against the patient the day they arrive, with the portal screenshot."
    >
      {showDialysisBills ? <DialysisPendingBills onBack={() => setShowDialysisBills(false)} /> : (
      <div className="space-y-4 p-4 sm:p-6">
        <TabletButton variant="outline" className="w-full justify-between" onClick={() => setShowDialysisBills(true)}>
          <span className="flex items-center"><Bell className="mr-2 h-5 w-5" />Dialysis pending bills</span>
          {dialysisReminderCount > 0 ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{dialysisReminderCount}</span> : <span className="text-xs text-muted-foreground">None</span>}
        </TabletButton>
        {!visit ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <TabletInput
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search IPD patient by name or UHID…"
                className="pl-10"
              />
            </div>
            {debouncedSearch.trim().length >= 2 && (
              results.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Searching…
                </div>
              ) : (results.data ?? []).length === 0 ? (
                <TabletCard variant="flat" className="py-8 text-center text-muted-foreground">
                  No IPD panel or corporate patient matches. Private patients are not listed here.
                </TabletCard>
              ) : (
                <div className="space-y-2">
                  {(results.data ?? []).map((v) => (
                    <TabletCard key={v.id} variant="flat" interactive onClick={() => setVisit(v)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold">{v.patientName}</p>
                          <p className="text-xs text-muted-foreground">
                            {v.visitCode} · {v.patientsId ?? "no UHID"}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          {v.corporate}
                        </span>
                      </div>
                    </TabletCard>
                  ))}
                </div>
              )
            )}
          </>
        ) : (
          <>
            <TabletCard variant="flat" className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">{visit.patientName}</p>
                <p className="text-sm text-muted-foreground">
                  {visit.visitCode} · {visit.corporate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setVisit(null); reset(); }}
                className="shrink-0 rounded-full p-2 active:bg-muted"
                aria-label="Pick another patient"
              >
                <X className="h-5 w-5" />
              </button>
            </TabletCard>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <TabletLabel htmlFor="ppr-amount">Amount received</TabletLabel>
                <TabletInput
                  id="ppr-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-2xl font-semibold tabular-nums"
                />
              </div>
              <div>
                <TabletLabel htmlFor="ppr-date">Received on</TabletLabel>
                <TabletInput
                  id="ppr-date"
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <TabletLabel htmlFor="ppr-ref">Reference / UTR (optional)</TabletLabel>
              <TabletInput
                id="ppr-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="As shown on the portal"
              />
            </div>

            <div>
              <TabletLabel htmlFor="ppr-notes">Notes (optional)</TabletLabel>
              <TabletInput
                id="ppr-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth recording"
              />
            </div>

            <div>
              <TabletLabel>Portal screenshot</TabletLabel>
              {screenshot ? (
                <TabletCard variant="flat" className="flex items-center gap-3">
                  <FileImage className="h-6 w-6 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">{screenshot.name}</span>
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    className="shrink-0 rounded-full p-2 active:bg-muted"
                    aria-label="Remove the screenshot"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </TabletCard>
              ) : (
                <TabletButton variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                  <Paperclip className="mr-2 h-5 w-5" />
                  Attach payment screenshot
                </TabletButton>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
              />
            </div>

            <TabletButton className="w-full" disabled={!canSave} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Banknote className="mr-2 h-5 w-5" />}
              Save payment received
            </TabletButton>
          </>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">
            {visit ? `Payments recorded for ${visit.patientName}` : "Recently recorded payments"}
          </p>
          {receipts.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : (receipts.data ?? []).length === 0 ? (
            <TabletCard variant="flat" className="py-6 text-center text-sm text-muted-foreground">
              Nothing recorded yet.
            </TabletCard>
          ) : (
            <div className="space-y-2">
              {(receipts.data ?? []).map((r) => (
                <TabletCard key={r.id} variant="flat" className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold">{r.patientName}</p>
                    <span className="shrink-0 text-base font-bold tabular-nums text-emerald-700">
                      ₹{rupees(r.amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {new Date(r.receivedDate).toLocaleDateString("en-IN")}
                      {r.corporate ? ` · ${r.corporate}` : ""}
                      {r.reference ? ` · ${r.reference}` : ""}
                    </span>
                    {r.screenshotUrl && (
                      <a
                        href={r.screenshotUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-medium text-primary"
                      >
                        <FileImage className="h-3.5 w-3.5" />
                        Screenshot
                      </a>
                    )}
                  </div>
                </TabletCard>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </FlowScaffold>
  );
}
