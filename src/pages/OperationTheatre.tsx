import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Icons
import {
  Calendar,
  Clock,
  Search,
  Plus,
  Printer,
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Stethoscope,
  ClipboardList,
  BarChart3,
  Package,
  Filter,
  Save,
  FileText,
  Wrench,
  TrendingUp,
} from "lucide-react";

// Charts
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
} from "recharts";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface OTScheduleRow {
  id: string;
  visit_id: string | null;
  patient_id: string | null;
  surgery_name: string;
  surgeon_id: string | null;
  surgeon_name: string | null;
  anesthetist_id: string | null;
  anesthetist_name: string | null;
  ot_room: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  estimated_duration_min: number | null;
  urgency: string;
  status: string;
  pre_op_checklist: Record<string, boolean> | null;
  special_requirements: string | null;
  notes: string | null;
  cancelled_reason: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  created_at: string;
  updated_at: string;
}

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string;
  uhid?: string;
}

interface StaffRow {
  id: string;
  name: string;
  role: string;
  department?: string;
}

interface OTRoom {
  id: string;
  name: string;
  status?: string;
}

interface SurgeryType {
  id: string;
  name: string;
  department?: string;
}

interface EquipmentRow {
  id: string;
  name: string;
  category_id: string | null;
  status: string;
  serial_number?: string;
  quantity?: number;
  last_sterilized?: string;
  next_maintenance?: string;
  notes?: string;
  location?: string;
}

interface EquipmentCategoryRow {
  id: string;
  name: string;
}

interface OTNoteRow {
  id: string;
  schedule_id?: string;
  patient_id?: string;
  surgeon_id?: string;
  diagnosis?: string;
  planned_procedure?: string;
  asa_grade?: string;
  anesthesia_type?: string;
  incision_time?: string;
  procedure_details?: string;
  blood_loss?: string;
  implants_used?: string;
  complications?: string;
  recovery_status?: string;
  post_op_instructions?: string;
  shift_to?: string;
  created_at?: string;
}

interface OTNoteTemplate {
  id: string;
  name: string;
  content: Record<string, string> | null;
}

// Pre-op checklist keys
const PRE_OP_CHECKLIST_ITEMS = [
  { key: "consent", label: "Consent Signed" },
  { key: "blood_group", label: "Blood Group Verified" },
  { key: "investigations", label: "Investigations Complete" },
  { key: "npo_status", label: "NPO Status Confirmed" },
  { key: "allergy_check", label: "Allergy Check Done" },
];

// Status pipeline order
const STATUS_PIPELINE: string[] = [
  "scheduled",
  "pre_op",
  "in_surgery",
  "post_op",
  "completed",
];

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  pre_op: "Pre-Op",
  in_surgery: "In Surgery",
  post_op: "Post-Op",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  pre_op: "bg-yellow-100 text-yellow-800 border-yellow-300",
  in_surgery: "bg-orange-100 text-orange-800 border-orange-300",
  post_op: "bg-purple-100 text-purple-800 border-purple-300",
  completed: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-red-100 text-red-800 border-red-300",
};

const URGENCY_COLORS: Record<string, string> = {
  elective: "bg-blue-100 text-blue-700 border-blue-300",
  emergency: "bg-red-100 text-red-700 border-red-300",
  day_care: "bg-green-100 text-green-700 border-green-300",
};

const EQUIPMENT_STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  in_use: "bg-yellow-100 text-yellow-800",
  under_maintenance: "bg-orange-100 text-orange-800",
  condemned: "bg-red-100 text-red-800",
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

// ---------------------------------------------------------------------------
// Loading skeleton component
// ---------------------------------------------------------------------------

const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />
    ))}
  </div>
);

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

