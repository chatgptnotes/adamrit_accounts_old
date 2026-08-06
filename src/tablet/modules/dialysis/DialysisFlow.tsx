import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Droplets,
  FileCheck2,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { cn } from "@/lib/utils";
import { PatientDocsTab } from "@/tablet/modules/patient-profile/PatientDocsTab";
import { usePatientDocs, type PatientDocCategory } from "@/tablet/hooks/usePatientDocs";
import { CYCLES_PER_BILL } from "@/lib/nephroplus/dialysisTracker";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
};

type DialysisPeriod = "today" | "month" | "year";

const periodLabels: Record<DialysisPeriod, string> = {
  today: "Today",
  month: "This month",
  year: "This year",
};

function periodRange(period: DialysisPeriod) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number) => String(value).padStart(2, "0");
  const endOfMonth = (targetYear: number, targetMonth: number) =>
    new Date(targetYear, targetMonth + 1, 0).getDate();

  if (period === "today") {
    const date = `${year}-${pad(month + 1)}-${pad(now.getDate())}`;
    return { start: date, end: date };
  }

  if (period === "month") {
    return {
      start: `${year}-${pad(month + 1)}-01`,
      end: `${year}-${pad(month + 1)}-${pad(endOfMonth(year, month))}`,
    };
  }

  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

type PatientShape = {
  id: string;
  name: string | null;
  patients_id: string | null;
  phone: string | null;
};

type DialysisVisit = {
  id: string;
  visit_id: string | null;
  visit_date: string;
  created_at: string | null;
  status: string | null;
  patient_id: string;
  patient: PatientShape;
  amount: number;
};

type Session = DialysisVisit & { sessionNumber: number };

function money(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function isCompleted(status: string | null) {
  return ["completed", "complete", "done"].includes((status || "").toLowerCase());
}

async function loadVisits(hospitalName: string, patientId?: string): Promise<DialysisVisit[]> {
  let query = supabase
    .from("visits")
    .select(
      "id, visit_id, visit_date, created_at, status, patient_id, patients!inner(id, name, patients_id, phone, hospital_name)",
    )
    .eq("patient_type", "Dialysis")
    .eq("patients.hospital_name", hospitalName)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (patientId) query = query.eq("patient_id", patientId);

  const { data, error } = await query;
  if (error) throw error;

  const visits = (data || []) as any[];
  const visitIds = visits.map((v) => v.id).filter(Boolean);
  const amounts = new Map<string, number>();

  if (visitIds.length > 0) {
    const { data: charges, error: chargesError } = await supabase
      .from("visit_clinical_services")
      .select("visit_id, amount, clinical_services!inner(service_name)")
      .in("visit_id", visitIds)
      .ilike("clinical_services.service_name", "%dialy%");
    if (chargesError) throw chargesError;
    for (const charge of (charges || []) as any[]) {
      amounts.set(
        charge.visit_id,
        (amounts.get(charge.visit_id) || 0) + (Number(charge.amount) || 0),
      );
    }
  }

  return visits.map((visit) => ({
    id: visit.id,
    visit_id: visit.visit_id,
    visit_date: visit.visit_date,
    created_at: visit.created_at,
    status: visit.status,
    patient_id: visit.patient_id,
    patient: visit.patients,
    amount: amounts.get(visit.id) || 0,
  }));
}

function reportMarker(visitId: string) {
  return `dialysis_visit:${visitId}`;
}

type ReportCategory = Extract<
  PatientDocCategory,
  "dialysis" | "lab_investigation" | "clinic_notes" | "monitor_chart" | "radiology_investigation"
>;

function clinicNotesMarker(patientId: string) {
  return `clinic_notes:${patientId}`;
}

const REPORTS: ReadonlyArray<{
  category: ReportCategory;
  label: string;
  notesFilter: (session: Session) => string | null;
}> = [
  {
    category: "dialysis",
    label: "Patient photo",
    notesFilter: (session) => reportMarker(session.id),
  },
  {
    category: "lab_investigation",
    label: "Lab report",
    notesFilter: (session) => reportMarker(session.id),
  },
  {
    category: "clinic_notes",
    label: "Clinic notes",
    notesFilter: (session) => clinicNotesMarker(session.patient_id),
  },
  {
    category: "monitor_chart",
    label: "Vital report",
    notesFilter: (session) => reportMarker(session.id),
  },
  {
    category: "radiology_investigation",
    label: "Radiology report",
    notesFilter: (session) => reportMarker(session.id),
  },
];

function SessionDocuments({
  session,
  onUploaded,
}: {
  session: Session;
  onUploaded: () => Promise<void>;
}) {
  const common = {
    patientId: session.patient_id,
    patientName: session.patient.name,
    latestOnly: true,
    compact: true,
    onUploaded,
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Session {session.sessionNumber} documents</p>
          <p className="text-xs text-muted-foreground">
            System-generated reports for this dialysis visit.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold">
          {shortDate(session.visit_date)}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <ReportSlot
            key={report.category}
            label={report.label}
            category={report.category}
            notesFilter={report.notesFilter(session)}
            {...common}
          />
        ))}
      </div>
    </div>
  );
}

