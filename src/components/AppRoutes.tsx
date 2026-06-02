import { Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

// Import critical pages synchronously
import LandingPage from "../pages/LandingPage";
import Index from "../pages/Index";
import NotFound from "../pages/NotFound";
import PatientDashboard from "../pages/PatientDashboard";
import PatientOverview from "../pages/PatientOverview";
import TodaysIpdDashboard from "../pages/TodaysIpdDashboard";
import ConferenceCallPage from "../pages/ConferenceCall";
import TodaysOpd from "../pages/TodaysOpd";
import AdvanceStatementReport from "../pages/AdvanceStatementReport";
import NoDeductionLetterPage from "../pages/NoDeductionLetter";
import CurrentlyAdmittedPatients from "../pages/CurrentlyAdmittedPatients";
// Loaded eagerly (no lazy chunk) so an open tab never hits "Failed to fetch
// dynamically imported module" after a redeploy.
import IpdDischargeSummary from "../pages/IpdDischargeSummary";

// Lazy load discharged patients page
const DischargedPatients = lazy(() => import("../pages/DischargedPatients"));
const Accommodation = lazy(() => import("../pages/Accommodation"));
const RoomManagement = lazy(() => import("../pages/RoomManagement"));
const DirectorDashboard = lazy(() => import("../pages/DirectorDashboard"));

// Import authentication pages
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";
import TestSignup from "./TestSignup";
import SimpleSignup from "./SimpleSignup";

// Lazy load Advanced Statement Report
const AdvancedStatementReport = lazy(() => import("../pages/AdvancedStatementReport"));

// Lazy load heavy feature pages
const Accounting = lazy(() => import("../pages/Accounting"));
const CashBook = lazy(() => import("../pages/CashBook"));
const PatientLedger = lazy(() => import("../pages/PatientLedger"));
const DayBook = lazy(() => import("../pages/DayBook"));
const LedgerStatement = lazy(() => import("../pages/LedgerStatement"));
const Pharmacy = lazy(() => import("../pages/Pharmacy"));
const Shifting = lazy(() => import("../pages/Shifting"));
const Lab = lazy(() => import("../pages/Lab"));
const TaskOptimizer = lazy(() => import("../pages/TaskOptimizer"));
const Radiology = lazy(() => import("../pages/Radiology"));
const RadiologyMaster = lazy(() => import("../pages/RadiologyMaster"));
const LabMaster = lazy(() => import("../pages/LabMaster"));
const FinalBill = lazy(() => import("../pages/FinalBill"));
const EditFinalBill = lazy(() => import("../pages/EditFinalBill"));

// Lazy load other pages
const Diagnoses = lazy(() => import("../pages/Diagnoses"));
const Patients = lazy(() => import("../pages/Patients"));
const Users = lazy(() => import("../pages/Users"));
const Complications = lazy(() => import("../pages/Complications"));
const CghsSurgery = lazy(() => import("../pages/CghsSurgery"));
const CghsSurgeryMaster = lazy(() => import("../pages/CghsSurgeryMaster"));
const EsicSurgeons = lazy(() => import("../pages/EsicSurgeons"));
const Referees = lazy(() => import("../pages/Referees"));
const ImplantMaster = lazy(() => import("../pages/ImplantMaster"));
const HopeSurgeons = lazy(() => import("../pages/HopeSurgeons"));
const HopeConsultants = lazy(() => import("../pages/HopeConsultants"));
const HopeAnaesthetists = lazy(() => import("../pages/HopeAnaesthetists"));
const AyushmanSurgeons = lazy(() => import("../pages/AyushmanSurgeons"));
const AyushmanConsultants = lazy(() => import("../pages/AyushmanConsultants"));
const AyushmanAnaesthetists = lazy(() => import("../pages/AyushmanAnaesthetists"));
const HopeRMOs = lazy(() => import("../pages/HopeRMOs"));
const AyushmanRMOs = lazy(() => import("../pages/AyushmanRMOs"));
const PmjayMjpjayMaster = lazy(() => import("../pages/PmjayMjpjayMaster"));
const MandatoryService = lazy(() => import("../pages/MandatoryService"));
const MandatoryServiceCreate = lazy(() => import("../pages/MandatoryServiceCreate"));
const ClinicalServices = lazy(() => import("../pages/ClinicalServices"));
const ClinicalServiceCreate = lazy(() => import("../pages/ClinicalServiceCreate"));
const ExternalRequisition = lazy(() => import("../pages/ExternalRequisition"));
const ExternalRequisitionCreate = lazy(() => import("../pages/ExternalRequisitionCreate"));
const GatePassPrintPage = lazy(() => import("../pages/GatePassPrint"));
const DischargeSummaryPrint = lazy(() => import("../pages/DischargeSummaryPrint"));
const DischargeSummaryEdit = lazy(() => import("../pages/DischargeSummaryEdit"));
const OpdSummaryLanding = lazy(() => import("../pages/OpdSummaryLanding"));
const DeathCertificate = lazy(() => import("../pages/DeathCertificate"));
const PhysiotherapyBill = lazy(() => import("../pages/PhysiotherapyBill"));
const AdmissionNotes = lazy(() => import("../pages/AdmissionNotes"));
const OpdAdmissionNotes = lazy(() => import("../pages/OpdAdmissionNotes"));

const PVIFormPrint = lazy(() => import("../pages/PVIFormPrint"));
const PatientProfile = lazy(() => import("../pages/PatientProfile"));
const TreatmentSheet = lazy(() => import("../pages/TreatmentSheet"));
const Reports = lazy(() => import("../pages/Reports"));
const FinalBillTest = lazy(() => import("../pages/FinalBillTest"));
const LabPrintDemo = lazy(() => import("../pages/LabPrintDemo"));
const StoreRequisition = lazy(() => import("../components/pharmacy/StoreRequisition"));
const MarketingDashboard = lazy(() => import("../pages/MarketingDashboard"));
const NephroPlus = lazy(() => import("../pages/NephroPlus"));
const EditSaleBill = lazy(() => import("../components/pharmacy/EditSaleBill"));
const DaywiseBills = lazy(() => import("../pages/DaywiseBills"));
const OldBills = lazy(() => import("../pages/OldBills"));
const ViewBill = lazy(() => import("../pages/ViewBill"));
const FinancialSummary = lazy(() => import("../pages/FinancialSummary"));
const P2Form = lazy(() => import("../pages/P2Form"));
const LabResultsEntryDemo = lazy(() => import("../pages/LabResultsEntryDemo"));
const Invoice = lazy(() => import("../pages/Invoice"));
const DetailedInvoice = lazy(() => import("../pages/DetailedInvoice"));
const DischargeInvoice = lazy(() => import("../pages/DischargeInvoice"));
const Corporate = lazy(() => import("../pages/Corporate"));
const CorporateBill = lazy(() => import("../pages/CorporateBill"));
const CorporateBulkPayments = lazy(() => import("../pages/CorporateBulkPayments"));
const BillSubmission = lazy(() => import("../pages/BillSubmission"));
const BillAgingStatement = lazy(() => import("../pages/BillAgingStatement"));
const ExpectedPaymentDateReport = lazy(() => import("../pages/ExpectedPaymentDateReport"));
const Marketing = lazy(() => import("../pages/Marketing"));
const RelationshipManager = lazy(() => import("../pages/RelationshipManager"));
const ITTransactionRegister = lazy(() => import("../pages/ITTransactionRegister"));
const TallyIntegration = lazy(() => import("../pages/TallyIntegration"));
const OperationTheatre = lazy(() => import("../pages/OperationTheatre"));
const CathLab = lazy(() => import("../pages/CathLab"));
const NursingStation = lazy(() => import("../pages/NursingStation"));
const CTMRIModule = lazy(() => import("../pages/CTMRIModule"));
const UserManagement = lazy(() => import("../pages/UserManagement"));
const ActivityLog = lazy(() => import("../pages/ActivityLog"));
const PatientJourneyLogs = lazy(() => import("../pages/PatientJourneyLogs"));
const CorporateMaster = lazy(() => import("../pages/CorporateMaster"));
const MasterData = lazy(() => import('@/pages/MasterData'));
const LocationMaster = lazy(() => import("../pages/LocationMaster"));
const CorporateAreas = lazy(() => import("../pages/CorporateAreas"));
const CorporateAreaDetail = lazy(() => import("../pages/CorporateAreaDetail"));
const BillApprovals = lazy(() => import("../pages/BillApprovals"));
const DailyPaymentAllocation = lazy(() => import("../pages/DailyPaymentAllocation"));
const PaymentVoucher = lazy(() => import("../pages/PaymentVoucher"));
const QueueManagement = lazy(() => import("../pages/QueueManagement"));
const QueueDisplay = lazy(() => import("../pages/QueueDisplay"));
const QueueTV = lazy(() => import("../pages/QueueTV"));
const HomeCollection = lazy(() => import("../pages/HomeCollection"));
const PhlebotomistDashboard = lazy(() => import("../pages/PhlebotomistDashboard"));
const B2BPortal = lazy(() => import("../pages/B2BPortal"));
const MarketingIncentives = lazy(() => import("../pages/MarketingIncentives"));
const DoctorView = lazy(() => import("../pages/DoctorView"));
const PatientPortal = lazy(() => import("../pages/PatientPortal"));
const SelfCheckIn = lazy(() => import("../pages/SelfCheckIn"));
const ReportDelivery = lazy(() => import("../pages/ReportDelivery"));
const RadiologyWorklist = lazy(() => import("../pages/RadiologyWorklist"));
const StaffAttendance = lazy(() => import("../pages/StaffAttendance"));
const B2BLogin = lazy(() => import("../pages/B2BLogin"));
const MarketingFieldTracker = lazy(() => import("../pages/MarketingFieldTracker"));
const Appointments = lazy(() => import("../pages/Appointments"));
const TelephonyDashboard = lazy(() => import("../pages/TelephonyDashboard"));
const PaymentQR = lazy(() => import("../pages/PaymentQR"));
const QueueStatus = lazy(() => import("../pages/QueueStatus"));
const CasualtyRegister = lazy(() => import("../pages/CasualtyRegister"));

// Loading component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
  </div>
);