const OperationTheatre: React.FC = () => {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "schedule";
  const setActiveTab = (tab: string) => setSearchParams({ tab });

  // -------------------------------------------------------------------------
  // Tab 1: Schedule / Dashboard state
  // -------------------------------------------------------------------------
  const [scheduleDate, setScheduleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [scheduleFilterRoom, setScheduleFilterRoom] = useState("all");
  const [scheduleFilterStatus, setScheduleFilterStatus] = useState("all");
  const [scheduleData, setScheduleData] = useState<OTScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [otRooms, setOtRooms] = useState<OTRoom[]>([]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Tab 2: Scheduling Form state
  // -------------------------------------------------------------------------
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientRow[]>([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [surgeryTypes, setSurgeryTypes] = useState<SurgeryType[]>([]);
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    surgery_name: "",
    surgeon_id: "",
    anesthetist_id: "",
    ot_room: "",
    scheduled_date: format(new Date(), "yyyy-MM-dd"),
    scheduled_time: "09:00",
    estimated_duration_min: 60,
    urgency: "elective",
    special_requirements: "",
    pre_op_checklist: {
      consent: false,
      blood_group: false,
      investigations: false,
      npo_status: false,
      allergy_check: false,
    } as Record<string, boolean>,
  });

  // -------------------------------------------------------------------------
  // Tab 3: OT Notes state
  // -------------------------------------------------------------------------
  const [notesScheduleList, setNotesScheduleList] = useState<OTScheduleRow[]>([]);
  const [selectedNoteScheduleId, setSelectedNoteScheduleId] = useState("");
  const [noteTemplates, setNoteTemplates] = useState<OTNoteTemplate[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [noteForm, setNoteForm] = useState({
    diagnosis: "",
    planned_procedure: "",
    asa_grade: "",
    anesthesia_type: "",
    incision_time: "",
    procedure_details: "",
    blood_loss: "",
    implants_used: "",
    complications: "",
    recovery_status: "",
    post_op_instructions: "",
    shift_to: "",
  });

  // -------------------------------------------------------------------------
  // Tab 4: Equipment / Inventory state
  // -------------------------------------------------------------------------
  const [equipmentList, setEquipmentList] = useState<EquipmentRow[]>([]);
  const [equipmentCategories, setEquipmentCategories] = useState<EquipmentCategoryRow[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentFilterStatus, setEquipmentFilterStatus] = useState("all");
  const [equipmentFilterCategory, setEquipmentFilterCategory] = useState("all");
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentRow | null>(null);
  const [equipmentForm, setEquipmentForm] = useState({
    name: "",
    category_id: "",
    status: "available",
    serial_number: "",
    quantity: 1,
    notes: "",
    location: "",
  });

  // -------------------------------------------------------------------------
  // Tab 5: Analytics state
  // -------------------------------------------------------------------------
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [surgeriesPerDay, setSurgeriesPerDay] = useState<{ date: string; count: number }[]>([]);
  const [otUtilization, setOtUtilization] = useState<{ name: string; value: number }[]>([]);
  const [surgeonCounts, setSurgeonCounts] = useState<{ name: string; count: number }[]>([]);
  const [cancellationRate, setCancellationRate] = useState({ total: 0, cancelled: 0, rate: 0 });
  const [emergencyVsElective, setEmergencyVsElective] = useState<{ name: string; value: number }[]>([]);
  const [avgDurationByType, setAvgDurationByType] = useState<{ name: string; avg: number }[]>([]);

  // =========================================================================
  // DATA FETCHING
  // =========================================================================

  /** Fetch OT rooms (shared across tabs) */
  const fetchOTRooms = useCallback(async () => {
    const { data, error } = await supabase.from("operation_theatres").select("*");
    if (!error && data) {
      setOtRooms(data.map((r: any) => ({ id: r.id, name: r.name || r.room_name || `OT ${r.id}`, status: r.status })));
    }
  }, []);

  /** Fetch staff members (shared across tabs) */
  const fetchStaff = useCallback(async () => {
    const { data, error } = await supabase.from("staff_members").select("*");
    if (!error && data) {
      setStaffList(data.map((s: any) => ({ id: s.id, name: s.name, role: s.role, department: s.department })));
    }
  }, []);

  /** Fetch surgery types */
  const fetchSurgeryTypes = useCallback(async () => {
    const { data, error } = await supabase.from("surgical_treatments").select("*");
    if (!error && data) {
      setSurgeryTypes(data.map((s: any) => ({ id: s.id, name: s.name, department: s.department })));
    }
  }, []);

  // -- Tab 1: Schedule data --
  const fetchSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      let query = supabase.from("ot_schedule").select("*").eq("scheduled_date", scheduleDate);
      if (scheduleFilterRoom !== "all") {
        query = query.eq("ot_room", scheduleFilterRoom);
      }
      if (scheduleFilterStatus !== "all") {
        query = query.eq("status", scheduleFilterStatus);
      }
      const { data, error } = await query.order("scheduled_time", { ascending: true });
      if (error) {
        toast({ title: "Error loading schedule", description: error.message, variant: "destructive" });
      } else {
        // Enrich with patient names if patient_id is present
        const rows = (data || []) as any[];
        const patientIds = rows.filter((r) => r.patient_id).map((r) => r.patient_id);
        let patientMap: Record<string, string> = {};
        if (patientIds.length > 0) {
          const { data: pData } = await supabase
            .from("patients")
            .select("id, first_name, last_name")
            .in("id", patientIds);
          if (pData) {
            pData.forEach((p: any) => {
              patientMap[p.id] = `${p.first_name || ""} ${p.last_name || ""}`.trim();
            });
          }
        }
        const enriched: OTScheduleRow[] = rows.map((r) => ({
          ...r,
          _patient_name: r.patient_id ? patientMap[r.patient_id] || "Unknown" : "N/A",
        }));
        setScheduleData(enriched as any);
      }
    } finally {
      setScheduleLoading(false);
    }
  }, [scheduleDate, scheduleFilterRoom, scheduleFilterStatus, toast]);

  // -- Tab 3: Notes schedule list --
  const fetchNotesScheduleList = useCallback(async () => {
    setNotesLoading(true);
    try {
      const { data, error } = await supabase
        .from("ot_schedule")
        .select("*")
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: false })
        .limit(100);
      if (!error && data) {
        setNotesScheduleList(data as any[]);
      }
    } finally {
      setNotesLoading(false);
    }
  }, []);

  const fetchNoteTemplates = useCallback(async () => {
    const { data, error } = await supabase.from("ot_notes_templates").select("*");
    if (!error && data) {
      setNoteTemplates(data as any[]);
    }
  }, []);

  // -- Tab 4: Equipment --
  const fetchEquipment = useCallback(async () => {
    setEquipmentLoading(true);
    try {
      const { data, error } = await supabase.from("equipment").select("*");
      if (!error && data) {
        setEquipmentList(data as any[]);
      }
      const { data: catData } = await supabase.from("equipment_categories").select("*");
      if (catData) {
        setEquipmentCategories(catData as any[]);
      }
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  // -- Tab 5: Analytics --
  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
      const today = format(new Date(), "yyyy-MM-dd");

      // Fetch all schedules in last 30 days for analytics
      const { data: allSchedules } = await supabase
        .from("ot_schedule")
        .select("*")
        .gte("scheduled_date", thirtyDaysAgo)
        .lte("scheduled_date", today);

      const schedules = (allSchedules || []) as any[];

      // 1) Surgeries per day (last 14 days)
      const fourteenDaysAgo = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const dailyCounts: Record<string, number> = {};
      schedules.forEach((s) => {
        if (s.scheduled_date >= fourteenDaysAgo && s.status !== "cancelled") {
          const d = s.scheduled_date;
          dailyCounts[d] = (dailyCounts[d] || 0) + 1;
        }
      });
      const dailyData = Object.entries(dailyCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date: format(new Date(date + "T00:00:00"), "dd MMM"), count }));
      setSurgeriesPerDay(dailyData);

      // 2) OT utilization (completed vs available hours)
      const completedCount = schedules.filter((s) => s.status === "completed").length;
      const inProgressCount = schedules.filter((s) => ["in_surgery", "pre_op", "post_op"].includes(s.status)).length;
      const scheduledCount = schedules.filter((s) => s.status === "scheduled").length;
      setOtUtilization([
        { name: "Completed", value: completedCount },
        { name: "In Progress", value: inProgressCount },
        { name: "Scheduled", value: scheduledCount },
      ]);

      // 3) Surgeon-wise count
      const surgeonMap: Record<string, number> = {};
      schedules.forEach((s) => {
        if (s.surgeon_name && s.status !== "cancelled") {
          surgeonMap[s.surgeon_name] = (surgeonMap[s.surgeon_name] || 0) + 1;
        }
      });
      const surgeonData = Object.entries(surgeonMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      setSurgeonCounts(surgeonData);

      // 4) Cancellation rate
      const totalScheduled = schedules.length;
      const cancelledCount = schedules.filter((s) => s.status === "cancelled").length;
      setCancellationRate({
        total: totalScheduled,
        cancelled: cancelledCount,
        rate: totalScheduled > 0 ? Math.round((cancelledCount / totalScheduled) * 100) : 0,
      });

      // 5) Emergency vs Elective
      const urgencyMap: Record<string, number> = {};
      schedules
        .filter((s) => s.status !== "cancelled")
        .forEach((s) => {
          const label = s.urgency === "emergency" ? "Emergency" : s.urgency === "day_care" ? "Day Care" : "Elective";
          urgencyMap[label] = (urgencyMap[label] || 0) + 1;
        });
      setEmergencyVsElective(Object.entries(urgencyMap).map(([name, value]) => ({ name, value })));

      // 6) Average duration by surgery type
      const durationMap: Record<string, { total: number; count: number }> = {};
      schedules
        .filter((s) => s.status === "completed" && s.actual_start_time && s.actual_end_time)
        .forEach((s) => {
          const start = new Date(s.actual_start_time).getTime();
          const end = new Date(s.actual_end_time).getTime();
          const durationMin = (end - start) / 60000;
          if (durationMin > 0 && durationMin < 1440) {
            const name = s.surgery_name || "Unknown";
            if (!durationMap[name]) durationMap[name] = { total: 0, count: 0 };
            durationMap[name].total += durationMin;
            durationMap[name].count += 1;
          }
        });
      const avgData = Object.entries(durationMap)
        .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count) }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 10);
      setAvgDurationByType(avgData);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // =========================================================================
  // Initial data load based on active tab
  // =========================================================================

  useEffect(() => {
    fetchOTRooms();
    fetchStaff();
  }, [fetchOTRooms, fetchStaff]);

  useEffect(() => {
    if (activeTab === "schedule") {
      fetchSchedule();
    }
  }, [activeTab, fetchSchedule]);

  useEffect(() => {
    if (activeTab === "book") {
      fetchSurgeryTypes();
    }
  }, [activeTab, fetchSurgeryTypes]);

  useEffect(() => {
    if (activeTab === "notes") {
      fetchNotesScheduleList();
      fetchNoteTemplates();
    }
  }, [activeTab, fetchNotesScheduleList, fetchNoteTemplates]);

  useEffect(() => {
    if (activeTab === "equipment") {
      fetchEquipment();
    }
  }, [activeTab, fetchEquipment]);

  useEffect(() => {
    if (activeTab === "analytics") {
      fetchAnalytics();
    }
  }, [activeTab, fetchAnalytics]);

  // =========================================================================
  // Patient search debounce (Tab 2)
  // =========================================================================

  useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const searchTerm = `%${patientSearch}%`;
        const { data, error } = await supabase
          .from("patients")
          .select("id, first_name, last_name, phone, uhid")
          .or(`first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},uhid.ilike.${searchTerm}`)
          .limit(10);
        if (!error && data) {
          setPatientResults(data as any[]);
        }
      } finally {
        setPatientSearchLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  // =========================================================================
  // ACTIONS
  // =========================================================================

  /** Update surgery status in pipeline */
  const handleStatusUpdate = async (id: string, newStatus: string) => {
    if (newStatus === "cancelled") {
      setCancellingId(id);
      setCancelDialogOpen(true);
      return;
    }

    const updatePayload: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "in_surgery") {
      updatePayload.actual_start_time = new Date().toISOString();
    }
    if (newStatus === "completed") {
      updatePayload.actual_end_time = new Date().toISOString();
    }

    const { error } = await supabase.from("ot_schedule").update(updatePayload as any).eq("id", id);
    if (error) {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Status updated", description: `Surgery moved to ${STATUS_LABELS[newStatus]}` });
      fetchSchedule();
    }
  };

  /** Cancel with reason */
  const handleCancelConfirm = async () => {
    if (!cancellingId) return;
    const { error } = await supabase
      .from("ot_schedule")
      .update({ status: "cancelled", cancelled_reason: cancelReason, updated_at: new Date().toISOString() } as any)
      .eq("id", cancellingId);
    if (error) {
      toast({ title: "Error cancelling", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Surgery cancelled", description: "The surgery has been cancelled." });
      fetchSchedule();
    }
    setCancelDialogOpen(false);
    setCancelReason("");
    setCancellingId(null);
  };

  /** Save new schedule (Tab 2) */
  const handleSaveSchedule = async () => {
    if (!selectedPatient) {
      toast({ title: "Missing patient", description: "Please select a patient.", variant: "destructive" });
      return;
    }
    if (!scheduleForm.surgery_name) {
      toast({ title: "Missing surgery", description: "Please select a surgery type.", variant: "destructive" });
      return;
    }

    setFormSaving(true);
    try {
      // Find surgeon and anesthetist names
      const surgeon = staffList.find((s) => s.id === scheduleForm.surgeon_id);
      const anesthetist = staffList.find((s) => s.id === scheduleForm.anesthetist_id);

      const insertPayload = {
        patient_id: selectedPatient.id,
        surgery_name: scheduleForm.surgery_name,
        surgeon_id: scheduleForm.surgeon_id || null,
        surgeon_name: surgeon?.name || null,
        anesthetist_id: scheduleForm.anesthetist_id || null,
        anesthetist_name: anesthetist?.name || null,
        ot_room: scheduleForm.ot_room || null,
        scheduled_date: scheduleForm.scheduled_date,
        scheduled_time: scheduleForm.scheduled_time,
        estimated_duration_min: scheduleForm.estimated_duration_min,
        urgency: scheduleForm.urgency,
        status: "scheduled",
        pre_op_checklist: scheduleForm.pre_op_checklist,
        special_requirements: scheduleForm.special_requirements || null,
      };

      const { error } = await supabase.from("ot_schedule").insert(insertPayload as any);
      if (error) {
        toast({ title: "Error saving schedule", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Surgery scheduled", description: "The surgery has been added to the OT schedule." });
        // Reset form
        setSelectedPatient(null);
        setPatientSearch("");
        setScheduleForm({
          surgery_name: "",
          surgeon_id: "",
          anesthetist_id: "",
          ot_room: "",
          scheduled_date: format(new Date(), "yyyy-MM-dd"),
          scheduled_time: "09:00",
          estimated_duration_min: 60,
          urgency: "elective",
          special_requirements: "",
          pre_op_checklist: {
            consent: false,
            blood_group: false,
            investigations: false,
            npo_status: false,
            allergy_check: false,
          },
        });
      }
    } finally {
      setFormSaving(false);
    }
  };

  /** Save OT Notes (Tab 3) */
  const handleSaveNote = async () => {
    if (!selectedNoteScheduleId) {
      toast({ title: "Missing surgery", description: "Please select a surgery first.", variant: "destructive" });
      return;
    }

    setNotesSaving(true);
    try {
      const selectedSchedule = notesScheduleList.find((s) => s.id === selectedNoteScheduleId);
      const insertPayload = {
        schedule_id: selectedNoteScheduleId,
        patient_id: selectedSchedule?.patient_id || null,
        surgeon_id: selectedSchedule?.surgeon_id || null,
        diagnosis: noteForm.diagnosis || null,
        planned_procedure: noteForm.planned_procedure || null,
        asa_grade: noteForm.asa_grade || null,
        anesthesia_type: noteForm.anesthesia_type || null,
        incision_time: noteForm.incision_time || null,
        procedure_details: noteForm.procedure_details || null,
        blood_loss: noteForm.blood_loss || null,
        implants_used: noteForm.implants_used || null,
        complications: noteForm.complications || null,
        recovery_status: noteForm.recovery_status || null,
        post_op_instructions: noteForm.post_op_instructions || null,
        shift_to: noteForm.shift_to || null,
      };

      const { error } = await supabase.from("ot_notes").insert(insertPayload as any);
      if (error) {
        toast({ title: "Error saving notes", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "OT Notes saved", description: "Surgical notes have been recorded." });
      }
    } finally {
      setNotesSaving(false);
    }
  };

  /** Load note template */
  const handleLoadTemplate = (templateId: string) => {
    const template = noteTemplates.find((t) => t.id === templateId);
    if (template && template.content) {
      const content = template.content as Record<string, string>;
      setNoteForm((prev) => ({
        ...prev,
        diagnosis: content.diagnosis || prev.diagnosis,
        planned_procedure: content.planned_procedure || prev.planned_procedure,
        asa_grade: content.asa_grade || prev.asa_grade,
        anesthesia_type: content.anesthesia_type || prev.anesthesia_type,
        procedure_details: content.procedure_details || prev.procedure_details,
        post_op_instructions: content.post_op_instructions || prev.post_op_instructions,
        shift_to: content.shift_to || prev.shift_to,
      }));
      toast({ title: "Template loaded", description: `Applied template: ${template.name}` });
    }
  };

  /** Print OT notes */
  const handlePrintNotes = () => {
    window.print();
  };

  /** Save or update equipment (Tab 4) */
  const handleSaveEquipment = async () => {
    if (!equipmentForm.name) {
      toast({ title: "Missing name", description: "Equipment name is required.", variant: "destructive" });
      return;
    }

    const payload = {
      name: equipmentForm.name,
      category_id: equipmentForm.category_id || null,
      status: equipmentForm.status,
      serial_number: equipmentForm.serial_number || null,
      quantity: equipmentForm.quantity,
      notes: equipmentForm.notes || null,
      location: equipmentForm.location || null,
    };

    if (editingEquipment) {
      const { error } = await supabase.from("equipment").update(payload as any).eq("id", editingEquipment.id);
      if (error) {
        toast({ title: "Error updating equipment", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Equipment updated" });
        fetchEquipment();
      }
    } else {
      const { error } = await supabase.from("equipment").insert(payload as any);
      if (error) {
        toast({ title: "Error adding equipment", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Equipment added" });
        fetchEquipment();
      }
    }
    setEquipmentDialogOpen(false);
    setEditingEquipment(null);
    setEquipmentForm({ name: "", category_id: "", status: "available", serial_number: "", quantity: 1, notes: "", location: "" });
  };

  const openEditEquipment = (eq: EquipmentRow) => {
    setEditingEquipment(eq);
    setEquipmentForm({
      name: eq.name || "",
      category_id: eq.category_id || "",
      status: eq.status || "available",
      serial_number: eq.serial_number || "",
      quantity: eq.quantity || 1,
      notes: eq.notes || "",
      location: eq.location || "",
    });
    setEquipmentDialogOpen(true);
  };

  const openAddEquipment = () => {
    setEditingEquipment(null);
    setEquipmentForm({ name: "", category_id: "", status: "available", serial_number: "", quantity: 1, notes: "", location: "" });
    setEquipmentDialogOpen(true);
  };

  // =========================================================================
  // Computed data
  // =========================================================================

  // Schedule quick stats
  const statsTotal = scheduleData.length;
  const statsInProgress = scheduleData.filter((s) => ["in_surgery", "pre_op", "post_op"].includes(s.status)).length;
  const statsCompleted = scheduleData.filter((s) => s.status === "completed").length;
  const statsCancelled = scheduleData.filter((s) => s.status === "cancelled").length;

  // Equipment filtered
  const filteredEquipment = equipmentList.filter((eq) => {
    if (equipmentFilterStatus !== "all" && eq.status !== equipmentFilterStatus) return false;
    if (equipmentFilterCategory !== "all" && eq.category_id !== equipmentFilterCategory) return false;
    return true;
  });

  // Low stock equipment (quantity <= 2)
  const lowStockEquipment = equipmentList.filter((eq) => eq.quantity != null && eq.quantity <= 2);

  // Category name lookup
  const categoryNameMap: Record<string, string> = {};
  equipmentCategories.forEach((c) => {
    categoryNameMap[c.id] = c.name;
  });

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="h-full flex flex-col p-4 sm:p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Operation Theatre Management</h1>
        <p className="text-gray-500 mt-1">
          Schedule surgeries, track OT workflow, manage equipment, and view analytics
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="grid w-full grid-cols-5 mb-4">
          <TabsTrigger value="schedule" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Schedule</span>
          </TabsTrigger>
          <TabsTrigger value="book" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Book Surgery</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">OT Notes</span>
          </TabsTrigger>
          <TabsTrigger value="equipment" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Equipment</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================= */}
        {/* TAB 1: OT Schedule / Dashboard                                     */}
        {/* ================================================================= */}
        <TabsContent value="schedule" className="space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card onClick={() => setScheduleFilterStatus("all")} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Scheduled</p>
                  <p className="text-2xl font-bold">{statsTotal}</p>
                </div>
              </CardContent>
            </Card>
            <Card onClick={() => setScheduleFilterStatus("in_surgery")} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Activity className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">In Progress</p>
                  <p className="text-2xl font-bold">{statsInProgress}</p>
                </div>
              </CardContent>
            </Card>
            <Card onClick={() => setScheduleFilterStatus("completed")} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Completed</p>
                  <p className="text-2xl font-bold">{statsCompleted}</p>
                </div>
              </CardContent>
            </Card>
            <Card onClick={() => setScheduleFilterStatus("cancelled")} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Cancelled</p>
                  <p className="text-2xl font-bold">{statsCancelled}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Filters:</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="schedule-date" className="text-sm">Date</Label>
                  <Input
                    id="schedule-date"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">OT Room</Label>
                  <Select value={scheduleFilterRoom} onValueChange={setScheduleFilterRoom}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Rooms</SelectItem>
                      {otRooms.map((r) => (
                        <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Status</Label>
                  <Select value={scheduleFilterStatus} onValueChange={setScheduleFilterStatus}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={fetchSchedule}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Schedule table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Today's OT Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {scheduleLoading ? (
                <LoadingSkeleton rows={6} />
              ) : scheduleData.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-lg font-medium">No surgeries scheduled</p>
                  <p className="text-sm">No OT entries found for the selected filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead>
                        <TableHead>Surgery</TableHead>
                        <TableHead>Surgeon</TableHead>
                        <TableHead>Anesthetist</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>OT Room</TableHead>
                        <TableHead>Urgency</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheduleData.map((row) => {
                        const currentIndex = STATUS_PIPELINE.indexOf(row.status);
                        const canAdvance = currentIndex >= 0 && currentIndex < STATUS_PIPELINE.length - 1;
                        const nextStatus = canAdvance ? STATUS_PIPELINE[currentIndex + 1] : null;

                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {(row as any)._patient_name || "N/A"}
                            </TableCell>
                            <TableCell>{row.surgery_name}</TableCell>
                            <TableCell>{row.surgeon_name || "-"}</TableCell>
                            <TableCell>{row.anesthetist_name || "-"}</TableCell>
                            <TableCell>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3 text-gray-400" />
                                {row.scheduled_time || "-"}
                              </span>
                            </TableCell>
                            <TableCell>{row.ot_room || "-"}</TableCell>
                            <TableCell>
                              <Badge className={`${URGENCY_COLORS[row.urgency] || "bg-gray-100 text-gray-700"} border text-xs`}>
                                {row.urgency === "day_care" ? "Day Care" : row.urgency?.charAt(0).toUpperCase() + row.urgency?.slice(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {/* Status pipeline: clickable badges */}
                              <div className="flex items-center gap-1 flex-wrap">
                                {STATUS_PIPELINE.map((st, idx) => {
                                  const isActive = row.status === st;
                                  const isPast = currentIndex >= 0 && idx < currentIndex;
                                  const isFuture = currentIndex >= 0 && idx > currentIndex;
                                  return (
                                    <button
                                      key={st}
                                      onClick={() => {
                                        if (row.status !== "cancelled" && row.status !== "completed") {
                                          handleStatusUpdate(row.id, st);
                                        }
                                      }}
                                      disabled={row.status === "cancelled" || row.status === "completed"}
                                      className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-all cursor-pointer disabled:cursor-not-allowed
                                        ${isActive ? STATUS_COLORS[st] + " font-bold ring-2 ring-offset-1 ring-blue-400" : ""}
                                        ${isPast ? "bg-gray-100 text-gray-400 border-gray-200" : ""}
                                        ${isFuture ? "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100" : ""}
                                      `}
                                      title={`Move to ${STATUS_LABELS[st]}`}
                                    >
                                      {STATUS_LABELS[st]}
                                    </button>
                                  );
                                })}
                                {row.status === "cancelled" && (
                                  <Badge className="bg-red-100 text-red-700 border border-red-300 text-[10px]">Cancelled</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {nextStatus && row.status !== "cancelled" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-7"
                                    onClick={() => handleStatusUpdate(row.id, nextStatus)}
                                  >
                                    Next
                                  </Button>
                                )}
                                {row.status !== "cancelled" && row.status !== "completed" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-7 text-red-600 hover:text-red-700"
                                    onClick={() => handleStatusUpdate(row.id, "cancelled")}
                                  >
                                    Cancel
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cancel dialog */}
          <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel Surgery</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Label>Reason for cancellation</Label>
                <Textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancellation..."
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
                  Go Back
                </Button>
                <Button variant="destructive" onClick={handleCancelConfirm}>
                  Confirm Cancellation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ================================================================= */}
        {/* TAB 2: OT Scheduling Form                                          */}
        {/* ================================================================= */}
        <TabsContent value="book" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-blue-600" />
                Schedule New Surgery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Patient search */}
              <div className="space-y-2">
                <Label className="font-semibold">Patient *</Label>
                {selectedPatient ? (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <p className="font-medium">{selectedPatient.first_name} {selectedPatient.last_name}</p>
                      <p className="text-sm text-gray-500">
                        {selectedPatient.uhid ? `UHID: ${selectedPatient.uhid}` : ""}{" "}
                        {selectedPatient.phone ? `| Phone: ${selectedPatient.phone}` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedPatient(null); setPatientSearch(""); }}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search patient by name or UHID..."
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-10"
                    />
                    {patientSearchLoading && (
                      <div className="absolute right-3 top-2.5">
                        <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />
                      </div>
                    )}
                    {patientResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                            onClick={() => {
                              setSelectedPatient(p);
                              setPatientResults([]);
                              setPatientSearch("");
                            }}
                          >
                            <p className="font-medium text-sm">{p.first_name} {p.last_name}</p>
                            <p className="text-xs text-gray-500">
                              {p.uhid ? `UHID: ${p.uhid}` : ""}{p.phone ? ` | ${p.phone}` : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Surgery type */}
                <div className="space-y-2">
                  <Label className="font-semibold">Surgery Type *</Label>
                  <Select
                    value={scheduleForm.surgery_name}
                    onValueChange={(v) => setScheduleForm((f) => ({ ...f, surgery_name: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select surgery type" />
                    </SelectTrigger>
                    <SelectContent>
                      {surgeryTypes.map((s) => (
                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Surgeon */}
                <div className="space-y-2">
                  <Label className="font-semibold">Surgeon</Label>
                  <Select
                    value={scheduleForm.surgeon_id}
                    onValueChange={(v) => setScheduleForm((f) => ({ ...f, surgeon_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select surgeon" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffList
                        .filter((s) => s.role?.toLowerCase().includes("surgeon") || s.role?.toLowerCase().includes("doctor"))
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      {/* Show all staff if no surgeon-role matches */}
                      {staffList.filter((s) => s.role?.toLowerCase().includes("surgeon") || s.role?.toLowerCase().includes("doctor")).length === 0 &&
                        staffList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({s.role})</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Anesthetist */}
                <div className="space-y-2">
                  <Label className="font-semibold">Anesthetist</Label>
                  <Select
                    value={scheduleForm.anesthetist_id}
                    onValueChange={(v) => setScheduleForm((f) => ({ ...f, anesthetist_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select anesthetist" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffList
                        .filter((s) => s.role?.toLowerCase().includes("anest") || s.role?.toLowerCase().includes("anaest"))
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      {staffList.filter((s) => s.role?.toLowerCase().includes("anest") || s.role?.toLowerCase().includes("anaest")).length === 0 &&
                        staffList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({s.role})</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* OT Room */}
                <div className="space-y-2">
                  <Label className="font-semibold">OT Room</Label>
                  <Select
                    value={scheduleForm.ot_room}
                    onValueChange={(v) => setScheduleForm((f) => ({ ...f, ot_room: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select OT room" />
                    </SelectTrigger>
                    <SelectContent>
                      {otRooms.map((r) => (
                        <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date */}
                <div className="space-y-2">
                  <Label className="font-semibold">Scheduled Date *</Label>
                  <Input
                    type="date"
                    value={scheduleForm.scheduled_date}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, scheduled_date: e.target.value }))}
                  />
                </div>

                {/* Time */}
                <div className="space-y-2">
                  <Label className="font-semibold">Scheduled Time *</Label>
                  <Input
                    type="time"
                    value={scheduleForm.scheduled_time}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, scheduled_time: e.target.value }))}
                  />
                </div>

                {/* Estimated duration */}
                <div className="space-y-2">
                  <Label className="font-semibold">Estimated Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={scheduleForm.estimated_duration_min}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, estimated_duration_min: parseInt(e.target.value) || 60 }))}
                  />
                </div>

                {/* Urgency */}
                <div className="space-y-2">
                  <Label className="font-semibold">Urgency</Label>
                  <Select
                    value={scheduleForm.urgency}
                    onValueChange={(v) => setScheduleForm((f) => ({ ...f, urgency: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elective">Elective</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                      <SelectItem value="day_care">Day Care</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Pre-op checklist */}
              <div className="space-y-3">
                <Label className="font-semibold">Pre-Op Checklist</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-gray-50 rounded-lg border">
                  {PRE_OP_CHECKLIST_ITEMS.map((item) => (
                    <div key={item.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`checklist-${item.key}`}
                        checked={scheduleForm.pre_op_checklist[item.key] || false}
                        onCheckedChange={(checked) =>
                          setScheduleForm((f) => ({
                            ...f,
                            pre_op_checklist: { ...f.pre_op_checklist, [item.key]: !!checked },
                          }))
                        }
                      />
                      <Label htmlFor={`checklist-${item.key}`} className="text-sm cursor-pointer">
                        {item.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Special requirements */}
              <div className="space-y-2">
                <Label className="font-semibold">Special Requirements</Label>
                <Textarea
                  placeholder="Any special requirements or notes..."
                  value={scheduleForm.special_requirements}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, special_requirements: e.target.value }))}
                  rows={3}
                />
              </div>

              {/* Save button */}
              <div className="flex justify-end">
                <Button onClick={handleSaveSchedule} disabled={formSaving} className="bg-blue-600 hover:bg-blue-700">
                  {formSaving ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" /> Schedule Surgery</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================= */}
        {/* TAB 3: OT Notes                                                    */}
        {/* ================================================================= */}
        <TabsContent value="notes" className="space-y-4 print:p-0">
          <Card className="print:shadow-none print:border-0">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Surgical Notes
              </CardTitle>
              <div className="flex items-center gap-2">
                {noteTemplates.length > 0 && (
                  <Select onValueChange={handleLoadTemplate}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Load template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {noteTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" onClick={handlePrintNotes} className="print:hidden">
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Select surgery */}
              <div className="space-y-2">
                <Label className="font-semibold">Select Surgery *</Label>
                {notesLoading ? (
                  <div className="h-10 bg-gray-200 rounded animate-pulse" />
                ) : (
                  <Select value={selectedNoteScheduleId} onValueChange={setSelectedNoteScheduleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a scheduled surgery..." />
                    </SelectTrigger>
                    <SelectContent>
                      {notesScheduleList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.surgery_name} - {s.surgeon_name || "N/A"} ({format(new Date(s.scheduled_date + "T00:00:00"), "dd MMM yyyy")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Pre-operative section */}
              <div className="space-y-4">
                <h3 className="text-md font-semibold text-blue-700 border-b border-blue-200 pb-1">
                  Pre-Operative
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Diagnosis</Label>
                    <Textarea
                      value={noteForm.diagnosis}
                      onChange={(e) => setNoteForm((f) => ({ ...f, diagnosis: e.target.value }))}
                      placeholder="Enter diagnosis..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Planned Procedure</Label>
                    <Textarea
                      value={noteForm.planned_procedure}
                      onChange={(e) => setNoteForm((f) => ({ ...f, planned_procedure: e.target.value }))}
                      placeholder="Enter planned procedure..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ASA Grade</Label>
                    <Select
                      value={noteForm.asa_grade}
                      onValueChange={(v) => setNoteForm((f) => ({ ...f, asa_grade: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select ASA grade" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="I">ASA I - Normal healthy patient</SelectItem>
                        <SelectItem value="II">ASA II - Mild systemic disease</SelectItem>
                        <SelectItem value="III">ASA III - Severe systemic disease</SelectItem>
                        <SelectItem value="IV">ASA IV - Life-threatening disease</SelectItem>
                        <SelectItem value="V">ASA V - Moribund patient</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Anesthesia Type</Label>
                    <Select
                      value={noteForm.anesthesia_type}
                      onValueChange={(v) => setNoteForm((f) => ({ ...f, anesthesia_type: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select anesthesia type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General Anesthesia</SelectItem>
                        <SelectItem value="spinal">Spinal Anesthesia</SelectItem>
                        <SelectItem value="epidural">Epidural Anesthesia</SelectItem>
                        <SelectItem value="local">Local Anesthesia</SelectItem>
                        <SelectItem value="regional">Regional Block</SelectItem>
                        <SelectItem value="sedation">Sedation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Intra-operative section */}
              <div className="space-y-4">
                <h3 className="text-md font-semibold text-orange-700 border-b border-orange-200 pb-1">
                  Intra-Operative
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Incision Time</Label>
                    <Input
                      type="time"
                      value={noteForm.incision_time}
                      onChange={(e) => setNoteForm((f) => ({ ...f, incision_time: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Blood Loss (ml)</Label>
                    <Input
                      type="text"
                      value={noteForm.blood_loss}
                      onChange={(e) => setNoteForm((f) => ({ ...f, blood_loss: e.target.value }))}
                      placeholder="e.g., 200 ml"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Procedure Details</Label>
                    <Textarea
                      value={noteForm.procedure_details}
                      onChange={(e) => setNoteForm((f) => ({ ...f, procedure_details: e.target.value }))}
                      placeholder="Describe the surgical procedure in detail..."
                      rows={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Implants Used</Label>
                    <Input
                      value={noteForm.implants_used}
                      onChange={(e) => setNoteForm((f) => ({ ...f, implants_used: e.target.value }))}
                      placeholder="List any implants used..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Complications</Label>
                    <Input
                      value={noteForm.complications}
                      onChange={(e) => setNoteForm((f) => ({ ...f, complications: e.target.value }))}
                      placeholder="Any complications during surgery..."
                    />
                  </div>
                </div>
              </div>

              {/* Post-operative section */}
              <div className="space-y-4">
                <h3 className="text-md font-semibold text-green-700 border-b border-green-200 pb-1">
                  Post-Operative
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Recovery Status</Label>
                    <Input
                      value={noteForm.recovery_status}
                      onChange={(e) => setNoteForm((f) => ({ ...f, recovery_status: e.target.value }))}
                      placeholder="Patient recovery status..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Shift To</Label>
                    <Select
                      value={noteForm.shift_to}
                      onValueChange={(v) => setNoteForm((f) => ({ ...f, shift_to: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ward">Ward</SelectItem>
                        <SelectItem value="icu">ICU</SelectItem>
                        <SelectItem value="recovery_room">Recovery Room</SelectItem>
                        <SelectItem value="day_care">Day Care Discharge</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Post-Op Instructions</Label>
                    <Textarea
                      value={noteForm.post_op_instructions}
                      onChange={(e) => setNoteForm((f) => ({ ...f, post_op_instructions: e.target.value }))}
                      placeholder="Post-operative care instructions..."
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* Save button */}
              <div className="flex justify-end gap-2 print:hidden">
                <Button onClick={handleSaveNote} disabled={notesSaving} className="bg-blue-600 hover:bg-blue-700">
                  {notesSaving ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" /> Save OT Notes</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================= */}
        {/* TAB 4: Equipment / Inventory                                       */}
        {/* ================================================================= */}
        <TabsContent value="equipment" className="space-y-4">
          {/* Low stock alerts */}
          {lowStockEquipment.length > 0 && (
            <Card className="border-orange-300 bg-orange-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
                  <AlertTriangle className="h-4 w-4" />
                  Low Stock Alerts ({lowStockEquipment.length} items)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {lowStockEquipment.map((eq) => (
                    <Badge key={eq.id} className="bg-orange-100 text-orange-800 border border-orange-300">
                      {eq.name}: {eq.quantity} left
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters and add button */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Filters:</span>
                  </div>
                  <Select value={equipmentFilterStatus} onValueChange={setEquipmentFilterStatus}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="in_use">In Use</SelectItem>
                      <SelectItem value="under_maintenance">Under Maintenance</SelectItem>
                      <SelectItem value="condemned">Condemned</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={equipmentFilterCategory} onValueChange={setEquipmentFilterCategory}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {equipmentCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={openAddEquipment} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-1" /> Add Equipment
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Equipment table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wrench className="h-5 w-5 text-blue-600" />
                Equipment Inventory
              </CardTitle>
            </CardHeader>
            <CardContent>
              {equipmentLoading ? (
                <LoadingSkeleton rows={6} />
              ) : filteredEquipment.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Package className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-lg font-medium">No equipment found</p>
                  <p className="text-sm">Add equipment or adjust your filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Serial No.</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Last Sterilized</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEquipment.map((eq) => (
                        <TableRow key={eq.id}>
                          <TableCell className="font-medium">{eq.name}</TableCell>
                          <TableCell>{eq.category_id ? categoryNameMap[eq.category_id] || "-" : "-"}</TableCell>
                          <TableCell className="text-xs text-gray-500">{eq.serial_number || "-"}</TableCell>
                          <TableCell>
                            <span className={eq.quantity != null && eq.quantity <= 2 ? "text-red-600 font-bold" : ""}>
                              {eq.quantity ?? "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${EQUIPMENT_STATUS_COLORS[eq.status] || "bg-gray-100 text-gray-700"} text-xs`}>
                              {eq.status?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{eq.location || "-"}</TableCell>
                          <TableCell className="text-sm">
                            {eq.last_sterilized
                              ? format(new Date(eq.last_sterilized), "dd MMM yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openEditEquipment(eq)}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add/Edit equipment dialog */}
          <Dialog open={equipmentDialogOpen} onOpenChange={setEquipmentDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingEquipment ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={equipmentForm.name}
                    onChange={(e) => setEquipmentForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Equipment name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={equipmentForm.category_id}
                      onValueChange={(v) => setEquipmentForm((f) => ({ ...f, category_id: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {equipmentCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={equipmentForm.status}
                      onValueChange={(v) => setEquipmentForm((f) => ({ ...f, status: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="in_use">In Use</SelectItem>
                        <SelectItem value="under_maintenance">Under Maintenance</SelectItem>
                        <SelectItem value="condemned">Condemned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Serial Number</Label>
                    <Input
                      value={equipmentForm.serial_number}
                      onChange={(e) => setEquipmentForm((f) => ({ ...f, serial_number: e.target.value }))}
                      placeholder="Serial number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min={0}
                      value={equipmentForm.quantity}
                      onChange={(e) => setEquipmentForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input
                    value={equipmentForm.location}
                    onChange={(e) => setEquipmentForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="e.g., OT Room 1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={equipmentForm.notes}
                    onChange={(e) => setEquipmentForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Additional notes..."
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEquipmentDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveEquipment} className="bg-blue-600 hover:bg-blue-700">
                  <Save className="h-4 w-4 mr-1" /> {editingEquipment ? "Update" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ================================================================= */}
        {/* TAB 5: OT Analytics                                                */}
        {/* ================================================================= */}
        <TabsContent value="analytics" className="space-y-4">
          {analyticsLoading ? (
            <LoadingSkeleton rows={8} />
          ) : (
            <>
              {/* Top stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-sm text-gray-500">Total Surgeries (30d)</p>
                    <p className="text-2xl font-bold text-blue-600">{cancellationRate.total}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-sm text-gray-500">Cancellation Rate</p>
                    <p className="text-2xl font-bold text-red-600">{cancellationRate.rate}%</p>
                    <p className="text-xs text-gray-400">{cancellationRate.cancelled} cancelled</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-sm text-gray-500">Surgeons Active</p>
                    <p className="text-2xl font-bold text-green-600">{surgeonCounts.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-sm text-gray-500">Avg Duration Types</p>
                    <p className="text-2xl font-bold text-purple-600">{avgDurationByType.length}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts row 1 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Surgeries per day */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      Surgeries Per Day (Last 14 Days)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {surgeriesPerDay.length === 0 ? (
                      <p className="text-center text-gray-400 py-8">No data available</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={surgeriesPerDay}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis allowDecimals={false} />
                          <RechartsTooltip />
                          <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Surgeries" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* OT Utilization */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="h-4 w-4 text-green-600" />
                      OT Utilization (30 Days)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {otUtilization.every((d) => d.value === 0) ? (
                      <p className="text-center text-gray-400 py-8">No data available</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={otUtilization}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={3}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {otUtilization.map((_, idx) => (
                              <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Charts row 2 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Surgeon-wise surgery count */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Stethoscope className="h-4 w-4 text-purple-600" />
                      Surgeon-wise Surgery Count
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {surgeonCounts.length === 0 ? (
                      <p className="text-center text-gray-400 py-8">No data available</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={Math.max(200, surgeonCounts.length * 35)}>
                        <BarChart data={surgeonCounts} layout="vertical" margin={{ left: 80 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" allowDecimals={false} />
                          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                          <RechartsTooltip />
                          <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Surgeries" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Emergency vs Elective */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      Emergency vs Elective Ratio
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {emergencyVsElective.length === 0 ? (
                      <p className="text-center text-gray-400 py-8">No data available</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={emergencyVsElective}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={3}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {emergencyVsElective.map((entry, idx) => (
                              <Cell
                                key={`cell-${idx}`}
                                fill={
                                  entry.name === "Emergency"
                                    ? "#ef4444"
                                    : entry.name === "Day Care"
                                    ? "#10b981"
                                    : "#3b82f6"
                                }
                              />
                            ))}
                          </Pie>
                          <RechartsTooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Charts row 3 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-600" />
                    Average Surgery Duration by Type (minutes)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {avgDurationByType.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No completed surgeries with recorded times available</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(200, avgDurationByType.length * 35)}>
                      <BarChart data={avgDurationByType} layout="vertical" margin={{ left: 120 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" unit=" min" />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                        <RechartsTooltip formatter={(value: number) => [`${value} min`, "Avg Duration"]} />
                        <Bar dataKey="avg" fill="#f59e0b" radius={[0, 4, 4, 0]} name="Avg Duration" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button variant="outline" onClick={fetchAnalytics}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh Analytics
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OperationTheatre;
