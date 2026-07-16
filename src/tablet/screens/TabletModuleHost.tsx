import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getModule } from "@/tablet/config/modules";

/** Lazy module-flow registry, keyed by the module id from config/modules.ts. */
const FLOWS: Record<string, LazyExoticComponent<ComponentType>> = {
  director: lazy(() => import("@/tablet/modules/director/DirectorFlow")),
  register: lazy(() => import("@/tablet/modules/register/RegisterPatientFlow")),
  occupancy: lazy(() => import("@/tablet/modules/occupancy/OccupancyBoard")),
  "patient-profile": lazy(
    () => import("@/tablet/modules/patient-profile/PatientProfileFlow"),
  ),
  "icu-admission": lazy(() => import("@/tablet/modules/icu-admission/IcuAdmissionFlow")),
  advance: lazy(() => import("@/tablet/modules/advance/AdvanceFlow")),

  requisition: lazy(() => import("@/tablet/modules/requisition/RequisitionFlow")),
  "gate-pass": lazy(() => import("@/tablet/modules/gate-pass/GatePassFlow")),
  "discharge-summary": lazy(
    () => import("@/tablet/modules/discharge-summary/DischargeSummaryFlow"),
  ),
  "doctor-notes": lazy(
    () => import("@/tablet/modules/doctor-notes/DoctorNotesFlow"),
  ),
  "pharmacy-dispense": lazy(
    () => import("@/tablet/modules/pharmacy-dispense/PharmacyDispenseFlow"),
  ),
  "medication-round": lazy(
    () => import("@/tablet/modules/medication-round/MedicationRoundFlow"),
  ),
  discharge: lazy(() => import("@/tablet/modules/discharge/DischargeListFlow")),
  dama: lazy(() => import("@/tablet/modules/dama/DamaFlow")),
  billing: lazy(() => import("@/tablet/modules/billing/BillingFlow")),
  "cash-in-hand": lazy(() => import("@/tablet/modules/cash-in-hand/CashInHandView")),
  report: lazy(() => import("@/tablet/modules/report/ReportFlow")),
  "referral-register": lazy(
    () => import("@/tablet/modules/referral-register/ReferralRegisterFlow"),
  ),
};

/**
 * Resolves /:moduleId to its flow component. Any path that is not a known
 * module — e.g. a stale desktop route such as /dashboard the browser landed
 * on — redirects to the tablet home instead of dead-ending on an error.
 */
export function TabletModuleHost() {
  const { moduleId } = useParams();
  const mod = getModule(moduleId);
  const Flow = moduleId ? FLOWS[moduleId] : undefined;

  if (!mod || !Flow) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <Flow />
    </Suspense>
  );
}
