import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Calendar, Clock, User, Phone, CheckCircle, X, AlertCircle, MessageCircle } from 'lucide-react';
import { format, addMinutes, getDay, parseISO } from 'date-fns';
import { composeAppointmentReminder, openWhatsApp } from '@/lib/patient-whatsapp';

// DATA SOURCE: appointments → doctor_id + appointment_date

// ─── Types ────────────────────────────────────────────────────────────────────

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  qualification: string | null;
  consultation_fee: number | null;
  available_days: string[];
  slot_duration_minutes: number;
  room_number: string | null;
  is_active: boolean;
}

interface Appointment {
  id: string;
  doctor_id: string;
  patient_id: string | null;
  patient_name: string;
  patient_mobile: string | null;
  patient_age: number | null;
  appointment_date: string;
  time_slot: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  chief_complaint: string | null;
  notes: string | null;
  visit_id: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATUS_CONFIG: Record<
  Appointment['status'],
  { label: string; className: string }
> = {
  scheduled: { label: 'Scheduled', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-800 border-green-200' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800 border-red-200' },
  no_show: { label: 'No Show', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate HH:mm time slots between startHour and endHour using durationMins intervals */
function generateSlots(startHour: number, endHour: number, durationMins: number): string[] {
  const slots: string[] = [];
  let current = new Date();
  current.setHours(startHour, 0, 0, 0);
  const end = new Date();
  end.setHours(endHour, 0, 0, 0);
  while (current < end) {
    slots.push(format(current, 'HH:mm'));
    current = addMinutes(current, durationMins);
  }
  return slots;
}

/** Return today's date as YYYY-MM-DD string */
function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Appointment['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function AppointmentRow({
  appt,
  doctorName,
  onStatusChange,
  isUpdating,
}: {
  appt: Appointment;
  doctorName: string | null;
  onStatusChange: (id: string, status: Appointment['status']) => void;
  isUpdating: boolean;
}) {
  const canConfirm = appt.status === 'scheduled';
  const canRemind =
    (appt.status === 'scheduled' || appt.status === 'confirmed') && Boolean(appt.patient_mobile);

  const sendReminder = () => {
    const whenLabel = `${format(parseISO(appt.appointment_date), 'dd MMM yyyy')} at ${appt.time_slot}`;
    const message = composeAppointmentReminder(appt.patient_name, whenLabel, doctorName);
    if (!openWhatsApp(appt.patient_mobile, message)) {
      toast.error('This patient has no usable mobile number on record.');
    }
  };
  const canComplete = appt.status === 'confirmed';
  const canNoShow = appt.status === 'scheduled' || appt.status === 'confirmed';
  const canCancel = appt.status === 'scheduled' || appt.status === 'confirmed';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-gray-100 rounded-lg bg-white hover:bg-gray-50 transition-colors">
      {/* Time slot */}
      <div className="flex items-center gap-1.5 min-w-[60px]">
        <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span className="text-sm font-semibold text-gray-800">{appt.time_slot}</span>
      </div>

      {/* Patient info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 text-sm">{appt.patient_name}</span>
          {appt.patient_age != null && (
            <span className="text-xs text-gray-500">{appt.patient_age}y</span>
          )}
          <StatusBadge status={appt.status} />
        </div>
        {appt.patient_mobile && (
          <div className="flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">{appt.patient_mobile}</span>
          </div>
        )}
        {appt.chief_complaint && (
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{appt.chief_complaint}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {canRemind && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 text-green-700 border-green-200 hover:bg-green-50"
            onClick={sendReminder}
            title="Send an appointment reminder on WhatsApp"
          >
            <MessageCircle className="w-3 h-3 mr-1" />
            Remind
          </Button>
        )}
        {canConfirm && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 text-blue-700 border-blue-200 hover:bg-blue-50"
            disabled={isUpdating}
            onClick={() => onStatusChange(appt.id, 'confirmed')}
          >
            <CheckCircle className="w-3 h-3 mr-1" />
            Confirm
          </Button>
        )}
        {canComplete && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 text-green-700 border-green-200 hover:bg-green-50"
            disabled={isUpdating}
            onClick={() => onStatusChange(appt.id, 'completed')}
          >
            <CheckCircle className="w-3 h-3 mr-1" />
            Complete
          </Button>
        )}
        {canNoShow && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 text-gray-600 border-gray-200 hover:bg-gray-50"
            disabled={isUpdating}
            onClick={() => onStatusChange(appt.id, 'no_show')}
          >
            <AlertCircle className="w-3 h-3 mr-1" />
            No Show
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2 text-red-700 border-red-200 hover:bg-red-50"
            disabled={isUpdating}
            onClick={() => onStatusChange(appt.id, 'cancelled')}
          >
            <X className="w-3 h-3 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const Appointments = () => {
  const queryClient = useQueryClient();

  // Booking form state
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [patientName, setPatientName] = useState('');
  const [patientMobile, setPatientMobile] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');

  // Right-panel filter state
  const [filterDoctorId, setFilterDoctorId] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>(todayStr());

  // ── Data: doctors list ──────────────────────────────────────────────────────
  // DATA SOURCE: doctors table → is_active = true
  const { data: doctors = [], isLoading: doctorsLoading } = useQuery<Doctor[]>({
    queryKey: ['appointments-doctors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('doctors')
        .select('id, name, specialty, qualification, consultation_fee, available_days, slot_duration_minutes, room_number, is_active')
        .eq('is_active', true)
        .order('name');
      if (error) {
        console.error('Error fetching doctors:', error);
        throw error;
      }
      return (data ?? []) as Doctor[];
    },
    staleTime: 300000, // 5 min — doctor list changes rarely
  });

  // ── Data: booked slots for selected doctor + date (booking form) ─────────────
  // DATA SOURCE: appointments → doctor_id + appointment_date (for slot availability)
  const { data: bookedSlots = [] } = useQuery<string[]>({
    queryKey: ['booked-slots', selectedDoctorId, selectedDate],
    queryFn: async () => {
      if (!selectedDoctorId || !selectedDate) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('time_slot')
        .eq('doctor_id', selectedDoctorId)
        .eq('appointment_date', selectedDate)
        .not('status', 'in', '("cancelled","no_show")');
      if (error) {
        console.error('Error fetching booked slots:', error);
        throw error;
      }
      return (data ?? []).map((r: { time_slot: string }) => r.time_slot);
    },
    enabled: !!selectedDoctorId && !!selectedDate,
    staleTime: 30000, // 30s — slots refresh fairly often
  });

  // ── Data: appointments list (right panel) ────────────────────────────────────
  // DATA SOURCE: appointments → doctor_id + appointment_date
  const { data: appointments = [], isLoading: apptLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments-list', filterDoctorId, filterDate],
    queryFn: async () => {
      let query = supabase
        .from('appointments')
        .select('*')
        .eq('appointment_date', filterDate)
        .order('time_slot', { ascending: true });

      if (filterDoctorId && filterDoctorId !== 'all') {
        query = query.eq('doctor_id', filterDoctorId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching appointments:', error);
        throw error;
      }
      return (data ?? []) as Appointment[];
    },
    staleTime: 15000, // 15s
  });

  // ── Mutation: book appointment ────────────────────────────────────────────────
  const bookMutation = useMutation({
    mutationFn: async (payload: {
      doctor_id: string;
      appointment_date: string;
      time_slot: string;
      patient_name: string;
      patient_mobile: string | null;
      patient_age: number | null;
      chief_complaint: string | null;
    }) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          ...payload,
          status: 'scheduled',
          created_by: 'reception',
        })
        .select()
        .single();
      if (error) {
        console.error('Error booking appointment:', error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booked-slots', selectedDoctorId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['appointments-list'] });
      toast.success('Appointment booked successfully');
      // Reset form
      setSelectedSlot('');
      setPatientName('');
      setPatientMobile('');
      setPatientAge('');
      setChiefComplaint('');
    },
    onError: (error: Error) => {
      toast.error(`Failed to book appointment: ${error.message}`);
    },
  });

  // ── Mutation: update appointment status ────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Appointment['status'] }) => {
      const { error } = await supabase
        .from('appointments')
        .update({ status })
        .eq('id', id);
      if (error) {
        console.error('Error updating appointment status:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments-list'] });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`);
    },
  });

  // ── Derived values ────────────────────────────────────────────────────────────

  /** The selected doctor object */
  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId) ?? null;

  /** Day name for selected date (e.g. "Monday") */
  const selectedDayName = selectedDate ? DAY_NAMES[getDay(new Date(selectedDate + 'T00:00:00'))] : '';

  /** Whether the selected doctor is available on the selected date */
  const isDoctorAvailable =
    selectedDoctor && selectedDate
      ? selectedDoctor.available_days.includes(selectedDayName)
      : true;

  /** All possible time slots for the selected doctor */
  const allSlots: string[] =
    selectedDoctor && selectedDate && isDoctorAvailable
      ? generateSlots(8, 18, selectedDoctor.slot_duration_minutes)
      : [];

  // ── Event handlers ────────────────────────────────────────────────────────────

  function handleBookAppointment() {
    if (!selectedDoctorId) return toast.error('Please select a doctor');
    if (!selectedDate) return toast.error('Please select a date');
    if (!selectedSlot) return toast.error('Please select a time slot');
    if (!patientName.trim()) return toast.error('Patient name is required');
    if (patientMobile && !/^\d{10}$/.test(patientMobile)) {
      return toast.error('Mobile number must be 10 digits');
    }

    bookMutation.mutate({
      doctor_id: selectedDoctorId,
      appointment_date: selectedDate,
      time_slot: selectedSlot,
      patient_name: patientName.trim(),
      patient_mobile: patientMobile || null,
      patient_age: patientAge ? parseInt(patientAge, 10) : null,
      chief_complaint: chiefComplaint.trim() || null,
    });
  }

  function handleStatusChange(id: string, status: Appointment['status']) {
    statusMutation.mutate({ id, status });
  }

  // ── Counts ────────────────────────────────────────────────────────────────────

  const todayTotal = appointments.filter(a => a.appointment_date === todayStr()).length;

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            {format(new Date(), 'EEEE, dd MMMM yyyy')}
          </p>
        </div>
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-sm px-3 py-1">
          {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} on selected date
        </Badge>
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── LEFT: Book Appointment ─────────────────────────────────────────── */}
        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Book Appointment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Doctor selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Doctor</label>
              {doctorsLoading ? (
                <p className="text-sm text-gray-400">Loading doctors…</p>
              ) : (
                <Select
                  value={selectedDoctorId}
                  onValueChange={val => {
                    setSelectedDoctorId(val);
                    setSelectedSlot('');
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map(doc => (
                      <SelectItem key={doc.id} value={doc.id}>
                        <span className="font-medium">{doc.name}</span>
                        {doc.specialty && (
                          <span className="text-gray-500 ml-1">— {doc.specialty}</span>
                        )}
                        {doc.room_number && (
                          <span className="text-gray-400 ml-1">· Room {doc.room_number}</span>
                        )}
                        {doc.consultation_fee != null && (
                          <span className="text-gray-400 ml-1">· ₹{doc.consultation_fee}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Date picker */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Date</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={e => {
                  setSelectedDate(e.target.value);
                  setSelectedSlot('');
                }}
                className="w-full"
              />
            </div>

            {/* Time slots */}
            {selectedDoctorId && selectedDate && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  Available Slots
                  {selectedDoctor && (
                    <span className="font-normal text-gray-400 text-xs">
                      ({selectedDoctor.slot_duration_minutes} min slots)
                    </span>
                  )}
                </label>

                {!isDoctorAvailable ? (
                  <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {selectedDoctor?.name} is not available on {selectedDayName}
                  </div>
                ) : allSlots.length === 0 ? (
                  <p className="text-sm text-gray-400">No slots generated</p>
                ) : (
                  <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {allSlots.map(slot => {
                      const isBooked = bookedSlots.includes(slot);
                      const isSelected = selectedSlot === slot;
                      return (
                        <button
                          key={slot}
                          disabled={isBooked}
                          onClick={() => setSelectedSlot(slot)}
                          className={`
                            text-xs py-1.5 px-1 rounded border font-medium transition-colors
                            ${isBooked
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}
                          `}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Patient Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                Patient Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Full name"
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Mobile + Age row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Mobile</label>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="10 digits"
                    value={patientMobile}
                    onChange={e => setPatientMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="pl-8"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Age</label>
                <Input
                  placeholder="Years"
                  value={patientAge}
                  onChange={e => setPatientAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  inputMode="numeric"
                />
              </div>
            </div>

            {/* Chief Complaint */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Chief Complaint</label>
              <Textarea
                placeholder="Reason for visit…"
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Book button */}
            <Button
              onClick={handleBookAppointment}
              disabled={bookMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {bookMutation.isPending ? 'Booking…' : 'Book Appointment'}
            </Button>
          </CardContent>
        </Card>

        {/* ── RIGHT: Appointments list ────────────────────────────────────────── */}
        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-gray-800 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                Appointments
              </span>
              <Badge variant="secondary" className="text-xs">
                {appointments.length} total
              </Badge>
            </CardTitle>

            {/* Filter bar */}
            <div className="flex gap-2 pt-1">
              <Select
                value={filterDoctorId}
                onValueChange={setFilterDoctorId}
              >
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue placeholder="All Doctors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Doctors</SelectItem>
                  {doctors.map(doc => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="w-auto h-8 text-xs"
              />
            </div>
          </CardHeader>

          <CardContent>
            {apptLoading ? (
              <p className="text-sm text-gray-400 py-4 text-center">Loading appointments…</p>
            ) : appointments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Calendar className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No appointments for this date</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                {appointments.map(appt => (
                  <AppointmentRow
                    key={appt.id}
                    appt={appt}
                    doctorName={doctors.find(d => d.id === appt.doctor_id)?.name ?? null}
                    onStatusChange={handleStatusChange}
                    isUpdating={statusMutation.isPending}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
};

export default Appointments;
