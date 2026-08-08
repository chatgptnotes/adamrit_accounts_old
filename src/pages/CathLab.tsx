import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, isAfter, isBefore, startOfDay } from "date-fns";

// UI components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Activity,
  Calendar,
  ClipboardList,
  Package,
  BarChart3,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Edit,
  AlertTriangle,
  Heart,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// Charts
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cath lab schedule record from Supabase */
interface CathLabSchedule {
  id: string;
  visit_id: string | null;
  patient_id: string | null;
  procedure_type: string;
  procedure_subtype: string | null;
  cardiologist_id: string | null;
  cardiologist_name: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  estimated_duration_min: number | null;
  status: string;
  access_site: string;
  pre_procedure_checklist: Record<string, boolean> | null;
  findings: Record<string, any> | null;
  stents_used: StentDetail[] | null;
  hemodynamics: Record<string, any> | null;
  fluoroscopy_time_min: number | null;
  contrast_volume_ml: number | null;
  radiation_dose_mgy: number | null;
  complications: string | null;
  notes: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  patient_first_name?: string;
  patient_last_name?: string;
}

/** Stent detail stored inside stents_used JSONB array */
interface StentDetail {
  type: string;
  size: string;
  brand: string;
}

/** Cath lab inventory item */
interface InventoryItem {
  id: string;
  item_type: string;
  brand: string;
  model: string;
  size: string;
  quantity: number;
  unit_cost: number;
  batch_number: string;
  expiry_date: string;
  supplier: string;
  created_at: string;
  updated_at: string;
}

/** Patient record (subset) */
interface Patient {
  id: string;
  first_name: string;
  last_name: string;
}

/** Staff member (subset) */
interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROCEDURE_TYPES = [
  "CAG",
  "PTCA",
  "PCI",
  "Pacemaker (Temporary)",
  "Pacemaker (Permanent)",
  "EP Study",
  "Balloon Valvuloplasty",
  "ASD/VSD Closure",
  "Peripheral Angioplasty",
];

const STATUS_PIPELINE: string[] = [
  "scheduled",
  "pre_procedure",
  "in_lab",
  "post_procedure",
  "completed",
  "cancelled",
];

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  pre_procedure: "bg-yellow-100 text-yellow-800",
  in_lab: "bg-orange-100 text-orange-800",
  post_procedure: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  pre_procedure: "Pre-Procedure",
  in_lab: "In Lab",
  post_procedure: "Post-Procedure",
  completed: "Completed",
  cancelled: "Cancelled",
};

const INVENTORY_TYPES = ["stent", "balloon", "guidewire", "catheter", "other"];

const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "consent", label: "Consent Form Signed" },
  { key: "blood_reports", label: "Blood Reports Available" },
  { key: "echo_report", label: "Echo Report Available" },
  { key: "creatinine", label: "Creatinine Checked" },
  { key: "allergy_check", label: "Allergy Check Done" },
  { key: "anticoagulant_status", label: "Anticoagulant Status Verified" },
  { key: "fasting_status", label: "Fasting Status Confirmed" },
];

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a status string for display */
function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

/** Build a patient display name from joined fields or fallback */
function patientName(row: CathLabSchedule): string {
  if (row.patient_first_name || row.patient_last_name) {
    return `${row.patient_first_name ?? ""} ${row.patient_last_name ?? ""}`.trim();
  }
  return "Unknown Patient";
}

/** Loading skeleton placeholder */
function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 bg-gray-200 rounded animate-pulse"
        />
      ))}
    </div>
  );
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

