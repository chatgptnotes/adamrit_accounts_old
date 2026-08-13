import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Pencil, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAdmittedVisits,
  useDischargedVisits,
  type TabletVisit,
} from "@/tablet/hooks/useVisitLists";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { shortDate } from "@/tablet/lib/format";
import { buildArshiyaSummaryPdfBlob } from "@/tablet/modules/advance/arshiyaSummaryPdf";
import { loadSummarySignatory } from "@/tablet/modules/advance/doctorCredentials";

const HIDE_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "visit_id",
  "hospital_name",
  "patient_id",
]);

type Scope = "admitted" | "discharged";

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Module 2 — view & print an IPD discharge summary, or open the full editor. */
export default function DischargeSummaryFlow() {
  const { hospitalConfig } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("admitted");
  const [selected, setSelected] = useState<TabletVisit | null>(null);

  // A summary is normally written before/at discharge, so the picker offers
  // still-admitted patients too — not only the discharged list it used to show.
  const admitted = useAdmittedVisits();
  const discharged = useDischargedVisits();
  const active = scope === "admitted" ? admitted : discharged;

  // The editor queries visits with .eq('patient_type', 'IPD'), so an Emergency
  // visit would land on its "No Data Found" placeholder form. Keep them out.
  const visits =
    scope === "admitted"
      ? (active.data || []).filter((v) => v.patientType === "IPD")
      : active.data || [];

  const summary = useQuery({
    queryKey: ["tablet-discharge-summary", selected?.id],
    enabled: !!selected,
    queryFn: async () => {
      // visit_id is a uuid column keyed on visits.id — pass selected.id, not
      // the text visit code (matches src/pages/IpdDischargeSummary.tsx).
      const { data, error } = await supabase
        .from("ipd_discharge_summary")
        .select("*")
        .eq("visit_id", selected!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });

  if (!selected) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 gap-2 p-4 pb-0">
          {(["admitted", "discharged"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`min-h-[44px] flex-1 rounded-xl border text-base font-medium capitalize transition active:scale-95 ${
                scope === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          <TabletVisitList
            visits={visits}
            loading={active.isLoading}
            error={active.isError}
            onSelect={setSelected}
            emptyText={
              scope === "admitted"
                ? "No admitted IPD patients."
                : "No discharged patients."
            }
            metaKind={scope}
          />
        </div>
      </div>
    );
  }

  const fields = summary.data
    ? Object.entries(summary.data).filter(
        ([k, v]) =>
          !HIDE_KEYS.has(k) &&
          v != null &&
          v !== "" &&
          typeof v !== "object",
      )
    : [];

  const printSummary = async () => {
    if (!summary.data) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const summaryText = fields
      .map(([key, value]) => `## ${labelize(key)}\n${String(value)}`)
      .join("\n\n") || "No discharge-summary details recorded.";

    try {
      const blob = await buildArshiyaSummaryPdfBlob({
        summaryText,
        withLogo: true,
        documentTitle: "DISCHARGE SUMMARY",
        hospitalName: hospitalConfig.name,
        patientName: selected.patientName,
        patientId: selected.patientsId,
        visitNumber: selected.visitId,
        registrationId: null,
        aadhaarNumber: selected.aadhaarNumber,
        mobileNumber: selected.phone,
        portalUrl: `${window.location.origin}/patient-portal`,
        signatory: await loadSummarySignatory(selected.doctorName),
      });
      const printUrl = URL.createObjectURL(blob);
      printWindow.location.replace(printUrl);
      window.setTimeout(() => URL.revokeObjectURL(printUrl), 60_000);
    } catch {
      printWindow.close();
    }
  };

  return (
    <FlowScaffold
      heading="Discharge Summary"
      subheading={`${selected.patientName} · ${selected.patientsId || selected.visitId}`}
      actions={
        <>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => setSelected(null)}
          >
            Back
          </TabletButton>
          <TabletButton
            className="flex-1"
            onClick={() =>
              // The editor looks the visit up by visits.visit_id — the TEXT
              // code. Passing selected.id (the uuid the query above needs)
              // silently opens an empty form instead.
              navigate(`/ipd-discharge-summary/${selected.visitId}`)
            }
          >
            <Pencil className="h-5 w-5" />
            {summary.data ? "Edit" : "Create"}
          </TabletButton>
          <TabletButton
            variant="outline"
            className="flex-1"
            disabled={!summary.data}
            onClick={() => void printSummary()}
          >
            <Printer className="h-5 w-5" /> Print
          </TabletButton>
        </>
      }
    >
      {summary.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : summary.isError ? (
        <p className="py-10 text-center text-destructive">
          Could not load the discharge summary.
        </p>
      ) : !summary.data ? (
        <p className="py-10 text-center text-muted-foreground">
          No discharge summary recorded yet — tap Create to write one.
        </p>
      ) : (
        <div className="tablet-print-area space-y-4">
          <div className="border-b pb-3">
            <h3 className="text-lg font-bold">Discharge Summary</h3>
            <p className="text-sm text-muted-foreground">
              {selected.patientName} · {selected.patientsId || selected.visitId} ·
              Discharged {shortDate(selected.dischargeDate)}
            </p>
          </div>
          <dl className="space-y-3">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-medium text-muted-foreground">
                  {labelize(k)}
                </dt>
                <dd className="whitespace-pre-wrap">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </FlowScaffold>
  );
}
