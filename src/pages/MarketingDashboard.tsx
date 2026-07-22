import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Camera, Send, Save, Edit2, Users, TrendingUp, Building2, Percent, IndianRupee, ClipboardList, CalendarCheck, Mic, MicOff, ImagePlus, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTileAccess } from '@/hooks/useTileAccess';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCorporateBulkPayments } from '@/hooks/useCorporateBulkPayments';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { geminiGenerateContentUrl, geminiGenerateContent } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { ClinicalKPIs } from '@/components/ClinicalKPIs';

const db = supabase as any;

const inr = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

interface DayStats {
  id?: string;
  date: string;
  doctors_contacted: number;
  admissions: number;
  discharges: number;
  occupancy_percent: number;
  revenue: number;
  plan_for_today: string;
  notes: string;
}

const emptyStats: DayStats = {
  date: new Date().toISOString().split('T')[0],
  doctors_contacted: 0, admissions: 0, discharges: 0,
  occupancy_percent: 0, revenue: 0, plan_for_today: '', notes: ''
};

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  photos?: string[];
  extracted?: any;
  saved?: boolean;
}

export default function MarketingDashboard() {
  const { toast } = useToast();
  const { user, hospitalConfig } = useAuth();
  const { canSeeTile } = useTileAccess();

  // Payment Receipts state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: payments = [], isLoading: paymentsLoading } = useCorporateBulkPayments({
    hospital_name: hospitalConfig?.name,
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const formatReceiptDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return dateStr; }
  };

  const [today, setToday] = useState<DayStats>(emptyStats);
  const [currentlyAdmittedCount, setCurrentlyAdmittedCount] = useState(0);
  const [delayedBillSubmissions, setDelayedBillSubmissions] = useState<any[]>([]);
  const [delayedPayments, setDelayedPayments] = useState<any[]>([]);
  const [patientWisePending, setPatientWisePending] = useState<any[]>([]);
  const [corporateVisitsData, setCorporateVisitsData] = useState<any[]>([]);
  const [areaWiseData, setAreaWiseData] = useState<any[]>([]);
  const [openDelayCard, setOpenDelayCard] = useState<string | null>(null);
  const [selectedPanelName, setSelectedPanelName] = useState<string | null>(null);
  const [panelPatients, setPanelPatients] = useState<any[]>([]);
  const [panelPatientsLoading, setPanelPatientsLoading] = useState(false);
  const [chartFilter, setChartFilter] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const [monthRows, setMonthRows] = useState<any[]>([]);
  const [yearRows, setYearRows] = useState<any[]>([]);
  const [yesterdayRow, setYesterdayRow] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<DayStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [paymentReceipts, setPaymentReceipts] = useState<any[]>([]);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatPhotos, setChatPhotos] = useState<File[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [contactPrefs, setContactPrefs] = useState<Record<number, { dietary_preference: string; drinks_alcohol: string; gratification_type: string; phone: string; email: string; gratification_details: string; personal_habits: string; family_details: string; birthday: string; anniversary: string }>>({});
  const [editedExtracted, setEditedExtracted] = useState<Record<number, { corporateId?: string; corporate?: string; areaId?: string; area?: string }>>({});
  const [corporateList, setCorporateList] = useState<any[]>([]);
  const [areaListByIdx, setAreaListByIdx] = useState<Record<number, any[]>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // Speech recognition setup
  const startRecording = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: 'Speech recognition not supported', description: 'Please use Chrome or Edge browser', variant: 'destructive' });
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang;

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text + ' ';
        } else {
          interimTranscript += text;
        }
      }
      setChatInput(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech error:', event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const yearStart = `${now.getFullYear()}-01-01`;
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

  const allChartVisitsRef = useRef<any[]>([]);

  const buildChartData = (filter: 'daily' | 'monthly' | 'yearly', visits?: any[]) => {
    const data = visits || allChartVisitsRef.current;
    let startDate = monthStart;
    if (filter === 'daily') startDate = todayStr;
    else if (filter === 'yearly') startDate = yearStart;

    const filtered = data.filter((v: any) => v.admission_date >= startDate && v.admission_date <= todayStr);

    // Corporate-wise
    const corpMap: Record<string, number> = {};
    filtered.forEach((v: any) => {
      const corp = v.patients?.corporate || 'Private';
      corpMap[corp] = (corpMap[corp] || 0) + 1;
    });
    setCorporateVisitsData(
      Object.entries(corpMap)
        .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + '..' : name, fullName: name, visits: count }))
        .sort((a, b) => b.visits - a.visits)
    );

    // Area-wise
    const areaMap: Record<string, number> = {};
    filtered.forEach((v: any) => {
      const area = v.patients?.city_town || 'Unknown';
      areaMap[area] = (areaMap[area] || 0) + 1;
    });
    setAreaWiseData(
      Object.entries(areaMap)
        .map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + '..' : name, fullName: name, patients: count }))
        .sort((a, b) => b.patients - a.patients)
    );
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const hospitalFilter = hospitalConfig?.name;

      const isHope = hospitalFilter?.toLowerCase() === 'hope';

      // Fetch all dynamic data in parallel
      const [
        admTodayRes, admMonthRes, admYestRes,
        disTodayRes, disMonthRes, disYestRes,
        revTodayRes, revMonthRes, revYearRes,
        currentlyAdmittedRes, totalBedsRes,
        monthlyOccVisitsRes,
        doctorsTodayRes, doctorsMonthRes,
        planRes, corpRes,
        // Pharmacy credit payments (Hope only)
        pharmCreditTodayRes, pharmCreditMonthRes, pharmCreditYearRes,
        // Delay tracking & charts
        dischargedVisitsRes, billPrepRes, monthVisitsForChartsRes,
      ] = await Promise.all([
        // Admissions today (IPD + OPD, filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('admission_date', todayStr); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Admissions this month (IPD + OPD, filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).gte('admission_date', monthStart).lte('admission_date', todayStr); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Admissions yesterday (IPD + OPD, filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('admission_date', yesterday); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Discharges today (filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('patient_type', 'IPD').eq('discharge_date', todayStr); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Discharges this month (filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('patient_type', 'IPD').gte('discharge_date', monthStart).lte('discharge_date', todayStr); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Discharges yesterday (filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('patient_type', 'IPD').eq('discharge_date', yesterday); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Revenue today (from DayBook RPC - filtered by hospital)
        db.rpc('get_cash_book_transactions_direct', { p_from_date: todayStr, p_to_date: todayStr, p_transaction_type: null, p_patient_id: null, p_hospital_name: hospitalFilter || null }),
        // Revenue this month
        db.rpc('get_cash_book_transactions_direct', { p_from_date: monthStart, p_to_date: todayStr, p_transaction_type: null, p_patient_id: null, p_hospital_name: hospitalFilter || null }),
        // Revenue this year
        db.rpc('get_cash_book_transactions_direct', { p_from_date: yearStart, p_to_date: todayStr, p_transaction_type: null, p_patient_id: null, p_hospital_name: hospitalFilter || null }),
        // Currently admitted IPD patients (for occupancy, filtered by hospital)
        (() => { let q = db.from('visits').select('id, patients!inner(hospital_name)', { count: 'exact', head: true }).eq('patient_type', 'IPD').is('discharge_date', null); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Total beds (filtered by hospital)
        (() => { let q = db.from('room_management').select('maximum_rooms'); if (hospitalFilter) q = q.eq('hospital_name', hospitalFilter); return q; })(),
        // IPD visits overlapping this month (for avg monthly occupancy)
        (() => { let q = db.from('visits').select('admission_date, discharge_date, patients!inner(hospital_name)').eq('patient_type', 'IPD').lte('admission_date', todayStr).or(`discharge_date.gte.${monthStart},discharge_date.is.null`); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Doctors contacted today (marketing_visits)
        db.from('marketing_visits').select('id', { count: 'exact', head: true }).eq('visit_date', todayStr),
        // Doctors contacted this month
        db.from('marketing_visits').select('id', { count: 'exact', head: true }).gte('visit_date', monthStart).lte('visit_date', todayStr),
        // Plan for today from marketing_daily_stats
        db.from('marketing_daily_stats').select('plan_for_today').eq('date', todayStr).maybeSingle(),
        // Corporate list
        db.from('corporate_master').select('id, name').order('name'),
        // Pharmacy credit payments today (Hope only)
        isHope
          ? db.from('pharmacy_credit_payments').select('amount').neq('payment_method', 'CREDIT').ilike('hospital_name', '%hope%').gte('payment_date', `${todayStr}T00:00:00`).lte('payment_date', `${todayStr}T23:59:59`)
          : Promise.resolve({ data: [] }),
        // Pharmacy credit payments this month (Hope only)
        isHope
          ? db.from('pharmacy_credit_payments').select('amount').neq('payment_method', 'CREDIT').ilike('hospital_name', '%hope%').gte('payment_date', `${monthStart}T00:00:00`).lte('payment_date', `${todayStr}T23:59:59`)
          : Promise.resolve({ data: [] }),
        // Pharmacy credit payments this year (Hope only)
        isHope
          ? db.from('pharmacy_credit_payments').select('amount').neq('payment_method', 'CREDIT').ilike('hospital_name', '%hope%').gte('payment_date', `${yearStart}T00:00:00`).lte('payment_date', `${todayStr}T23:59:59`)
          : Promise.resolve({ data: [] }),
        // Discharged IPD visits (last 90 days) for delay tracking
        (() => { const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]; let q = db.from('visits').select('visit_id, admission_date, discharge_date, patients!inner(name, corporate, city_town, hospital_name)').eq('patient_type', 'IPD').not('discharge_date', 'is', null).gte('discharge_date', ninetyDaysAgo); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
        // Bill preparation records for delay/pending tracking
        (() => { let q = db.from('bill_preparation').select('visit_id, bill_amount, date_of_submission, received_amount, received_date, deduction_amount, tds_amount, visits!inner!visit_id(patients!inner(name, corporate, hospital_name))'); if (hospitalFilter) q = q.eq('visits.patients.hospital_name', hospitalFilter); return q; })(),
        // Visits for corporate/area charts (fetch yearly range, filter client-side per chartFilter)
        (() => { let q = db.from('visits').select('visit_id, admission_date, patients!inner(corporate, city_town, hospital_name)').gte('admission_date', yearStart).lte('admission_date', todayStr); if (hospitalFilter) q = q.eq('patients.hospital_name', hospitalFilter); return q; })(),
      ]);

      // Sum ALL revenue from DayBook RPC (Advance Payments + Final Payments, all payment modes)
      const sumAllRevenue = (res: any) => {
        return (res.data || []).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
      };

      // Sum pharmacy credit payments (Hope only)
      const sumPharmCredit = (res: any) => (res.data || []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

      const revenueToday = sumAllRevenue(revTodayRes) + sumPharmCredit(pharmCreditTodayRes);
      const revenueMonth = sumAllRevenue(revMonthRes) + sumPharmCredit(pharmCreditMonthRes);
      const revenueYear = sumAllRevenue(revYearRes) + sumPharmCredit(pharmCreditYearRes);

      const totalBeds = (totalBedsRes.data || []).reduce((s: number, r: any) => s + (Number(r.maximum_rooms) || 0), 0);
      const currentlyAdmitted = currentlyAdmittedRes.count || 0;
      setCurrentlyAdmittedCount(currentlyAdmitted);
      const occupancyToday = totalBeds > 0 ? Math.round((currentlyAdmitted / totalBeds) * 100) : 0;

      // Calculate average monthly occupancy using patient-days
      const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const todayDate = new Date(todayStr);
      const daysElapsed = Math.max(1, Math.floor((todayDate.getTime() - monthStartDate.getTime()) / 86400000) + 1);

      let totalPatientDays = 0;
      const monthVisits = monthlyOccVisitsRes.data || [];
      monthVisits.forEach((v: any) => {
        const admDate = new Date(v.admission_date);
        const disDate = v.discharge_date ? new Date(v.discharge_date) : todayDate;
        // Clamp to month boundaries
        const start = admDate < monthStartDate ? monthStartDate : admDate;
        const end = disDate > todayDate ? todayDate : disDate;
        const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
        totalPatientDays += days;
      });

      const avgOccupancyMonth = totalBeds > 0 ? Math.round((totalPatientDays / (daysElapsed * totalBeds)) * 100) : 0;

      const todayData: DayStats = {
        date: todayStr,
        doctors_contacted: doctorsTodayRes.count || 0,
        admissions: admTodayRes.count || 0,
        discharges: disTodayRes.count || 0,
        occupancy_percent: occupancyToday,
        revenue: revenueToday,
        plan_for_today: planRes.data?.plan_for_today || '',
        notes: '',
      };

      setToday(todayData);
      setForm(todayData);

      // Build monthRows-compatible array for monthSum/monthAvg helpers
      setMonthRows([{
        doctors_contacted: doctorsMonthRes.count || 0,
        admissions: admMonthRes.count || 0,
        discharges: disMonthRes.count || 0,
        occupancy_percent: avgOccupancyMonth,
        revenue: revenueMonth,
      }]);

      setYearRows([{ revenue: revenueYear }]);

      setYesterdayRow({
        admissions: admYestRes.count || 0,
        discharges: disYestRes.count || 0,
      });

      setCorporateList(corpRes.data || []);

      // === Delay & Chart Processing ===
      const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0];
      const twoMonthsAgo = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];
      const fortyEightHoursAgo = new Date(now.getTime() - 2 * 86400000).toISOString().split('T')[0];
      const dischargedVisits = dischargedVisitsRes.data || [];
      const billPrepRecords = billPrepRes.data || [];
      const billPrepByVisit = new Map(billPrepRecords.map((bp: any) => [bp.visit_id, bp]));

      // Helper: check if patient is corporate (not private)
      const isCorporate = (corp: any) => corp && corp !== '' && corp.toLowerCase() !== 'private';

      // 1. Delay in Bill Submission: discharged >3 days ago, no bill submitted (corporate only)
      const delayedBills = dischargedVisits
        .filter((v: any) => {
          if (!isCorporate(v.patients?.corporate)) return false;
          if (v.discharge_date > threeDaysAgo) return false;
          const bp = billPrepByVisit.get(v.visit_id);
          return !bp || !bp.date_of_submission;
        })
        .map((v: any) => ({
          patient_name: v.patients?.name || 'Unknown',
          visit_id: v.visit_id,
          discharge_date: v.discharge_date,
          days_overdue: Math.floor((new Date(todayStr).getTime() - new Date(v.discharge_date).getTime()) / 86400000),
        }))
        .sort((a: any, b: any) => b.days_overdue - a.days_overdue);
      setDelayedBillSubmissions(delayedBills);

      // 2. Delay in Receiving Payment: bill submitted >2 months ago, no payment received (corporate only)
      const delayedPay = billPrepRecords
        .filter((bp: any) => {
          if (!isCorporate(bp.visits?.patients?.corporate)) return false;
          if (!bp.date_of_submission) return false;
          if (bp.date_of_submission > twoMonthsAgo) return false;
          return !bp.received_date && (!bp.received_amount || Number(bp.received_amount) === 0);
        })
        .map((bp: any) => ({
          patient_name: bp.visits?.patients?.name || 'Unknown',
          visit_id: bp.visit_id,
          bill_amount: Number(bp.bill_amount) || 0,
          date_of_submission: bp.date_of_submission,
          days_overdue: Math.floor((new Date(todayStr).getTime() - new Date(bp.date_of_submission).getTime()) / 86400000),
        }))
        .sort((a: any, b: any) => b.days_overdue - a.days_overdue);
      setDelayedPayments(delayedPay);

      // 3. Patient-wise Pending Payment: pending >48 hours (corporate only)
      const pending = billPrepRecords
        .filter((bp: any) => {
          if (!isCorporate(bp.visits?.patients?.corporate)) return false;
          if (!bp.date_of_submission) return false;
          if (bp.date_of_submission > fortyEightHoursAgo) return false;
          const billAmt = Number(bp.bill_amount) || 0;
          const receivedAmt = Number(bp.received_amount) || 0;
          const deduction = Number(bp.deduction_amount) || 0;
          const tds = Number(bp.tds_amount) || 0;
          return billAmt > 0 && (receivedAmt + deduction + tds) < billAmt;
        })
        .map((bp: any) => {
          const billAmt = Number(bp.bill_amount) || 0;
          const receivedAmt = Number(bp.received_amount) || 0;
          const deduction = Number(bp.deduction_amount) || 0;
          const tds = Number(bp.tds_amount) || 0;
          return {
            patient_name: bp.visits?.patients?.name || 'Unknown',
            corporate: bp.visits?.patients?.corporate || 'Private',
            visit_id: bp.visit_id,
            bill_amount: billAmt,
            received_amount: receivedAmt,
            deduction_amount: deduction,
            tds_amount: tds,
            pending_amount: billAmt - receivedAmt - deduction - tds,
          };
        })
        .sort((a: any, b: any) => b.pending_amount - a.pending_amount);
      setPatientWisePending(pending);

      // 4 & 5. Store raw chart visits, process via buildChartData
      allChartVisitsRef.current = monthVisitsForChartsRes.data || [];
      buildChartData(chartFilter, monthVisitsForChartsRes.data || []);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
    setLoading(false);
  };

  const fetchAreasForCorporate = async (corporateId: string, msgIdx: number) => {
    const { data } = await db.from('corporate_areas').select('id, area_name').eq('corporate_id', corporateId).order('area_name');
    setAreaListByIdx(prev => ({ ...prev, [msgIdx]: data || [] }));
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (allChartVisitsRef.current.length > 0) buildChartData(chartFilter); }, [chartFilter]);

  const handleCorpBarClick = async (data: any) => {
    const fullName = data?.fullName || data?.name;
    if (!fullName) return;
    setSelectedPanelName(fullName);
    setPanelPatients([]);
    setPanelPatientsLoading(true);
    try {
      let startDate = monthStart;
      if (chartFilter === 'daily') startDate = todayStr;
      else if (chartFilter === 'yearly') startDate = yearStart;
      let q = supabase
        .from('visits')
        .select('visit_id, admission_date, discharge_date, patient_type, appointment_with, status, patients!inner(name, corporate, hospital_name, age, gender)')
        .gte('admission_date', startDate)
        .lte('admission_date', todayStr)
        .order('admission_date', { ascending: false });
      if (fullName === 'Private') {
        q = q.or('patients.corporate.is.null,patients.corporate.eq.Private');
      } else {
        q = q.eq('patients.corporate', fullName);
      }
      if (hospitalConfig?.name) q = q.eq('patients.hospital_name', hospitalConfig.name);
      const { data: visits } = await q;
      setPanelPatients(visits || []);
    } catch (e) {
      setPanelPatients([]);
    } finally {
      setPanelPatientsLoading(false);
    }
  };

  const monthSum = (key: string) => monthRows.reduce((s: number, r: any) => s + (Number(r[key]) || 0), 0);
  const monthAvg = (key: string) => monthRows.length ? monthSum(key) / monthRows.length : 0;
  const yearSum = (key: string) => yearRows.reduce((s: number, r: any) => s + (Number(r[key]) || 0), 0);

  const saveStats = async () => {
    const payload = { ...form, date: todayStr };
    delete (payload as any).id;
    if (today.id) {
      await db.from('marketing_daily_stats').update(payload).eq('id', today.id);
    } else {
      await db.from('marketing_daily_stats').insert(payload);
    }
    toast({ title: 'Stats saved!' });
    setShowModal(false);
    fetchData();
  };

  // Photo upload
  const uploadPhotos = async (files: File[]): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of files) {
      const name = `marketing/${Date.now()}_${file.name}`;
      const { error } = await db.storage.from('corporate-photos').upload(name, file, { upsert: true });
      if (!error) {
        const { data } = db.storage.from('corporate-photos').getPublicUrl(name);
        urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  const sendChat = async () => {
    if (!chatInput.trim() && chatPhotos.length === 0) return;
    setChatLoading(true);
    let photoUrls: string[] = [];
    if (chatPhotos.length > 0) {
      photoUrls = await uploadPhotos(chatPhotos);
    }
    const userMsg: ChatMessage = { role: 'user', text: chatInput, photos: photoUrls };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatPhotos([]);

    try {
      const todayDate = new Date().toISOString().split('T')[0];
      const prompt = `Extract visit info as JSON. Summarize conversation professionally (2-3 sentences max).

Input: "${chatInput}"${photoUrls.length ? ` [${photoUrls.length} photos]` : ''}

Known corporates: WCL, ESIC, CGHS, ECHS, Central Railway, SECR, MPKAY, PM-JAY, MP Police

Return JSON only:
{
  "corporate": "organization name or null",
  "area": "city/area name or null", 
  "contactName": "person name or null",
  "designation": "role or null",
  "conversation": "professional summary of discussion",
  "actionItems": "action points or null",
  "followUpDate": "YYYY-MM-DD or null",
  "followUpNeeded": false,
  "marketingStaff": "staff name or null",
  "meetingDate": "${todayDate}"
}`;

      let text: string;
      if (LLM_BACKEND === 'vps') {
        // No fallback: VPS failure throws and surfaces in the chat error state.
        text = await callVpsClaude(prompt);
      } else {
        const res = await geminiGenerateContent(geminiGenerateContentUrl(''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json'
            }
          })
        });

        const data = await res.json();

        if (data.error) {
          throw new Error(data.error.message);
        }

        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
      
      // Clean up JSON if needed
      text = text.trim();
      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();
      
      let extracted = JSON.parse(text);
      // Handle if Gemini returns an array instead of object
      if (Array.isArray(extracted)) {
        extracted = extracted[0];
      }
      // Clean up "null" strings and normalize values from AI response
      for (const key of Object.keys(extracted)) {
        if (extracted[key] === 'null' || extracted[key] === null || extracted[key] === 'undefined') extracted[key] = '';
        if (key === 'followUpNeeded') extracted[key] = extracted[key] === true || extracted[key] === 'true';
      }
      // Auto-set marketing staff from logged-in user
      if (!extracted.marketingStaff && user?.username) {
        extracted.marketingStaff = user.username;
      }
      setMessages(prev => {
        const newMessages = [...prev, { role: 'assistant' as const, text: '', extracted }];
        const newIdx = newMessages.length - 1;
        // Auto-resolve corporate ID if corporate was detected, so area dropdown can load
        if (extracted.corporate && extracted.corporate !== 'null' && extracted.corporate !== 'Unknown') {
          const match = corporateList.find((c: any) => c.name.toLowerCase().includes(extracted.corporate.toLowerCase()) || extracted.corporate.toLowerCase().includes(c.name.toLowerCase()));
          if (match) {
            setEditedExtracted(prev => ({ ...prev, [newIdx]: { ...prev[newIdx], corporateId: match.id, corporate: match.name } }));
            fetchAreasForCorporate(match.id, newIdx);
          }
        }
        return newMessages;
      });
    } catch (err) {
      console.error('AI Error:', err);
      setMessages(prev => [...prev, { role: 'assistant', text: 'Failed to process. Try again.' }]);
    }
    setChatLoading(false);
  };

  const saveToMaster = async (idx: number) => {
    const msg = messages[idx];
    if (!msg.extracted) return;
    const e = { ...msg.extracted };

    // Apply user edits for corporate/area
    const edits = editedExtracted[idx];
    if (edits?.corporate) e.corporate = edits.corporate;
    if (edits?.area) e.area = edits.area;

    // Get photos from the user message (previous message)
    const userMsg = messages[idx - 1];
    const photos = userMsg?.photos || [];

    try {
      // Step 1: Use selected corporate ID from dropdown, or find/create by name
      let corporateId = edits?.corporateId || null;
      if (!corporateId && e.corporate) {
        const { data: existingCorps } = await db.from('corporate_master')
          .select('id, name')
          .or(`name.ilike.%${e.corporate}%,name.ilike.${e.corporate}%`);

        if (existingCorps && existingCorps.length > 0) {
          corporateId = existingCorps[0].id;
        } else {
          const { data: newCorp } = await db.from('corporate_master')
            .insert({ name: e.corporate, category: 'government' })
            .select('id')
            .single();
          corporateId = newCorp?.id;
        }
      }

      // Step 2: Use selected area ID from dropdown, or find/create by name
      let areaId = edits?.areaId || null;
      if (!areaId && e.area && corporateId) {
        const { data: existingAreas } = await db.from('corporate_areas')
          .select('id, area_name')
          .eq('corporate_id', corporateId)
          .or(`area_name.ilike.%${e.area}%,area_name.ilike.${e.area}%`);

        if (existingAreas && existingAreas.length > 0) {
          areaId = existingAreas[0].id;
        } else {
          const { data: newArea } = await db.from('corporate_areas')
            .insert({
              corporate_id: corporateId,
              area_name: e.area,
              status: 'active'
            })
            .select('id')
            .single();
          areaId = newArea?.id;
        }
      }

      // Step 3: Find or create Contact under Area (e.g., Dr. Sharma)
      let contactId = null;
      const prefs = contactPrefs[idx] || { dietary_preference: 'unknown', drinks_alcohol: 'unknown', gratification_type: '', phone: '', email: '', gratification_details: '', personal_habits: '', family_details: '', birthday: '', anniversary: '' };
      if (e.contactName && areaId) {
        const { data: existingContact } = await db.from('corporate_area_contacts')
          .select('id')
          .eq('area_id', areaId)
          .ilike('name', e.contactName)
          .maybeSingle();

        if (existingContact) {
          contactId = existingContact.id;
          // Update all profile fields on existing contact
          const updateData: any = {};
          if (prefs.dietary_preference && prefs.dietary_preference !== 'unknown') updateData.dietary_preference = prefs.dietary_preference;
          if (prefs.drinks_alcohol && prefs.drinks_alcohol !== 'unknown') updateData.drinks_alcohol = prefs.drinks_alcohol;
          if (prefs.gratification_type) updateData.gratification_type = prefs.gratification_type;
          if (prefs.phone) updateData.phone = prefs.phone;
          if (prefs.email) updateData.email = prefs.email;
          if (prefs.gratification_details) updateData.gratification_details = prefs.gratification_details;
          if (prefs.personal_habits) updateData.personal_habits = prefs.personal_habits;
          if (prefs.family_details) updateData.family_details = prefs.family_details;
          if (prefs.birthday) updateData.birthday = prefs.birthday;
          if (prefs.anniversary) updateData.anniversary = prefs.anniversary;
          if (Object.keys(updateData).length > 0) {
            await db.from('corporate_area_contacts').update(updateData).eq('id', contactId);
          }
        } else {
          const { data: newContact } = await db.from('corporate_area_contacts')
            .insert({
              area_id: areaId,
              name: e.contactName,
              designation: e.designation || null,
              photos: photos,
              dietary_preference: prefs.dietary_preference || 'unknown',
              drinks_alcohol: prefs.drinks_alcohol || 'unknown',
              gratification_type: prefs.gratification_type || null,
              phone: prefs.phone || null,
              email: prefs.email || null,
              gratification_details: prefs.gratification_details || null,
              personal_habits: prefs.personal_habits || null,
              family_details: prefs.family_details || null,
              birthday: prefs.birthday && prefs.birthday.match(/^\d{4}-\d{2}-\d{2}$/) ? prefs.birthday : null,
              anniversary: prefs.anniversary && prefs.anniversary.match(/^\d{4}-\d{2}-\d{2}$/) ? prefs.anniversary : null,
            })
            .select('id')
            .single();
          contactId = newContact?.id;
        }
      }

      // Step 4: Create Meeting record under Area
      if (areaId) {
        const { error: meetingError } = await db.from('corporate_area_meetings').insert({
          area_id: areaId,
          meeting_date: e.meetingDate || todayStr,
          person_met: e.contactName || null,
          location: e.area || null,
          conversation: e.conversation || null,
          action_requested: e.actionItems || null,
          follow_up_date: e.followUpDate && e.followUpDate.match(/^\d{4}-\d{2}-\d{2}$/) ? e.followUpDate : null,
          follow_up_needed: e.followUpNeeded === true,
          photos: photos,
          marketing_staff: e.marketingStaff || null,
        });
        
        if (meetingError) {
          console.error('Meeting save error:', meetingError);
          throw meetingError;
        }
      }

      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, saved: true } : m));
      toast({ 
        title: 'Saved to Corporate Master!',
        description: `${e.corporate || 'Unknown'} → ${e.area || 'Unknown'} → ${e.contactName || 'Meeting recorded'}`
      });
    } catch (error) {
      console.error('Save error:', error);
      toast({ title: 'Failed to save', description: 'Please try again', variant: 'destructive' });
    }
  };

  const StatCard = ({ icon: Icon, label, value, color = 'blue' }: { icon: any; label: string; value: string | number; color?: string }) => (
    <Card className="bg-white border border-gray-100 shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-start gap-2 mb-1">
          <Icon className={`h-4 w-4 text-${color}-500 mt-0.5 shrink-0`} />
          <span className="text-xs text-gray-500 leading-tight">{label}</span>
        </div>
        <div className="text-lg font-bold text-gray-900">{value}</div>
      </CardContent>
    </Card>
  );

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-2 md:p-4 space-y-3 md:space-y-4">
      {/* Clinical KPIs + Yesterday's Activity */}
      <ClinicalKPIs canSeeTile={canSeeTile} />

      {/* AI Field Assistant Chat - FIRST on mobile */}
      <div className="bg-white border-2 border-blue-400 rounded-xl overflow-hidden shadow-lg md:order-none">
        <div className="p-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold flex items-center gap-2">
          🤖 AI Field Assistant
          <span className="text-xs text-blue-200 ml-auto">Snap photos & chat about your visits</span>
        </div>
        <div className="h-80 overflow-y-auto p-3 space-y-3 bg-gray-50">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-12">
              Tell me about your field visit today...<br />
              You can attach photos too! 📸
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>
                {msg.text && <p className="text-sm">{msg.text}</p>}
                {msg.photos && msg.photos.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {msg.photos.map((url, i) => (
                      <img key={i} src={url} className="h-20 w-20 object-cover rounded" alt="" />
                    ))}
                  </div>
                )}
                {msg.extracted && (
                  <div className="mt-2 space-y-2">
                    <div className="bg-blue-50 rounded-lg p-3 text-sm space-y-1">
                      {/* Hierarchy: Corporate → Area - dropdown if unknown */}
                      {!msg.saved ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span>🏢</span>
                          {(!msg.extracted.corporate || msg.extracted.corporate === 'null' || msg.extracted.corporate === 'Unknown') ? (
                            <select
                              value={editedExtracted[idx]?.corporateId || ''}
                              onChange={e => {
                                const corp = corporateList.find((c: any) => c.id === e.target.value);
                                setEditedExtracted(prev => ({ ...prev, [idx]: { ...prev[idx], corporateId: e.target.value, corporate: corp?.name || '', areaId: '', area: '' } }));
                                if (e.target.value) fetchAreasForCorporate(e.target.value, idx);
                              }}
                              className="text-xs border border-orange-300 rounded px-2 py-1 bg-orange-50 text-orange-800 w-40"
                            >
                              <option value="">-- Select Corporate --</option>
                              {corporateList.map((c: any) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-blue-700 font-medium">{msg.extracted.corporate}</span>
                          )}
                          <span>→ 📍</span>
                          {(!msg.extracted.area || msg.extracted.area === 'null' || msg.extracted.area === 'Unknown') ? (
                            areaListByIdx[idx] && areaListByIdx[idx].length > 0 ? (
                              <select
                                value={editedExtracted[idx]?.areaId || ''}
                                onChange={e => {
                                  const ar = areaListByIdx[idx]?.find((a: any) => a.id === e.target.value);
                                  setEditedExtracted(prev => ({ ...prev, [idx]: { ...prev[idx], areaId: e.target.value, area: ar?.area_name || '' } }));
                                }}
                                className="text-xs border border-orange-300 rounded px-2 py-1 bg-orange-50 text-orange-800 w-40"
                              >
                                <option value="">-- Select Area --</option>
                                {areaListByIdx[idx].map((a: any) => (
                                  <option key={a.id} value={a.id}>{a.area_name}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-orange-500 italic">{editedExtracted[idx]?.corporateId ? 'No areas found' : 'Select corporate first'}</span>
                            )
                          ) : (
                            <span className="text-blue-700 font-medium">{msg.extracted.area}</span>
                          )}
                        </div>
                      ) : (
                        (msg.extracted.corporate || msg.extracted.area) && (
                          <p className="text-blue-700 font-medium">
                            🏢 {msg.extracted.corporate || 'Unknown'} → 📍 {msg.extracted.area || 'Unknown'}
                          </p>
                        )
                      )}
                      {msg.extracted.contactName && msg.extracted.contactName !== 'null' && <p><strong>👤 Contact:</strong> {msg.extracted.contactName}</p>}
                      {msg.extracted.designation && msg.extracted.designation !== 'null' && <p><strong>💼 Designation:</strong> {msg.extracted.designation}</p>}
                      <p><strong>🧑‍💼 Visited by:</strong> {msg.extracted.marketingStaff && msg.extracted.marketingStaff !== 'null' ? msg.extracted.marketingStaff : user?.username || 'Unknown'}</p>
                      {msg.extracted.conversation && msg.extracted.conversation !== 'null' && <p><strong>💬 Notes:</strong> {msg.extracted.conversation}</p>}
                      {msg.extracted.actionItems && msg.extracted.actionItems !== 'null' && <p><strong>✅ Action Items:</strong> {msg.extracted.actionItems}</p>}
                      {msg.extracted.followUpDate && msg.extracted.followUpDate !== 'null' && <p><strong>📅 Follow-up:</strong> {msg.extracted.followUpDate}</p>}
                    </div>
                    {!msg.saved ? (
                      <div className="space-y-2">
                        {msg.extracted.contactName && (() => {
                          const p = contactPrefs[idx] || { dietary_preference: 'unknown', drinks_alcohol: 'unknown', gratification_type: '', phone: '', email: '', gratification_details: '', personal_habits: '', family_details: '', birthday: '', anniversary: '' };
                          const up = (field: string, val: string) => setContactPrefs(prev => ({ ...prev, [idx]: { ...p, ...prev[idx], [field]: val } }));
                          return (
                          <div className="bg-pink-50 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">📋 Doctor's Profile</p>
                            {/* Phone & Email */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">📞 Phone</label>
                                <input type="tel" placeholder="Phone number" value={contactPrefs[idx]?.phone || ''} onChange={e => up('phone', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">📧 Email</label>
                                <input type="email" placeholder="Email address" value={contactPrefs[idx]?.email || ''} onChange={e => up('email', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                              </div>
                            </div>
                            {/* Preferences */}
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mt-2">🎯 Preferences & Gratification</p>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">Dietary</label>
                                <select value={contactPrefs[idx]?.dietary_preference || 'unknown'} onChange={e => up('dietary_preference', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white">
                                  <option value="unknown">❓ Unknown</option>
                                  <option value="vegetarian">🥬 Veg</option>
                                  <option value="non-vegetarian">🍗 Non-Veg</option>
                                  <option value="eggetarian">🥚 Eggetarian</option>
                                  <option value="vegan">🌱 Vegan</option>
                                  <option value="jain">🙏 Jain</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Alcohol</label>
                                <select value={contactPrefs[idx]?.drinks_alcohol || 'unknown'} onChange={e => up('drinks_alcohol', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white">
                                  <option value="unknown">❓ Unknown</option>
                                  <option value="no">🚫 No</option>
                                  <option value="occasionally">🍷 Occasionally</option>
                                  <option value="socially">🥂 Socially</option>
                                  <option value="regularly">🍺 Regularly</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Gratification</label>
                                <select value={contactPrefs[idx]?.gratification_type || ''} onChange={e => up('gratification_type', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white">
                                  <option value="">-- Select --</option>
                                  <option value="monetary">💰 Monetary</option>
                                  <option value="gifts_in_kind">🎁 Gifts</option>
                                  <option value="family_outing">👨‍👩‍👧‍👦 Outing</option>
                                  <option value="dinner">🍽️ Dinner</option>
                                  <option value="travel">✈️ Travel</option>
                                  <option value="festival_gifts">🎊 Festival</option>
                                  <option value="professional_favor">🤝 Favor</option>
                                  <option value="none">🚫 None</option>
                                </select>
                              </div>
                            </div>
                            {/* Gratification Details & Personal Habits */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">Gratification Details</label>
                                <textarea placeholder="E.g. Prefers whisky, likes trips to Goa" value={contactPrefs[idx]?.gratification_details || ''} onChange={e => up('gratification_details', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" rows={2} />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Personal Habits & Interests</label>
                                <textarea placeholder="E.g. Morning walker, cricket fan" value={contactPrefs[idx]?.personal_habits || ''} onChange={e => up('personal_habits', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" rows={2} />
                              </div>
                            </div>
                            {/* Family & Dates */}
                            <div className="grid grid-cols-1 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">Family Details</label>
                                <input type="text" placeholder="E.g. Wife: Sunita, Son: 10th class" value={contactPrefs[idx]?.family_details || ''} onChange={e => up('family_details', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500">🎂 Birthday</label>
                                <input type="date" value={contactPrefs[idx]?.birthday || ''} onChange={e => up('birthday', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">💍 Anniversary</label>
                                <input type="date" value={contactPrefs[idx]?.anniversary || ''} onChange={e => up('anniversary', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                              </div>
                            </div>
                          </div>
                          );
                        })()}
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => saveToMaster(idx)}>
                            <Save className="h-3 w-3 mr-1" /> Save to Corporate Master
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-green-600 font-medium">✅ Saved to Corporate Master</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-3 border-t border-gray-200 bg-white">
          {chatPhotos.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {chatPhotos.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} className="h-12 w-12 object-cover rounded" alt="" />
                  <button className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center"
                    onClick={() => setChatPhotos(prev => prev.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* Hidden file inputs */}
          <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden"
            onChange={e => { if (e.target.files) { setChatPhotos(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; } }} />
          <input type="file" accept="image/*" multiple ref={fileInputRef} className="hidden"
            onChange={e => { if (e.target.files) setChatPhotos(prev => [...prev, ...Array.from(e.target.files!)]); }} />

          {/* Action buttons row */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 transition active:scale-95"
            >
              <Camera className="h-5 w-5 text-blue-600" />
              <span className="text-[10px] text-blue-600 font-medium">Camera</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 transition active:scale-95"
            >
              <ImagePlus className="h-5 w-5 text-purple-600" />
              <span className="text-[10px] text-purple-600 font-medium">Gallery</span>
            </button>
            <button
              onClick={toggleRecording}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl border transition active:scale-95 ${
                isRecording
                  ? 'bg-red-100 border-red-300 animate-pulse'
                  : 'bg-green-50 hover:bg-green-100 border-green-200'
              }`}
            >
              {isRecording ? <MicOff className="h-5 w-5 text-red-600" /> : <Mic className="h-5 w-5 text-green-600" />}
              <span className={`text-[10px] font-medium ${isRecording ? 'text-red-600' : 'text-green-600'}`}>
                {isRecording ? 'Stop' : 'Mic'}
              </span>
            </button>
            <button
              onClick={() => setSpeechLang(prev => prev === 'hi-IN' ? 'en-IN' : 'hi-IN')}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 transition active:scale-95"
              title={speechLang === 'hi-IN' ? 'Hindi mode - tap for English' : 'English mode - tap for Hindi'}
            >
              <span className="text-sm font-bold text-orange-600">{speechLang === 'hi-IN' ? 'हि' : 'EN'}</span>
              <span className="text-[10px] text-orange-600 font-medium">{speechLang === 'hi-IN' ? 'Hindi' : 'English'}</span>
            </button>
          </div>

          {/* Text input row */}
          <div className="flex gap-2">
            <Input
              placeholder="Describe your visit..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              className="flex-1 h-10"
            />
            <Button onClick={sendChat} disabled={chatLoading} className="h-10 px-4 bg-blue-600 hover:bg-blue-700">
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Section - Collapsible on mobile */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowStats(!showStats)}
          className="w-full p-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition md:hidden"
        >
          <span className="text-sm font-semibold text-gray-700">📊 Dashboard Stats</span>
          {showStats ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </button>
        <div className={`p-3 space-y-3 ${showStats ? 'block' : 'hidden md:block'}`}>
          <div className="flex items-center justify-between md:mb-2">
            <h1 className="text-lg font-bold text-gray-900 hidden md:block">📊 Marketing Dashboard</h1>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {canSeeTile("m-doctors-today") && <StatCard icon={Users} label="Doctors Today" value={today.doctors_contacted} color="blue" />}
            {canSeeTile("m-doctors-month") && <StatCard icon={Users} label="Doctors Month" value={monthSum('doctors_contacted')} color="indigo" />}
            {canSeeTile("m-admissions-yesterday") && <StatCard icon={TrendingUp} label="Admissions Yesterday" value={yesterdayRow?.admissions || 0} color="green" />}
            {canSeeTile("m-admissions-month") && <StatCard icon={TrendingUp} label="Admissions Month" value={monthSum('admissions')} color="emerald" />}
            {canSeeTile("m-occupancy-today") && <StatCard icon={Percent} label="Occupancy Today" value={currentlyAdmittedCount} color="orange" />}
            {canSeeTile("m-avg-occupancy-month") && <StatCard icon={Percent} label="Avg Occupancy Month" value={`${monthAvg('occupancy_percent').toFixed(0)}%`} color="amber" />}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {canSeeTile("m-revenue-today") && <StatCard icon={IndianRupee} label="Revenue Today" value={inr(today.revenue)} color="green" />}
            {canSeeTile("m-revenue-month") && <StatCard icon={IndianRupee} label="Revenue Month" value={inr(monthSum('revenue'))} color="emerald" />}
            {canSeeTile("m-revenue-year") && <StatCard icon={IndianRupee} label="Revenue Year" value={inr(yearSum('revenue'))} color="teal" />}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {canSeeTile("m-discharges-yesterday") && <StatCard icon={Building2} label="Discharges Yesterday" value={yesterdayRow?.discharges || 0} color="purple" />}
            {canSeeTile("m-discharges-month") && <StatCard icon={Building2} label="Discharges Month" value={monthSum('discharges')} color="violet" />}
            {canSeeTile("m-todays-plan") && (
            <Card className="bg-white border border-gray-100 shadow-sm col-span-2 md:col-span-1">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-gray-500">Today's Plan</span>
                </div>
                <p className="text-sm text-gray-700 line-clamp-3">{today.plan_for_today || 'No plan set'}</p>
              </CardContent>
            </Card>
            )}
          </div>
        </div>
      </div>

      {/* Update Stats Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Daily Stats</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Doctors Contacted</Label>
              <Input type="number" value={form.doctors_contacted} onChange={e => setForm({ ...form, doctors_contacted: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Admissions</Label>
              <Input type="number" value={form.admissions} onChange={e => setForm({ ...form, admissions: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Discharges</Label>
              <Input type="number" value={form.discharges} onChange={e => setForm({ ...form, discharges: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Occupancy %</Label>
              <Input type="number" value={form.occupancy_percent} onChange={e => setForm({ ...form, occupancy_percent: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Revenue ₹</Label>
              <Input type="number" value={form.revenue} onChange={e => setForm({ ...form, revenue: +e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Plan for Today</Label>
            <Textarea value={form.plan_for_today} onChange={e => setForm({ ...form, plan_for_today: e.target.value })} rows={3} />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button onClick={saveStats}>Save Stats</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Receipts Table */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Payment Receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No corporate bulk payment receipts found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Receipt No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Corporate</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Bank Name</TableHead>
                    <TableHead className="text-right">Claim Amount</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Patients</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <React.Fragment key={payment.id}>
                      <TableRow className="cursor-pointer hover:bg-gray-50" onClick={() => toggleRow(payment.id)}>
                        <TableCell>
                          {expandedRows.has(payment.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium">{payment.receipt_number}</TableCell>
                        <TableCell>{formatReceiptDate(payment.payment_date)}</TableCell>
                        <TableCell>{payment.corporate_name}</TableCell>
                        <TableCell>{payment.payment_mode}</TableCell>
                        <TableCell>{payment.reference_number || '-'}</TableCell>
                        <TableCell>{payment.bank_name || '-'}</TableCell>
                        <TableCell className="text-right">
                          {payment.claim_amount ? `Rs. ${Number(payment.claim_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          Rs. {Number(payment.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">{payment.allocations?.length || 0}</TableCell>
                      </TableRow>

                      {expandedRows.has(payment.id) && (
                        <TableRow>
                          <TableCell colSpan={10} className="bg-gray-50 p-0">
                            <div className="p-4">
                              {payment.narration && (
                                <p className="text-sm text-gray-600 mb-3">
                                  <span className="font-medium">Narration:</span> {payment.narration}
                                </p>
                              )}
                              {payment.allocations && payment.allocations.length > 0 ? (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-10">#</TableHead>
                                      <TableHead>Patient Name</TableHead>
                                      <TableHead>Patient ID</TableHead>
                                      <TableHead>Visit ID</TableHead>
                                      <TableHead className="text-right">Bill Amount</TableHead>
                                      <TableHead className="text-right">Received Amt</TableHead>
                                      <TableHead className="text-right">Deduction</TableHead>
                                      <TableHead className="text-right">TDS</TableHead>
                                      <TableHead>Remarks</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {payment.allocations.map((alloc, idx) => (
                                      <TableRow key={alloc.id}>
                                        <TableCell className="text-center">{idx + 1}</TableCell>
                                        <TableCell className="font-medium">{alloc.patient_name}</TableCell>
                                        <TableCell>{alloc.patients_id || '-'}</TableCell>
                                        <TableCell>{alloc.visit_id || '-'}</TableCell>
                                        <TableCell className="text-right">
                                          {alloc.bill_amount ? `Rs. ${Number(alloc.bill_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          Rs. {Number(alloc.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {alloc.deduction_amount ? `Rs. ${Number(alloc.deduction_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {alloc.tds_amount ? `Rs. ${Number(alloc.tds_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell>{alloc.remarks || '-'}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              ) : (
                                <p className="text-sm text-gray-500">No allocations recorded.</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delay & Pending Counter Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Card
          className={`cursor-pointer transition hover:shadow-md border-2 ${openDelayCard === 'bill_submission' ? 'border-red-400 bg-red-50' : 'border-gray-100'}`}
          onClick={() => setOpenDelayCard(openDelayCard === 'bill_submission' ? null : 'bill_submission')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Delay in Bill Submission (&gt;3 Days)</p>
                <p className="text-2xl font-bold text-red-600">{delayedBillSubmissions.length}</p>
                <p className="text-xs text-gray-400 mt-1">Patients</p>
              </div>
              <ClipboardList className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition hover:shadow-md border-2 ${openDelayCard === 'payment_delay' ? 'border-orange-400 bg-orange-50' : 'border-gray-100'}`}
          onClick={() => setOpenDelayCard(openDelayCard === 'payment_delay' ? null : 'payment_delay')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Delay in Receiving Payment (&gt;2 Months)</p>
                <p className="text-2xl font-bold text-orange-600">{delayedPayments.length}</p>
                <p className="text-xs text-gray-400 mt-1">Patients &middot; {inr(delayedPayments.reduce((s, r) => s + r.bill_amount, 0))}</p>
              </div>
              <CalendarCheck className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition hover:shadow-md border-2 ${openDelayCard === 'pending_payment' ? 'border-amber-400 bg-amber-50' : 'border-gray-100'}`}
          onClick={() => setOpenDelayCard(openDelayCard === 'pending_payment' ? null : 'pending_payment')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Patient-wise Pending Payment (&gt;48 Hours)</p>
                <p className="text-2xl font-bold text-amber-600">{patientWisePending.length}</p>
                <p className="text-xs text-gray-400 mt-1">Patients &middot; {inr(patientWisePending.reduce((s, r) => s + r.pending_amount, 0))}</p>
              </div>
              <IndianRupee className="h-8 w-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Expanded Table for selected delay card */}
      {openDelayCard === 'bill_submission' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Delay in Bill Submission (&gt;3 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {delayedBillSubmissions.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No delayed bill submissions found.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Visit ID</TableHead>
                      <TableHead>Discharge Date</TableHead>
                      <TableHead className="text-right">Days Overdue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delayedBillSubmissions.map((row: any, idx: number) => (
                      <TableRow key={row.visit_id}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell className="font-medium">{row.patient_name}</TableCell>
                        <TableCell>{row.visit_id}</TableCell>
                        <TableCell>{row.discharge_date}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">{row.days_overdue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {openDelayCard === 'payment_delay' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Delay in Receiving Payment (&gt;2 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            {delayedPayments.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No delayed payments found.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Visit ID</TableHead>
                      <TableHead className="text-right">Bill Amount</TableHead>
                      <TableHead>Submitted On</TableHead>
                      <TableHead className="text-right">Days Overdue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delayedPayments.map((row: any, idx: number) => (
                      <TableRow key={row.visit_id}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell className="font-medium">{row.patient_name}</TableCell>
                        <TableCell>{row.visit_id}</TableCell>
                        <TableCell className="text-right">{inr(row.bill_amount)}</TableCell>
                        <TableCell>{row.date_of_submission}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">{row.days_overdue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {openDelayCard === 'pending_payment' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Patient-wise Pending Payment (&gt;48 Hours)</CardTitle>
          </CardHeader>
          <CardContent>
            {patientWisePending.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No pending payments found.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Visit ID</TableHead>
                      <TableHead>Corporate</TableHead>
                      <TableHead className="text-right">Bill Amount</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Deduction</TableHead>
                      <TableHead className="text-right">TDS</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientWisePending.map((row: any, idx: number) => (
                      <TableRow key={row.visit_id}>
                        <TableCell>{idx + 1}</TableCell>
                        <TableCell className="font-medium">{row.patient_name}</TableCell>
                        <TableCell>{row.visit_id}</TableCell>
                        <TableCell>{row.corporate}</TableCell>
                        <TableCell className="text-right">{inr(row.bill_amount)}</TableCell>
                        <TableCell className="text-right">{inr(row.received_amount)}</TableCell>
                        <TableCell className="text-right">{inr(row.deduction_amount)}</TableCell>
                        <TableCell className="text-right">{inr(row.tds_amount)}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">{inr(row.pending_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts Section */}
      <div className="mt-6">
        {/* Filter Buttons */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Patient Analytics</h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['daily', 'monthly', 'yearly'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setChartFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${chartFilter === f ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {f === 'daily' ? 'Today' : f === 'monthly' ? 'This Month' : 'This Year'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Corporate-wise Patient Visits Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Corporate-wise Patient Visits</CardTitle>
            </CardHeader>
            <CardContent>
              {corporateVisitsData.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No visit data available.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={corporateVisitsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} layout="vertical"
                    onClick={(chartData: any) => { if (chartData?.activePayload?.[0]?.payload) handleCorpBarClick(chartData.activePayload[0].payload); }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <XAxis type="number" allowDecimals={false} />
                    <Tooltip formatter={(value: any) => [value, 'Visits']} labelFormatter={(label: any) => {
                      const item = corporateVisitsData.find(d => d.name === label);
                      return item?.fullName || label;
                    }} />
                    <Bar dataKey="visits" fill="#2563eb" radius={[0, 4, 4, 0]} cursor="pointer" />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {/* Drilldown patient list */}
              {selectedPanelName && (
                <div className="mt-4 border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-blue-600 text-white px-4 py-2">
                    <span className="font-semibold text-sm">{selectedPanelName} — Patient List ({panelPatients.length} visits)</span>
                    <button onClick={() => setSelectedPanelName(null)} className="text-white hover:text-gray-200 font-bold text-lg leading-none">x</button>
                  </div>
                  {panelPatientsLoading ? (
                    <div className="text-center py-4 text-sm text-gray-500">Loading patients...</div>
                  ) : panelPatients.length === 0 ? (
                    <div className="text-center py-4 text-sm text-gray-500">No patients found.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left border-b">#</th>
                            <th className="px-3 py-2 text-left border-b">Patient Name</th>
                            <th className="px-3 py-2 text-left border-b">Visit ID</th>
                            <th className="px-3 py-2 text-left border-b">Type</th>
                            <th className="px-3 py-2 text-left border-b">Admission</th>
                            <th className="px-3 py-2 text-left border-b">Doctor</th>
                            <th className="px-3 py-2 text-left border-b">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {panelPatients.map((v: any, i: number) => (
                            <tr key={v.visit_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-3 py-2 border-b text-gray-500">{i + 1}</td>
                              <td className="px-3 py-2 border-b font-medium">{v.patients?.name || '-'}</td>
                              <td className="px-3 py-2 border-b text-blue-600">{v.visit_id}</td>
                              <td className="px-3 py-2 border-b">{v.patient_type}</td>
                              <td className="px-3 py-2 border-b">{v.admission_date}</td>
                              <td className="px-3 py-2 border-b">{v.appointment_with || '-'}</td>
                              <td className="px-3 py-2 border-b capitalize">{v.status || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Area-wise Patient Origin Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Area-wise Patient Origin</CardTitle>
            </CardHeader>
            <CardContent>
              {areaWiseData.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No area data available.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={areaWiseData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <XAxis type="number" allowDecimals={false} />
                    <Tooltip formatter={(value: any) => [value, 'Patients']} labelFormatter={(label: any) => {
                      const item = areaWiseData.find(d => d.name === label);
                      return item?.fullName || label;
                    }} />
                    <Bar dataKey="patients" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sales Book Section */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">📖 Hope Hospital Sales Book</h2>
          <a href="/hope-sales-book.pdf" target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1">
            📥 Download Full PDF (38 pages)
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => (
            <a key={i} href="/hope-sales-book.pdf" target="_blank" rel="noopener noreferrer" className="group">
              <img src={`/salesbook-page-${i}.png`} alt={`Sales Book Page ${i}`} className="w-full rounded-lg border border-gray-200 shadow-sm group-hover:shadow-md group-hover:ring-2 ring-blue-400 transition" />
              <p className="text-xs text-gray-500 text-center mt-1">Page {i}</p>
            </a>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3 text-center">Click any page or download button to view the complete 38-page sales book</p>
      </div>
    </div>
  );
}