function ReportSlot({
  label,
  category,
  ...props
}: {
  label: string;
  category: ReportCategory;
  patientId: string;
  patientName: string | null;
  notesFilter: string | null;
  latestOnly: boolean;
  compact: boolean;
  onUploaded: () => Promise<void>;
}) {
  const docs = usePatientDocs(props.patientId, category, props.notesFilter);
  const latest = docs.data?.[0] || null;

  return (
    <TabletCard variant="flat" className="space-y-2 p-2.5">
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {docs.isLoading ? "Loading" : latest ? `Uploaded · ${shortDate(latest.uploadedAt)}` : "No file"}
        </span>
      </div>
      <PatientDocsTab
        category={category}
        label={label}
        uploadNotes={props.notesFilter}
        readOnly
        {...props}
      />
    </TabletCard>
  );
}

function PatientDialysisRow({
  visit,
  history,
  onUploaded,
  onExpanded,
}: {
  visit: DialysisVisit;
  history: Session[];
  onUploaded: (visit: DialysisVisit) => Promise<void>;
  onExpanded: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(visit.id);
  const documentsRef = useRef<HTMLDivElement>(null);
  const activeSession = history.find((item) => item.id === activeSessionId);
  const completed = isCompleted(visit.status);
  const currentCycle = ((history.length - 1) % CYCLES_PER_BILL) + 1;

  useEffect(() => {
    if (!expanded || !activeSessionId || history.length <= 1) return;
    documentsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeSessionId, expanded, history.length]);

  return (
    <TabletCard variant="flat" className={cn("space-y-3", completed && "border-emerald-200") }>
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left active:scale-[0.99]"
        onClick={() =>
          setExpanded((value) => {
            const next = !value;
            onExpanded(next);
            return next;
          })
        }
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <UserRound className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{visit.patient.name || "Unnamed patient"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {visit.patient.patients_id || "No patient ID"} · {visit.patient.phone || "No phone"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold",
              completed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800",
            )}
          >
            {completed ? "Dialysis done" : "Registered"}
          </span>
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Metric label="Last dialysis" value={shortDate(visit.visit_date)} />
        <Metric label="This visit" value={money(visit.amount)} />
        <Metric label="Six-cycle sitting" value={`${currentCycle} / ${CYCLES_PER_BILL}`} />
        <Metric label="Total sittings" value={String(history.length)} />
      </div>

      {expanded ? (
        <div className="space-y-4 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Dialysis history</p>
            <span className="text-xs text-muted-foreground">Newest visit first</span>
          </div>

          <div className="space-y-2">
            {history.map((session) => {
              const selected = activeSession?.id === session.id;
              return (
                <div
                  key={session.id}
                  ref={selected ? documentsRef : undefined}
                  className={cn(
                    "overflow-hidden rounded-xl border",
                    selected ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`View dialysis session ${session.sessionNumber} from ${shortDate(session.visit_date)}`}
                    aria-pressed={selected}
                    onClick={() => setActiveSessionId((current) => (current === session.id ? null : session.id))}
                    className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {session.sessionNumber}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{shortDate(session.visit_date)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {session.amount ? money(session.amount) : "Amount not recorded"}
                      </span>
                    </span>
                    <span className="text-right text-xs font-semibold">
                      {selected ? "Viewing" : isCompleted(session.status) ? "Done" : "Open"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        selected && "rotate-180 text-primary",
                      )}
                    />
                  </button>

                  {selected ? (
                    <div className="border-t px-3 pb-3">
                      <SessionDocuments
                        session={session}
                        onUploaded={() => onUploaded(session)}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {!completed ? (
            <TabletButton className="w-full" onClick={() => onUploaded(visit)}>
              <CheckCircle2 className="mr-2 h-5 w-5" />
              Mark today’s dialysis done
            </TabletButton>
          ) : null}
        </div>
      ) : null}
    </TabletCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/70 px-2 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

export default function DialysisFlow() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<DialysisPeriod>("today");
  const [searchTerm, setSearchTerm] = useState("");
  // Dialysis happens only at Hope — every login sees Hope's list.
  const listHospital = "hope";

  const todayVisits = useQuery({
    queryKey: ["tablet-dialysis-today", listHospital, period, searchTerm.trim().toLowerCase()],
    queryFn: async () => {
      const visits = await loadVisits(listHospital);
      const range = periodRange(period);
      const normalizedSearch = searchTerm.trim().toLowerCase();
      // "Today" is a rolling 24 hours on when the VISIT WAS MADE, so the
      // staff uploading session images always see the visit they need,
      // whichever calendar day the registration crossed.
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const periodRows = normalizedSearch
        ? visits.filter((row) =>
            [row.patient.name, row.patient.patients_id, row.patient.phone, row.visit_id]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
          )
        : period === "today"
          ? visits.filter((row) =>
              row.created_at
                ? row.created_at >= last24h
                : row.visit_date >= last24h.slice(0, 10),
            )
          : visits.filter((row) => row.visit_date >= range.start && row.visit_date <= range.end);
      const unique = new Map<string, DialysisVisit>();
      for (const row of periodRows) {
        if (!unique.has(row.patient_id)) unique.set(row.patient_id, row);
      }
      return Array.from(unique.values());
    },
    staleTime: 30_000,
  });

  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["tablet-dialysis-history", expandedPatientId, listHospital],
    enabled: !!expandedPatientId,
    queryFn: async () => {
      const rows = await loadVisits(listHospital, expandedPatientId || undefined);
      return rows
        .filter((row) => row.patient_id === expandedPatientId)
        .sort((a, b) => b.visit_date.localeCompare(a.visit_date))
        .map((row, index) => ({ ...row, sessionNumber: rows.length - index }));
    },
    staleTime: 30_000,
  });

  const patients = useMemo(() => todayVisits.data || [], [todayVisits.data]);
  const visiblePatients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((visit) =>
      [
        visit.patient.name,
        visit.patient.patients_id,
        visit.patient.phone,
        visit.visit_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [patients, searchTerm]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      todayVisits.refetch(),
      expandedPatientId ? history.refetch() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const markDone = async (visit: DialysisVisit) => {
    const { error } = await supabase
      .from("visits")
      .update({ status: "completed" })
      .eq("id", visit.id);
    if (error) {
      toast({ title: "Could not update dialysis status", description: error.message, variant: "destructive" });
      return;
    }
    await qc.invalidateQueries({ queryKey: ["tablet-dialysis-today"] });
    await qc.invalidateQueries({ queryKey: ["tablet-dialysis-history", visit.patient_id] });
    toast({ title: "Dialysis marked done", description: `${visit.patient.name || "Patient"} is recorded for today.` });
  };

  const handlePatientUploaded = async (visit: DialysisVisit) => {
    await markDone(visit);
    await refresh();
  };

  const isSearching = searchTerm.trim().length > 0;
  const selectedPeriodLabel = isSearching ? "All matching visits" : periodLabels[period];

  return (
    <FlowScaffold
      heading="Dialysis Done"
      subheading="Dialysis patients, session history, billing, and reports"
      actions={
        <TabletButton variant="outline" className="flex-1" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
          Refresh
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Dialysis date range">
          {(Object.keys(periodLabels) as DialysisPeriod[]).map((option) => (
            <TabletButton
              key={option}
              type="button"
              size="sm"
              variant={period === option ? "default" : "outline"}
              aria-selected={period === option}
              onClick={() => setPeriod(option)}
              className="min-h-12 px-2 text-sm sm:text-base"
            >
              {periodLabels[option]}
            </TabletButton>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search patient name, patient ID, phone, or visit ID"
            aria-label="Search dialysis patients"
            className="pl-12 pr-4"
          />
          {isSearching ? (
            <p className="mt-1 text-xs text-muted-foreground">Search is showing results from all dates.</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TabletCard variant="flat" className="py-3">
            <p className="text-xs text-muted-foreground">
              Registered · {period === "today" ? "last 24 hrs" : selectedPeriodLabel}
            </p>
            <p className="mt-1 text-2xl font-bold">{todayVisits.isLoading ? "…" : visiblePatients.length}</p>
          </TabletCard>
          <TabletCard variant="flat" className="py-3">
            <p className="text-xs text-muted-foreground">
              Completed · {period === "today" ? "last 24 hrs" : selectedPeriodLabel}
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">
              {todayVisits.isLoading ? "…" : visiblePatients.filter((row) => isCompleted(row.status)).length}
            </p>
          </TabletCard>
        </div>

        <TabletCard variant="flat" className="flex items-start gap-3 bg-sky-50/70">
          <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div>
            <p className="text-sm font-semibold text-sky-950">{selectedPeriodLabel} dialysis list</p>
            <p className="mt-1 text-xs text-sky-900/70">
              Tap a patient name to open the six-session history. Reports uploaded here are also visible in Patient Profile → Dialysis.
            </p>
          </div>
        </TabletCard>

        {todayVisits.isLoading ? (
          <TabletCard variant="flat" className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading today’s patients…
          </TabletCard>
        ) : todayVisits.isError ? (
          <TabletCard variant="flat" className="border-red-200 bg-red-50">
            <p className="text-sm font-semibold text-red-700">Unable to load dialysis patients.</p>
            <p className="mt-1 text-sm text-red-600">{todayVisits.error instanceof Error ? todayVisits.error.message : "Please retry."}</p>
          </TabletCard>
        ) : visiblePatients.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">
              {searchTerm.trim()
                ? "No matching dialysis patients found."
                : `No dialysis patients found for ${selectedPeriodLabel.toLowerCase()}.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Patients registered from the dashboard will appear here.</p>
          </TabletCard>
        ) : (
          <div className="space-y-3">
            {visiblePatients.map((visit) => (
              <PatientDialysisRow
                key={visit.patient_id}
                visit={visit}
                history={
                  expandedPatientId === visit.patient_id && history.data?.length
                    ? history.data
                    : [{ ...visit, sessionNumber: 1 }]
                }
                onUploaded={handlePatientUploaded}
                onExpanded={(expanded) => setExpandedPatientId(expanded ? visit.patient_id : null)}
              />
            ))}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}
