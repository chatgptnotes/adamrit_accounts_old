import type { ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { PatientTypeBadge } from "@/tablet/components/PatientTypeBadge";
import { inr, shortDate } from "@/tablet/lib/format";
import { HospitalChip } from "./DirectorListRow";
import {
  useVisitDetail,
  useVisitFinancials,
  type DirectorListRowData,
  type DirectorVisitRow,
} from "./useDirectorList";

/** One labelled read-only field. */
function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words">{value === null || value === "" ? "—" : value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <TabletCard variant="flat" className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{children}</dl>
    </TabletCard>
  );
}

function Money({ financials }: { financials: ReturnType<typeof useVisitFinancials> }) {
  if (financials.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }
  if (financials.isError || !financials.data) {
    return <p className="text-sm text-muted-foreground">Could not load billing for this visit.</p>;
  }
  const f = financials.data;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <Field label="Advance received" value={inr(f.advanceTotal)} />
      <Field label="Final payments" value={inr(f.finalTotal)} />
      <Field label="Bill amount" value={f.billAmount == null ? null : inr(f.billAmount)} />
      <Field label="Bill received" value={f.receivedAmount == null ? null : inr(f.receivedAmount)} />
      <Field label="Outstanding" value={f.outstanding == null ? null : inr(f.outstanding)} />
    </dl>
  );
}

function VisitBody({ visit }: { visit: DirectorVisitRow }) {
  const financials = useVisitFinancials(visit.visitId);
  const bed = [visit.ward, visit.room].filter(Boolean).join(" / ");

  return (
    <>
      <Section title="Patient">
        <Field label="Patient ID" value={visit.patientsId} />
        <Field label="Age / Gender" value={`${visit.age ?? "—"} / ${visit.gender || "—"}`} />
        <Field label="Phone" value={visit.phone} />
        <Field label="Corporate" value={visit.corporate} />
      </Section>

      <Section title="Visit">
        <Field label="Visit ID" value={visit.visitId} />
        <Field label="Visit type" value={visit.visitType} />
        <Field label="Visit date" value={shortDate(visit.visitDate)} />
        <Field label="Treatment" value={visit.treatmentType} />
        <Field label="Doctor" value={visit.doctor} />
        <Field label="Diagnosis" value={visit.diagnosis} />
        <Field label="Reason for visit" value={visit.reasonForVisit} />
        <Field label="Status" value={visit.status} />
      </Section>

      <Section title="Admission">
        <Field label="Admitted" value={shortDate(visit.admissionDate)} />
        <Field label="Discharged" value={shortDate(visit.dischargeDate)} />
        <Field
          label="Length of stay"
          value={
            visit.stayDays == null
              ? null
              : `${visit.stayDays} ${visit.stayDays === 1 ? "day" : "days"}${
                  visit.dischargeDate ? "" : " (ongoing)"
                }`
          }
        />
        <Field
          label="Discharge mode"
          value={visit.dischargeMode ? visit.dischargeMode.replace(/_/g, " ") : null}
        />
        <Field label="Ward / Bed" value={bed || null} />
        <Field label="Billing status" value={visit.billingStatus} />
      </Section>

      <TabletCard variant="flat" className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Money
        </h3>
        <Money financials={financials} />
      </TabletCard>
    </>
  );
}

/**
 * Full-screen detail for one drill-list row, rendered in place of the list with a back
 * button (the master/detail pattern OccupancyBoard uses).
 *
 * Deliberately not a Radix Sheet/Dialog: those portal to document.body, outside the
 * `.tablet-root` element that carries the tablet CSS tokens and the light-theme class,
 * so they lose the tablet theme entirely.
 */
export function DirectorListDetail({
  row,
  onBack,
}: {
  row: DirectorListRowData;
  onBack: () => void;
}) {
  // A payment row only carries the visit_id, so its visit has to be looked up.
  const lookedUp = useVisitDetail(row.kind === "payment" ? row.visitId : null);
  const visit = row.kind === "visit" ? row : lookedUp.data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 space-y-2 border-b p-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
        <div className="flex items-center gap-2">
          <h2 className="truncate text-xl font-bold">{row.patientName}</h2>
          {visit ? <PatientTypeBadge type={visit.patientType} /> : null}
          <HospitalChip hospital={row.hospital} />
        </div>
      </div>

      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {row.kind === "payment" ? (
          <Section title="Payment">
            <Field label="Type" value={row.source === "advance" ? "Advance" : "Final payment"} />
            <Field label="Amount" value={inr(row.amount)} />
            <Field label="Mode" value={row.mode} />
            <Field label="Received on" value={shortDate(row.receivedAt)} />
          </Section>
        ) : null}

        {visit ? (
          <VisitBody visit={visit} />
        ) : lookedUp.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <p className="py-6 text-center text-muted-foreground">
            Visit {row.visitId} could not be loaded.
          </p>
        )}
      </div>
    </div>
  );
}
