import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDischargedVisits, type TabletVisit } from "@/tablet/hooks/useVisitLists";
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

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Module 2 — view & print an IPD discharge summary (read-only). */
export default function DischargeSummaryFlow() {
  const { hospitalConfig } = useAuth();
  const visits = useDischargedVisits();
  const [selected, setSelected] = useState<TabletVisit | null>(null);

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
      <TabletVisitList
        visits={visits.data || []}
        loading={visits.isLoading}
        error={visits.isError}
        onSelect={setSelected}
        emptyText="No discharged patients."
        metaKind="discharged"
      />
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
          No discharge summary recorded for this visit.
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
