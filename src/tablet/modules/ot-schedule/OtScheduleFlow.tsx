import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  FileImage,
  Loader2,
  Receipt,
  ScanLine,
  Search,
  Upload,
  UserRound,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  createAssistantApprovalsFromOt,
  createDoctorApprovalsFromOt,
  listOtDoctorApprovals,
  setOtDoctorAmount,
} from "@/lib/approval-queue-service";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { compressImageToLimit } from "@/tablet/lib/image";
import { MultiShotCamera, type CapturedPhotoItem } from "@/tablet/modules/patient-profile/MultiShotCamera";
import {
  uploadPatientDocs,
  usePatientDocs,
  type PatientDocUploadItem,
} from "@/tablet/hooks/usePatientDocs";

const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

interface VisitOption {
  id: string;
  visitId: string;
  patientId: string;
  patientName: string;
  patientsId: string | null;
  phone: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  surgeryDate: string | null;
  packageName: string | null;
  packageCode: string | null;
  ward: string | null;
  room: string | null;
}

export interface OTScheduleItem {
  id: string;
  visitId: string | null;
  visitNumber: string | null;
  patientId: string | null;
  patientName: string;
  patientsId: string | null;
  phone: string | null;
  surgeryName: string;
  scheduledDate: string;
  scheduledTime: string | null;
  otRoom: string | null;
  status: string;
  actualEndTime: string | null;
  surgeryDate: string | null;
  packageName: string | null;
  surgeonName: string | null;
  anesthetistName: string | null;
  anesthesiaType: string | null;
}

type PackageOtDefaults = {
  packageId: string;
  packageName: string;
  packageCode: string;
  surgeonName: string;
  anesthetistName: string;
  anesthesiaType: string;
};

export const todayDate = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const normalizeStatus = (value: string | null | undefined) => (value || "scheduled").replace(/_/g, " ");
const normalizeLookup = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const sanitizeSearch = (value: string | null | undefined) => String(value || "").trim().replace(/[,*%]/g, " ");

const rowPatient = (row: any) => Array.isArray(row?.patients) ? row.patients[0] : row?.patients;
const rowVisit = (row: any) => Array.isArray(row?.visits) ? row.visits[0] : row?.visits;

function formatDateTime(date: string | null, time?: string | null) {
  if (!date) return "-";
  const joined = time ? `${date}T${time}` : date;
  const parsed = new Date(joined);
  if (Number.isNaN(parsed.getTime())) return time ? `${date} ${time}` : date;
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: time ? "2-digit" : undefined,
    minute: time ? "2-digit" : undefined,
  });
}

function mapVisit(row: any): VisitOption {
  const patient = rowPatient(row);
  return {
    id: row.id,
    visitId: row.visit_id,
    patientId: row.patient_id || patient?.id,
    patientName: patient?.name || "Unknown patient",
    patientsId: patient?.patients_id || null,
    phone: patient?.phone || null,
    admissionDate: row.admission_date || null,
    dischargeDate: row.discharge_date || null,
    surgeryDate: row.surgery_date || null,
    packageName: row.package_name || row.treatment_type || row.reason_for_visit || null,
    packageCode: row.package_code || null,
    ward: row.ward_allotted || null,
    room: row.room_allotted || null,
  };
}

function parseAnesthesiaType(value: string | null | undefined) {
  // special_requirements also carries free-text notes from the desktop OT
  // screen ("arrange 2 units blood…") — only the marked segment is the
  // anaesthesia, never the whole field.
  const match = String(value || "").match(/Anesthesia Type:\s*([^|\n]+)/i);
  return match ? match[1].trim() || null : null;
}

function mapSchedule(row: any): OTScheduleItem {
  const patient = rowPatient(row);
  const visit = rowVisit(row);
  const derivedStatus = row.status === "completed" || visit?.surgery_date ? "completed" : row.status || "scheduled";
  return {
    id: row.id,
    visitId: row.visit_id || visit?.id || null,
    visitNumber: visit?.visit_id || null,
    patientId: row.patient_id || patient?.id || null,
    patientName: patient?.name || "Unknown patient",
    patientsId: patient?.patients_id || null,
    phone: patient?.phone || null,
    surgeryName: row.surgery_name || visit?.package_name || "Surgery",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time || null,
    otRoom: row.ot_room || null,
    status: derivedStatus,
    actualEndTime: row.actual_end_time || null,
    surgeryDate: visit?.surgery_date || null,
    packageName: visit?.package_name || null,
    surgeonName: row.surgeon_name || null,
    anesthetistName: row.anesthetist_name || null,
    anesthesiaType: parseAnesthesiaType(row.special_requirements),
  };
}

function useVisitSearch(term: string) {
  const { hospitalConfig } = useAuth();
  const safe = term.trim().replace(/[%,]/g, "");

  return useQuery({
    queryKey: ["tablet-ot-visit-search", hospitalConfig.name, safe],
    staleTime: 1000 * 20,
    queryFn: async (): Promise<VisitOption[]> => {
      let patientIds: string[] | null = null;

      if (safe) {
        const { data: patients, error: patientError } = await supabase
          .from("patients")
          .select("id")
          .eq("hospital_name", hospitalConfig.name)
          .or(`name.ilike.%${safe}%,patients_id.ilike.%${safe}%,phone.ilike.%${safe}%`)
          .limit(40);
        if (patientError) throw patientError;
        patientIds = (patients || []).map((patient) => patient.id);
        if (patientIds.length === 0) return [];
      }

      let query = supabase
        .from("visits")
        .select(`
          id,
          visit_id,
          patient_id,
          patient_type,
          admission_date,
          discharge_date,
          surgery_date,
          package_code,
          package_name,
          treatment_type,
          reason_for_visit,
          ward_allotted,
          room_allotted,
          patients!inner(id, name, patients_id, phone, hospital_name)
        `)
        .eq("patients.hospital_name", hospitalConfig.name)
        .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
        .order("admission_date", { ascending: false })
        .limit(60);

      if (patientIds) query = query.in("patient_id", patientIds);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(mapVisit);
    },
  });
}

