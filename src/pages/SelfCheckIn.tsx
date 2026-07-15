import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Search, CheckCircle, Clock, ArrowLeft, Printer } from 'lucide-react';
import { format } from 'date-fns';

// DATA SOURCE: queue_tokens via next_queue_token RPC → new token issued on check-in

const DEPARTMENTS = [
  { id: 'OPD',          label: 'OPD / Consultation',  color: '#2563eb' },
  { id: 'Lab',          label: 'Lab / Blood Tests',    color: '#16a34a' },
  { id: 'Radiology',    label: 'Radiology',            color: '#7c3aed' },
  { id: 'USG',          label: 'Ultrasound (USG)',     color: '#0891b2' },
  { id: 'ECG',          label: 'ECG',                  color: '#dc2626' },
  { id: 'Pharmacy',     label: 'Pharmacy',             color: '#059669' },
  { id: 'Billing',      label: 'Billing / Accounts',   color: '#6366f1' },
  { id: 'Physiotherapy',label: 'Physiotherapy',        color: '#f59e0b' },
  { id: 'X-Ray',        label: 'X-Ray',                color: '#65a30d' },
];

type Screen = 'welcome' | 'name' | 'dept' | 'confirm' | 'done';

interface IssuedToken {
  tokenNumber: number;
  department: string;
  patientName: string;
  time: string;
}

