import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  Upload,
  UserRound,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
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
  ward: string | null;
  room: string | null;
}

interface OTScheduleItem {
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
}

const todayDate = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const normalizeStatus = (value: string | null | undefined) => (value || "scheduled").replace(/_/g, " ");

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
    ward: row.ward_allotted || null,
    room: row.room_allotted || null,
  };
}

function mapSchedule(row: any): OTScheduleItem {
  const patient = rowPatient(row);
  const visit = rowVisit(row);
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
    status: row.status || "scheduled",
    actualEndTime: row.actual_end_time || null,
    surgeryDate: visit?.surgery_date || null,
    packageName: visit?.package_name || null,
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

function useDailySchedule(date: string) {
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
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const completed = status === "completed";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${completed ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
      {normalizeStatus(status)}
    </span>
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
  const [otRoom, setOtRoom] = useState("OT");
  const [saving, setSaving] = useState(false);

  const visibleRooms = rooms.data?.length ? rooms.data : ["OT"];

  const selectVisit = (visit: VisitOption) => {
    setSelected(visit);
    setSurgeryName(visit.packageName || "");
    setOtRoom(visibleRooms[0] || "OT");
  };

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
      const { error } = await supabase.from("ot_schedule").insert({
        patient_id: selected.patientId,
        visit_id: selected.id,
        surgery_name: surgeryName.trim(),
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        ot_room: otRoom || "OT",
        urgency: "elective",
        status: "scheduled",
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["tablet-daily-ot-schedule"] });
      toast({ title: "OT scheduled", description: `${selected.patientName} added for ${formatDateTime(scheduledDate, scheduledTime)}.` });
      setSelected(null);
      setSearch("");
      setSurgeryName("");
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
    <FlowScaffold heading="OT Schedule - Gaurav" subheading="Search a patient and add planned surgery date and time.">
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
            <TabletInput value={surgeryName} onChange={(event) => setSurgeryName(event.target.value)} placeholder="Surgery name" />
          </label>

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
    </FlowScaffold>
  );
}

function SarveshWorklist() {
  const { user, hospitalConfig } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const chooseRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayDate());
  const schedule = useDailySchedule(date);
  const [selected, setSelected] = useState<OTScheduleItem | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const docs = usePatientDocs(selected?.patientId || undefined, "ot_photos");

  const completedCount = useMemo(
    () => (schedule.data || []).filter((row) => row.status === "completed" || row.surgeryDate).length,
    [schedule.data],
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tablet-daily-ot-schedule"] }),
      selected?.patientId ? qc.invalidateQueries({ queryKey: ["tablet-patient-docs", selected.patientId, "ot_photos"] }) : Promise.resolve(),
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

              <MultiShotCamera
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(photos) => void uploadOtPhotos(photos)}
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