function usePackageOtDefaults(packageName: string, packageCode: string | null | undefined) {
  const name = packageName.trim();
  const code = String(packageCode || "").trim();

  return useQuery({
    queryKey: ["tablet-ot-package-defaults", name, code],
    enabled: Boolean(name || code),
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<PackageOtDefaults | null> => {
      const orParts = [
        code ? `treatment_code.ilike.*${sanitizeSearch(code)}*` : "",
        name ? `treatment_plan.ilike.*${sanitizeSearch(name)}*` : "",
      ].filter(Boolean);
      if (orParts.length === 0) return null;

      const { data: packages, error } = await supabase
        .from("pmjay_mjpjay_packages")
        .select("id, treatment_code, treatment_plan, anaesthesia_type, is_active")
        .eq("is_active", true)
        .or(orParts.join(","))
        .limit(12);
      if (error) throw error;

      const rows = packages || [];
      if (rows.length === 0) return null;

      const normalizedCode = normalizeLookup(code);
      const normalizedName = normalizeLookup(name);
      const match =
        rows.find((row: any) => normalizedCode && normalizeLookup(row.treatment_code) === normalizedCode) ||
        rows.find((row: any) => normalizedName && normalizeLookup(row.treatment_plan) === normalizedName) ||
        rows.find((row: any) => normalizedName && normalizeLookup(row.treatment_plan).includes(normalizedName)) ||
        rows[0];

      const packageId = String(match.id);
      const [surgeonsResult, anaesthetistsResult] = await Promise.all([
        supabase
          .from("pmjay_mjpjay_package_surgeons")
          .select("surgeon_name, created_at")
          .eq("package_id", packageId)
          .order("created_at", { ascending: true }),
        supabase
          .from("pmjay_mjpjay_package_anaesthetists")
          .select("anaesthetist_name, created_at")
          .eq("package_id", packageId)
          .order("created_at", { ascending: true }),
      ]);
      if (surgeonsResult.error) throw surgeonsResult.error;
      if (anaesthetistsResult.error) throw anaesthetistsResult.error;

      const surgeonName = [
        ...new Set((surgeonsResult.data || []).map((row: any) => String(row.surgeon_name || "").trim()).filter(Boolean)),
      ].join(", ");
      const anesthetistName = [
        ...new Set((anaesthetistsResult.data || []).map((row: any) => String(row.anaesthetist_name || "").trim()).filter(Boolean)),
      ].join(", ");

      return {
        packageId,
        packageName: match.treatment_plan || name,
        packageCode: match.treatment_code || code,
        surgeonName,
        anesthetistName,
        anesthesiaType: match.anaesthesia_type || "",
      };
    },
  });
}

interface PackageMasterOption {
  code: string | null;
  name: string;
  label: string;
}

// Same masters as the Advance Statement package dropdown: PMJAY/MJPJAY,
// Yojana MH procedures, then CGHS surgeries — deduped by name. Searched
// server-side per term: the CGHS/Yojana masters have thousands of rows,
// more than one unpaginated select returns.
function usePackageMasterSearch(term: string) {
  const query = term.trim();
  return useQuery({
    queryKey: ["tablet-ot-package-master-search", query.toLowerCase()],
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<PackageMasterOption[]> => {
      const like = `*${sanitizeSearch(query)}*`;
      const [pmjayRes, yojanaRes, cghsRes] = await Promise.all([
        supabase
          .from("pmjay_mjpjay_packages")
          .select("treatment_code, treatment_plan")
          .eq("is_active", true)
          .or(`treatment_plan.ilike.${like},treatment_code.ilike.${like}`)
          .order("treatment_plan")
          .limit(10),
        supabase
          .from("yojana_mh_procedures")
          .select("procedure_code, package_code, package_name, procedure_name, procedure_label")
          .or(`package_name.ilike.${like},procedure_name.ilike.${like},procedure_code.ilike.${like},package_code.ilike.${like}`)
          .order("package_name")
          .limit(10),
        supabase.from("cghs_surgery").select("name").eq("is_active", true).ilike("name", like).order("name").limit(10),
      ]);

      const pmjay: PackageMasterOption[] = (pmjayRes.data || [])
        .map((p: any) => ({
          code: p.treatment_code || null,
          name: p.treatment_plan || p.treatment_code || "",
          label: [p.treatment_code, p.treatment_plan].filter(Boolean).join(" - "),
        }))
        .filter((p) => p.name);

      const yojana: PackageMasterOption[] = (yojanaRes.data || [])
        .map((p: any) => ({
          code: p.procedure_code || p.package_code || null,
          name: p.package_name || p.procedure_name || p.procedure_label || p.package_code || "",
          label: [
            p.procedure_code || p.package_code,
            p.package_name || p.procedure_name || p.procedure_label || p.package_code,
          ].filter(Boolean).join(" - "),
        }))
        .filter((p) => p.name);

      const cghs: PackageMasterOption[] = (cghsRes.data || [])
        .map((p: any) => ({ code: null, name: p.name || "", label: p.name || "" }))
        .filter((p) => p.name);

      return Array.from(new Map([...yojana, ...pmjay, ...cghs].map((pkg) => [pkg.name, pkg])).values()).slice(0, 12);
    },
  });
}