export default function SelfCheckIn() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [nameInput, setNameInput] = useState('');
  const [mobileInput, setMobileInput] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-return to welcome after 30 seconds on done screen
  useEffect(() => {
    if (screen !== 'done') return;
    const t = setTimeout(() => {
      setScreen('welcome');
      setNameInput('');
      setMobileInput('');
      setSelectedDept('');
      setIssued(null);
    }, 30000);
    return () => clearTimeout(t);
  }, [screen]);

  // Fetch queue count for each dept so patient can see wait
  const { data: waitCounts = {} } = useQuery({
    queryKey: ['kiosk-wait-counts'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('queue_tokens')
        .select('department')
        .in('status', ['waiting', 'called'])
        .gte('created_at', today.toISOString())
        .limit(500);
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        counts[r.department] = (counts[r.department] || 0) + 1;
      });
      return counts;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const issueToken = useMutation({
    mutationFn: async () => {
      const name = nameInput.trim();
      if (!name) throw new Error('Name required');
      if (!selectedDept) throw new Error('Select department');

      const { data: nextNum, error: rpcErr } = await supabase
        .rpc('next_queue_token', { dept: selectedDept });
      if (rpcErr) throw rpcErr;

      const { error } = await supabase.from('queue_tokens').insert({
        token_number: nextNum,
        department: selectedDept,
        patient_name: name,
        mobile: mobileInput.trim() || null,
        status: 'waiting',
        counter_name: 'Counter 1',
      });
      if (error) throw error;
      return nextNum as number;
    },
    onSuccess: (tokenNum) => {
      setIssued({
        tokenNumber: tokenNum,
        department: selectedDept,
        patientName: nameInput.trim(),
        time: format(new Date(), 'hh:mm a'),
      });
      setScreen('done');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deptConfig = DEPARTMENTS.find(d => d.id === selectedDept);

  // ── Welcome screen ──
  if (screen === 'welcome') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700 text-white p-8 select-none">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-black mb-3 tracking-tight">Hope Hospital</h1>
          <p className="text-blue-200 text-xl">Patient Self Check-In</p>
          <p className="text-blue-300 text-sm mt-2">{format(clock, 'EEEE, dd MMMM yyyy · hh:mm:ss a')}</p>
        </div>
        <button
          className="bg-white text-blue-800 text-2xl font-bold px-16 py-8 rounded-3xl shadow-2xl hover:bg-blue-50 active:scale-95 transition-all"
          onClick={() => setScreen('name')}
        >
          Tap to Check In
        </button>
        <p className="text-blue-300 text-sm mt-8">Get your queue token without waiting at reception</p>
      </div>
    );
  }

  // ── Name entry ──
  if (screen === 'name') {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 p-8">
        <button className="flex items-center gap-2 text-muted-foreground mb-8 w-fit" onClick={() => setScreen('welcome')}>
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <div className="max-w-xl mx-auto w-full space-y-8 mt-8">
          <div>
            <h2 className="text-3xl font-bold mb-1">Enter Your Name</h2>
            <p className="text-muted-foreground">Type your full name as registered</p>
          </div>
          <Input
            autoFocus
            placeholder="Your full name"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            className="h-16 text-2xl text-center rounded-2xl border-2"
            onKeyDown={e => e.key === 'Enter' && nameInput.trim() && setScreen('dept')}
          />
          <div>
            <p className="text-sm text-muted-foreground mb-2">Mobile (optional — for WhatsApp alerts)</p>
            <Input
              placeholder="10-digit mobile"
              value={mobileInput}
              onChange={e => setMobileInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="h-12 text-lg text-center rounded-2xl border-2"
              inputMode="numeric"
            />
          </div>
          <Button
            size="lg"
            className="w-full h-16 text-xl rounded-2xl"
            disabled={!nameInput.trim()}
            onClick={() => setScreen('dept')}
          >
            Next — Choose Department
          </Button>
        </div>
      </div>
    );
  }

  // ── Department selection ──
  if (screen === 'dept') {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 p-8">
        <button className="flex items-center gap-2 text-muted-foreground mb-6 w-fit" onClick={() => setScreen('name')}>
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <div className="max-w-2xl mx-auto w-full">
          <h2 className="text-3xl font-bold mb-1">Where are you going?</h2>
          <p className="text-muted-foreground mb-6">Select your destination</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {DEPARTMENTS.map(dept => {
              const waiting = waitCounts[dept.id] || 0;
              const selected = selectedDept === dept.id;
              return (
                <button
                  key={dept.id}
                  onClick={() => setSelectedDept(dept.id)}
                  className={`p-5 rounded-2xl border-2 text-left transition-all active:scale-95 ${selected ? 'border-blue-500 bg-blue-50 shadow-lg' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div
                    className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center text-white font-black text-lg"
                    style={{ backgroundColor: dept.color }}
                  >
                    {dept.id[0]}
                  </div>
                  <div className="font-semibold text-sm leading-tight">{dept.label}</div>
                  {waiting > 0 && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {waiting} waiting
                    </div>
                  )}
                  {waiting === 0 && (
                    <div className="text-xs text-green-600 mt-1">No wait</div>
                  )}
                </button>
              );
            })}
          </div>

          <Button
            size="lg"
            className="w-full h-16 text-xl rounded-2xl mt-8"
            disabled={!selectedDept || issueToken.isPending}
            onClick={() => issueToken.mutate()}
          >
            {issueToken.isPending ? 'Getting your token…' : 'Get Queue Token'}
          </Button>
        </div>
      </div>
    );
  }

  // ── Done / Token issued ──
  if (screen === 'done' && issued) {
    const dept = DEPARTMENTS.find(d => d.id === issued.department);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8 select-none">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Token display */}
          <div className="p-8 text-center" style={{ backgroundColor: dept?.color || '#2563eb' }}>
            <p className="text-white text-sm font-semibold uppercase tracking-widest mb-2">Your Token</p>
            <div className="text-white text-8xl font-black leading-none">
              {issued.department[0]}{issued.tokenNumber}
            </div>
            <p className="text-white/80 text-sm mt-2">{dept?.label}</p>
          </div>

          {/* Details */}
          <div className="p-6 space-y-3 text-center">
            <div>
              <p className="text-xl font-bold">{issued.patientName}</p>
              <p className="text-muted-foreground text-sm">Checked in at {issued.time}</p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
              <div className="text-left">
                <p className="font-semibold text-green-800 text-sm">You are in the queue!</p>
                <p className="text-green-600 text-xs">Please wait near {dept?.label}. Listen for your token to be called.</p>
              </div>
            </div>

            <Button variant="outline" className="w-full" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print Slip
            </Button>
          </div>

          <div className="bg-gray-50 px-6 py-3 text-center text-xs text-muted-foreground border-t">
            This screen will reset in 30 seconds
          </div>
        </div>
      </div>
    );
  }

  return null;
}
