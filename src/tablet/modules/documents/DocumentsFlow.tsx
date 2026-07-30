import { useMemo, useState } from "react";
import { FileText, User } from "lucide-react";
import { BillDocumentsSection } from "@/pages/corporate-bill/BillDocumentsSection";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import {
  useAdmittedVisits,
  useBillingWorklist,
  useDischargedVisits,
  type TabletVisit,
} from "@/tablet/hooks/useVisitLists";
import { shortDate } from "@/tablet/lib/format";

export default function DocumentsFlow() {
  const [selected, setSelected] = useState<TabletVisit | null>(null);
  if (!selected) return <DocumentsPicker onSelect={setSelected} />;
  return <DocumentsViewer visit={selected} onBack={() => setSelected(null)} />;
}

function DocumentsPicker({ onSelect }: { onSelect: (visit: TabletVisit) => void }) {
  const admitted = useAdmittedVisits();
  const discharged = useDischargedVisits();
  const billing = useBillingWorklist();

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
    <TabletVisitList
      visits={visits}
      loading={admitted.isLoading || discharged.isLoading}
      error={admitted.isError || discharged.isError}
      onSelect={onSelect}
      emptyText="No patient visits found."
      metaKind="admitted"
      pinned={
        billing.count > 0 ? (
          <section className="space-y-2">
            <h3 className="text-base font-bold text-destructive">
              To be billed ({billing.count})
            </h3>
            {billing.discharged.map((visit) => (
              <BillingRow
                key={`d-${visit.id}`}
                visit={visit}
                onSelect={onSelect}
                tag={`Discharged ${shortDate(visit.dischargeDate)} · Bill pending`}
                tagClassName="bg-amber-100 text-amber-800"
              />
            ))}
            {billing.plannedToday.map((visit) => (
              <BillingRow
                key={`p-${visit.id}`}
                visit={visit}
                onSelect={onSelect}
                tag="Discharge planned today"
                tagClassName="bg-muted text-muted-foreground"
              />
            ))}
          </section>
        ) : null
      }
    />
  );
}

/** One patient on the billing worklist. Tapping it opens the same documents view
 *  as the main list below. */
function BillingRow({
  visit,
  onSelect,
  tag,
  tagClassName,
}: {
  visit: TabletVisit;
  onSelect: (visit: TabletVisit) => void;
  tag: string;
  tagClassName: string;
}) {
  return (
    <TabletCard interactive onClick={() => onSelect(visit)} className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
        <User className="h-6 w-6 text-amber-700" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{visit.patientName}</p>
        <p className="truncate text-sm text-muted-foreground">
          {visit.patientsId || visit.visitId}
        </p>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagClassName}`}
        >
          {tag}
        </span>
      </div>
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