// Active cath-lab technicians from the master, for the assistant dropdown.
function useCathlabTechnicians() {
  return useQuery({
    queryKey: ["tablet-cathlab-technicians"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<Array<{ name: string; default_fee: number }>> => {
      const { data, error } = await (supabase as any)
        .from("cathlab_technicians")
        .select("name, default_fee")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []).map((t: any) => ({ name: t.name, default_fee: Number(t.default_fee) || 0 }));
    },
  });
}

function useOtRooms() {
  return useQuery({
    queryKey: ["tablet-ot-rooms"],
    staleTime: 1000 * 60,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("operation_theatres")
        .select("name")
        .order("name", { ascending: true });
      if (error) throw error;
      const rooms = (data || []).map((room) => room.name).filter(Boolean);
      return rooms.length ? rooms : ["OT"];
    },
  });
}

export function useDailySchedule(date: string) {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ["tablet-daily-ot-schedule", hospitalConfig.name, date],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<OTScheduleItem[]> => {
      const { data, error } = await supabase
        .from("ot_schedule")
        .select(`
          id,
          visit_id,
          patient_id,
          surgery_name,
          scheduled_date,
          scheduled_time,
          ot_room,
          status,
          actual_end_time,
          surgeon_name,
          anesthetist_name,
          special_requirements,
          patients!inner(id, name, patients_id, phone, hospital_name),
          visits(id, visit_id, surgery_date, package_name)
        `)
        .eq("scheduled_date", date)
        .eq("patients.hospital_name", hospitalConfig.name)
        .neq("status", "cancelled")
        .order("scheduled_time", { ascending: true });
      if (error) throw error;
      return (data || []).map(mapSchedule);
    },
  });
}

async function markScheduleCompleted(row: OTScheduleItem) {
  const completedAt = new Date().toISOString();
  const updatePayload: Record<string, string> = {
    status: "completed",
    actual_end_time: completedAt,
    updated_at: completedAt,
  };
  if (!row.actualEndTime) {
    updatePayload.actual_start_time = completedAt;
  }

  const { error: scheduleError } = await supabase
    .from("ot_schedule")
    .update(updatePayload as any)
    .eq("id", row.id);
  if (scheduleError) throw scheduleError;

  if (row.visitId) {
    const { error: visitError } = await supabase
      .from("visits")
      .update({ surgery_date: completedAt, updated_at: completedAt })
      .eq("id", row.visitId);
    if (visitError) throw visitError;
  }

  // Auto-queue one DOCTOR payable per surgeon for management approval.
  // Fire-and-forget: OT completion must never fail because of billing.
  void createDoctorApprovalsFromOt({
    id: row.id,
    surgeon_name: row.surgeonName,
    anesthetist_name: row.anesthetistName,
    anesthesia_type: row.anesthesiaType,
    surgery_name: row.surgeryName,
    visit_id: row.visitNumber,
    patient_name: row.patientName,
  }).catch((err) => console.warn("[ot-schedule] doctor approval auto-feed failed:", err));
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const completed = status === "completed";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${completed ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
      {normalizeStatus(status)}
    </span>
  );
}

/**
 * Amount editor on a completed OT card: Gaurav enters how much the doctor
 * will be paid; the amount lands on the auto-created DOCTOR bill(s) in the
 * accounting Approvals queue. Approved bills are frozen and never updated.
 */
