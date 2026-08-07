import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getModule } from "@/tablet/config/modules";
import { useAuth } from "@/contexts/AuthContext";
import { canCreateAccountingVouchers } from "@/lib/accounting-access";
import { MlPinGate } from "@/components/MlPinGate";

/** Lazy module-flow registry, keyed by the module id from config/modules.ts. */
const FLOWS: Record<string, LazyExoticComponent<ComponentType>> = {
  "hr-pulse": lazy(() => import("@/tablet/modules/hr/HrFlow")),
  director: lazy(() => import("@/tablet/modules/director/DirectorFlow")),
  register: lazy(() => import("@/tablet/modules/register/RegisterPatientFlow")),
  occupancy: lazy(() => import("@/tablet/modules/occupancy/OccupancyBoard")),
  // Director-dashboard drill list (hidden from the home grid).
  "director-list": lazy(
    () => import("@/tablet/modules/director-list/DirectorListFlow"),
  ),
  "panel-documents": lazy(
    () => import("@/tablet/modules/panel-documents/PanelDocumentsFlow"),
  ),
  "patient-profile": lazy(
    () => import("@/tablet/modules/patient-profile/PatientProfileFlow"),
  ),
  "bed-shifting": lazy(() => import("@/tablet/modules/bed-shifting/BedShiftingFlow")),
  "bed-booking": lazy(() => import("@/tablet/modules/bed-booking/BedBookingFlow")),
  "icu-admission": lazy(() => import("@/tablet/modules/icu-admission/IcuAdmissionFlow")),
  advance: lazy(() => import("@/tablet/modules/advance/AdvanceFlow")),
  "accounts-tilak": lazy(
    () => import("@/tablet/modules/accounts-tilak/AccountsTilakFlow"),
  ),
  "payment-voucher": lazy(
    () => import("@/tablet/modules/accounting-vouchers/TabletVoucherFlow"),
  ),
  "receipt-voucher": lazy(
    () => import("@/tablet/modules/accounting-vouchers/TabletVoucherFlow"),
  ),
  "contra-voucher": lazy(
    () => import("@/tablet/modules/accounting-vouchers/TabletVoucherFlow"),
  ),
  "journal-voucher": lazy(
    () => import("@/tablet/modules/accounting-vouchers/TabletVoucherFlow"),
  ),
  // Past bills sit behind the office PIN — the gate, not the flow, decides.
  // The tile renders the desktop Expense Bill page itself, so the register,
  // its filters, the referral sections and Move to Daily Allocation are the
  // same screen in both editions rather than two that drift apart.
  "expense-bills": lazy(() =>
    import("@/tablet/modules/expense-bills/ExpenseBillsMirror").then((m) => ({
      default: () => (
        <MlPinGate>
          <m.default />
        </MlPinGate>
      ),
    })),
  ),
  "panel-payment-received": lazy(
    () => import("@/tablet/modules/panel-payment-received/PanelPaymentReceivedFlow"),
  ),
  "payments-due": lazy(
    () => import("@/tablet/modules/payments-due/PaymentsDueFlow"),
  ),
  "payment-collection-gaurav": lazy(
    () => import("@/tablet/modules/payment-collection-gaurav/PaymentCollectionGauravFlow"),
  ),
  "private-room-charges-reena": lazy(
    () => import("@/tablet/modules/private-room-charges-reena/PrivateRoomChargesReenaFlow"),
  ),

  "direct-patients": lazy(() => import("@/tablet/modules/direct-patients/DirectPatientsFlow")),
  "ask-books-voice": lazy(() => import("@/tablet/modules/ask-books-voice/AskBooksVoiceFlow")),
  "canteen-sonu": lazy(() => import("@/tablet/modules/canteen-sonu/CanteenSonuFlow")),
  "quick-pay-avni": lazy(() => import("@/tablet/modules/quick-pay-avni/QuickPayAvniFlow")),
  "pharmacy-dues-abhishek": lazy(() => import("@/tablet/modules/pharmacy-dues-abhishek/PharmacyDuesAbhishekFlow")),
  // Renders the desktop billing screen itself, so the cart, Generate Invoice,
  // the QR and Complete Sale behave identically in both editions.
  "pharmacy-billing-abhishek": lazy(() => import("@/tablet/modules/pharmacy-billing/PharmacyBillingMirror")),
  "pharmacy-vendor-lalit": lazy(() => import("@/tablet/modules/pharmacy-vendor-lalit/PharmacyVendorLalitFlow")),
  "bank-cash": lazy(() => import("@/tablet/modules/bank-cash/BankCashFlow")),
  "implant-calculation": lazy(() => import("@/tablet/modules/implant-calculation/ImplantCalculationFlow")),
  "incoming-referrals": lazy(() => import("@/tablet/modules/incoming-referrals/IncomingReferralsFlow")),
  "akshay-payouts": lazy(() => import("@/tablet/modules/akshay-payouts/AkshayPayoutsFlow")),
  "diagnostics-hope": lazy(() => import("@/tablet/modules/diagnostics/DiagnosticsFlow")),
  "diagnostics-ayushman": lazy(() => import("@/tablet/modules/diagnostics/DiagnosticsFlow")),
  "spot-approval": lazy(() => import("@/tablet/modules/spot-approval/SpotApprovalFlow")),
  "rupali-register": lazy(() => import("@/tablet/modules/rupali/RupaliFlow")),
  requisition: lazy(() => import("@/tablet/modules/requisition/RequisitionFlow")),
  "gate-pass": lazy(() => import("@/tablet/modules/gate-pass/GatePassFlow")),
  "discharge-summary": lazy(
    () => import("@/tablet/modules/discharge-summary/DischargeSummaryFlow"),
  ),
  "doctor-notes": lazy(
    () => import("@/tablet/modules/doctor-notes/DoctorNotesFlow"),
  ),
  dialysis: lazy(() => import("@/tablet/modules/dialysis/DialysisFlow")),
  "dialysis-rakesh": lazy(() => import("@/tablet/modules/dialysis-rakesh/DialysisRakeshFlow")),
  "dialysis-billing": lazy(() => import("@/tablet/modules/dialysis-billing/DialysisBillingFlow")),
  "dialysis-front-office": lazy(
    () => import("@/tablet/modules/dialysis-front-office/DialysisFrontOfficeFlow"),
  ),
  "ot-schedule-gaurav": lazy(
    () => import("@/tablet/modules/ot-schedule/OtScheduleFlow"),
  ),
  "rmo-duty-gaurav": lazy(
    () => import("@/tablet/modules/rmo-duty/RmoDutyFlow"),
  ),
  "rmo-duty-javed": lazy(
    () => import("@/tablet/modules/rmo-duty/RmoDutyFlow"),
  ),
  "ot-photos-sarvesh": lazy(
    () => import("@/tablet/modules/ot-schedule/OtScheduleFlow"),
  ),
  "implant-servesh": lazy(
    () => import("@/tablet/modules/implant-servesh/ImplantServeshFlow"),
  ),
  "implant-bill": lazy(
    () => import("@/tablet/modules/implant-bill/ImplantBillFlow"),
  ),
  "implant-sticker": lazy(
    () => import("@/tablet/modules/implant-sticker/ImplantStickerFlow"),
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
  documents: lazy(() => import("@/tablet/modules/documents/DocumentsFlow")),
  "cash-in-hand": lazy(() => import("@/tablet/modules/cash-in-hand/CashInHandView")),
  report: lazy(() => import("@/tablet/modules/report/ReportFlow")),
  "referral-register": lazy(
    () => import("@/tablet/modules/referral-register/ReferralRegisterFlow"),
  ),
  "referee-ruby": lazy(
    () => import("@/tablet/modules/referee-ruby/RefereeRubyFlow"),
  ),
  "referee-viji": lazy(
    () => import("@/tablet/modules/referee-viji/RefereeVijiFlow"),
  ),
};

/**
 * Resolves /:moduleId to its flow component. Any path that is not a known
 * module — e.g. a stale desktop route such as /dashboard the browser landed
 * on — redirects to the tablet home instead of dead-ending on an error.
 */
export function TabletModuleHost() {
  const { moduleId } = useParams();
  const { user } = useAuth();
  const mod = getModule(moduleId);
  const Flow = moduleId ? FLOWS[moduleId] : undefined;

  if (!mod || !Flow) {
    return <Navigate to="/" replace />;
  }
  if (mod.accountingOnly && !canCreateAccountingVouchers(user)) {
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
