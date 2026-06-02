import { BarChart3, Calendar, PhoneCall, Users, UserPlus, Database, Activity, FileText, TestTube, Camera, Pill, MapPin, Stethoscope, UserCog, ScrollText, Calculator, Syringe, Shield, Building2, ClipboardList, ShieldCheck, Receipt, HeartHandshake, ExternalLink, UserCheck, Bed, DoorOpen, LayoutDashboard, BookOpen, Clock, TrendingUp, Scissors, Heart, Cross, ClipboardCheck, ArrowLeftRight, Wallet, Navigation, Award, Smartphone, MonitorSmartphone, MessageCircle, ScanLine, Footprints, Phone, QrCode, Sparkles } from 'lucide-react';

export type MenuSection = 'main' | 'masters';

export interface MenuItemDef {
  title: string;
  url: string;
  icon: any;
  section?: MenuSection;
}

export const menuItems: MenuItemDef[] = [
  // ── Main section ──
  {
    title: "Dashboard",
    url: "/",
    icon: BarChart3,
  },
  {
    title: "Task Optimizer",
    url: "/task-optimizer",
    icon: Sparkles,
  },
  {
    title: "Director Dashboard",
    url: "/director-dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Patient Dashboard",
    url: "/patient-dashboard",
    icon: Users,
  },
  {
    title: "Patient Overview",
    url: "/patient-overview",
    icon: LayoutDashboard,
  },
  {
    title: "Marketing",
    url: "/marketing",
    icon: TrendingUp,
  },
  {
    title: "Marketing Dashboard",
    url: "/marketing-dashboard",
    icon: BarChart3,
  },
  {
    title: "NephroPlus Dialysis",
    url: "/nephroplus",
    icon: Activity,
  },
  {
    title: "IPD Dashboard",
    url: "/todays-ipd",
    icon: Calendar,
  },
  {
    title: "Conference Call",
    url: "/conference-call",
    icon: PhoneCall,
  },
  {
    title: "Today's OPD",
    url: "/todays-opd",
    icon: ClipboardList,
  },
  {
    title: "Currently Admitted",
    url: "/currently-admitted",
    icon: Building2,
  },
  {
    title: "Accommodation",
    url: "/accommodation",
    icon: Bed,
  },
  {
    title: "Room Management",
    url: "/room-management",
    icon: DoorOpen,
  },
  {
    title: "Discharged Patients",
    url: "/discharged-patients",
    icon: UserCheck,
  },
  {
    title: "External Requisition",
    url: "/external-requisition",
    icon: ExternalLink,
  },
  {
    title: "Patients",
    url: "/patients",
    icon: UserPlus,
  },
  {
    title: "Users",
    url: "/users",
    icon: UserCog,
  },
  {
    title: "Operation Theatre",
    url: "/ot",
    icon: Scissors,
  },
  {
    title: "Cath Lab",
    url: "/cath-lab",
    icon: Heart,
  },
  {
    title: "Nursing Station",
    url: "/nursing",
    icon: Cross,
  },
  {
    title: "Casualty Register",
    url: "/casualty-register",
    icon: Cross,
  },
  {
    title: "CT / MRI",
    url: "/ct-mri",
    icon: Camera,
  },
  {
    title: "Accounting",
    url: "/accounting",
    icon: Calculator,
  },
  {
    title: "Cash Book",
    url: "/cash-book",
    icon: BookOpen,
  },
  {
    title: "Payment Allocation",
    url: "/daily-payment-allocation",
    icon: Wallet,
  },
  {
    title: "Payment Voucher",
    url: "/payment-voucher",
    icon: Receipt,
  },
  {
    title: "Ledger Statement",
    url: "/ledger-statement",
    icon: FileText,
  },
  {
    title: "Corporate",
    url: "/corporate",
    icon: Building2,
  },
  {
    title: "Corporate Receipts",
    url: "/corporate-bulk-payments",
    icon: Receipt,
  },
  {
    title: "Intimation + Bill Submissions",
    url: "/bill-submission",
    icon: Receipt,
  },
  {
    title: "Bill Approvals",
    url: "/bill-approvals",
    icon: ClipboardCheck,
  },
  {
    title: "Aging Statement",
    url: "/bill-aging-statement",
    icon: Clock,
  },
  {
    title: "IT Transaction Register",
    url: "/it-transaction-register",
    icon: ScrollText,
  },
  {
    title: "Tally Integration",
    url: "/tally",
    icon: BookOpen,
  },
  {
    title: "Lab",
    url: "/lab",
    icon: TestTube,
  },
  {
    title: "Radiology",
    url: "/radiology",
    icon: Camera,
  },
  {
    title: "Pharmacy",
    url: "/pharmacy",
    icon: Pill,
  },
  {
    title: "Shifting",
    url: "/shifting",
    icon: ArrowLeftRight,
  },
  {
    title: "Activity Log",
    url: "/activity-log",
    icon: ClipboardCheck,
  },
  {
    title: "Patient Journey Logs",
    url: "/patient-journey-logs",
    icon: ScrollText,
  },
  {
    title: "Queue Management",
    url: "/queue-management",
    icon: Clock,
  },
  {
    title: "Home Collection",
    url: "/home-collection",
    icon: MapPin,
  },
  {
    title: "Phlebotomist",
    url: "/phlebotomist",
    icon: Navigation,
  },
  {
    title: "B2B Partners",
    url: "/b2b-portal",
    icon: Building2,
  },
  {
    title: "Marketing Incentives",
    url: "/marketing-incentives",
    icon: Award,
  },
  {
    title: "Marketing Field Tracker",
    url: "/marketing-field",
    icon: Footprints,
  },
  {
    title: "Appointments",
    url: "/appointments",
    icon: Calendar,
  },
  {
    title: "Telephony Dashboard",
    url: "/telephony",
    icon: Phone,
  },
  {
    title: "Payment QR",
    url: "/payment-qr",
    icon: QrCode,
  },
  {
    title: "Doctor View",
    url: "/doctor-view",
    icon: Stethoscope,
  },
  {
    title: "Patient Portal",
    url: "/patient-portal",
    icon: Smartphone,
  },
  {
    title: "Self Check-In Kiosk",
    url: "/kiosk",
    icon: MonitorSmartphone,
  },
  {
    title: "Report Delivery",
    url: "/report-delivery",
    icon: MessageCircle,
  },
  {
    title: "Radiology Worklist",
    url: "/radiology-worklist",
    icon: ScanLine,
  },
  {
    title: "Staff Attendance",
    url: "/attendance",
    icon: UserCheck,
  },

  // ── Masters section ──
  {
    title: "Lab Master",
    url: "/lab-master",
    icon: TestTube,
    section: 'masters',
  },
  {
    title: "Radiology Master",
    url: "/radiology-master",
    icon: Camera,
    section: 'masters',
  },
  {
    title: "Surgery",
    url: "/cghs-surgery-master",
    icon: Syringe,
    section: 'masters',
  },
  {
    title: "Implant Master",
    url: "/implant-master",
    icon: Syringe,
    section: 'masters',
  },
  {
    title: "Diagnoses",
    url: "/diagnoses",
    icon: Activity,
    section: 'masters',
  },
  {
    title: "Complications",
    url: "/complications",
    icon: Database,
    section: 'masters',
  },
  {
    title: "Mandatory Service",
    url: "/mandatory-service",
    icon: ShieldCheck,
    section: 'masters',
  },
  {
    title: "Clinical Services",
    url: "/clinical-services",
    icon: HeartHandshake,
    section: 'masters',
  },
  {
    title: "Referees",
    url: "/referees",
    icon: MapPin,
    section: 'masters',
  },
  {
    title: "Relationship Manager",
    url: "/relationship-manager",
    icon: HeartHandshake,
    section: 'masters',
  },
  {
    title: "Hope Surgeons",
    url: "/hope-surgeons",
    icon: Stethoscope,
    section: 'masters',
  },
  {
    title: "Hope Consultants",
    url: "/hope-consultants",
    icon: UserCog,
    section: 'masters',
  },
  {
    title: "Hope Anaesthetists",
    url: "/hope-anaesthetists",
    icon: Syringe,
    section: 'masters',
  },
  {
    title: "PMJAY / MJPJAY Master",
    url: "/pmjay-mjpjay-master",
    icon: Shield,
    section: 'masters',
  },
  {
    title: "Ayushman Surgeons",
    url: "/ayushman-surgeons",
    icon: Stethoscope,
    section: 'masters',
  },
  {
    title: "Ayushman Consultants",
    url: "/ayushman-consultants",
    icon: UserCog,
    section: 'masters',
  },
  {
    title: "Ayushman Anaesthetists",
    url: "/ayushman-anaesthetists",
    icon: Syringe,
    section: 'masters',
  },
  {
    title: "Hope RMOs",
    url: "/hope-rmos",
    icon: UserCog,
    section: 'masters',
  },
  {
    title: "Ayushman RMOs",
    url: "/ayushman-rmos",
    icon: UserCog,
    section: 'masters',
  },
  {
    title: "Corporate Master",
    url: "/corporate-master",
    icon: Building2,
    section: 'masters',
  },
  {
    title: "Location Master",
    url: "/location-master",
    icon: MapPin,
    section: 'masters',
  },
  {
    title: "User Management",
    url: "/user-management",
    icon: UserCog,
    section: 'masters',
  },
];