function OtDoctorAmountEditor({
  row,
  bills,
  onSaved,
}: {
  row: OTScheduleItem;
  bills: Array<{ id: string; party_name: string; amount: number; status: string }>;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const pendingBills = bills.filter((bill) => bill.status === "PENDING");
  const savedAmount = pendingBills.find((bill) => bill.amount > 0)?.amount || 0;
  const allApproved = bills.length > 0 && pendingBills.length === 0;
  const [value, setValue] = useState<string>(savedAmount > 0 ? String(savedAmount) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(savedAmount > 0 ? String(savedAmount) : "");
  }, [savedAmount]);

  if (allApproved) {
    return (
      <p className="mt-2 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600">
        Doctor payment approved in accounting — amount locked
      </p>
    );
  }

  const save = async () => {
    const amount = Number(value);
    if (!amount || amount <= 0) {
      toast({ title: "Enter amount", description: "Doctor payment must be more than zero.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await setOtDoctorAmount(
        {
          id: row.id,
          surgeon_name: row.surgeonName,
          surgery_name: row.surgeryName,
          visit_id: row.visitNumber,
          patient_name: row.patientName,
        },
        amount,
      );
      toast({ title: "Amount saved", description: "Visible in Accounting → Approvals for approval." });
      onSaved();
    } catch (err: any) {
      toast({ title: "Could not save amount", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border-t pt-2">
      <label className="text-xs font-semibold text-muted-foreground">Doctor payment (₹)</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <TabletButton className="h-10 shrink-0 px-3 text-sm" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
          Save
        </TabletButton>
      </div>
      {savedAmount > 0 ? (
        <p className="mt-1 text-xs text-emerald-600">₹{savedAmount.toLocaleString("en-IN")} sent to Accounting Approvals</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Amount will appear on the doctor's bill in Accounting → Approvals.</p>
      )}
    </div>
  );
}

function GauravScheduler() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const rooms = useOtRooms();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const visits = useVisitSearch(debouncedSearch);
  const [selected, setSelected] = useState<VisitOption | null>(null);
  const [scheduledDate, setScheduledDate] = useState(todayDate());
  const [scheduledTime, setScheduledTime] = useState(nowTime());
  const [surgeryName, setSurgeryName] = useState("");
  const [surgeonName, setSurgeonName] = useState("");
  const [anesthetistName, setAnesthetistName] = useState("");
  const [anesthesiaType, setAnesthesiaType] = useState("");
  const [notes, setNotes] = useState("");
  const [otRoom, setOtRoom] = useState("OT");
  // Outsourced per-case help, entered the day before with the fee decided
  // beforehand — saving raises their bill for approval ahead of the surgery.
  const [otAssistantName, setOtAssistantName] = useState("");
  const [otAssistantFee, setOtAssistantFee] = useState("");
  const [cathlabAssistantName, setCathlabAssistantName] = useState("");
  const [cathlabAssistantFee, setCathlabAssistantFee] = useState("");
  const [saving, setSaving] = useState(false);
  // Id of the patient's already-saved OT row, so Save updates it instead of
  // inserting a duplicate and the surgery/package survives a reopen.
  const [existingScheduleId, setExistingScheduleId] = useState<string | null>(null);
  const dailySchedule = useDailySchedule(scheduledDate);
  const packageDefaults = usePackageOtDefaults(surgeryName, selected?.packageCode);
  const [showPackageSuggestions, setShowPackageSuggestions] = useState(false);
  const [debouncedSurgeryName] = useDebounce(surgeryName, 250);
  const packageSearch = usePackageMasterSearch(debouncedSurgeryName);
  const cathlabTechnicians = useCathlabTechnicians();
  const packageSuggestions = packageSearch.data || [];

  // Doctor bills auto-created for today's completed surgeries (amount editor).
  const completedIds = useMemo(
    () => (dailySchedule.data || []).filter((row) => row.status === "completed").map((row) => row.id),
    [dailySchedule.data],
  );
  const otBills = useQuery({
    queryKey: ["ot-doctor-bills", completedIds.join("|")],
    queryFn: () => listOtDoctorApprovals(completedIds),
    enabled: completedIds.length > 0,
  });

  const visibleRooms = rooms.data?.length ? rooms.data : ["OT"];

  const selectVisit = async (visit: VisitOption) => {
    setSelected(visit);
    setSurgeryName(visit.packageName || "");
    setSurgeonName("");
    setAnesthetistName("");
    setAnesthesiaType("");
    setNotes("");
    setOtRoom(visibleRooms[0] || "OT");
    setOtAssistantName("");
    setOtAssistantFee("");
    setCathlabAssistantName("");
    setCathlabAssistantFee("");
    setExistingScheduleId(null);

    // Reload the most recent saved OT row for this visit so the surgery/package
    // (and time/room) come back instead of a blank field on every reopen.
    try {
      const { data } = await supabase
        .from("ot_schedule")
        .select("id, surgery_name, scheduled_date, scheduled_time, ot_room, notes, ot_assistant_name, ot_assistant_fee, cathlab_assistant_name, cathlab_assistant_fee")
        .eq("visit_id", visit.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setExistingScheduleId(data.id);
        if (data.surgery_name) setSurgeryName(data.surgery_name);
        if (data.scheduled_date) setScheduledDate(data.scheduled_date);
        if (data.scheduled_time) setScheduledTime(data.scheduled_time);
        if (data.ot_room) setOtRoom(data.ot_room);
        if (data.notes) setNotes(data.notes);
        const extras = data as any;
        if (extras.ot_assistant_name) setOtAssistantName(extras.ot_assistant_name);
        if (extras.ot_assistant_fee) setOtAssistantFee(String(extras.ot_assistant_fee));
        if (extras.cathlab_assistant_name) setCathlabAssistantName(extras.cathlab_assistant_name);
        if (extras.cathlab_assistant_fee) setCathlabAssistantFee(String(extras.cathlab_assistant_fee));
      }
    } catch {
      // Non-fatal: fall back to the package-derived defaults already set above.
    }
  };

  useEffect(() => {
    if (packageDefaults.isFetching) return;
    const defaults = packageDefaults.data;
    setSurgeonName(defaults?.surgeonName || "");
    setAnesthetistName(defaults?.anesthetistName || "");
    setAnesthesiaType(defaults?.anesthesiaType || "");
  }, [packageDefaults.data, packageDefaults.isFetching]);

  const saveSchedule = async () => {
    if (!selected) {
      toast({ title: "Select patient", description: "Search and select the patient visit first.", variant: "destructive" });
      return;
    }
    if (!surgeryName.trim()) {
      toast({ title: "Add surgery", description: "Enter the surgery or package name.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        patient_id: selected.patientId,
        visit_id: selected.id,
        surgery_name: surgeryName.trim(),
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        ot_room: otRoom || "OT",
        surgeon_name: surgeonName.trim() || null,
        anesthetist_name: anesthetistName.trim() || null,
        special_requirements: anesthesiaType.trim() ? `Anesthesia Type: ${anesthesiaType.trim()}` : null,
        notes: notes.trim() || null,
        urgency: "elective",
        status: "scheduled",
        ot_assistant_name: otAssistantName.trim() || null,
        ot_assistant_fee: Number(otAssistantFee) > 0 ? Number(otAssistantFee) : null,
        cathlab_assistant_name: cathlabAssistantName.trim() || null,
        cathlab_assistant_fee: Number(cathlabAssistantFee) > 0 ? Number(cathlabAssistantFee) : null,
      };
      // Update the existing row when one was loaded, so re-saving the same
      // patient keeps one OT record instead of stacking duplicates.
      const { data: savedRow, error } = existingScheduleId
        ? await supabase.from("ot_schedule").update(payload).eq("id", existingScheduleId).select("id").single()
        : await supabase.from("ot_schedule").insert(payload).select("id").single();
      if (error) throw error;

      // Assistant fees are decided beforehand — raise their bills NOW so the
      // amount can be approved (and the JV posted) before the procedure. The
      // approved bill doubles as the system-generated invoice.
      void createAssistantApprovalsFromOt(
        {
          id: savedRow.id,
          surgery_name: surgeryName.trim(),
          visit_id: selected.visitId,
          patient_name: selected.patientName,
        },
        [
          { role: "OT Assistant", name: otAssistantName, fee: Number(otAssistantFee) },
          { role: "Cath Lab Assistant", name: cathlabAssistantName, fee: Number(cathlabAssistantFee) },
        ],
      );
      await qc.invalidateQueries({ queryKey: ["tablet-daily-ot-schedule"] });
      toast({ title: "OT scheduled", description: `${selected.patientName} added for ${formatDateTime(scheduledDate, scheduledTime)}.` });
      setSelected(null);
      setSearch("");
      setSurgeryName("");
      setSurgeonName("");
      setAnesthetistName("");
      setAnesthesiaType("");
      setNotes("");
      setOtAssistantName("");
      setOtAssistantFee("");
      setCathlabAssistantName("");
      setCathlabAssistantFee("");
      setExistingScheduleId(null);
      setScheduledTime(nowTime());
    } catch (error) {
      toast({
        title: "Could not schedule OT",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FlowScaffold heading="OT Schedule - Gaurav" subheading="Search a patient, add OT time, and track whether surgery is scheduled or completed.">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <TabletCard>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <TabletInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient name, patient ID or phone"
              className="pl-11"
            />
          </div>

          <div className="mt-4 space-y-3">
            {visits.isLoading ? (
              <div className="py-10 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />
                Loading patients...
              </div>
            ) : visits.isError ? (
              <p className="py-10 text-center text-destructive">Could not load patient visits.</p>
            ) : (visits.data || []).length === 0 ? (
              <p className="py-10 text-center text-muted-foreground">No patient visits found.</p>
            ) : (
              (visits.data || []).map((visit) => (
                <button key={visit.id} type="button" onClick={() => selectVisit(visit)} className="w-full text-left">
                  <TabletCard className={`flex items-center gap-3 transition ${selected?.id === visit.id ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{visit.patientName}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {visit.patientsId || visit.visitId} · Adm {shortDate(visit.admissionDate)}
                      </p>
                      {visit.packageName ? <p className="mt-1 truncate text-xs text-muted-foreground">{visit.packageName}</p> : null}
                    </div>
                  </TabletCard>
                </button>
              ))
            )}
          </div>
        </TabletCard>

        <TabletCard className="h-fit space-y-4">
          <div>
            <p className="text-sm font-semibold text-muted-foreground">Selected patient</p>
            <p className="mt-1 text-lg font-bold">{selected?.patientName || "No patient selected"}</p>
            <p className="text-sm text-muted-foreground">{selected ? `${selected.patientsId || selected.visitId} · ${selected.ward || "-"} ${selected.room || ""}` : "Choose from the patient list"}</p>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Surgery / package</span>
            <div className="relative">
              <TabletInput
                value={surgeryName}
                onChange={(event) => {
                  setSurgeryName(event.target.value);
                  setShowPackageSuggestions(true);
                }}
                onFocus={() => setShowPackageSuggestions(true)}
                onBlur={() => setTimeout(() => setShowPackageSuggestions(false), 150)}
                placeholder="Type to search the package master"
              />
              {showPackageSuggestions && packageSuggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-background shadow-lg">
                  {packageSuggestions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className="block w-full border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/60"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setSurgeryName(option.name);
                        setShowPackageSuggestions(false);
                      }}
                    >
                      <span className="font-medium">{option.name}</span>
                      {option.code ? (
                        <span className="ml-2 text-xs text-muted-foreground">{option.code}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-muted-foreground">PMJAY/MJPJAY Master Defaults</span>
              {packageDefaults.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Surgeon Name</span>
                <TabletInput value={surgeonName} onChange={(event) => setSurgeonName(event.target.value)} placeholder="Auto-filled from package master" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Anaesthetist Name</span>
                <TabletInput value={anesthetistName} onChange={(event) => setAnesthetistName(event.target.value)} placeholder="Auto-filled from package master" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Anesthesia Type</span>
                <TabletInput value={anesthesiaType} onChange={(event) => setAnesthesiaType(event.target.value)} placeholder="Auto-filled from package master" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Note</span>
                <TabletInput value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a note" />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium">OT Assistant (outsourced)</span>
                <TabletInput value={otAssistantName} onChange={(event) => setOtAssistantName(event.target.value)} placeholder="Name" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Fee (₹)</span>
                <TabletInput type="number" inputMode="decimal" value={otAssistantFee} onChange={(event) => setOtAssistantFee(event.target.value)} placeholder="0" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Cath Lab Technician</span>
                <select
                  className="h-14 w-full rounded-xl border border-input bg-background px-4 text-lg"
                  value={cathlabAssistantName}
                  onChange={(event) => {
                    const name = event.target.value;
                    setCathlabAssistantName(name);
                    const tech = (cathlabTechnicians.data || []).find((t) => t.name === name);
                    if (tech?.default_fee) setCathlabAssistantFee(String(tech.default_fee));
                  }}
                >
                  <option value="">— None —</option>
                  {/* A previously saved name missing from the master must not vanish. */}
                  {cathlabAssistantName &&
                    !(cathlabTechnicians.data || []).some((t) => t.name === cathlabAssistantName) && (
                      <option value={cathlabAssistantName}>{cathlabAssistantName}</option>
                    )}
                  {(cathlabTechnicians.data || []).map((tech) => (
                    <option key={tech.name} value={tech.name}>{tech.name}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Fee (₹)</span>
                <TabletInput type="number" inputMode="decimal" value={cathlabAssistantFee} onChange={(event) => setCathlabAssistantFee(event.target.value)} placeholder="0" />
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Assistant fees raise their bill for approval the moment the schedule is saved — approve it in
              Accounting before the procedure and the invoice is ready to pay against.
            </p>

            {!packageDefaults.isFetching && surgeryName && !packageDefaults.data ? (
              <p className="mt-2 text-xs text-amber-700">
                No matching package master defaults found for this surgery/package.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Date</span>
              <TabletInput type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Time</span>
              <TabletInput type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">OT room</span>
            <select
              value={otRoom}
              onChange={(event) => setOtRoom(event.target.value)}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:ring-2 focus:ring-primary/30"
            >
              {visibleRooms.map((room) => (
                <option key={room} value={room}>{room}</option>
              ))}
            </select>
          </label>

          <TabletButton className="w-full" disabled={saving || !selected} onClick={() => void saveSchedule()}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CalendarClock className="h-5 w-5" />}
            Save OT Schedule
          </TabletButton>
        </TabletCard>
      </div>

      <TabletCard className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">OT status for {formatDateTime(scheduledDate)}</h3>
            <p className="text-sm text-muted-foreground">
              Completed status updates automatically when Sarvesh uploads OT photos or taps Mark OT Done.
            </p>
          </div>
          {dailySchedule.isFetching ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {dailySchedule.isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading OT status...</p>
        ) : dailySchedule.isError ? (
          <p className="py-8 text-center text-destructive">Could not load OT status.</p>
        ) : (dailySchedule.data || []).length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No OT surgeries scheduled for this date.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(dailySchedule.data || []).map((row) => (
              <div key={row.id} className="rounded-xl border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{row.patientName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {row.patientsId || row.visitNumber || "No ID"} · {row.otRoom || "OT"}
                    </p>
                  </div>
                  <ScheduleStatusBadge status={row.status} />
                </div>
                <p className="mt-2 truncate text-sm">{row.surgeryName}</p>
                {row.surgeonName || row.anesthetistName || row.anesthesiaType ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[row.surgeonName, row.anesthetistName, row.anesthesiaType].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {row.scheduledTime || "--:--"}
                </p>
                {row.status === "completed" && (
                  <OtDoctorAmountEditor
                    row={row}
                    bills={(otBills.data || []).filter((bill) => bill.ot_schedule_id === row.id)}
                    onSaved={() => void qc.invalidateQueries({ queryKey: ["ot-doctor-bills"] })}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </TabletCard>
    </FlowScaffold>
  );
}

type LinkedImplantDocCategory = "implant_invoice" | "implant_sticker";

function LinkedImplantDocument({
  label,
  icon,
  docs,
  loading,
  uploading,
  onUploadClick,
  onCaptureClick,
}: {
  label: string;
  icon: ReactNode;
  docs: ReturnType<typeof usePatientDocs>["data"];
  loading: boolean;
  uploading: boolean;
  onUploadClick: () => void;
  onCaptureClick: () => void;
}) {
  const latest = docs?.[0];
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">
              {latest ? `Latest: ${shortDate(latest.uploadedAt)}` : "Required for OT documentation"}
            </p>
          </div>
        </div>
        {loading || uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
      </div>

      {latest ? (
        <a
          href={latest.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-muted/60 px-3 text-sm font-semibold"
        >
          <span className="min-w-0 truncate">{latest.fileName}</span>
          <FileImage className="h-5 w-5 shrink-0" />
        </a>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
          <button
            type="button"
            onClick={onCaptureClick}
            disabled={uploading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
          >
            <Camera className="h-4 w-4" />
            Capture
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A case sometimes changes on the table — a different procedure is done, or
 * the anaesthesia is switched. The OT Photos tile is where the person in the
 * theatre records that, so the schedule (and every bill raised from it)
 * carries what actually happened.
 */
function OnTableChange({
  row,
  onSaved,
}: {
  row: OTScheduleItem;
  onSaved: (surgeryName: string, anesthesiaType: string | null) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [procedure, setProcedure] = useState(row.surgeryName);
  const [anesthesia, setAnesthesia] = useState(row.anesthesiaType || "");
  const [saving, setSaving] = useState(false);

  const changed =
    procedure.trim() !== row.surgeryName.trim()
    || (anesthesia.trim() || null) !== (row.anesthesiaType || null);

  const save = async () => {
    const name = procedure.trim();
    if (!name) {
      toast({ title: "Enter the procedure name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // The field may hold free-text notes from the desktop OT screen —
      // replace only the anaesthesia segment and keep the rest.
      const { data: currentRow, error: fetchError } = await supabase
        .from("ot_schedule")
        .select("special_requirements")
        .eq("id", row.id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      const current = String((currentRow as { special_requirements?: string | null } | null)?.special_requirements || "");
      const freeText = current.replace(/\s*\|?\s*Anesthesia Type:[^|\n]*/gi, "").trim();
      const marker = anesthesia.trim() ? `Anesthesia Type: ${anesthesia.trim()}` : "";
      const { error } = await supabase
        .from("ot_schedule")
        .update({
          surgery_name: name,
          special_requirements: [freeText, marker].filter(Boolean).join(" | ") || null,
        } as never)
        .eq("id", row.id);
      if (error) throw error;
      toast({ title: "On-table change saved", description: `${name}${anesthesia.trim() ? ` · ${anesthesia.trim()}` : ""}` });
      onSaved(name, anesthesia.trim() || null);
      setOpen(false);
    } catch (error) {
      toast({
        title: "Could not save the change",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <TabletButton variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Edit3 className="h-5 w-5" />
        Case changed on the table?
      </TabletButton>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
      <p className="text-sm font-semibold">On-table change</p>
      <div>
        <TabletLabel htmlFor="ot-change-procedure">Procedure done</TabletLabel>
        <TabletInput
          id="ot-change-procedure"
          value={procedure}
          onChange={(event) => setProcedure(event.target.value)}
        />
      </div>
      <div>
        <TabletLabel htmlFor="ot-change-anesthesia">Anesthesia given</TabletLabel>
        <TabletInput
          id="ot-change-anesthesia"
          value={anesthesia}
          onChange={(event) => setAnesthesia(event.target.value)}
          placeholder="GA / SA / LA…"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TabletButton variant="outline" onClick={() => { setProcedure(row.surgeryName); setAnesthesia(row.anesthesiaType || ""); setOpen(false); }}>
          Cancel
        </TabletButton>
        <TabletButton disabled={saving || !changed} onClick={() => void save()}>
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          Save change
        </TabletButton>
      </div>
    </div>
  );
}

function SarveshWorklist() {
  const { user, hospitalConfig } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const chooseRef = useRef<HTMLInputElement>(null);
  const implantBillRef = useRef<HTMLInputElement>(null);
  const implantStickerRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayDate());
  const schedule = useDailySchedule(date);
  const [selected, setSelected] = useState<OTScheduleItem | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [implantCameraCategory, setImplantCameraCategory] = useState<LinkedImplantDocCategory | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingImplantDoc, setUploadingImplantDoc] = useState<LinkedImplantDocCategory | null>(null);
  const docs = usePatientDocs(selected?.patientId || undefined, "ot_photos");
  const implantInvoiceDocs = usePatientDocs(selected?.patientId || undefined, "implant_invoice");
  const implantStickerDocs = usePatientDocs(selected?.patientId || undefined, "implant_sticker");

  const completedCount = useMemo(
    () => (schedule.data || []).filter((row) => row.status === "completed" || row.surgeryDate).length,
    [schedule.data],
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tablet-daily-ot-schedule"] }),
      selected?.patientId ? qc.invalidateQueries({ queryKey: ["tablet-patient-docs", selected.patientId, "ot_photos"] }) : Promise.resolve(),
      selected?.patientId ? qc.invalidateQueries({ queryKey: ["tablet-patient-docs", selected.patientId, "implant_invoice"] }) : Promise.resolve(),
      selected?.patientId ? qc.invalidateQueries({ queryKey: ["tablet-patient-docs", selected.patientId, "implant_sticker"] }) : Promise.resolve(),
    ]);
  };

  const complete = async (row: OTScheduleItem) => {
    setBusyId(row.id);
    try {
      await markScheduleCompleted(row);
      toast({ title: "Surgery marked done", description: `${row.patientName} will appear as operated in billing reports.` });
      await refresh();
    } catch (error) {
      toast({
        title: "Could not mark done",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const uploadOtPhotos = async (items: File[] | CapturedPhotoItem[]) => {
    if (!selected?.patientId) return;
    setBusyId(selected.id);
    try {
      const normalized: CapturedPhotoItem[] = items.map((item) =>
        item instanceof File ? { file: item, geo: null } : item,
      );
      const prepared: PatientDocUploadItem[] = [];
      for (const { file, geo } of normalized) {
        const out = await compressImageToLimit(file, MAX_FILE_BYTES);
        if (out.size <= MAX_FILE_BYTES) {
          prepared.push({
            file: out,
            geo,
            captureSource: geo ? "in_app_camera" : "file_picker",
          });
        }
      }
      if (prepared.length === 0) {
        toast({ title: "No photos uploaded", description: "Selected files were too large.", variant: "destructive" });
        return;
      }
      await uploadPatientDocs(prepared, {
        patientId: selected.patientId,
        patientName: selected.patientName,
        category: "ot_photos",
        uploadedBy: user?.id ?? null,
        placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
      });
      await markScheduleCompleted(selected);
      toast({ title: "OT photos uploaded", description: "Surgery marked done automatically." });
      await refresh();
    } catch (error) {
      toast({
        title: "OT photo upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const uploadImplantDocument = async (category: LinkedImplantDocCategory, items: File[] | CapturedPhotoItem[]) => {
    if (!selected?.patientId) return;
    setUploadingImplantDoc(category);
    try {
      const normalized: CapturedPhotoItem[] = items.map((item) =>
        item instanceof File ? { file: item, geo: null } : item,
      );
      const prepared: PatientDocUploadItem[] = [];
      for (const { file, geo } of normalized) {
        const out = file.type.startsWith("image/") ? await compressImageToLimit(file, MAX_FILE_BYTES) : file;
        if (out.size <= MAX_FILE_BYTES || !file.type.startsWith("image/")) {
          prepared.push({
            file: out,
            geo,
            captureSource: geo ? "in_app_camera" : "file_picker",
          });
        }
      }
      if (prepared.length === 0) {
        toast({ title: "No document uploaded", description: "Selected file was too large.", variant: "destructive" });
        return;
      }
      await uploadPatientDocs(prepared, {
        patientId: selected.patientId,
        patientName: selected.patientName,
        category,
        uploadedBy: user?.id ?? null,
        placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
      });
      toast({
        title: "Document uploaded",
        description: `${category === "implant_invoice" ? "Implant Bill" : "Implant Sticker"} is now visible in OT Photos.`,
      });
      await refresh();
    } catch (error) {
      toast({
        title: "Document upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingImplantDoc(null);
    }
  };

  return (
    <FlowScaffold heading="OT Photos - Sarvesh" subheading="View today’s scheduled surgeries, upload OT photos, and mark surgery done.">
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <TabletCard className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold">OT date</span>
              <TabletInput type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-44" />
            </label>
            <div className="text-sm text-muted-foreground">
              {completedCount} done · {(schedule.data || []).length} scheduled
            </div>
          </TabletCard>

          {schedule.isLoading ? (
            <TabletCard className="py-12 text-center text-muted-foreground">
              <Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />
              Loading OT schedule...
            </TabletCard>
          ) : schedule.isError ? (
            <TabletCard className="py-12 text-center text-destructive">Could not load OT schedule.</TabletCard>
          ) : (schedule.data || []).length === 0 ? (
            <TabletCard className="py-12 text-center text-muted-foreground">No OT surgeries scheduled for this date.</TabletCard>
          ) : (
            <div className="space-y-3">
              {(schedule.data || []).map((row) => (
                <button key={row.id} type="button" onClick={() => setSelected(row)} className="w-full text-left">
                  <TabletCard className={`transition ${selected?.id === row.id ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold">{row.patientName}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {row.patientsId || row.visitNumber || "No ID"} · {row.otRoom || "OT"}
                        </p>
                        <p className="mt-1 truncate text-sm">{row.surgeryName}</p>
                      </div>
                      <div className="text-right">
                        <p className="flex items-center gap-1 text-sm font-semibold">
                          <Clock className="h-4 w-4" />
                          {row.scheduledTime || "--:--"}
                        </p>
                        <div className="mt-2"><ScheduleStatusBadge status={row.status} /></div>
                      </div>
                    </div>
                  </TabletCard>
                </button>
              ))}
            </div>
          )}
        </div>

        <TabletCard className="h-fit space-y-4">
          {!selected ? (
            <div className="py-12 text-center text-muted-foreground">
              Select a scheduled patient to upload OT photos or mark done.
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-lg font-bold">{selected.patientName}</p>
                <p className="text-sm text-muted-foreground">{selected.patientsId || selected.visitNumber || "No ID"}</p>
                <p className="mt-2 text-sm">{selected.surgeryName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDateTime(selected.scheduledDate, selected.scheduledTime)} · {selected.otRoom || "OT"}
                </p>
              </div>

              <OnTableChange
                key={selected.id}
                row={selected}
                onSaved={(surgeryName, anesthesiaType) => {
                  setSelected((prev) =>
                    prev && prev.id === selected.id ? { ...prev, surgeryName, anesthesiaType } : prev,
                  );
                  void refresh();
                }}
              />

              <div className="grid grid-cols-2 gap-3">
                <TabletButton
                  className="w-full"
                  disabled={busyId === selected.id || selected.status === "completed"}
                  onClick={() => void complete(selected)}
                >
                  {busyId === selected.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  Mark Done
                </TabletButton>
                <TabletButton
                  variant="outline"
                  className="w-full"
                  disabled={busyId === selected.id}
                  onClick={() => setCameraOpen(true)}
                >
                  <Camera className="h-5 w-5" />
                  Take Photos
                </TabletButton>
              </div>

              <input
                ref={chooseRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void uploadOtPhotos(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <TabletButton
                variant="outline"
                className="w-full"
                disabled={busyId === selected.id}
                onClick={() => chooseRef.current?.click()}
              >
                <Upload className="h-5 w-5" />
                Upload OT Photos
              </TabletButton>

              <div>
                <p className="mb-2 text-sm font-semibold">Implant documents linked from Implant tab</p>
                <div className="space-y-3">
                  <LinkedImplantDocument
                    label="Implant Bill"
                    icon={<Receipt className="h-5 w-5" />}
                    docs={implantInvoiceDocs.data}
                    loading={implantInvoiceDocs.isLoading}
                    uploading={uploadingImplantDoc === "implant_invoice"}
                    onUploadClick={() => implantBillRef.current?.click()}
                    onCaptureClick={() => setImplantCameraCategory("implant_invoice")}
                  />
                  <LinkedImplantDocument
                    label="Implant Sticker"
                    icon={<ScanLine className="h-5 w-5" />}
                    docs={implantStickerDocs.data}
                    loading={implantStickerDocs.isLoading}
                    uploading={uploadingImplantDoc === "implant_sticker"}
                    onUploadClick={() => implantStickerRef.current?.click()}
                    onCaptureClick={() => setImplantCameraCategory("implant_sticker")}
                  />
                </div>
              </div>

              <input
                ref={implantBillRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(event) => {
                  void uploadImplantDocument("implant_invoice", Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <input
                ref={implantStickerRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(event) => {
                  void uploadImplantDocument("implant_sticker", Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />

              <MultiShotCamera
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(photos) => void uploadOtPhotos(photos)}
              />
              <MultiShotCamera
                open={Boolean(implantCameraCategory)}
                onClose={() => setImplantCameraCategory(null)}
                onCapture={(photos) => {
                  if (implantCameraCategory) void uploadImplantDocument(implantCameraCategory, photos);
                  setImplantCameraCategory(null);
                }}
              />

              <div>
                <p className="mb-2 text-sm font-semibold">Uploaded OT photos</p>
                {docs.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading photos...</p>
                ) : (docs.data || []).length === 0 ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No OT photos uploaded yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {(docs.data || []).slice(0, 6).map((doc) => (
                      <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border bg-muted">
                        <img src={doc.fileUrl} alt={doc.fileName} className="h-24 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabletCard>
      </div>
    </FlowScaffold>
  );
}

export default function OtScheduleFlow() {
  const { moduleId } = useParams();
  return moduleId === "ot-photos-sarvesh" ? <SarveshWorklist /> : <GauravScheduler />;
}