const CathLab: React.FC = () => {
  const { toast } = useToast();

  // URL-persisted tab state
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "dashboard";
  const setActiveTab = (tab: string) => setSearchParams({ tab });

  // ------ Shared state ------
  const [schedules, setSchedules] = useState<CathLabSchedule[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // =========================================================================
  // DATA FETCHING
  // =========================================================================

  const fetchSchedules = useCallback(async () => {
    const { data, error } = await supabase
      .from("cath_lab_schedule")
      .select("*")
      .order("scheduled_date", { ascending: false });

    if (error) {
      console.error("Error fetching schedules:", error);
      return;
    }

    // Enrich with patient names by fetching referenced patients
    const patientIds = [
      ...new Set(
        (data || [])
          .map((d: any) => d.patient_id)
          .filter(Boolean)
      ),
    ];

    let patientMap: Record<string, { first_name: string; last_name: string }> = {};
    if (patientIds.length > 0) {
      const { data: pData } = await supabase
        .from("patients")
        .select("id, first_name, last_name")
        .in("id", patientIds);
      if (pData) {
        pData.forEach((p: any) => {
          patientMap[p.id] = { first_name: p.first_name, last_name: p.last_name };
        });
      }
    }

    const enriched: CathLabSchedule[] = (data || []).map((row: any) => ({
      ...row,
      patient_first_name: patientMap[row.patient_id]?.first_name,
      patient_last_name: patientMap[row.patient_id]?.last_name,
    }));

    setSchedules(enriched);
  }, []);

  const fetchInventory = useCallback(async () => {
    const { data, error } = await supabase
      .from("cath_lab_inventory")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching inventory:", error);
      return;
    }
    setInventory((data as any[]) || []);
  }, []);

  const fetchStaff = useCallback(async () => {
    const { data, error } = await supabase
      .from("staff_members")
      .select("id, first_name, last_name, role");

    if (error) {
      console.error("Error fetching staff:", error);
      return;
    }
    setStaff((data as any[]) || []);
  }, []);

  // Initial data load
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchSchedules(), fetchInventory(), fetchStaff()]);
      setLoading(false);
    };
    loadAll();
  }, [fetchSchedules, fetchInventory, fetchStaff]);

  // =========================================================================
  // TAB 1 -- DASHBOARD
  // =========================================================================

  function DashboardTab() {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todaySchedules = schedules.filter(
      (s) => s.scheduled_date === todayStr
    );

    const totalScheduled = todaySchedules.length;
    const inProgress = todaySchedules.filter(
      (s) => s.status === "in_lab" || s.status === "pre_procedure" || s.status === "post_procedure"
    ).length;
    const completedToday = todaySchedules.filter(
      (s) => s.status === "completed"
    ).length;

    /** Advance a procedure to the next status in the pipeline */
    const advanceStatus = async (proc: CathLabSchedule) => {
      const currentIdx = STATUS_PIPELINE.indexOf(proc.status);
      if (currentIdx < 0 || currentIdx >= STATUS_PIPELINE.length - 2) return; // skip cancelled
      const nextStatus = STATUS_PIPELINE[currentIdx + 1];

      const updatePayload: any = { status: nextStatus };
      if (nextStatus === "in_lab") {
        updatePayload.actual_start_time = new Date().toISOString();
      }
      if (nextStatus === "completed") {
        updatePayload.actual_end_time = new Date().toISOString();
      }

      const { error } = await supabase
        .from("cath_lab_schedule")
        .update(updatePayload as any)
        .eq("id", proc.id);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Status Updated", description: `Moved to ${statusLabel(nextStatus)}` });
      fetchSchedules();
    };

    if (loading) return <LoadingSkeleton rows={6} />;

    return (
      <div className="space-y-6">
        {/* Quick stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Scheduled Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600" />
                <span className="text-2xl font-bold">{totalScheduled}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                In Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-orange-600" />
                <span className="text-2xl font-bold">{inProgress}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Completed Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold">{completedToday}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Today's procedures table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Today's Procedures — {format(new Date(), "dd MMM yyyy")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todaySchedules.length === 0 ? (
              <p className="text-gray-500 py-4 text-center">
                No procedures scheduled for today.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Procedure</TableHead>
                    <TableHead>Cardiologist</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todaySchedules.map((proc) => (
                    <TableRow key={proc.id}>
                      <TableCell className="font-medium">
                        {patientName(proc)}
                      </TableCell>
                      <TableCell>{proc.procedure_type}</TableCell>
                      <TableCell>
                        {proc.cardiologist_name || "—"}
                      </TableCell>
                      <TableCell>{proc.scheduled_time || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          className={`${STATUS_COLORS[proc.status] || "bg-gray-100 text-gray-800"}`}
                        >
                          {statusLabel(proc.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {proc.status !== "completed" &&
                          proc.status !== "cancelled" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => advanceStatus(proc)}
                            >
                              Next Step
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Status pipeline overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">
              Status Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {STATUS_PIPELINE.map((status) => {
                const count = todaySchedules.filter(
                  (s) => s.status === status
                ).length;
                return (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-lg border px-4 py-2"
                  >
                    <Badge className={STATUS_COLORS[status]}>
                      {statusLabel(status)}
                    </Badge>
                    <span className="font-semibold">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================================================
  // TAB 2 -- PROCEDURE SCHEDULING
  // =========================================================================

  function SchedulingTab() {
    const [patientSearch, setPatientSearch] = useState("");
    const [searchResults, setSearchResults] = useState<Patient[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [procedureType, setProcedureType] = useState("");
    const [cardiologistId, setCardiologistId] = useState("");
    const [scheduledDate, setScheduledDate] = useState("");
    const [scheduledTime, setScheduledTime] = useState("");
    const [accessSite, setAccessSite] = useState("radial");
    const [estimatedDuration, setEstimatedDuration] = useState("");
    const [notes, setNotes] = useState("");
    const [checklist, setChecklist] = useState<Record<string, boolean>>({
      consent: false,
      blood_reports: false,
      echo_report: false,
      creatinine: false,
      allergy_check: false,
      anticoagulant_status: false,
      fasting_status: false,
    });
    const [saving, setSaving] = useState(false);

    // Search patients by name
    const handlePatientSearch = async (query: string) => {
      setPatientSearch(query);
      if (query.length < 2) {
        setSearchResults([]);
        return;
      }
      const { data, error } = await supabase
        .from("patients")
        .select("id, first_name, last_name")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .limit(10);

      if (!error && data) {
        setSearchResults(data as any[]);
      }
    };

    const selectPatient = (p: Patient) => {
      setSelectedPatient(p);
      setPatientSearch(`${p.first_name} ${p.last_name}`);
      setSearchResults([]);
    };

    // Find the selected cardiologist's name for denormalised storage
    const getCardiologistName = (): string => {
      const found = staff.find((s) => s.id === cardiologistId);
      return found ? `${found.first_name} ${found.last_name}` : "";
    };

    const handleSave = async () => {
      if (!selectedPatient) {
        toast({ title: "Validation", description: "Please select a patient.", variant: "destructive" });
        return;
      }
      if (!procedureType) {
        toast({ title: "Validation", description: "Please select a procedure type.", variant: "destructive" });
        return;
      }
      if (!scheduledDate) {
        toast({ title: "Validation", description: "Please select a date.", variant: "destructive" });
        return;
      }

      setSaving(true);

      const record = {
        patient_id: selectedPatient.id,
        procedure_type: procedureType,
        cardiologist_id: cardiologistId || null,
        cardiologist_name: getCardiologistName() || null,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime || null,
        estimated_duration_min: estimatedDuration ? parseInt(estimatedDuration, 10) : null,
        status: "scheduled",
        access_site: accessSite,
        pre_procedure_checklist: checklist,
        notes: notes || null,
      };

      const { error } = await supabase
        .from("cath_lab_schedule")
        .insert(record as any);

      setSaving(false);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Scheduled", description: "Procedure has been scheduled successfully." });

      // Reset form
      setSelectedPatient(null);
      setPatientSearch("");
      setProcedureType("");
      setCardiologistId("");
      setScheduledDate("");
      setScheduledTime("");
      setAccessSite("radial");
      setEstimatedDuration("");
      setNotes("");
      setChecklist({
        consent: false,
        blood_reports: false,
        echo_report: false,
        creatinine: false,
        allergy_check: false,
        anticoagulant_status: false,
        fasting_status: false,
      });

      // Refresh data
      fetchSchedules();
    };

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              Schedule New Procedure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Patient search */}
            <div className="space-y-2">
              <Label>Patient *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="Search patient by name..."
                  value={patientSearch}
                  onChange={(e) => handlePatientSearch(e.target.value)}
                />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm"
                        onClick={() => selectPatient(p)}
                      >
                        {p.first_name} {p.last_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedPatient && (
                <p className="text-sm text-green-600">
                  Selected: {selectedPatient.first_name} {selectedPatient.last_name}
                </p>
              )}
            </div>

            {/* Row: Procedure type + Cardiologist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Procedure Type *</Label>
                <Select value={procedureType} onValueChange={setProcedureType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select procedure" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROCEDURE_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {pt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cardiologist</Label>
                <Select value={cardiologistId} onValueChange={setCardiologistId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cardiologist" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.first_name} {s.last_name}
                        {s.role ? ` (${s.role})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row: Date + Time + Access Site */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Scheduled Date *</Label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Scheduled Time</Label>
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Access Site</Label>
                <Select value={accessSite} onValueChange={setAccessSite}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="radial">Radial</SelectItem>
                    <SelectItem value="femoral">Femoral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Estimated duration */}
            <div className="space-y-2 max-w-xs">
              <Label>Estimated Duration (minutes)</Label>
              <Input
                type="number"
                min={0}
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                placeholder="e.g. 60"
              />
            </div>

            {/* Pre-procedure checklist */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                Pre-Procedure Checklist
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CHECKLIST_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`check-${item.key}`}
                      checked={checklist[item.key]}
                      onCheckedChange={(val) =>
                        setChecklist((prev) => ({
                          ...prev,
                          [item.key]: Boolean(val),
                        }))
                      }
                    />
                    <label
                      htmlFor={`check-${item.key}`}
                      className="text-sm cursor-pointer"
                    >
                      {item.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={3}
              />
            </div>

            {/* Save button */}
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Schedule Procedure"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================================================
  // TAB 3 -- CATH LAB REPORTS
  // =========================================================================

  function ReportsTab() {
    const [selectedProcId, setSelectedProcId] = useState("");
    const [selectedProc, setSelectedProc] = useState<CathLabSchedule | null>(null);

    // Findings fields
    const [ladStenosis, setLadStenosis] = useState("");
    const [lcxStenosis, setLcxStenosis] = useState("");
    const [rcaStenosis, setRcaStenosis] = useState("");
    const [lmcaStenosis, setLmcaStenosis] = useState("");

    // Stent details (multiple)
    const [stents, setStents] = useState<StentDetail[]>([]);
    const [stentType, setStentType] = useState("");
    const [stentSize, setStentSize] = useState("");
    const [stentBrand, setStentBrand] = useState("");

    // Hemodynamics
    const [systolicPressure, setSystolicPressure] = useState("");
    const [diastolicPressure, setDiastolicPressure] = useState("");
    const [meanGradient, setMeanGradient] = useState("");

    // Procedure metrics
    const [fluoroscopyTime, setFluoroscopyTime] = useState("");
    const [contrastVolume, setContrastVolume] = useState("");
    const [radiationDose, setRadiationDose] = useState("");
    const [complications, setComplications] = useState("");

    const [savingReport, setSavingReport] = useState(false);

    // When a procedure is selected, load existing data
    useEffect(() => {
      if (!selectedProcId) {
        setSelectedProc(null);
        return;
      }
      const proc = schedules.find((s) => s.id === selectedProcId) || null;
      setSelectedProc(proc);

      if (proc) {
        // Load existing findings
        const f = proc.findings || {};
        setLadStenosis(f.lad_stenosis?.toString() || "");
        setLcxStenosis(f.lcx_stenosis?.toString() || "");
        setRcaStenosis(f.rca_stenosis?.toString() || "");
        setLmcaStenosis(f.lmca_stenosis?.toString() || "");

        // Stents
        setStents(proc.stents_used || []);

        // Hemodynamics
        const h = proc.hemodynamics || {};
        setSystolicPressure(h.systolic_pressure?.toString() || "");
        setDiastolicPressure(h.diastolic_pressure?.toString() || "");
        setMeanGradient(h.mean_gradient?.toString() || "");

        // Metrics
        setFluoroscopyTime(proc.fluoroscopy_time_min?.toString() || "");
        setContrastVolume(proc.contrast_volume_ml?.toString() || "");
        setRadiationDose(proc.radiation_dose_mgy?.toString() || "");
        setComplications(proc.complications || "");
      }
    }, [selectedProcId, schedules]);

    const addStent = () => {
      if (!stentType && !stentSize && !stentBrand) return;
      setStents((prev) => [
        ...prev,
        { type: stentType, size: stentSize, brand: stentBrand },
      ]);
      setStentType("");
      setStentSize("");
      setStentBrand("");
    };

    const removeStent = (idx: number) => {
      setStents((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleSaveReport = async () => {
      if (!selectedProcId) return;
      setSavingReport(true);

      const findings = {
        lad_stenosis: ladStenosis ? parseFloat(ladStenosis) : null,
        lcx_stenosis: lcxStenosis ? parseFloat(lcxStenosis) : null,
        rca_stenosis: rcaStenosis ? parseFloat(rcaStenosis) : null,
        lmca_stenosis: lmcaStenosis ? parseFloat(lmcaStenosis) : null,
      };

      const hemodynamics = {
        systolic_pressure: systolicPressure ? parseFloat(systolicPressure) : null,
        diastolic_pressure: diastolicPressure ? parseFloat(diastolicPressure) : null,
        mean_gradient: meanGradient ? parseFloat(meanGradient) : null,
      };

      const updateData: any = {
        findings,
        stents_used: stents,
        hemodynamics,
        fluoroscopy_time_min: fluoroscopyTime ? parseFloat(fluoroscopyTime) : null,
        contrast_volume_ml: contrastVolume ? parseFloat(contrastVolume) : null,
        radiation_dose_mgy: radiationDose ? parseFloat(radiationDose) : null,
        complications: complications || null,
      };

      const { error } = await supabase
        .from("cath_lab_schedule")
        .update(updateData as any)
        .eq("id", selectedProcId);

      setSavingReport(false);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Report Saved", description: "Findings have been saved successfully." });
      fetchSchedules();
    };

    /** Print the report section */
    const handlePrint = () => {
      window.print();
    };

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-600" />
              Cath Lab Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Procedure selector */}
            <div className="space-y-2 max-w-lg">
              <Label>Select Procedure</Label>
              <Select value={selectedProcId} onValueChange={setSelectedProcId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a procedure..." />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {patientName(s)} — {s.procedure_type} ({s.scheduled_date})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProc && (
              <div className="space-y-6 print:space-y-4" id="cath-report">
                {/* Coronary Anatomy */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Coronary Anatomy — Stenosis (%)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label>LAD</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={ladStenosis}
                        onChange={(e) => setLadStenosis(e.target.value)}
                        placeholder="%"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>LCx</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={lcxStenosis}
                        onChange={(e) => setLcxStenosis(e.target.value)}
                        placeholder="%"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>RCA</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={rcaStenosis}
                        onChange={(e) => setRcaStenosis(e.target.value)}
                        placeholder="%"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>LMCA</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={lmcaStenosis}
                        onChange={(e) => setLmcaStenosis(e.target.value)}
                        placeholder="%"
                      />
                    </div>
                  </div>
                </div>

                {/* Stent Details */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Stent Details</h3>
                  {stents.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead className="w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stents.map((st, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{st.type}</TableCell>
                            <TableCell>{st.size}</TableCell>
                            <TableCell>{st.brand}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeStent(idx)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div className="space-y-1">
                      <Label>Type</Label>
                      <Input
                        value={stentType}
                        onChange={(e) => setStentType(e.target.value)}
                        placeholder="DES / BMS"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Size</Label>
                      <Input
                        value={stentSize}
                        onChange={(e) => setStentSize(e.target.value)}
                        placeholder="e.g. 3.0x28mm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Brand</Label>
                      <Input
                        value={stentBrand}
                        onChange={(e) => setStentBrand(e.target.value)}
                        placeholder="e.g. Xience"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={addStent}
                      className="flex items-center gap-1"
                    >
                      <Plus className="h-4 w-4" /> Add Stent
                    </Button>
                  </div>
                </div>

                {/* Hemodynamic Data */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Hemodynamic Data</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <Label>Systolic Pressure (mmHg)</Label>
                      <Input
                        type="number"
                        value={systolicPressure}
                        onChange={(e) => setSystolicPressure(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Diastolic Pressure (mmHg)</Label>
                      <Input
                        type="number"
                        value={diastolicPressure}
                        onChange={(e) => setDiastolicPressure(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Mean Gradient (mmHg)</Label>
                      <Input
                        type="number"
                        value={meanGradient}
                        onChange={(e) => setMeanGradient(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Procedure Metrics */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Procedure Metrics</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <Label>Fluoroscopy Time (min)</Label>
                      <Input
                        type="number"
                        value={fluoroscopyTime}
                        onChange={(e) => setFluoroscopyTime(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Contrast Volume (ml)</Label>
                      <Input
                        type="number"
                        value={contrastVolume}
                        onChange={(e) => setContrastVolume(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Radiation Dose (mGy)</Label>
                      <Input
                        type="number"
                        value={radiationDose}
                        onChange={(e) => setRadiationDose(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Complications */}
                <div className="space-y-2">
                  <Label>Complications</Label>
                  <Textarea
                    value={complications}
                    onChange={(e) => setComplications(e.target.value)}
                    placeholder="Document any complications..."
                    rows={3}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <Button
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={savingReport}
                    onClick={handleSaveReport}
                  >
                    {savingReport ? "Saving..." : "Save Report"}
                  </Button>
                  <Button variant="outline" onClick={handlePrint}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print Report
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================================================
  // TAB 4 -- INVENTORY
  // =========================================================================

  function InventoryTab() {
    const [filterType, setFilterType] = useState("all");
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editItem, setEditItem] = useState<InventoryItem | null>(null);
    const [editQty, setEditQty] = useState("");

    // New item form fields
    const [newItemType, setNewItemType] = useState("stent");
    const [newBrand, setNewBrand] = useState("");
    const [newModel, setNewModel] = useState("");
    const [newSize, setNewSize] = useState("");
    const [newQty, setNewQty] = useState("");
    const [newUnitCost, setNewUnitCost] = useState("");
    const [newBatch, setNewBatch] = useState("");
    const [newExpiry, setNewExpiry] = useState("");
    const [newSupplier, setNewSupplier] = useState("");
    const [savingItem, setSavingItem] = useState(false);

    const today = startOfDay(new Date());
    const thirtyDaysFromNow = addDays(today, 30);

    const filteredInventory =
      filterType === "all"
        ? inventory
        : inventory.filter((item) => item.item_type === filterType);

    /** Check whether an item is expiring soon (within 30 days) */
    const isExpiringSoon = (expiryDate: string): boolean => {
      if (!expiryDate) return false;
      const expiry = new Date(expiryDate);
      return isBefore(expiry, thirtyDaysFromNow) && isAfter(expiry, today);
    };

    /** Check whether an item is already expired */
    const isExpired = (expiryDate: string): boolean => {
      if (!expiryDate) return false;
      return isBefore(new Date(expiryDate), today);
    };

    /** Check low stock */
    const isLowStock = (qty: number): boolean => qty < 5;

    const handleAddItem = async () => {
      if (!newBrand || !newModel) {
        toast({ title: "Validation", description: "Brand and Model are required.", variant: "destructive" });
        return;
      }

      setSavingItem(true);

      const record = {
        item_type: newItemType,
        brand: newBrand,
        model: newModel,
        size: newSize || null,
        quantity: newQty ? parseInt(newQty, 10) : 0,
        unit_cost: newUnitCost ? parseFloat(newUnitCost) : 0,
        batch_number: newBatch || null,
        expiry_date: newExpiry || null,
        supplier: newSupplier || null,
      };

      const { error } = await supabase
        .from("cath_lab_inventory")
        .insert(record as any);

      setSavingItem(false);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Added", description: "Inventory item added successfully." });
      setAddDialogOpen(false);
      resetNewItemForm();
      fetchInventory();
    };

    const resetNewItemForm = () => {
      setNewItemType("stent");
      setNewBrand("");
      setNewModel("");
      setNewSize("");
      setNewQty("");
      setNewUnitCost("");
      setNewBatch("");
      setNewExpiry("");
      setNewSupplier("");
    };

    const openEditQty = (item: InventoryItem) => {
      setEditItem(item);
      setEditQty(item.quantity.toString());
      setEditDialogOpen(true);
    };

    const handleUpdateQty = async () => {
      if (!editItem) return;
      const newQuantity = parseInt(editQty, 10);
      if (isNaN(newQuantity) || newQuantity < 0) {
        toast({ title: "Validation", description: "Enter a valid quantity.", variant: "destructive" });
        return;
      }

      const { error } = await supabase
        .from("cath_lab_inventory")
        .update({ quantity: newQuantity } as any)
        .eq("id", editItem.id);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Updated", description: "Quantity updated successfully." });
      setEditDialogOpen(false);
      setEditItem(null);
      fetchInventory();
    };

    if (loading) return <LoadingSkeleton rows={6} />;

    return (
      <div className="space-y-6">
        {/* Alerts for expiring and low stock items */}
        {inventory.some(
          (i) => isExpiringSoon(i.expiry_date) || isExpired(i.expiry_date) || isLowStock(i.quantity)
        ) && (
          <Card className="border-orange-300 bg-orange-50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
                <span className="font-semibold text-orange-800">Alerts</span>
              </div>
              <ul className="space-y-1 text-sm">
                {inventory
                  .filter((i) => isExpired(i.expiry_date))
                  .map((i) => (
                    <li key={`exp-${i.id}`} className="text-red-700">
                      EXPIRED: {i.brand} {i.model} (Batch: {i.batch_number}) — expired{" "}
                      {i.expiry_date}
                    </li>
                  ))}
                {inventory
                  .filter((i) => isExpiringSoon(i.expiry_date))
                  .map((i) => (
                    <li key={`soon-${i.id}`} className="text-orange-700">
                      Expiring soon: {i.brand} {i.model} (Batch: {i.batch_number}) — expires{" "}
                      {i.expiry_date}
                    </li>
                  ))}
                {inventory
                  .filter((i) => isLowStock(i.quantity))
                  .map((i) => (
                    <li key={`low-${i.id}`} className="text-yellow-700">
                      Low stock: {i.brand} {i.model} — only {i.quantity} remaining
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                Cath Lab Inventory
              </CardTitle>
              <div className="flex items-center gap-3">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {INVENTORY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setAddDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Item
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredInventory.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No inventory items found.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit Cost</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInventory.map((item) => {
                      const expSoon = isExpiringSoon(item.expiry_date);
                      const expired = isExpired(item.expiry_date);
                      const lowStock = isLowStock(item.quantity);

                      return (
                        <TableRow
                          key={item.id}
                          className={
                            expired
                              ? "bg-red-50"
                              : expSoon
                                ? "bg-orange-50"
                                : ""
                          }
                        >
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {item.item_type}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.brand}</TableCell>
                          <TableCell>{item.model}</TableCell>
                          <TableCell>{item.size || "—"}</TableCell>
                          <TableCell>
                            <span
                              className={
                                lowStock ? "text-red-600 font-semibold" : ""
                              }
                            >
                              {item.quantity}
                            </span>
                            {lowStock && (
                              <AlertTriangle className="inline h-3 w-3 ml-1 text-red-500" />
                            )}
                          </TableCell>
                          <TableCell>
                            {item.unit_cost != null
                              ? `₹${Number(item.unit_cost).toLocaleString()}`
                              : "—"}
                          </TableCell>
                          <TableCell>{item.batch_number || "—"}</TableCell>
                          <TableCell>
                            <span
                              className={
                                expired
                                  ? "text-red-600 font-semibold"
                                  : expSoon
                                    ? "text-orange-600 font-semibold"
                                    : ""
                              }
                            >
                              {item.expiry_date || "—"}
                            </span>
                          </TableCell>
                          <TableCell>{item.supplier || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditQty(item)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
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

        {/* ---- Add Item Dialog ---- */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Inventory Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Item Type</Label>
                <Select value={newItemType} onValueChange={setNewItemType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Brand *</Label>
                  <Input
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Model *</Label>
                  <Input
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Size</Label>
                  <Input
                    value={newSize}
                    onChange={(e) => setNewSize(e.target.value)}
                    placeholder="e.g. 3.0x28mm"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={0}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Unit Cost (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={newUnitCost}
                    onChange={(e) => setNewUnitCost(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Batch Number</Label>
                  <Input
                    value={newBatch}
                    onChange={(e) => setNewBatch(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Expiry Date</Label>
                  <Input
                    type="date"
                    value={newExpiry}
                    onChange={(e) => setNewExpiry(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Supplier</Label>
                  <Input
                    value={newSupplier}
                    onChange={(e) => setNewSupplier(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={savingItem}
                onClick={handleAddItem}
              >
                {savingItem ? "Adding..." : "Add Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ---- Edit Quantity Dialog ---- */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Update Quantity</DialogTitle>
            </DialogHeader>
            {editItem && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  {editItem.brand} {editItem.model} ({editItem.item_type})
                </p>
                <div className="space-y-1">
                  <Label>New Quantity</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleUpdateQty}
              >
                Update
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // =========================================================================
  // TAB 5 -- ANALYTICS
  // =========================================================================

  function AnalyticsTab() {
    if (loading) return <LoadingSkeleton rows={6} />;

    // ---- Procedures per month ----
    const monthCounts: Record<string, number> = {};
    schedules.forEach((s) => {
      const month = s.scheduled_date?.slice(0, 7); // "YYYY-MM"
      if (month) {
        monthCounts[month] = (monthCounts[month] || 0) + 1;
      }
    });
    const proceduresPerMonth = Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12) // last 12 months
      .map(([month, count]) => ({ month, count }));

    // ---- Procedure type distribution ----
    const typeCounts: Record<string, number> = {};
    schedules.forEach((s) => {
      const t = s.procedure_type || "Unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const typeDistribution = Object.entries(typeCounts).map(([name, value]) => ({
      name,
      value,
    }));

    // ---- Stent usage by brand ----
    const brandCounts: Record<string, number> = {};
    schedules.forEach((s) => {
      (s.stents_used || []).forEach((st) => {
        const brand = st.brand || "Unknown";
        brandCounts[brand] = (brandCounts[brand] || 0) + 1;
      });
    });
    const stentByBrand = Object.entries(brandCounts).map(([brand, count]) => ({
      brand,
      count,
    }));

    // ---- Average contrast volume ----
    const contrastValues = schedules
      .map((s) => s.contrast_volume_ml)
      .filter((v): v is number => v != null && v > 0);
    const avgContrast =
      contrastValues.length > 0
        ? (contrastValues.reduce((a, b) => a + b, 0) / contrastValues.length).toFixed(1)
        : "N/A";

    // ---- Complication rate ----
    const completedProcs = schedules.filter((s) => s.status === "completed");
    const withComplications = completedProcs.filter(
      (s) => s.complications && s.complications.trim().length > 0
    );
    const complicationRate =
      completedProcs.length > 0
        ? ((withComplications.length / completedProcs.length) * 100).toFixed(1)
        : "N/A";

    // ---- Revenue per procedure type (estimated from inventory cost) ----
    const revPerType: Record<string, number> = {};
    schedules.forEach((s) => {
      const t = s.procedure_type || "Unknown";
      const stents = s.stents_used || [];
      let cost = 0;
      stents.forEach((st) => {
        // Match with inventory items by brand
        const invItem = inventory.find(
          (inv) =>
            inv.brand.toLowerCase() === st.brand?.toLowerCase() &&
            inv.item_type === "stent"
        );
        if (invItem) {
          cost += Number(invItem.unit_cost) || 0;
        }
      });
      revPerType[t] = (revPerType[t] || 0) + cost;
    });
    const revenueData = Object.entries(revPerType)
      .filter(([, v]) => v > 0)
      .map(([type, revenue]) => ({ type, revenue }));

    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Procedures
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">{schedules.length}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Avg Contrast Volume (ml)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">{avgContrast}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Complication Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">
                {complicationRate !== "N/A" ? `${complicationRate}%` : "N/A"}
              </span>
            </CardContent>
          </Card>
        </div>

        {/* Procedures per month — BarChart */}
        <Card>
          <CardHeader>
            <CardTitle>Procedures per Month</CardTitle>
          </CardHeader>
          <CardContent>
            {proceduresPerMonth.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={proceduresPerMonth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Procedure type distribution — PieChart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Procedure Type Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {typeDistribution.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={typeDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) =>
                        `${name} (${(percent * 100).toFixed(0)}%)`
                      }
                    >
                      {typeDistribution.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={PIE_COLORS[idx % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Stent usage by brand — BarChart */}
          <Card>
            <CardHeader>
              <CardTitle>Stent Usage by Brand</CardTitle>
            </CardHeader>
            <CardContent>
              {stentByBrand.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No stent data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stentByBrand}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="brand" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Revenue per procedure type */}
        {revenueData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Revenue per Procedure Type (Estimated from Inventory)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number) => [
                      `₹${value.toLocaleString()}`,
                      "Revenue",
                    ]}
                  />
                  <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Heart className="h-8 w-8 text-blue-600" />
          Cath Lab Management
        </h1>
        <p className="text-gray-600 mt-1">
          Cardiac catheterisation lab scheduling, reporting, inventory, and analytics
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="dashboard" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="scheduling" className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Scheduling</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1">
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Reports</span>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center gap-1">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Inventory</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="scheduling" className="mt-6">
          <SchedulingTab />
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <ReportsTab />
        </TabsContent>

        <TabsContent value="inventory" className="mt-6">
          <InventoryTab />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>

      {/* Print-friendly styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #cath-report, #cath-report * { visibility: visible; }
          #cath-report { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default CathLab;
