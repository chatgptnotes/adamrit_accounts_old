import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BillDocumentsSection } from "@/pages/corporate-bill/BillDocumentsSection";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import {
  useAdmittedVisits,
  useDischargedVisits,
  useRecentlyDischargedVisits,
  useTodaysDischarges,
  useWardNames,
  type TabletVisit,
} from "@/tablet/hooks/useVisitLists";
import { shortDate } from "@/tablet/lib/format";
import { DeathFileChecklist } from "@/components/patient/DeathFileChecklist";

export default function DocumentsFlow() {
  const [selected, setSelected] = useState<TabletVisit | null>(null);
  if (!selected) return <DocumentsPicker onSelect={setSelected} />;
  return <DocumentsViewer visit={selected} onBack={() => setSelected(null)} />;
}

type PickerMode = "all" | "billing" | "today";

function DocumentsPicker({ onSelect }: { onSelect: (visit: TabletVisit) => void }) {
  const [mode, setMode] = useState<PickerMode>("all");
  const showDischarged = mode === "billing";
  const admitted = useAdmittedVisits();
  const discharged = useDischargedVisits();
  const billing = useRecentlyDischargedVisits();
  const todaysDischarges = useTodaysDischarges(mode === "today");
  const wardNames = useWardNames();
  const qc = useQueryClient();
  const { toast } = useToast();

  /** Clears a patient off the billing worklist. bill_paid is already true on
   *  every recent discharge, so it cannot carry this — billing_cleared_at is
   *  written only here. */
  const markBilled = useMutation({
    mutationFn: async (visit: TabletVisit) => {
      const { error } = await supabase
        .from("visits")
        .update({ billing_cleared_at: new Date().toISOString() } as any)
        .eq("id", visit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-recently-discharged"] });
      toast({ title: "Billing done", description: "The patient is off the billing list." });
    },
    onError: (error: any) => {
      toast({
        title: "Could not mark billing done",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const visits = useMemo(() => {
    const seen = new Set<string>();
    const merged: TabletVisit[] = [];
    for (const visit of [...(admitted.data || []), ...(discharged.data || [])]) {
      if (seen.has(visit.id)) continue;
      seen.add(visit.id);
      merged.push(visit);
    }
    return merged;
  }, [admitted.data, discharged.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-lg font-bold sm:text-xl">Documents</h2>
          <p className="text-sm text-muted-foreground">
            {mode === "billing"
              ? "Discharged in the last 7 days or planned for discharge — waiting to be billed"
              : mode === "today"
                ? "Expected discharges from Arshiya and patients discharged by reception — live, no manual entry"
                : "All admitted and discharged patients"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <TabletButton
            variant={mode === "today" ? "default" : "outline"}
            onClick={() => setMode(mode === "today" ? "all" : "today")}
          >
            {`Today's Discharge (${todaysDischarges.count})`}
          </TabletButton>
          <TabletButton
            variant={mode === "billing" ? "default" : "outline"}
            onClick={() => setMode(mode === "billing" ? "all" : "billing")}
          >
            {mode === "billing" ? "All patients" : `To bill (${billing.count})`}
          </TabletButton>
        </div>
      </div>

      {mode === "today" ? (
        <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {todaysDischarges.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : todaysDischarges.isError ? (
            <p className="py-10 text-center text-destructive">
              Could not load today's expected discharges. Check the connection.
            </p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <TodaysDischargeColumn
                title="Expected Discharge Patients"
                emptyText="Nobody is marked for discharge today on Arshiya's tile yet."
                visits={todaysDischarges.expectedVisits}
                wardNames={wardNames.data}
                onSelect={onSelect}
                kind="expected"
              />
              <TodaysDischargeColumn
                title="Discharged Patients"
                emptyText="No patient has been discharged by reception today yet."
                visits={todaysDischarges.dischargedVisits}
                wardNames={wardNames.data}
                onSelect={onSelect}
                kind="discharged"
              />
            </div>
          )}
        </div>
      ) : showDischarged ? (
        <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {billing.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : billing.isError ? (
            <p className="py-10 text-center text-destructive">
              Could not load the billing list. Check the connection.
            </p>
          ) : billing.visits.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              Nobody discharged or planned for discharge is waiting to be billed.
            </p>
          ) : (
            billing.visits.map((visit) => (
              <BillingRow
                key={visit.id}
                visit={visit}
                onSelect={onSelect}
                onBilled={() => markBilled.mutate(visit)}
                billing={markBilled.isPending}
              />
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <TabletVisitList
            visits={visits}
            loading={admitted.isLoading || discharged.isLoading}
            error={admitted.isError || discharged.isError}
            onSelect={onSelect}
            emptyText="No patient visits found."
            metaKind="admitted"
          />
        </div>
      )}
    </div>
  );
}

/** The two live Today’s Discharge columns shown in Azhar’s Documents tile. */
function TodaysDischargeColumn({
  title,
  emptyText,
  visits,
  wardNames,
  onSelect,
  kind,
}: {
  title: string;
  emptyText: string;
  visits: TabletVisit[];
  wardNames: Map<string, string> | undefined;
  onSelect: (visit: TabletVisit) => void;
  kind: "expected" | "discharged";
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {visits.length}
        </span>
      </div>
      <div className="space-y-3">
        {visits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          visits.map((visit) => (
            <TodaysDischargeRow
              key={visit.id}
              visit={visit}
              wardName={visit.ward ? wardNames?.get(visit.ward) || visit.ward : null}
              onSelect={onSelect}
              kind={kind}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TodaysDischargeRow({
  visit,
  wardName,
  onSelect,
  kind,
}: {
  visit: TabletVisit;
  wardName: string | null;
  onSelect: (visit: TabletVisit) => void;
  kind: "expected" | "discharged";
}) {
  const fields: { label: string; value: string }[] = [
    { label: "UHID", value: visit.patientsId || "—" },
    { label: "Registration / IPD ID", value: visit.visitId || "—" },
    { label: "Doctor", value: visit.doctorName || "—" },
    { label: "Ward", value: wardName || "—" },
    { label: "Room / Bed", value: visit.room || "—" },
    { label: "Admitted", value: visit.admissionDate ? shortDate(visit.admissionDate) : "—" },
    {
      label: kind === "expected" ? "Expected discharge" : "Discharged",
      value:
        kind === "expected"
          ? visit.plannedDischargeDate ? shortDate(visit.plannedDischargeDate) : "—"
          : visit.dischargeDate ? shortDate(visit.dischargeDate) : "—",
    },
    {
      label: "Discharge status",
      value: visit.status || (visit.isDischarged || visit.dischargeDate ? "Discharged" : "Admitted"),
    },
  ];
  return (
    <TabletCard className="p-0">
      <button
        type="button"
        onClick={() => onSelect(visit)}
        className="w-full p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${kind === "expected" ? "bg-sky-100" : "bg-emerald-100"}`}>
            <User className={`h-6 w-6 ${kind === "expected" ? "text-sky-700" : "text-emerald-700"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{visit.patientName}</p>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${kind === "expected" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}>
              {kind === "expected" ? "Admitted · discharge expected today" : "Discharged today"}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <p className="text-[11px] font-medium uppercase text-muted-foreground">{f.label}</p>
              <p className="truncate text-sm font-semibold">{f.value}</p>
            </div>
          ))}
        </div>
      </button>
    </TabletCard>
  );
}

/** One patient waiting to be billed. Tapping the row opens their documents; the
 *  button clears them off the list. */
function BillingRow({
  visit,
  onSelect,
  onBilled,
  billing,
}: {
  visit: TabletVisit;
  onSelect: (visit: TabletVisit) => void;
  onBilled: () => void;
  billing: boolean;
}) {
  return (
    <TabletCard className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onSelect(visit)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <User className="h-6 w-6 text-amber-700" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{visit.patientName}</p>
          <p className="truncate text-sm text-muted-foreground">
            {visit.patientsId || visit.visitId}
          </p>
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {visit.dischargeDate
              ? `Discharged ${shortDate(visit.dischargeDate)} · Bill pending`
              : `Discharge planned ${shortDate(visit.plannedDischargeDate)} · Bill pending`}
          </span>
        </div>
      </button>
      <TabletButton variant="outline" onClick={onBilled} disabled={billing} className="shrink-0">
        {billing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-2 h-4 w-4" />
        )}
        Billing done
      </TabletButton>
    </TabletCard>
  );
}

function DocumentsViewer({
  visit,
  onBack,
}: {
  visit: TabletVisit;
  onBack: () => void;
}) {
  return (
    <FlowScaffold
      heading="Documents"
      subheading={`${visit.patientName} · ${visit.patientsId || visit.visitId}`}
      actions={
        <TabletButton variant="outline" className="flex-1" onClick={onBack}>
          Change patient
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <TabletCard className="flex items-center gap-4 bg-indigo-50">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100">
            <FileText className="h-7 w-7 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{visit.patientName}</p>
            <p className="truncate text-sm text-muted-foreground">
              Visit {visit.visitId} · {visit.patientsId || "No patient ID"}
            </p>
          </div>
        </TabletCard>

        {/* Renders only when this visit ended in a death. */}
        <DeathFileChecklist
          patientId={visit.patientUuid || ""}
          patientName={visit.patientName}
          visitId={visit.visitId}
        />

        <BillDocumentsSection
          patientId={visit.patientUuid || ""}
          patientName={visit.patientName}
          patientRegistrationNo={visit.patientsId || visit.visitId}
          visitId={visit.visitId}
          defaultOpen
          collapsible={false}
          fileLayout="list"
          categoryLayout="list"
        />
      </div>
    </FlowScaffold>
  );
}