// Director Dashboard route guard
const DirectorRoute = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const DIRECTOR_EMAILS = ['cmd@hopehospital.com', 'finance@hopehospital.com'];
  const DIRECTOR_ROLES = ['superadmin', 'super_admin'];

  const canAccess = (u: typeof user): boolean => {
    if (!u) return false;
    const email = u.email?.toLowerCase() ?? '';
    const role = (u as { role?: string }).role ?? '';
    return DIRECTOR_EMAILS.includes(email) || DIRECTOR_ROLES.includes(role);
  };

  useEffect(() => {
    if (!canAccess(user)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  if (!canAccess(user)) {
    return null;
  }

  return <Suspense fallback={<PageLoader />}><DirectorDashboard /></Suspense>;
};

export const AppRoutes = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<Index />} />
        <Route path="/director-dashboard" element={<DirectorRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup-simple" element={<SimpleSignup />} />
        <Route path="/test" element={<TestSignup />} />
        <Route path="/patient-dashboard" element={<PatientDashboard />} />
        <Route path="/patient-overview" element={<PatientOverview />} />
        <Route path="/patient-profile" element={<Suspense fallback={<PageLoader />}><PatientProfile /></Suspense>} />
        <Route path="/todays-ipd" element={<TodaysIpdDashboard />} />
        <Route path="/conference-call" element={<ConferenceCallPage />} />
        <Route path="/todays-opd" element={<TodaysOpd />} />
        <Route path="/advance-statement-report" element={<AdvanceStatementReport />} />
        <Route path="/advanced-statement-report" element={<Suspense fallback={<PageLoader />}><AdvancedStatementReport /></Suspense>} />
        <Route path="/currently-admitted" element={<CurrentlyAdmittedPatients />} />
        <Route path="/accommodation" element={<Suspense fallback={<PageLoader />}><Accommodation /></Suspense>} />
        <Route path="/room-management" element={<Suspense fallback={<PageLoader />}><RoomManagement /></Suspense>} />
        <Route path="/discharged-patients" element={<Suspense fallback={<PageLoader />}><DischargedPatients /></Suspense>} />
        <Route path="/mandatory-service" element={<Suspense fallback={<PageLoader />}><MandatoryService /></Suspense>} />
        <Route path="/mandatory-service-create" element={<Suspense fallback={<PageLoader />}><MandatoryServiceCreate /></Suspense>} />
        <Route path="/clinical-services" element={<Suspense fallback={<PageLoader />}><ClinicalServices /></Suspense>} />
        <Route path="/clinical-service-create" element={<Suspense fallback={<PageLoader />}><ClinicalServiceCreate /></Suspense>} />
        <Route path="/external-requisition" element={<Suspense fallback={<PageLoader />}><ExternalRequisition /></Suspense>} />
        <Route path="/external-requisition-create" element={<Suspense fallback={<PageLoader />}><ExternalRequisitionCreate /></Suspense>} />
        <Route path="/gate-pass/:visitId" element={<Suspense fallback={<PageLoader />}><GatePassPrintPage /></Suspense>} />
        <Route path="/discharge-summary-print/:visitId" element={<Suspense fallback={<PageLoader />}><DischargeSummaryPrint /></Suspense>} />
        <Route path="/discharge-summary-edit/:visitId" element={<Suspense fallback={<PageLoader />}><DischargeSummaryEdit /></Suspense>} />
        <Route path="/opd-summary" element={<Suspense fallback={<PageLoader />}><OpdSummaryLanding /></Suspense>} />
        <Route path="/physiotherapy-bill/:visitId" element={<Suspense fallback={<PageLoader />}><PhysiotherapyBill /></Suspense>} />
        <Route path="/admission-notes/:visitId" element={<Suspense fallback={<PageLoader />}><AdmissionNotes /></Suspense>} />
        <Route path="/opd-admission-notes/:visitId" element={<Suspense fallback={<PageLoader />}><OpdAdmissionNotes /></Suspense>} />

        <Route path="/pvi-form/:visitId" element={<Suspense fallback={<PageLoader />}><PVIFormPrint /></Suspense>} />
        <Route path="/diagnoses" element={<Suspense fallback={<PageLoader />}><Diagnoses /></Suspense>} />
        <Route path="/patients" element={<Suspense fallback={<PageLoader />}><Patients /></Suspense>} />
        <Route path="/users" element={<Suspense fallback={<PageLoader />}><Users /></Suspense>} />
        <Route path="/complications" element={<Suspense fallback={<PageLoader />}><Complications /></Suspense>} />
        <Route path="/cghs-surgery" element={<Suspense fallback={<PageLoader />}><CghsSurgery /></Suspense>} />
        <Route path="/cghs-surgery-master" element={<Suspense fallback={<PageLoader />}><CghsSurgeryMaster /></Suspense>} />
        <Route path="/lab" element={<Suspense fallback={<PageLoader />}><Lab /></Suspense>} />
        <Route path="/task-optimizer" element={<Suspense fallback={<PageLoader />}><TaskOptimizer /></Suspense>} />
        <Route path="/radiology" element={<Suspense fallback={<PageLoader />}><Radiology /></Suspense>} />
        <Route path="/radiology-master" element={<Suspense fallback={<PageLoader />}><RadiologyMaster /></Suspense>} />
        <Route path="/lab-master" element={<Suspense fallback={<PageLoader />}><LabMaster /></Suspense>} />
        <Route path="/treatment-sheet" element={<Suspense fallback={<PageLoader />}><TreatmentSheet /></Suspense>} />
        <Route path="/esic-surgeons" element={<Suspense fallback={<PageLoader />}><EsicSurgeons /></Suspense>} />
        <Route path="/referees" element={<Suspense fallback={<PageLoader />}><Referees /></Suspense>} />
        <Route path="/implant-master" element={<Suspense fallback={<PageLoader />}><ImplantMaster /></Suspense>} />
        <Route path="/relationship-manager" element={<Suspense fallback={<PageLoader />}><RelationshipManager /></Suspense>} />
        <Route path="/hope-surgeons" element={<Suspense fallback={<PageLoader />}><HopeSurgeons /></Suspense>} />
        <Route path="/hope-consultants" element={<Suspense fallback={<PageLoader />}><HopeConsultants /></Suspense>} />
        <Route path="/hope-anaesthetists" element={<Suspense fallback={<PageLoader />}><HopeAnaesthetists /></Suspense>} />
        <Route path="/ayushman-surgeons" element={<Suspense fallback={<PageLoader />}><AyushmanSurgeons /></Suspense>} />
        <Route path="/ayushman-consultants" element={<Suspense fallback={<PageLoader />}><AyushmanConsultants /></Suspense>} />
        <Route path="/ayushman-anaesthetists" element={<Suspense fallback={<PageLoader />}><AyushmanAnaesthetists /></Suspense>} />
        <Route path="/hope-rmos" element={<Suspense fallback={<PageLoader />}><HopeRMOs /></Suspense>} />
        <Route path="/ayushman-rmos" element={<Suspense fallback={<PageLoader />}><AyushmanRMOs /></Suspense>} />
        <Route path="/pmjay-mjpjay-master" element={<Suspense fallback={<PageLoader />}><PmjayMjpjayMaster /></Suspense>} />
        <Route path="/accounting" element={<Suspense fallback={<PageLoader />}><Accounting /></Suspense>} />
        <Route path="/cash-book" element={<Suspense fallback={<PageLoader />}><CashBook /></Suspense>} />
        <Route path="/patient-ledger" element={<Suspense fallback={<PageLoader />}><PatientLedger /></Suspense>} />
        <Route path="/day-book" element={<Suspense fallback={<PageLoader />}><DayBook /></Suspense>} />
        <Route path="/ledger-statement" element={<Suspense fallback={<PageLoader />}><LedgerStatement /></Suspense>} />
        <Route path="/corporate" element={<Suspense fallback={<PageLoader />}><Corporate /></Suspense>} />
        <Route path="/yojna-bill/:visitId" element={<Suspense fallback={<PageLoader />}><CorporateBill /></Suspense>} />
        <Route path="/corporate-bulk-payments" element={<Suspense fallback={<PageLoader />}><CorporateBulkPayments /></Suspense>} />
        <Route path="/pharmacy/goods-received-note" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/pharmacy/purchase-orders/add" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/pharmacy/purchase-orders/list" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/pharmacy/product-purchase-report" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/pharmacy/inventory-tracking" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/pharmacy" element={<Suspense fallback={<PageLoader />}><Pharmacy /></Suspense>} />
        <Route path="/shifting" element={<Suspense fallback={<PageLoader />}><Shifting /></Suspense>} />
        <Route path="/pharmacy/edit-sale/:saleId" element={<Suspense fallback={<PageLoader />}><EditSaleBill /></Suspense>} />
        <Route path="/reports" element={<Suspense fallback={<PageLoader />}><Reports /></Suspense>} />
        <Route path="/final-bill/:visitId" element={<Suspense fallback={<PageLoader />}><FinalBill /></Suspense>} />
        <Route path="/no-deduction-letter/:visitId" element={<NoDeductionLetterPage />} />
        <Route path="/edit-final-bill/:visitId" element={<Suspense fallback={<PageLoader />}><EditFinalBill /></Suspense>} />
        <Route path="/old-bills/:visitId" element={<Suspense fallback={<PageLoader />}><OldBills /></Suspense>} />
        <Route path="/old-bills" element={<Suspense fallback={<PageLoader />}><OldBills /></Suspense>} />
        <Route path="/view-bill/:billId" element={<Suspense fallback={<PageLoader />}><ViewBill /></Suspense>} />
        <Route path="/financial-summary" element={<Suspense fallback={<PageLoader />}><FinancialSummary /></Suspense>} />
        <Route path="/p2form/:visitId" element={<Suspense fallback={<PageLoader />}><P2Form /></Suspense>} />
        <Route path="/lab-print-demo" element={<Suspense fallback={<PageLoader />}><LabPrintDemo /></Suspense>} />
        <Route path="/lab-results-entry-demo" element={<Suspense fallback={<PageLoader />}><LabResultsEntryDemo /></Suspense>} />
        <Route path="/daywise-bills" element={<Suspense fallback={<PageLoader />}><DaywiseBills /></Suspense>} />
        <Route path="/invoice/:visitId" element={<Suspense fallback={<PageLoader />}><Invoice /></Suspense>} />
        <Route path="/detailed-invoice/:visitId" element={<Suspense fallback={<PageLoader />}><DetailedInvoice /></Suspense>} />
        <Route path="/detailed-invoice" element={<Suspense fallback={<PageLoader />}><DetailedInvoice /></Suspense>} />
        <Route path="/discharge-invoice/:visitId" element={<Suspense fallback={<PageLoader />}><DischargeInvoice /></Suspense>} />
        <Route path="/ipd-discharge-summary/:visitId" element={<IpdDischargeSummary />} />
        <Route path="/death-certificate/:visitId" element={<Suspense fallback={<PageLoader />}><DeathCertificate /></Suspense>} />
        <Route path="/bill-submission" element={<Suspense fallback={<PageLoader />}><BillSubmission /></Suspense>} />
        <Route path="/bill-aging-statement" element={<Suspense fallback={<PageLoader />}><BillAgingStatement /></Suspense>} />
        <Route path="/expected-payment-date-report" element={<Suspense fallback={<PageLoader />}><ExpectedPaymentDateReport /></Suspense>} />
        <Route path="/marketing" element={<Suspense fallback={<PageLoader />}><Marketing /></Suspense>} />
        <Route path="/it-transaction-register" element={<Suspense fallback={<PageLoader />}><ITTransactionRegister /></Suspense>} />
        <Route path="/tally" element={<Suspense fallback={<PageLoader />}><TallyIntegration /></Suspense>} />
        <Route path="/ot" element={<Suspense fallback={<PageLoader />}><OperationTheatre /></Suspense>} />
        <Route path="/cath-lab" element={<Suspense fallback={<PageLoader />}><CathLab /></Suspense>} />
        <Route path="/nursing" element={<Suspense fallback={<PageLoader />}><NursingStation /></Suspense>} />
        <Route path="/ct-mri" element={<Suspense fallback={<PageLoader />}><CTMRIModule /></Suspense>} />
        <Route path="/user-management" element={<Suspense fallback={<PageLoader />}><UserManagement /></Suspense>} />
        <Route path="/activity-log" element={<Suspense fallback={<PageLoader />}><ActivityLog /></Suspense>} />
        <Route path="/patient-journey-logs" element={<Suspense fallback={<PageLoader />}><PatientJourneyLogs /></Suspense>} />
        <Route path="/marketing-dashboard" element={<Suspense fallback={<PageLoader />}><MarketingDashboard /></Suspense>} />
        <Route path="/corporate-master" element={<Suspense fallback={<PageLoader />}><CorporateMaster /></Suspense>} />
        <Route path="/corporate-master/:corporateId" element={<Suspense fallback={<PageLoader />}><CorporateAreas /></Suspense>} />
        <Route path="/corporate-master/:corporateId/area/:areaId" element={<Suspense fallback={<PageLoader />}><CorporateAreaDetail /></Suspense>} />
        <Route path="/location-master" element={<Suspense fallback={<PageLoader />}><LocationMaster /></Suspense>} />
        <Route path="/bill-approvals" element={<Suspense fallback={<PageLoader />}><BillApprovals /></Suspense>} />
        <Route path="/daily-payment-allocation" element={<Suspense fallback={<PageLoader />}><DailyPaymentAllocation /></Suspense>} />
        <Route path="/payment-voucher" element={<Suspense fallback={<PageLoader />}><PaymentVoucher /></Suspense>} />
        <Route path="/queue-management" element={<Suspense fallback={<PageLoader />}><QueueManagement /></Suspense>} />
        <Route path="/queue-display" element={<QueueDisplay />} />
        <Route path="/queue-tv" element={<QueueTV />} />
        <Route path="/home-collection" element={<Suspense fallback={<PageLoader />}><HomeCollection /></Suspense>} />
        <Route path="/phlebotomist" element={<Suspense fallback={<PageLoader />}><PhlebotomistDashboard /></Suspense>} />
        <Route path="/b2b-portal" element={<Suspense fallback={<PageLoader />}><B2BPortal /></Suspense>} />
        <Route path="/marketing-incentives" element={<Suspense fallback={<PageLoader />}><MarketingIncentives /></Suspense>} />
        <Route path="/doctor-view" element={<Suspense fallback={<PageLoader />}><DoctorView /></Suspense>} />
        <Route path="/patient-portal" element={<PatientPortal />} />
        <Route path="/self-check-in" element={<SelfCheckIn />} />
        <Route path="/report-delivery" element={<Suspense fallback={<PageLoader />}><ReportDelivery /></Suspense>} />
        <Route path="/radiology-worklist" element={<Suspense fallback={<PageLoader />}><RadiologyWorklist /></Suspense>} />
        <Route path="/attendance" element={<Suspense fallback={<PageLoader />}><StaffAttendance /></Suspense>} />
        <Route path="/b2b-login" element={<Suspense fallback={<PageLoader />}><B2BLogin /></Suspense>} />
        <Route path="/marketing-field" element={<Suspense fallback={<PageLoader />}><MarketingFieldTracker /></Suspense>} />
        <Route path="/appointments" element={<Suspense fallback={<PageLoader />}><Appointments /></Suspense>} />
        <Route path="/telephony" element={<Suspense fallback={<PageLoader />}><TelephonyDashboard /></Suspense>} />
        <Route path="/payment-qr" element={<Suspense fallback={<PageLoader />}><PaymentQR /></Suspense>} />
        <Route path="/queue-status" element={<QueueStatus />} />
        <Route path="/nephroplus" element={<Suspense fallback={<PageLoader />}><NephroPlus /></Suspense>} />
        <Route path="/casualty-register" element={<Suspense fallback={<PageLoader />}><CasualtyRegister /></Suspense>} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="/master-data" element={<Suspense fallback={<PageLoader />}><MasterData /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};
