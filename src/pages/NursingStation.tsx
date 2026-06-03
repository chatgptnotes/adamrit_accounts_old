import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// UI Components
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
  Pill,
  ClipboardList,
  Droplets,
  BarChart3,
  Users,
  AlertTriangle,
  Heart,
  Thermometer,
  Wind,
  Plus,
  Save,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";

// Charts
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatientVisit {
  id: string;
  patient_id: string;
  ward: string;
  bed_no: string;
  status: string;
  admission_date: string;
  diagnosis: string;
  patient_name?: string;
  first_name?: string;
  last_name?: string;
}

interface VitalSign {
  id: string;
  visit_id: string;
  patient_id: string;
  recorded_by: string;
  recorded_at: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  blood_sugar: number | null;
  urine_output_ml: number | null;
  gcs_score: number | null;
  pain_score: number | null;
  notes: string | null;
  ward: string | null;
  bed_no: string | null;
}

interface MedicationAdmin {
  id: string;
  visit_id: string;
  patient_id: string;
  prescription_item_id: string | null;
  medication_name: string;
  dose: string;
  route: string;
  frequency: string;
  scheduled_time: string;
  administered_at: string | null;
  administered_by: string | null;
  status: string;
  missed_reason: string | null;
  notes: string | null;
  created_at: string;
}

interface IOEntry {
  id: string;
  visit_id: string;
  patient_id: string;
  recorded_by: string;
  recorded_at: string;
  entry_type: string;
  category: string;
  sub_category: string | null;
  volume_ml: number;
  rate_ml_hr: number | null;
  notes: string | null;
  ward: string | null;
  bed_no: string | null;
}

interface CarePlan {
  id: string;
  visit_id: string;
  patient_id: string;
  shift: string;
  shift_date: string;
  nurse_name: string;
  assessment: Record<string, string> | null;
  care_tasks: Array<{ task: string; done: boolean }> | null;
  handover_notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  stable: "bg-green-100 text-green-800 border-green-300",
  "under observation": "bg-yellow-100 text-yellow-800 border-yellow-300",
  admitted: "bg-blue-100 text-blue-800 border-blue-300",
  discharged: "bg-gray-100 text-gray-800 border-gray-300",
};

const MED_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  given: "bg-green-100 text-green-800",
  missed: "bg-red-100 text-red-800",
  held: "bg-gray-100 text-gray-800",
  refused: "bg-orange-100 text-orange-800",
};

const PIE_COLORS = ["#22c55e", "#ef4444", "#eab308", "#6b7280", "#f97316"];

const DEFAULT_CARE_TASKS = [
  "Vitals done",
  "Medications given",
  "IV site checked",
  "Input/Output charted",
  "Position change",
  "Catheter care",
  "Wound dressing",
];

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

const LoadingSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const NursingStation: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "dashboard";
  const setActiveTab = (tab: string) => setSearchParams({ tab });
  const { toast } = useToast();

  // Global state
  const [patients, setPatients] = useState<PatientVisit[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientVisit | null>(null);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Fetch admitted patients (visits with patient info)
  // ---------------------------------------------------------------------------
  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const { data: visits, error } = await supabase
        .from("visits")
        .select("id, patient_id, ward, bed_no, status, admission_date, diagnosis")
        .in("status", ["admitted", "critical", "stable", "under observation"])
        .order("admission_date", { ascending: false });

      if (error) throw error;

      if (visits && visits.length > 0) {
        const patientIds = [...new Set((visits as any[]).map((v) => v.patient_id))];
        const { data: patientData } = await supabase
          .from("patients")
          .select("id, first_name, last_name")
          .in("id", patientIds);

        const patientMap = new Map<string, { first_name: string; last_name: string }>();
        (patientData || []).forEach((p: any) => patientMap.set(p.id, p));

        const enriched: PatientVisit[] = (visits as any[]).map((v) => {
          const p = patientMap.get(v.patient_id);
          return {
            ...v,
            patient_name: p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() : "Unknown",
            first_name: p?.first_name || "",
            last_name: p?.last_name || "",
          };
        });
        setPatients(enriched);
      } else {
        setPatients([]);
      }
    } catch (err) {
      console.error("Error fetching patients:", err);
      toast({ title: "Error", description: "Failed to load patient data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // Select first patient by default when patients load
  useEffect(() => {
    if (patients.length > 0 && !selectedPatient) {
      setSelectedPatient(patients[0]);
    }
  }, [patients, selectedPatient]);

  // ---------------------------------------------------------------------------
  // Patient selector component (reused across tabs)
  // ---------------------------------------------------------------------------
  const PatientSelector = () => (
    <div className="flex items-center gap-3 mb-4">
      <Label className="font-medium whitespace-nowrap">Select Patient:</Label>
      <Select
        value={selectedPatient?.id || ""}
        onValueChange={(val) => {
          const p = patients.find((pt) => pt.id === val);
          if (p) setSelectedPatient(p);
        }}
      >
        <SelectTrigger className="w-[360px]">
          <SelectValue placeholder="Choose a patient" />
        </SelectTrigger>
        <SelectContent>
          {patients.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.patient_name} - Bed {p.bed_no || "N/A"} ({p.ward || "N/A"})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedPatient && (
        <Badge variant="outline" className={STATUS_COLORS[selectedPatient.status?.toLowerCase()] || "bg-blue-50"}>
          {selectedPatient.status}
        </Badge>
      )}
    </div>
  );

  // =========================================================================
  // TAB 1: NURSE DASHBOARD
  // =========================================================================
  const DashboardTab = () => {
    const [filter, setFilter] = useState<string>("all");

    const filtered = patients.filter((p) => {
      if (filter === "all") return true;
      return p.status?.toLowerCase() === filter;
    });

    const totalAdmitted = patients.length;
    const criticalCount = patients.filter((p) => p.status?.toLowerCase() === "critical").length;
    const stableCount = patients.filter((p) => p.status?.toLowerCase() === "stable").length;

    // Determine current shift
    const hour = new Date().getHours();
    let currentShift = "Night";
    if (hour >= 6 && hour < 14) currentShift = "Morning";
    else if (hour >= 14 && hour < 22) currentShift = "Afternoon";

    return (
      <div className="space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card onClick={() => setFilter("all")} className="border-l-4 border-l-blue-500 cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Admitted</p>
                  <p className="text-2xl font-bold">{totalAdmitted}</p>
                </div>
                <Users className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card onClick={() => setFilter("critical")} className="border-l-4 border-l-red-500 cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Critical</p>
                  <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          <Card onClick={() => setFilter("stable")} className="border-l-4 border-l-green-500 cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Stable</p>
                  <p className="text-2xl font-bold text-green-600">{stableCount}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Current Shift</p>
                  <p className="text-2xl font-bold">{currentShift}</p>
                </div>
                <Clock className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground mr-2">Filter:</span>
          {[
            { label: "All", value: "all" },
            { label: "Critical", value: "critical" },
            { label: "Stable", value: "stable" },
            { label: "Under Observation", value: "under observation" },
          ].map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={fetchPatients}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Patient Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ward-wise Patient List</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingSkeleton rows={6} />
            ) : filtered.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No patients found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bed No</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Diagnosis</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Admission Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow
                      key={p.id}
                      className={`cursor-pointer hover:bg-blue-50 ${
                        selectedPatient?.id === p.id ? "bg-blue-50" : ""
                      }`}
                      onClick={() => setSelectedPatient(p)}
                    >
                      <TableCell className="font-medium">{p.bed_no || "-"}</TableCell>
                      <TableCell>{p.patient_name}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{p.diagnosis || "-"}</TableCell>
                      <TableCell>{p.ward || "-"}</TableCell>
                      <TableCell>
                        {p.admission_date ? format(new Date(p.admission_date), "dd MMM yyyy") : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_COLORS[p.status?.toLowerCase()] || "bg-blue-50"}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  // =========================================================================
  // TAB 2: VITAL SIGNS MONITORING
  // =========================================================================
  const VitalSignsTab = () => {
    const [vitals, setVitals] = useState<VitalSign[]>([]);
    const [vitalsLoading, setVitalsLoading] = useState(false);

    // Form state
    const [bpSys, setBpSys] = useState("");
    const [bpDia, setBpDia] = useState("");
    const [pulse, setPulse] = useState("");
    const [temp, setTemp] = useState("");
    const [spo2, setSpo2] = useState("");
    const [respRate, setRespRate] = useState("");
    const [bloodSugar, setBloodSugar] = useState("");
    const [urineOutput, setUrineOutput] = useState("");
    const [gcs, setGcs] = useState("");
    const [painScore, setPainScore] = useState("");
    const [vitalNotes, setVitalNotes] = useState("");
    const [saving, setSaving] = useState(false);

    const fetchVitals = useCallback(async () => {
      if (!selectedPatient) return;
      setVitalsLoading(true);
      try {
        const { data, error } = await supabase
          .from("vital_signs")
          .select("*")
          .eq("visit_id", selectedPatient.id)
          .order("recorded_at", { ascending: false });
        if (error) throw error;
        setVitals((data as any[]) || []);
      } catch (err) {
        console.error("Error fetching vitals:", err);
      } finally {
        setVitalsLoading(false);
      }
    }, [selectedPatient]);

    useEffect(() => {
      fetchVitals();
    }, [fetchVitals]);

    const resetForm = () => {
      setBpSys("");
      setBpDia("");
      setPulse("");
      setTemp("");
      setSpo2("");
      setRespRate("");
      setBloodSugar("");
      setUrineOutput("");
      setGcs("");
      setPainScore("");
      setVitalNotes("");
    };

    const handleSaveVital = async () => {
      if (!selectedPatient) return;
      setSaving(true);
      try {
        const record = {
          visit_id: selectedPatient.id,
          patient_id: selectedPatient.patient_id,
          recorded_by: "Nurse",
          recorded_at: new Date().toISOString(),
          bp_systolic: bpSys ? Number(bpSys) : null,
          bp_diastolic: bpDia ? Number(bpDia) : null,
          pulse: pulse ? Number(pulse) : null,
          temperature: temp ? Number(temp) : null,
          spo2: spo2 ? Number(spo2) : null,
          respiratory_rate: respRate ? Number(respRate) : null,
          blood_sugar: bloodSugar ? Number(bloodSugar) : null,
          urine_output_ml: urineOutput ? Number(urineOutput) : null,
          gcs_score: gcs ? Number(gcs) : null,
          pain_score: painScore ? Number(painScore) : null,
          notes: vitalNotes || null,
          ward: selectedPatient.ward || null,
          bed_no: selectedPatient.bed_no || null,
        };
        const { error } = await supabase.from("vital_signs").insert(record as any);
        if (error) throw error;
        toast({ title: "Success", description: "Vital signs recorded successfully" });
        resetForm();
        fetchVitals();
      } catch (err) {
        console.error("Error saving vitals:", err);
        toast({ title: "Error", description: "Failed to save vital signs", variant: "destructive" });
      } finally {
        setSaving(false);
      }
    };

    // Check for abnormal vitals
    const getAlerts = (v: VitalSign): string[] => {
      const alerts: string[] = [];
      if (v.bp_systolic && (v.bp_systolic > 180 || v.bp_systolic < 90))
        alerts.push(`BP Sys: ${v.bp_systolic}`);
      if (v.pulse && (v.pulse > 120 || v.pulse < 50)) alerts.push(`Pulse: ${v.pulse}`);
      if (v.spo2 && v.spo2 < 90) alerts.push(`SpO2: ${v.spo2}%`);
      if (v.temperature && v.temperature > 102) alerts.push(`Temp: ${v.temperature}F`);
      return alerts;
    };

    // Prepare chart data (last 20 readings, chronological order)
    const chartData = [...vitals]
      .reverse()
      .slice(-20)
      .map((v) => ({
        time: format(new Date(v.recorded_at), "dd/MM HH:mm"),
        "BP Sys": v.bp_systolic,
        "BP Dia": v.bp_diastolic,
        Pulse: v.pulse,
        SpO2: v.spo2,
        Temp: v.temperature,
      }));

    return (
      <div className="space-y-6">
        <PatientSelector />

        {!selectedPatient ? (
          <p className="text-center text-muted-foreground py-8">Please select a patient to continue.</p>
        ) : (
          <>
            {/* Record Vitals Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  Record Vital Signs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  <div>
                    <Label className="text-xs">BP Systolic (mmHg)</Label>
                    <Input type="number" value={bpSys} onChange={(e) => setBpSys(e.target.value)} placeholder="120" />
                  </div>
                  <div>
                    <Label className="text-xs">BP Diastolic (mmHg)</Label>
                    <Input type="number" value={bpDia} onChange={(e) => setBpDia(e.target.value)} placeholder="80" />
                  </div>
                  <div>
                    <Label className="text-xs">Pulse (bpm)</Label>
                    <Input type="number" value={pulse} onChange={(e) => setPulse(e.target.value)} placeholder="72" />
                  </div>
                  <div>
                    <Label className="text-xs">Temperature (F)</Label>
                    <Input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="98.6" />
                  </div>
                  <div>
                    <Label className="text-xs">SpO2 (%)</Label>
                    <Input type="number" value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="98" />
                  </div>
                  <div>
                    <Label className="text-xs">Resp Rate (/min)</Label>
                    <Input type="number" value={respRate} onChange={(e) => setRespRate(e.target.value)} placeholder="16" />
                  </div>
                  <div>
                    <Label className="text-xs">Blood Sugar (mg/dL)</Label>
                    <Input type="number" value={bloodSugar} onChange={(e) => setBloodSugar(e.target.value)} placeholder="100" />
                  </div>
                  <div>
                    <Label className="text-xs">Urine Output (mL)</Label>
                    <Input type="number" value={urineOutput} onChange={(e) => setUrineOutput(e.target.value)} placeholder="500" />
                  </div>
                  <div>
                    <Label className="text-xs">GCS Score (3-15)</Label>
                    <Input type="number" min={3} max={15} value={gcs} onChange={(e) => setGcs(e.target.value)} placeholder="15" />
                  </div>
                  <div>
                    <Label className="text-xs">Pain Score (1-10)</Label>
                    <Input type="number" min={1} max={10} value={painScore} onChange={(e) => setPainScore(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <div className="mt-4">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    value={vitalNotes}
                    onChange={(e) => setVitalNotes(e.target.value)}
                    placeholder="Additional observations..."
                    rows={2}
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleSaveVital} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save Vitals"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Vital Trends Chart */}
            {chartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Vital Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" fontSize={11} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="BP Sys" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="BP Dia" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Pulse" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="SpO2" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Temp" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Vitals History Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Vitals History</CardTitle>
              </CardHeader>
              <CardContent>
                {vitalsLoading ? (
                  <LoadingSkeleton rows={4} />
                ) : vitals.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6">No vital sign records found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date/Time</TableHead>
                          <TableHead>BP</TableHead>
                          <TableHead>Pulse</TableHead>
                          <TableHead>Temp</TableHead>
                          <TableHead>SpO2</TableHead>
                          <TableHead>RR</TableHead>
                          <TableHead>Sugar</TableHead>
                          <TableHead>Urine</TableHead>
                          <TableHead>GCS</TableHead>
                          <TableHead>Pain</TableHead>
                          <TableHead>Alerts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vitals.map((v) => {
                          const alerts = getAlerts(v);
                          return (
                            <TableRow key={v.id}>
                              <TableCell className="whitespace-nowrap text-xs">
                                {format(new Date(v.recorded_at), "dd MMM yyyy HH:mm")}
                              </TableCell>
                              <TableCell>
                                {v.bp_systolic !== null && v.bp_diastolic !== null
                                  ? `${v.bp_systolic}/${v.bp_diastolic}`
                                  : "-"}
                              </TableCell>
                              <TableCell>{v.pulse ?? "-"}</TableCell>
                              <TableCell>{v.temperature ?? "-"}</TableCell>
                              <TableCell>{v.spo2 !== null ? `${v.spo2}%` : "-"}</TableCell>
                              <TableCell>{v.respiratory_rate ?? "-"}</TableCell>
                              <TableCell>{v.blood_sugar ?? "-"}</TableCell>
                              <TableCell>{v.urine_output_ml !== null ? `${v.urine_output_ml} mL` : "-"}</TableCell>
                              <TableCell>{v.gcs_score ?? "-"}</TableCell>
                              <TableCell>{v.pain_score ?? "-"}</TableCell>
                              <TableCell>
                                {alerts.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {alerts.map((a, idx) => (
                                      <Badge key={idx} variant="destructive" className="text-xs">
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        {a}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700">Normal</Badge>
                                )}
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
          </>
        )}
      </div>
    );
  };

  // =========================================================================
  // TAB 3: MEDICATION ADMINISTRATION (MAR)
  // =========================================================================
  const MedicationTab = () => {
    const [medications, setMedications] = useState<MedicationAdmin[]>([]);
    const [medLoading, setMedLoading] = useState(false);
    const [missedDialog, setMissedDialog] = useState<MedicationAdmin | null>(null);
    const [missedReason, setMissedReason] = useState("");
    const [addMedDialog, setAddMedDialog] = useState(false);
    const [newMed, setNewMed] = useState({
      medication_name: "",
      dose: "",
      route: "Oral",
      frequency: "OD",
      scheduled_time: "",
      notes: "",
    });

    const fetchMedications = useCallback(async () => {
      if (!selectedPatient) return;
      setMedLoading(true);
      try {
        const { data, error } = await supabase
          .from("medication_administration")
          .select("*")
          .eq("visit_id", selectedPatient.id)
          .order("scheduled_time", { ascending: true });
        if (error) throw error;
        setMedications((data as any[]) || []);
      } catch (err) {
        console.error("Error fetching medications:", err);
      } finally {
        setMedLoading(false);
      }
    }, [selectedPatient]);

    useEffect(() => {
      fetchMedications();
    }, [fetchMedications]);

    const markAsGiven = async (med: MedicationAdmin) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from("medication_administration") as any)
          .update({
            status: "given",
            administered_at: new Date().toISOString(),
            administered_by: "Nurse",
          })
          .eq("id", med.id);
        if (error) throw error;
        toast({ title: "Success", description: `${med.medication_name} marked as given` });
        fetchMedications();
      } catch (err) {
        console.error("Error updating medication:", err);
        toast({ title: "Error", description: "Failed to update medication", variant: "destructive" });
      }
    };

    const markAsMissed = async () => {
      if (!missedDialog) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from("medication_administration") as any)
          .update({
            status: "missed",
            missed_reason: missedReason,
          })
          .eq("id", missedDialog.id);
        if (error) throw error;
        toast({ title: "Updated", description: `${missedDialog.medication_name} marked as missed` });
        setMissedDialog(null);
        setMissedReason("");
        fetchMedications();
      } catch (err) {
        console.error("Error updating medication:", err);
        toast({ title: "Error", description: "Failed to update medication", variant: "destructive" });
      }
    };

    const addMedication = async () => {
      if (!selectedPatient || !newMed.medication_name) return;
      try {
        const record = {
          visit_id: selectedPatient.id,
          patient_id: selectedPatient.patient_id,
          medication_name: newMed.medication_name,
          dose: newMed.dose,
          route: newMed.route,
          frequency: newMed.frequency,
          scheduled_time: newMed.scheduled_time || new Date().toISOString(),
          status: "pending",
          notes: newMed.notes || null,
          created_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("medication_administration").insert(record as any);
        if (error) throw error;
        toast({ title: "Success", description: "Medication added successfully" });
        setAddMedDialog(false);
        setNewMed({ medication_name: "", dose: "", route: "Oral", frequency: "OD", scheduled_time: "", notes: "" });
        fetchMedications();
      } catch (err) {
        console.error("Error adding medication:", err);
        toast({ title: "Error", description: "Failed to add medication", variant: "destructive" });
      }
    };

    return (
      <div className="space-y-6">
        <PatientSelector />

        {!selectedPatient ? (
          <p className="text-center text-muted-foreground py-8">Please select a patient to continue.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Pill className="h-5 w-5 text-blue-600" />
                Medication Administration Record
              </h3>
              <Button onClick={() => setAddMedDialog(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Medication
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {medLoading ? (
                  <div className="p-6"><LoadingSkeleton rows={4} /></div>
                ) : medications.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No medications found for this patient.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medication</TableHead>
                        <TableHead>Dose</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Scheduled Time</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Administered</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medications.map((med) => (
                        <TableRow key={med.id}>
                          <TableCell className="font-medium">{med.medication_name}</TableCell>
                          <TableCell>{med.dose || "-"}</TableCell>
                          <TableCell>{med.route || "-"}</TableCell>
                          <TableCell>{med.frequency || "-"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {med.scheduled_time
                              ? format(new Date(med.scheduled_time), "dd MMM HH:mm")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge className={MED_STATUS_COLORS[med.status] || "bg-gray-100"}>
                              {med.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {med.administered_at
                              ? format(new Date(med.administered_at), "dd MMM HH:mm")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {med.status === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={() => markAsGiven(med)}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Given
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 border-red-300 hover:bg-red-50"
                                  onClick={() => {
                                    setMissedDialog(med);
                                    setMissedReason("");
                                  }}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Missed
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Missed Reason Dialog */}
            <Dialog open={!!missedDialog} onOpenChange={() => setMissedDialog(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reason for Missed Medication</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Please provide a reason for missing{" "}
                    <span className="font-medium">{missedDialog?.medication_name}</span>.
                  </p>
                  <Textarea
                    value={missedReason}
                    onChange={(e) => setMissedReason(e.target.value)}
                    placeholder="Enter reason..."
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setMissedDialog(null)}>Cancel</Button>
                  <Button variant="destructive" onClick={markAsMissed} disabled={!missedReason.trim()}>
                    Confirm Missed
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Add Medication Dialog */}
            <Dialog open={addMedDialog} onOpenChange={setAddMedDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Medication</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Medication Name</Label>
                    <Input
                      value={newMed.medication_name}
                      onChange={(e) => setNewMed({ ...newMed, medication_name: e.target.value })}
                      placeholder="e.g., Paracetamol 500mg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Dose</Label>
                      <Input
                        value={newMed.dose}
                        onChange={(e) => setNewMed({ ...newMed, dose: e.target.value })}
                        placeholder="e.g., 1 tablet"
                      />
                    </div>
                    <div>
                      <Label>Route</Label>
                      <Select
                        value={newMed.route}
                        onValueChange={(val) => setNewMed({ ...newMed, route: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["Oral", "IV", "IM", "SC", "Topical", "Inhalation", "Rectal", "Sublingual"].map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Frequency</Label>
                      <Select
                        value={newMed.frequency}
                        onValueChange={(val) => setNewMed({ ...newMed, frequency: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["OD", "BD", "TDS", "QID", "SOS", "Stat", "HS", "AC", "PC"].map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Scheduled Time</Label>
                      <Input
                        type="datetime-local"
                        value={newMed.scheduled_time}
                        onChange={(e) => setNewMed({ ...newMed, scheduled_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={newMed.notes}
                      onChange={(e) => setNewMed({ ...newMed, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddMedDialog(false)}>Cancel</Button>
                  <Button onClick={addMedication} disabled={!newMed.medication_name.trim()}>
                    <Plus className="h-4 w-4 mr-2" /> Add Medication
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  };

  // =========================================================================
  // TAB 4: NURSING CARE PLAN
  // =========================================================================
  const CarePlanTab = () => {
    const [shift, setShift] = useState<string>(() => {
      const h = new Date().getHours();
      if (h >= 6 && h < 14) return "morning";
      if (h >= 14 && h < 22) return "afternoon";
      return "night";
    });
    const [carePlans, setCarePlans] = useState<CarePlan[]>([]);
    const [cpLoading, setCpLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Assessment form
    const [consciousness, setConsciousness] = useState("alert");
    const [mobility, setMobility] = useState("ambulatory");
    const [skinIntegrity, setSkinIntegrity] = useState("intact");
    const [fallRisk, setFallRisk] = useState("low");
    const [bradenScore, setBradenScore] = useState("");

    // Care tasks
    const [careTasks, setCareTasks] = useState<Array<{ task: string; done: boolean }>>(
      DEFAULT_CARE_TASKS.map((t) => ({ task: t, done: false }))
    );

    // Handover notes
    const [handoverNotes, setHandoverNotes] = useState("");
    const [nurseName, setNurseName] = useState("");

    const fetchCarePlans = useCallback(async () => {
      if (!selectedPatient) return;
      setCpLoading(true);
      try {
        const { data, error } = await supabase
          .from("nursing_care_plan")
          .select("*")
          .eq("visit_id", selectedPatient.id)
          .order("shift_date", { ascending: false });
        if (error) throw error;
        setCarePlans((data as any[]) || []);
      } catch (err) {
        console.error("Error fetching care plans:", err);
      } finally {
        setCpLoading(false);
      }
    }, [selectedPatient]);

    useEffect(() => {
      fetchCarePlans();
    }, [fetchCarePlans]);

    const toggleTask = (index: number) => {
      setCareTasks((prev) =>
        prev.map((t, i) => (i === index ? { ...t, done: !t.done } : t))
      );
    };

    const handleSaveCarePlan = async () => {
      if (!selectedPatient || !nurseName.trim()) {
        toast({ title: "Required", description: "Please enter nurse name", variant: "destructive" });
        return;
      }
      setSaving(true);
      try {
        const record = {
          visit_id: selectedPatient.id,
          patient_id: selectedPatient.patient_id,
          shift,
          shift_date: format(new Date(), "yyyy-MM-dd"),
          nurse_name: nurseName,
          assessment: {
            consciousness,
            mobility,
            skin_integrity: skinIntegrity,
            fall_risk: fallRisk,
            braden_score: bradenScore,
          },
          care_tasks: careTasks,
          handover_notes: handoverNotes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("nursing_care_plan").insert(record as any);
        if (error) throw error;
        toast({ title: "Success", description: "Care plan saved successfully" });
        fetchCarePlans();
      } catch (err) {
        console.error("Error saving care plan:", err);
        toast({ title: "Error", description: "Failed to save care plan", variant: "destructive" });
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="space-y-6">
        <PatientSelector />

        {!selectedPatient ? (
          <p className="text-center text-muted-foreground py-8">Please select a patient to continue.</p>
        ) : (
          <>
            {/* Shift & Nurse Selection */}
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <Label className="text-xs">Shift</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning (6-14)</SelectItem>
                    <SelectItem value="afternoon">Afternoon (14-22)</SelectItem>
                    <SelectItem value="night">Night (22-6)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Nurse Name</Label>
                <Input
                  value={nurseName}
                  onChange={(e) => setNurseName(e.target.value)}
                  placeholder="Enter nurse name"
                  className="w-[200px]"
                />
              </div>
            </div>

            {/* Assessment Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  Patient Assessment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  <div>
                    <Label className="text-xs">Consciousness Level</Label>
                    <Select value={consciousness} onValueChange={setConsciousness}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Alert", "Verbal", "Pain", "Unresponsive", "Confused", "Drowsy"].map((c) => (
                          <SelectItem key={c} value={c.toLowerCase()}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Mobility</Label>
                    <Select value={mobility} onValueChange={setMobility}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Ambulatory", "Assisted", "Wheelchair", "Bed-bound", "Crutches"].map((m) => (
                          <SelectItem key={m} value={m.toLowerCase()}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Skin Integrity</Label>
                    <Select value={skinIntegrity} onValueChange={setSkinIntegrity}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Intact", "Impaired", "At Risk", "Wound Present"].map((s) => (
                          <SelectItem key={s} value={s.toLowerCase()}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Fall Risk</Label>
                    <Select value={fallRisk} onValueChange={setFallRisk}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Braden Score</Label>
                    <Input
                      type="number"
                      min={6}
                      max={23}
                      value={bradenScore}
                      onChange={(e) => setBradenScore(e.target.value)}
                      placeholder="6-23"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Care Tasks Checklist */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Care Tasks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {careTasks.map((task, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Checkbox
                        id={`task-${idx}`}
                        checked={task.done}
                        onCheckedChange={() => toggleTask(idx)}
                      />
                      <Label htmlFor={`task-${idx}`} className="text-sm cursor-pointer">
                        {task.task}
                      </Label>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Handover Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Handover Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder="Enter shift handover notes, observations, and pending tasks for the next shift..."
                  rows={4}
                />
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleSaveCarePlan} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save Care Plan"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Past Care Plans */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Past Care Plans</CardTitle>
              </CardHeader>
              <CardContent>
                {cpLoading ? (
                  <LoadingSkeleton rows={3} />
                ) : carePlans.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6">No care plans recorded yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Shift</TableHead>
                        <TableHead>Nurse</TableHead>
                        <TableHead>Assessment</TableHead>
                        <TableHead>Tasks Completed</TableHead>
                        <TableHead>Handover Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {carePlans.map((cp) => {
                        const assessment = cp.assessment as Record<string, string> | null;
                        const tasks = cp.care_tasks as Array<{ task: string; done: boolean }> | null;
                        const completedTasks = tasks ? tasks.filter((t) => t.done).length : 0;
                        const totalTasks = tasks ? tasks.length : 0;
                        return (
                          <TableRow key={cp.id}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {cp.shift_date ? format(new Date(cp.shift_date), "dd MMM yyyy") : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">{cp.shift}</Badge>
                            </TableCell>
                            <TableCell>{cp.nurse_name}</TableCell>
                            <TableCell className="text-xs">
                              {assessment ? (
                                <span>
                                  {assessment.consciousness && <span className="capitalize">{assessment.consciousness}</span>}
                                  {assessment.fall_risk && (
                                    <Badge
                                      variant="outline"
                                      className={`ml-1 text-xs ${
                                        assessment.fall_risk === "high"
                                          ? "bg-red-50 text-red-700"
                                          : assessment.fall_risk === "medium"
                                          ? "bg-yellow-50 text-yellow-700"
                                          : "bg-green-50 text-green-700"
                                      }`}
                                    >
                                      Fall: {assessment.fall_risk}
                                    </Badge>
                                  )}
                                </span>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell>
                              <span className={completedTasks === totalTasks && totalTasks > 0 ? "text-green-700 font-medium" : ""}>
                                {completedTasks}/{totalTasks}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs">
                              {cp.handover_notes || "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  // =========================================================================
  // TAB 5: IO CHART (Intake/Output)
  // =========================================================================
  const IOChartTab = () => {
    const [entries, setEntries] = useState<IOEntry[]>([]);
    const [ioLoading, setIoLoading] = useState(false);

    // Intake form
    const [intakeCategory, setIntakeCategory] = useState("IV Fluid");
    const [intakeSubCategory, setIntakeSubCategory] = useState("");
    const [intakeVolume, setIntakeVolume] = useState("");
    const [intakeRate, setIntakeRate] = useState("");
    const [intakeNotes, setIntakeNotes] = useState("");

    // Output form
    const [outputCategory, setOutputCategory] = useState("Urine");
    const [outputVolume, setOutputVolume] = useState("");
    const [outputNotes, setOutputNotes] = useState("");

    const [saving, setSaving] = useState(false);

    const fetchIOEntries = useCallback(async () => {
      if (!selectedPatient) return;
      setIoLoading(true);
      try {
        // Fetch today's entries
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data, error } = await supabase
          .from("io_chart")
          .select("*")
          .eq("visit_id", selectedPatient.id)
          .gte("recorded_at", todayStart.toISOString())
          .order("recorded_at", { ascending: false });
        if (error) throw error;
        setEntries((data as any[]) || []);
      } catch (err) {
        console.error("Error fetching IO entries:", err);
      } finally {
        setIoLoading(false);
      }
    }, [selectedPatient]);

    useEffect(() => {
      fetchIOEntries();
    }, [fetchIOEntries]);

    const addEntry = async (type: "intake" | "output") => {
      if (!selectedPatient) return;
      setSaving(true);
      try {
        const record: Record<string, any> = {
          visit_id: selectedPatient.id,
          patient_id: selectedPatient.patient_id,
          recorded_by: "Nurse",
          recorded_at: new Date().toISOString(),
          entry_type: type,
          ward: selectedPatient.ward || null,
          bed_no: selectedPatient.bed_no || null,
        };

        if (type === "intake") {
          if (!intakeVolume) {
            toast({ title: "Required", description: "Please enter volume", variant: "destructive" });
            setSaving(false);
            return;
          }
          record.category = intakeCategory;
          record.sub_category = intakeSubCategory || null;
          record.volume_ml = Number(intakeVolume);
          record.rate_ml_hr = intakeRate ? Number(intakeRate) : null;
          record.notes = intakeNotes || null;
        } else {
          if (!outputVolume) {
            toast({ title: "Required", description: "Please enter volume", variant: "destructive" });
            setSaving(false);
            return;
          }
          record.category = outputCategory;
          record.volume_ml = Number(outputVolume);
          record.notes = outputNotes || null;
        }

        const { error } = await supabase.from("io_chart").insert(record as any);
        if (error) throw error;
        toast({ title: "Success", description: `${type === "intake" ? "Intake" : "Output"} entry recorded` });

        // Reset forms
        if (type === "intake") {
          setIntakeVolume("");
          setIntakeRate("");
          setIntakeSubCategory("");
          setIntakeNotes("");
        } else {
          setOutputVolume("");
          setOutputNotes("");
        }
        fetchIOEntries();
      } catch (err) {
        console.error("Error adding IO entry:", err);
        toast({ title: "Error", description: "Failed to save entry", variant: "destructive" });
      } finally {
        setSaving(false);
      }
    };

    // Calculate 24h summary
    const totalIntake = entries
      .filter((e) => e.entry_type === "intake")
      .reduce((sum, e) => sum + (e.volume_ml || 0), 0);
    const totalOutput = entries
      .filter((e) => e.entry_type === "output")
      .reduce((sum, e) => sum + (e.volume_ml || 0), 0);
    const fluidBalance = totalIntake - totalOutput;

    // Low urine output warning: < 0.5 mL/kg/hr assumed ~30 mL/hr for 60kg patient = 720 mL/day
    const lowOutput = totalOutput < 500 && entries.length > 0;

    return (
      <div className="space-y-6">
        <PatientSelector />

        {!selectedPatient ? (
          <p className="text-center text-muted-foreground py-8">Please select a patient to continue.</p>
        ) : (
          <>
            {/* 24h Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Intake (24h)</p>
                      <p className="text-2xl font-bold text-blue-600">{totalIntake} mL</p>
                    </div>
                    <Droplets className="h-8 w-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-orange-500">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Output (24h)</p>
                      <p className="text-2xl font-bold text-orange-600">{totalOutput} mL</p>
                    </div>
                    {lowOutput && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Low Output
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className={`border-l-4 ${fluidBalance >= 0 ? "border-l-green-500" : "border-l-red-500"}`}>
                <CardContent className="p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Fluid Balance</p>
                    <p className={`text-2xl font-bold ${fluidBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fluidBalance >= 0 ? "+" : ""}{fluidBalance} mL
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Input Forms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Intake Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg text-blue-700">Add Intake</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Category</Label>
                    <Select value={intakeCategory} onValueChange={setIntakeCategory}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["IV Fluid", "Oral", "Blood Products", "Feeds"].map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Sub-category</Label>
                    <Input
                      value={intakeSubCategory}
                      onChange={(e) => setIntakeSubCategory(e.target.value)}
                      placeholder="e.g., NS 0.9%, RL, DNS"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Volume (mL)</Label>
                      <Input
                        type="number"
                        value={intakeVolume}
                        onChange={(e) => setIntakeVolume(e.target.value)}
                        placeholder="500"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Rate (mL/hr)</Label>
                      <Input
                        type="number"
                        value={intakeRate}
                        onChange={(e) => setIntakeRate(e.target.value)}
                        placeholder="100"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input value={intakeNotes} onChange={(e) => setIntakeNotes(e.target.value)} placeholder="Optional" />
                  </div>
                  <Button className="w-full" onClick={() => addEntry("intake")} disabled={saving}>
                    <Plus className="h-4 w-4 mr-2" /> Add Intake
                  </Button>
                </CardContent>
              </Card>

              {/* Output Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg text-orange-700">Add Output</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Category</Label>
                    <Select value={outputCategory} onValueChange={setOutputCategory}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Urine", "Drain", "Vomiting", "Stool", "Other"].map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Volume (mL)</Label>
                    <Input
                      type="number"
                      value={outputVolume}
                      onChange={(e) => setOutputVolume(e.target.value)}
                      placeholder="200"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input value={outputNotes} onChange={(e) => setOutputNotes(e.target.value)} placeholder="Optional" />
                  </div>
                  <Button className="w-full" variant="outline" onClick={() => addEntry("output")} disabled={saving}>
                    <Plus className="h-4 w-4 mr-2" /> Add Output
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Entries Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Today's IO Entries</CardTitle>
              </CardHeader>
              <CardContent>
                {ioLoading ? (
                  <LoadingSkeleton rows={4} />
                ) : entries.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6">No entries recorded today.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Sub-category</TableHead>
                        <TableHead>Volume (mL)</TableHead>
                        <TableHead>Rate (mL/hr)</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {format(new Date(e.recorded_at), "HH:mm")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                e.entry_type === "intake"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-orange-50 text-orange-700"
                              }
                            >
                              {e.entry_type}
                            </Badge>
                          </TableCell>
                          <TableCell>{e.category}</TableCell>
                          <TableCell>{e.sub_category || "-"}</TableCell>
                          <TableCell className="font-medium">{e.volume_ml}</TableCell>
                          <TableCell>{e.rate_ml_hr || "-"}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{e.notes || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  // =========================================================================
  // TAB 6: NURSING ANALYTICS
  // =========================================================================
  const AnalyticsTab = () => {
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [wardData, setWardData] = useState<Array<{ ward: string; count: number }>>([]);
    const [medStats, setMedStats] = useState<Array<{ name: string; value: number }>>([]);
    const [vitalCompliance, setVitalCompliance] = useState(0);
    const [shiftTaskData, setShiftTaskData] = useState<Array<{ shift: string; completed: number; total: number }>>([]);
    const [totalVitalsRecorded, setTotalVitalsRecorded] = useState(0);
    const [totalMeds, setTotalMeds] = useState(0);

    const fetchAnalytics = useCallback(async () => {
      setAnalyticsLoading(true);
      try {
        // 1. Patient count per ward
        const wardMap = new Map<string, number>();
        patients.forEach((p) => {
          const w = p.ward || "Unassigned";
          wardMap.set(w, (wardMap.get(w) || 0) + 1);
        });
        setWardData(Array.from(wardMap.entries()).map(([ward, count]) => ({ ward, count })));

        // 2. Vital sign recording compliance (vitals recorded today vs expected: 3 per patient per day)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: vitalsToday, error: vitalsErr } = await supabase
          .from("vital_signs")
          .select("id")
          .gte("recorded_at", todayStart.toISOString());
        if (vitalsErr) throw vitalsErr;
        const vitalsCount = vitalsToday?.length || 0;
        setTotalVitalsRecorded(vitalsCount);
        const expectedVitals = patients.length * 3; // 3 vitals expected per patient per day
        setVitalCompliance(expectedVitals > 0 ? Math.round((vitalsCount / expectedVitals) * 100) : 0);

        // 3. Medication administration stats
        const { data: allMeds, error: medsErr } = await supabase
          .from("medication_administration")
          .select("status")
          .gte("created_at", todayStart.toISOString());
        if (medsErr) throw medsErr;

        const medCountMap = new Map<string, number>();
        (allMeds || []).forEach((m: any) => {
          const s = m.status || "pending";
          medCountMap.set(s, (medCountMap.get(s) || 0) + 1);
        });
        setTotalMeds(allMeds?.length || 0);
        setMedStats(
          Array.from(medCountMap.entries()).map(([name, value]) => ({ name, value }))
        );

        // 4. Shift-wise task completion
        const { data: carePlansData, error: cpErr } = await supabase
          .from("nursing_care_plan")
          .select("shift, care_tasks")
          .gte("shift_date", format(new Date(), "yyyy-MM-dd"));
        if (cpErr) throw cpErr;

        const shiftMap = new Map<string, { completed: number; total: number }>();
        (carePlansData || []).forEach((cp: any) => {
          const s = cp.shift || "unknown";
          const tasks = cp.care_tasks as Array<{ task: string; done: boolean }> | null;
          const done = tasks ? tasks.filter((t) => t.done).length : 0;
          const total = tasks ? tasks.length : 0;
          const existing = shiftMap.get(s) || { completed: 0, total: 0 };
          shiftMap.set(s, { completed: existing.completed + done, total: existing.total + total });
        });
        setShiftTaskData(
          Array.from(shiftMap.entries()).map(([shift, val]) => ({ shift, ...val }))
        );
      } catch (err) {
        console.error("Error fetching analytics:", err);
      } finally {
        setAnalyticsLoading(false);
      }
    }, [patients]);

    useEffect(() => {
      fetchAnalytics();
    }, [fetchAnalytics]);

    if (analyticsLoading) {
      return (
        <div className="space-y-4">
          <LoadingSkeleton rows={8} />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Summary Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total Patients</p>
              <p className="text-2xl font-bold">{patients.length}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Vitals Recorded Today</p>
              <p className="text-2xl font-bold">{totalVitalsRecorded}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Vital Compliance</p>
              <p className={`text-2xl font-bold ${vitalCompliance >= 80 ? "text-green-600" : vitalCompliance >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                {vitalCompliance}%
              </p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Medications Today</p>
              <p className="text-2xl font-bold">{totalMeds}</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Ward-wise Patient Count */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patients per Ward</CardTitle>
            </CardHeader>
            <CardContent>
              {wardData.length === 0 ? (
                <p className="text-center text-muted-foreground py-6">No ward data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={wardData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="ward" fontSize={11} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Medication Status Pie */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Medication Administration</CardTitle>
            </CardHeader>
            <CardContent>
              {medStats.length === 0 ? (
                <p className="text-center text-muted-foreground py-6">No medication data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={medStats}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {medStats.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Shift-wise Task Completion */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Shift-wise Task Completion (Today)</CardTitle>
          </CardHeader>
          <CardContent>
            {shiftTaskData.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No shift data available for today.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={shiftTaskData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="shift" fontSize={12} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="total" fill="#94a3b8" name="Total" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  // =========================================================================
  // MAIN RENDER
  // =========================================================================
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Nursing Station</h1>
            <p className="text-sm text-muted-foreground">
              Patient monitoring, vitals, medications, and care management
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
            <TabsTrigger value="dashboard" className="flex items-center gap-1 text-xs md:text-sm">
              <Users className="h-4 w-4" />
              <span className="hidden md:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="vitals" className="flex items-center gap-1 text-xs md:text-sm">
              <Heart className="h-4 w-4" />
              <span className="hidden md:inline">Vitals</span>
            </TabsTrigger>
            <TabsTrigger value="medication" className="flex items-center gap-1 text-xs md:text-sm">
              <Pill className="h-4 w-4" />
              <span className="hidden md:inline">MAR</span>
            </TabsTrigger>
            <TabsTrigger value="careplan" className="flex items-center gap-1 text-xs md:text-sm">
              <ClipboardList className="h-4 w-4" />
              <span className="hidden md:inline">Care Plan</span>
            </TabsTrigger>
            <TabsTrigger value="iochart" className="flex items-center gap-1 text-xs md:text-sm">
              <Droplets className="h-4 w-4" />
              <span className="hidden md:inline">IO Chart</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1 text-xs md:text-sm">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden md:inline">Analytics</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="vitals">
            <VitalSignsTab />
          </TabsContent>
          <TabsContent value="medication">
            <MedicationTab />
          </TabsContent>
          <TabsContent value="careplan">
            <CarePlanTab />
          </TabsContent>
          <TabsContent value="iochart">
            <IOChartTab />
          </TabsContent>
          <TabsContent value="analytics">
            <AnalyticsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default NursingStation;
