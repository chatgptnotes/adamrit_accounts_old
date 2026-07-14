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
import { Phone, Search, User, Calendar, MapPin, MessageCircle, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock } from 'lucide-react';
import { format } from 'date-fns';

// DATA SOURCE: call_logs + patients (mobile lookup) → caller ID + booking

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  id: string;
  name: string;
  mobile: string | null;
  age: number | null;
  gender: string | null;
}

interface Visit {
  id: string;
  patient_id: string;
  visit_type: string | null;
  status: string | null;
  created_at: string;
}

interface CallLog {
  id: string;
  caller_number: string;
  patient_id: string | null;
  patient_name: string | null;
  call_type: 'inbound' | 'outbound' | 'missed';
  action_taken: 'appointment' | 'home_collection' | 'report_query' | 'other' | 'no_action';
  notes: string | null;
  duration_seconds: number | null;
  handled_by: string | null;
  created_at: string;
}

type CallType = 'inbound' | 'outbound' | 'missed';
type ActionTaken = 'appointment' | 'home_collection' | 'report_query' | 'other' | 'no_action';

// ─── Badge helpers ────────────────────────────────────────────────────────────

/** Returns tailwind classes for call_type badge coloring */
function callTypeBadgeClass(type: string): string {
  switch (type) {
    case 'inbound':  return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'outbound': return 'bg-green-100 text-green-800 border-green-200';
    case 'missed':   return 'bg-red-100 text-red-800 border-red-200';
    default:         return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

/** Returns tailwind classes for action_taken badge coloring */
function actionBadgeClass(action: string): string {
  switch (action) {
    case 'appointment':     return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'home_collection': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'report_query':    return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'other':           return 'bg-gray-100 text-gray-700 border-gray-200';
    case 'no_action':       return 'bg-gray-100 text-gray-500 border-gray-200';
    default:                return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

/** Returns icon for call_type */
function CallTypeIcon({ type }: { type: string }) {
  if (type === 'inbound')  return <PhoneIncoming  className="h-3 w-3 inline mr-1" />;
  if (type === 'outbound') return <PhoneOutgoing  className="h-3 w-3 inline mr-1" />;
  if (type === 'missed')   return <PhoneMissed    className="h-3 w-3 inline mr-1" />;
  return <Phone className="h-3 w-3 inline mr-1" />;
}

/** Capitalises first letter and replaces underscores with spaces */
function humanLabel(str: string): string {
  return str.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TelephonyDashboard() {
  const queryClient = useQueryClient();

  // Active call state
  const [callerNumber, setCallerNumber]       = useState('');
  const [lookupNumber, setLookupNumber]       = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Log form state
  const [callType, setCallType]     = useState<CallType | ''>('');
  const [actionTaken, setActionTaken] = useState<ActionTaken | ''>('');
  const [notes, setNotes]           = useState('');

  // Call log search
  const [logSearch, setLogSearch] = useState('');

  // ── Patient lookup (manual trigger via Lookup button) ──────────────────────
  // DATA SOURCE: patients.mobile ILIKE '%<lookupNumber>%' → limit 5
  const {
    data: matchedPatients,
    isFetching: isLookingUp,
    refetch: runLookup,
  } = useQuery<Patient[]>({
    queryKey: ['patient-lookup', lookupNumber],
    queryFn: async () => {
      if (!lookupNumber.trim()) return [];
      const { data, error } = await supabase
        .from('patients')
        .select('id, name, mobile, age, gender')
        .ilike('mobile', `%${lookupNumber.trim()}%`)
        .limit(5);
      if (error) throw error;
      return (data ?? []) as Patient[];
    },
    enabled: false, // only runs when refetch() is called
  });

  // ── Recent visits for selected patient ────────────────────────────────────
  // DATA SOURCE: visits.patient_id → order created_at desc, limit 3
  const { data: recentVisits } = useQuery<Visit[]>({
    queryKey: ['patient-visits', selectedPatient?.id],
    queryFn: async () => {
      if (!selectedPatient) return [];
      const { data, error } = await supabase
        .from('visits')
        .select('id, patient_id, visit_type, status, created_at')
        .eq('patient_id', selectedPatient.id)
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
    enabled: !!selectedPatient,
  });

  // ── Recent call logs ──────────────────────────────────────────────────────
  // DATA SOURCE: call_logs → order created_at desc, limit 50, refetchInterval 60000
  const { data: callLogs, isLoading: logsLoading } = useQuery<CallLog[]>({
    queryKey: ['call-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('call_logs')
        .select('id, caller_number, patient_id, patient_name, call_type, action_taken, notes, duration_seconds, handled_by, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CallLog[];
    },
    refetchInterval: 60000,
  });

  // ── Save call log mutation ─────────────────────────────────────────────────
  const saveCallLog = useMutation({
    mutationFn: async () => {
      if (!callType)   throw new Error('Please select a call type.');
      if (!actionTaken) throw new Error('Please select an action taken.');
      if (!callerNumber.trim()) throw new Error('Caller number is required.');

      const payload = {
        caller_number: callerNumber.trim(),
        patient_id:    selectedPatient?.id ?? null,
        patient_name:  selectedPatient?.name ?? null,
        call_type:     callType as CallType,
        action_taken:  actionTaken as ActionTaken,
        notes:         notes.trim() || null,
        handled_by:    null, // future: wire to logged-in staff
      };

      const { error } = await supabase.from('call_logs').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Call logged successfully.');
      // Reset form
      setCallType('');
      setActionTaken('');
      setNotes('');
      setCallerNumber('');
      setLookupNumber('');
      setSelectedPatient(null);
      queryClient.invalidateQueries({ queryKey: ['call-logs'] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to save call log.');
    },
  });

  // ── Lookup handler ─────────────────────────────────────────────────────────
  function handleLookup() {
    if (!callerNumber.trim()) {
      toast.error('Enter a caller number first.');
      return;
    }
    setLookupNumber(callerNumber.trim());
    setSelectedPatient(null);
    // runLookup fires after state settles; use setTimeout 0 so lookupNumber is committed
    setTimeout(() => { runLookup(); }, 0);
  }

  // ── Filtered call logs ─────────────────────────────────────────────────────
  const filteredLogs = (callLogs ?? []).filter(log => {
    if (!logSearch.trim()) return true;
    const q = logSearch.toLowerCase();
    return (
      log.caller_number.toLowerCase().includes(q) ||
      (log.patient_name ?? '').toLowerCase().includes(q)
    );
  });

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-600 rounded-lg">
          <Phone className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Telephony Dashboard</h1>
          <p className="text-sm text-gray-500">Caller ID lookup · Call logging · Quick actions</p>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          Section 1: Active Call Panel
      ────────────────────────────────────────────────────────────────────── */}
      <Card className="border-blue-200 shadow-sm">
        <CardHeader className="bg-blue-50 rounded-t-lg pb-3">
          <CardTitle className="flex items-center gap-2 text-blue-900">
            <PhoneIncoming className="h-5 w-5" />
            Active Call
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">

          {/* Caller number input + Lookup */}
          <div className="flex gap-3 max-w-md">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Caller number (10 digits)"
                maxLength={15}
                value={callerNumber}
                onChange={e => setCallerNumber(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
              />
            </div>
            <Button
              onClick={handleLookup}
              disabled={isLookingUp}
              className="flex items-center gap-2"
            >
              <Search className="h-4 w-4" />
              {isLookingUp ? 'Looking up…' : 'Lookup'}
            </Button>
          </div>

          {/* Matched patients */}
          {matchedPatients && matchedPatients.length > 0 && !selectedPatient && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Matching Patients ({matchedPatients.length})
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {matchedPatients.map(patient => (
                  <button
                    key={patient.id}
                    onClick={() => setSelectedPatient(patient)}
                    className="text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="font-semibold text-gray-900 text-sm truncate">{patient.name}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 space-y-0.5 pl-6">
                      <div>{patient.mobile ?? '—'}</div>
                      <div>
                        {patient.age != null ? `${patient.age} yrs` : '—'}
                        {patient.gender ? ` · ${patient.gender}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedPatients && matchedPatients.length === 0 && lookupNumber && (
            <p className="text-sm text-gray-500 italic">
              No patients found matching <strong>{lookupNumber}</strong>. You can still log the call below.
            </p>
          )}

          {/* Selected patient card + recent visits */}
          {selectedPatient && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-200 rounded-full">
                    <User className="h-5 w-5 text-blue-700" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{selectedPatient.name}</p>
                    <p className="text-sm text-gray-600">
                      {selectedPatient.mobile ?? '—'}
                      {selectedPatient.age != null ? ` · ${selectedPatient.age} yrs` : ''}
                      {selectedPatient.gender ? ` · ${selectedPatient.gender}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="text-xs text-gray-400 hover:text-red-500 underline"
                >
                  Clear
                </button>
              </div>

              {/* Last 3 visits */}
              {recentVisits && recentVisits.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-blue-800 uppercase tracking-wide mb-2">
                    Recent Visits
                  </p>
                  <div className="space-y-1.5">
                    {recentVisits.map(visit => (
                      <div
                        key={visit.id}
                        className="flex items-center gap-3 text-sm bg-white rounded px-3 py-2 border border-blue-100"
                      >
                        <Calendar className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        <span className="text-gray-600">
                          {format(new Date(visit.created_at), 'dd MMM yyyy')}
                        </span>
                        <span className="text-gray-800 font-medium">
                          {visit.visit_type ?? 'Visit'}
                        </span>
                        {visit.status && (
                          <Badge variant="outline" className="text-xs ml-auto">
                            {visit.status}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recentVisits && recentVisits.length === 0 && (
                <p className="text-xs text-blue-700 italic">No previous visits found.</p>
              )}
            </div>
          )}

          {/* Log This Call form */}
          <div className="border-t border-gray-200 pt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Log This Call</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Call type select */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Call Type *</label>
                <Select value={callType} onValueChange={v => setCallType(v as CallType)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select call type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">
                      <span className="flex items-center gap-1.5">
                        <PhoneIncoming className="h-3.5 w-3.5 text-blue-500" /> Inbound
                      </span>
                    </SelectItem>
                    <SelectItem value="outbound">
                      <span className="flex items-center gap-1.5">
                        <PhoneOutgoing className="h-3.5 w-3.5 text-green-500" /> Outbound
                      </span>
                    </SelectItem>
                    <SelectItem value="missed">
                      <span className="flex items-center gap-1.5">
                        <PhoneMissed className="h-3.5 w-3.5 text-red-500" /> Missed
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Action taken select */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Action Taken *</label>
                <Select value={actionTaken} onValueChange={v => setActionTaken(v as ActionTaken)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="appointment">Appointment</SelectItem>
                    <SelectItem value="home_collection">Home Collection</SelectItem>
                    <SelectItem value="report_query">Report Query</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="no_action">No Action</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Notes</label>
              <Textarea
                placeholder="Optional notes about this call…"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="resize-none"
              />
            </div>

            <Button
              onClick={() => saveCallLog.mutate()}
              disabled={saveCallLog.isPending || !callType || !actionTaken || !callerNumber.trim()}
              className="flex items-center gap-2"
            >
              <Phone className="h-4 w-4" />
              {saveCallLog.isPending ? 'Saving…' : 'Save Call Log'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────────────────
          Section 2: Quick Actions
      ────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Book Appointment */}
        <a href="/appointments" className="block no-underline">
          <Card className="hover:shadow-md hover:border-purple-300 transition-all cursor-pointer group h-full">
            <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-purple-100 rounded-xl group-hover:bg-purple-200 transition-colors">
                <Calendar className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Book Appointment</p>
                <p className="text-xs text-gray-500 mt-0.5">Open appointment scheduler</p>
              </div>
            </CardContent>
          </Card>
        </a>

        {/* Schedule Home Collection */}
        <a href="/home-collection" className="block no-underline">
          <Card className="hover:shadow-md hover:border-orange-300 transition-all cursor-pointer group h-full">
            <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-orange-100 rounded-xl group-hover:bg-orange-200 transition-colors">
                <MapPin className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Schedule Home Collection</p>
                <p className="text-xs text-gray-500 mt-0.5">Send a phlebotomist to patient</p>
              </div>
            </CardContent>
          </Card>
        </a>

        {/* Send Report via WhatsApp */}
        <a href="/report-delivery" className="block no-underline">
          <Card className="hover:shadow-md hover:border-green-300 transition-all cursor-pointer group h-full">
            <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-3">
              <div className="p-3 bg-green-100 rounded-xl group-hover:bg-green-200 transition-colors">
                <MessageCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Send Report via WhatsApp</p>
                <p className="text-xs text-gray-500 mt-0.5">Deliver reports to patient</p>
              </div>
            </CardContent>
          </Card>
        </a>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          Section 3: Recent Call Log
      ────────────────────────────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-gray-800">
              <Clock className="h-5 w-5 text-gray-500" />
              Recent Call Log
              <span className="text-sm font-normal text-gray-400">(auto-refreshes every 30 s)</span>
            </CardTitle>
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9 text-sm"
                placeholder="Search number or name…"
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {logsLoading ? (
            <p className="p-6 text-center text-sm text-gray-400">Loading call logs…</p>
          ) : filteredLogs.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">
              {logSearch ? 'No logs match your search.' : 'No call logs yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Time</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Caller Number</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Patient</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Call Type</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Action</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Handled By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    {/* Time */}
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {format(new Date(log.created_at), 'dd MMM HH:mm')}
                    </td>

                    {/* Caller Number */}
                    <td className="px-4 py-3 font-mono text-gray-800 whitespace-nowrap">
                      {log.caller_number}
                    </td>

                    {/* Patient Name */}
                    <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                      {log.patient_name ? (
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-gray-400" />
                          {log.patient_name}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-xs">Unknown</span>
                      )}
                    </td>

                    {/* Call Type badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${callTypeBadgeClass(log.call_type)}`}
                      >
                        <CallTypeIcon type={log.call_type} />
                        {humanLabel(log.call_type)}
                      </span>
                    </td>

                    {/* Action badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${actionBadgeClass(log.action_taken)}`}
                      >
                        {humanLabel(log.action_taken)}
                      </span>
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                      {log.notes ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Handled By */}
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {log.handled_by ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
