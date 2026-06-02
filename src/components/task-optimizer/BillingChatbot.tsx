import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RotateCcw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: number;
  role: 'user' | 'bot';
  text: string;
  loading?: boolean;
}

// ── Date resolver ────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return d.toISOString().split('T')[0]; }

function resolveDateRange(q: string): { label: string; start: string; end: string } {
  const now = new Date();
  if (q.includes('parson') || q.includes('day before yesterday')) {
    const d = new Date(now); d.setDate(d.getDate() - 2);
    const s = toDateStr(d); return { label: `Parson (${s})`, start: s, end: s };
  }
  if (q.includes('kal') || q.includes('yesterday') || q.includes('previous day')) {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    const s = toDateStr(d); return { label: `Kal (${s})`, start: s, end: s };
  }
  if (q.includes('is hafte') || q.includes('this week') || q.includes('hafte mein')) {
    const s = new Date(now); s.setDate(s.getDate() - s.getDay());
    return { label: 'Is Hafte', start: toDateStr(s), end: toDateStr(now) };
  }
  if (q.includes('is mahine') || q.includes('this month') || q.includes('mahine mein') || q.includes('monthly')) {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { label: 'Is Mahine', start: toDateStr(s), end: toDateStr(now) };
  }
  const s = toDateStr(now);
  return { label: `Aaj (${s})`, start: s, end: s };
}

function formatCurrency(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toLocaleString('en-IN')}`;
}

// ── Intent detection ─────────────────────────────────────────────────────────

type Intent =
  // Patients
  | 'patient_count' | 'admitted_now' | 'ipd_count' | 'opd_count' | 'discharge_count'
  | 'emergency_patients' | 'cghs_patients' | 'insurance_patients' | 'corporate_patients'
  // Billing
  | 'collection' | 'pending_bills' | 'bills_count' | 'payment_mode' | 'outstanding_amount' | 'advance_today'
  // Lab
  | 'lab_orders' | 'lab_pending'
  // Radiology
  | 'radiology_orders' | 'radiology_pending'
  // OT / Surgery
  | 'ot_today' | 'surgery_pending'
  // Pharmacy
  | 'pharmacy_today'
  // Fallback
  | 'faq';

const INTENTS: { intent: Intent; patterns: string[] }[] = [
  // ── Patients ──
  {
    intent: 'patient_count',
    patterns: [
      'kitne patient', 'how many patient', 'patient count', 'patient aaye', 'naye patient',
      'patient register', 'admission count', 'admission kitne', 'patient the',
      'patients today', 'today patient', 'aaj patient', 'kal patient', 'is hafte patient',
    ],
  },
  {
    intent: 'admitted_now',
    patterns: [
      'abhi kitne admit', 'currently admitted', 'active patients', 'kitne admit hain',
      'admit hain abhi', 'current census', 'bed occupancy', 'occupancy kitni',
      'total admit', 'abhi hospital mein kitne',
    ],
  },
  {
    intent: 'ipd_count',
    patterns: [
      'ipd kitne', 'ipd patient', 'ipd count', 'kitne ipd', 'ipd abhi', 'inpatient',
      'kal ipd', 'is hafte ipd', 'ipd today', 'ipd aaj',
    ],
  },
  {
    intent: 'opd_count',
    patterns: [
      'opd kitne', 'opd patient', 'opd count', 'kitne opd', 'outpatient',
      'opd aaj', 'opd today', 'kal opd', 'is hafte opd', 'opd visit',
    ],
  },
  {
    intent: 'discharge_count',
    patterns: [
      'discharge kitne', 'aaj discharge', 'today discharge', 'discharge count', 'discharge hue',
      'kal discharge', 'kitne discharge', 'discharge ho gaye', 'is hafte discharge',
    ],
  },
  {
    intent: 'emergency_patients',
    patterns: [
      'emergency patient', 'emergency kitne', 'casualty', 'emergency admit',
      'aaj emergency', 'emergency aaj', 'emergency count',
    ],
  },
  {
    intent: 'cghs_patients',
    patterns: [
      'cghs patient', 'cghs kitne', 'central govt patient', 'government patient',
      'cghs admit', 'cghs aaj', 'cghs count',
    ],
  },
  {
    intent: 'insurance_patients',
    patterns: [
      'insurance patient', 'tpa patient', 'cashless patient', 'mediclaim patient',
      'insurance kitne', 'tpa kitne', 'claim patient', 'insurance admit',
    ],
  },
  {
    intent: 'corporate_patients',
    patterns: [
      'corporate patient', 'corporate kitne', 'company patient', 'kitne corporate',
      'corporate admit', 'corporate aaj', 'kal corporate',
    ],
  },
  // ── Billing ──
  {
    intent: 'collection',
    patterns: [
      'collection kitna', 'aaj ka collection', 'kal ka collection', 'today collection',
      'kitna paisa aaya', 'revenue', 'payment kitna', 'income kitni', 'daily collection',
      'is hafte collection', 'is mahine collection', 'monthly collection',
    ],
  },
  {
    intent: 'pending_bills',
    patterns: [
      'pending bill', 'unpaid bill', 'bill pending', 'outstanding bill', 'bills due',
      'unpaid kitne', 'pending amount', 'dues kitne', 'payment pending',
    ],
  },
  {
    intent: 'bills_count',
    patterns: [
      'kitne bill bane', 'bills generate', 'bill count', 'aaj ke bill', 'kal ke bill',
      'today bills', 'bills today', 'is hafte bill', 'bill kitne bane',
    ],
  },
  {
    intent: 'payment_mode',
    patterns: [
      'cash kitna', 'upi kitna', 'card kitna', 'payment mode', 'cash collection',
      'neft kitna', 'online payment', 'payment breakdown', 'mode wise',
      'cash vs upi', 'cash aur upi', 'kitna cash aaya',
    ],
  },
  {
    intent: 'outstanding_amount',
    patterns: [
      'outstanding', 'total due', 'total pending amount', 'kitna baki hai',
      'receivable', 'total outstanding', 'baki amount', 'unpaid amount',
    ],
  },
  {
    intent: 'advance_today',
    patterns: [
      'advance', 'deposit', 'advance kitna', 'deposit kitna', 'advance aaj',
      'deposit aaj', 'advance collect', 'kitna advance aaya',
    ],
  },
  // ── Lab ──
  {
    intent: 'lab_orders',
    patterns: [
      'lab kitne', 'lab test', 'lab order', 'pathology', 'blood test', 'lab aaj',
      'kal lab', 'is hafte lab', 'lab count', 'kitne lab test',
    ],
  },
  {
    intent: 'lab_pending',
    patterns: [
      'lab pending', 'pending report', 'lab report pending', 'report nahi aaya',
      'lab result pending', 'test pending', 'pending lab', 'kitne lab pending',
    ],
  },
  // ── Radiology ──
  {
    intent: 'radiology_orders',
    patterns: [
      'radiology', 'xray', 'x-ray', 'ct scan', 'mri', 'ultrasound', 'usg',
      'radiology kitne', 'radiology aaj', 'imaging count', 'scan kitne',
    ],
  },
  {
    intent: 'radiology_pending',
    patterns: [
      'radiology pending', 'scan pending', 'xray pending', 'report pending radiology',
      'imaging pending', 'ct pending', 'mri pending',
    ],
  },
  // ── OT ──
  {
    intent: 'ot_today',
    patterns: [
      'operation kitne', 'surgery kitne', 'ot kitne', 'operation aaj', 'surgery aaj',
      'ot today', 'operations today', 'kitne operation', 'ot count', 'kal operation',
    ],
  },
  {
    intent: 'surgery_pending',
    patterns: [
      'surgery pending', 'operation pending', 'ot pending', 'pending surgery',
      'scheduled surgery', 'upcoming operation',
    ],
  },
  // ── Pharmacy ──
  {
    intent: 'pharmacy_today',
    patterns: [
      'pharmacy', 'medicine', 'prescription', 'dawai', 'pharma billing',
      'pharmacy aaj', 'pharmacy count', 'prescription today', 'kitne prescription',
    ],
  },
];

function detectIntent(q: string): Intent {
  const norm = q.toLowerCase().replace(/[?।!,.]/g, '').trim();
  for (const { intent, patterns } of INTENTS) {
    if (patterns.some(p => norm.includes(p))) return intent;
  }
  // fuzzy: single word match (4+ chars)
  const words = norm.split(' ').filter(w => w.length > 3);
  for (const { intent, patterns } of INTENTS) {
    for (const p of patterns) {
      if (words.some(w => p.includes(w))) return intent;
    }
  }
  return 'faq';
}

// ── Live queries ─────────────────────────────────────────────────────────────

async function queryLive(intent: Intent, raw: string): Promise<string> {
  const { label, start, end } = resolveDateRange(raw);

  try {
    // ── PATIENTS ──────────────────────────────────────────────────────────────
    if (intent === 'patient_count') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .gte('visit_date', start).lte('visit_date', end);
      if (error) throw error;
      return `🏥 ${label} ke Patients:\n\n👥 ${count ?? 0} patients registered\n\n✅ Real-time data from Supabase`;
    }

    if (intent === 'admitted_now') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .is('discharge_date', null);
      if (error) throw error;
      return `🛏 Abhi Admitted (Current Census):\n\n${count ?? 0} patients abhi hospital mein hain\n\n(Discharge hone par automatically update hoga)`;
    }

    if (intent === 'ipd_count') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .ilike('visit_type', '%ipd%').is('discharge_date', null);
      if (error) throw error;
      return `🏨 IPD Patients (Abhi Admitted):\n\n🛏 ${count ?? 0} IPD patients currently admitted`;
    }

    if (intent === 'opd_count') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .ilike('visit_type', '%opd%')
        .gte('visit_date', start).lte('visit_date', end);
      if (error) throw error;
      return `🏥 ${label} OPD Patients:\n\n👥 ${count ?? 0} OPD visits`;
    }

    if (intent === 'discharge_count') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .gte('discharge_date', start).lte('discharge_date', end);
      if (error) throw error;
      return `🚪 ${label} ke Discharges:\n\n✅ ${count ?? 0} patients discharge hue`;
    }

    if (intent === 'emergency_patients') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .ilike('visit_type', '%emergency%')
        .gte('visit_date', start).lte('visit_date', end);
      if (error) throw error;
      return `🚨 ${label} Emergency Patients:\n\n🚑 ${count ?? 0} emergency admissions`;
    }

    if (intent === 'cghs_patients') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .not('cghs_code', 'is', null).is('discharge_date', null);
      if (error) throw error;
      return `🏛️ CGHS Patients (Currently Admitted):\n\n${count ?? 0} CGHS patients abhi admit hain`;
    }

    if (intent === 'insurance_patients') {
      const { count, error } = await supabase
        .from('visits').select('id', { count: 'exact', head: true })
        .not('claim_id', 'is', null).is('discharge_date', null);
      if (error) throw error;
      return `💳 Insurance / TPA Patients (Admitted):\n\n${count ?? 0} cashless/TPA patients abhi admit hain`;
    }

    if (intent === 'corporate_patients') {
      const { data: vData, error: vErr } = await supabase
        .from('visits').select('patient_id').is('discharge_date', null);
      if (vErr) throw vErr;
      const ids = (vData ?? []).map(v => v.patient_id).slice(0, 500);
      if (!ids.length) return `🏢 Corporate Patients:\n\n0 corporate patients admit hain abhi`;
      const { count, error: pErr } = await supabase
        .from('patients').select('id', { count: 'exact', head: true })
        .in('id', ids).not('corporate', 'is', null);
      if (pErr) throw pErr;
      return `🏢 Corporate Patients (Admitted):\n\n🏢 ${count ?? 0} corporate patients abhi admit hain`;
    }

    // ── BILLING ───────────────────────────────────────────────────────────────
    if (intent === 'collection') {
      const { data, error } = await supabase
        .from('payment_transactions').select('payment_amount')
        .gte('payment_date', start).lte('payment_date', end);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + (r.payment_amount ?? 0), 0);
      return `💰 ${label} ka Collection:\n\n💵 Total: ${formatCurrency(total)}\n📋 Transactions: ${data?.length ?? 0}`;
    }

    if (intent === 'pending_bills') {
      const { count, error } = await supabase
        .from('bills').select('id', { count: 'exact', head: true })
        .not('status', 'eq', 'Received');
      if (error) throw error;
      const { data: amtData } = await supabase
        .from('bills').select('total_amount').not('status', 'eq', 'Received');
      const totalAmt = (amtData ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
      return `⏳ Pending Bills:\n\n📄 ${count ?? 0} bills pending\n💰 Total pending: ${formatCurrency(totalAmt)}`;
    }

    if (intent === 'bills_count') {
      const { data, error } = await supabase
        .from('bills').select('total_amount')
        .gte('date', start).lte('date', end);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
      return `🧾 ${label} ke Bills:\n\n📄 ${data?.length ?? 0} bills generate hue\n💰 Total amount: ${formatCurrency(total)}`;
    }

    if (intent === 'payment_mode') {
      const { data, error } = await supabase
        .from('payment_transactions').select('payment_mode, payment_amount')
        .gte('payment_date', start).lte('payment_date', end);
      if (error) throw error;
      const breakdown: Record<string, number> = {};
      for (const r of data ?? []) {
        const mode = r.payment_mode ?? 'Other';
        breakdown[mode] = (breakdown[mode] ?? 0) + (r.payment_amount ?? 0);
      }
      const lines = Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([mode, amt]) => `  • ${mode}: ${formatCurrency(amt)}`)
        .join('\n');
      const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
      return `💳 ${label} Payment Mode Breakdown:\n\n${lines || '  (No transactions)'}\n\n💵 Total: ${formatCurrency(total)}`;
    }

    if (intent === 'outstanding_amount') {
      const { data, error } = await supabase
        .from('bills').select('total_amount').not('status', 'eq', 'Received');
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
      return `📊 Total Outstanding Amount:\n\n💰 ${formatCurrency(total)}\n📄 ${data?.length ?? 0} bills unpaid\n\n(Har payment ke baad automatically update hoga)`;
    }

    if (intent === 'advance_today') {
      const { data, error } = await supabase
        .from('vouchers').select('total_amount')
        .gte('voucher_date', start).lte('voucher_date', end);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0);
      return `💵 ${label} ka Advance / Deposit:\n\n📋 ${data?.length ?? 0} vouchers\n💰 Total: ${formatCurrency(total)}`;
    }

    // ── LAB ───────────────────────────────────────────────────────────────────
    if (intent === 'lab_orders') {
      const { count, error } = await supabase
        .from('lab_orders').select('id', { count: 'exact', head: true })
        .gte('order_date', start).lte('order_date', end);
      if (error) throw error;
      return `🔬 ${label} ke Lab Orders:\n\n🧪 ${count ?? 0} lab tests ordered`;
    }

    if (intent === 'lab_pending') {
      const { count, error } = await supabase
        .from('lab_orders').select('id', { count: 'exact', head: true })
        .not('order_status', 'eq', 'completed').not('order_status', 'eq', 'reported');
      if (error) throw error;
      return `⏳ Pending Lab Reports:\n\n🧪 ${count ?? 0} lab tests ka result pending hai`;
    }

    // ── RADIOLOGY ─────────────────────────────────────────────────────────────
    if (intent === 'radiology_orders') {
      const { count, error } = await supabase
        .from('radiology_orders').select('id', { count: 'exact', head: true })
        .gte('order_date', start).lte('order_date', end);
      if (error) throw error;
      return `🩻 ${label} ke Radiology Orders:\n\n📷 ${count ?? 0} scans/X-rays ordered`;
    }

    if (intent === 'radiology_pending') {
      const { count, error } = await supabase
        .from('radiology_orders').select('id', { count: 'exact', head: true })
        .not('status', 'eq', 'completed').not('status', 'eq', 'reported');
      if (error) throw error;
      return `⏳ Pending Radiology Reports:\n\n🩻 ${count ?? 0} scans ka report pending hai`;
    }

    // ── OT ────────────────────────────────────────────────────────────────────
    if (intent === 'ot_today') {
      const { count, error } = await supabase
        .from('ot_patients').select('id', { count: 'exact', head: true })
        .gte('created_at', `${start}T00:00:00`).lte('created_at', `${end}T23:59:59`);
      if (error) throw error;
      return `⚕️ ${label} ke Operations:\n\n🏥 ${count ?? 0} patients OT mein gaye`;
    }

    if (intent === 'surgery_pending') {
      const { count, error } = await supabase
        .from('ot_patients').select('id', { count: 'exact', head: true })
        .not('status', 'eq', 'completed').not('status', 'eq', 'done');
      if (error) throw error;
      return `📋 Pending / Scheduled Surgeries:\n\n${count ?? 0} operations scheduled / pending`;
    }

    // ── PHARMACY ──────────────────────────────────────────────────────────────
    if (intent === 'pharmacy_today') {
      const { data, error } = await supabase
        .from('prescriptions').select('final_amount')
        .gte('prescription_date', start).lte('prescription_date', end);
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + (r.final_amount ?? 0), 0);
      return `💊 ${label} Pharmacy:\n\n📋 ${data?.length ?? 0} prescriptions\n💰 Total: ${formatCurrency(total)}`;
    }

    return faqFallback(raw);
  } catch (err) {
    return `⚠️ Data load nahi ho saka.\n\nError: ${err instanceof Error ? err.message : 'Unknown'}\n\nSupabase connection check karein.`;
  }
}

// ── FAQ fallback ──────────────────────────────────────────────────────────────

const FAQ: { keywords: string[]; answer: string }[] = [
  {
    keywords: ['corporate discharge', 'corporate ka final bill', 'corporate bill kaise'],
    answer: `📋 Corporate Discharge:\n1. Auth letter + employee ID + Aadhar collect karo\n2. Empanelment & tariff verify karo\n3. Final bill generate karo\n4. Patient ka signature lo\n5. Claim HR/TPA ko 24 hrs mein bhejo`,
  },
  {
    keywords: ['yojana', 'ayushman', 'pmjay', 'preauth', 'pre-auth'],
    answer: `🏥 Yojana Pre-Auth:\n1. Portal pe eligibility verify karo\n2. Pre-auth form fill karo\n3. Documents attach karo\n4. Procedure se PEHLE submit karo\n5. Approval ke baad hi treatment shuru karo`,
  },
  {
    keywords: ['tpa', 'cashless', 'insurance claim'],
    answer: `💳 TPA/Cashless:\n• Admission ke 6 hrs mein pre-auth bhejo\n• Stay >3 days: daily update bhejo\n• Discharge ke 24 hrs mein final claim submit karo`,
  },
  {
    keywords: ['nmi', 'nmi query', 'query aaya'],
    answer: `🔍 NMI Query:\n1. Exact item note karo\n2. Doctor se clinical justification lo\n3. Reports attach karo\n4. TPA ko reply bhejo\n5. 48 hrs mein follow up karo`,
  },
  {
    keywords: ['refund', 'paise wapas', 'overpaid'],
    answer: `💸 Refund:\n1. System mein verify karo\n2. Billing head approval lo\n3. Same mode mein refund karo\n4. Patient signature lo`,
  },
];

function faqFallback(q: string): string {
  const norm = q.toLowerCase();
  let best = null; let bestScore = 0;
  for (const f of FAQ) {
    const score = f.keywords.filter(k => norm.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  if (best && bestScore > 0) return best.answer;
  return `🤔 Yeh sawaal samajh nahi aaya.\n\nIn categories se pooch sakte ho:\n👥 Patients | 💰 Billing | 🔬 Lab | 🩻 Radiology | ⚕️ OT | 💊 Pharmacy\n\nExample:\n• "Aaj kitne patients aaye?"\n• "Kal ka collection kitna tha?"\n• "Lab pending kitne hain?"`;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    label: '👥 Patients',
    color: 'blue',
    qs: ['Aaj kitne patients aaye?', 'Abhi kitne admit hain?', 'Aaj discharge kitne hue?', 'Emergency patients aaj?', 'Corporate patients kitne?'],
  },
  {
    label: '💰 Billing',
    color: 'green',
    qs: ['Aaj ka collection kitna?', 'Pending bills kitne?', 'Cash aur UPI kitna aaya?', 'Total outstanding kitna?', 'Aaj kitne bill bane?'],
  },
  {
    label: '🔬 Lab & Radiology',
    color: 'purple',
    qs: ['Aaj lab orders kitne?', 'Lab reports pending?', 'Radiology orders aaj?', 'Scan pending kitne?'],
  },
  {
    label: '⚕️ OT & Pharma',
    color: 'orange',
    qs: ['Aaj operations kitne hue?', 'Surgery pending kitne?', 'Pharmacy today?'],
  },
];

const GREETING = `👋 Main aapka Live HMS Assistant hoon!\n\nMain Supabase se real-time data fetch karta hoon:\n\n👥 Patients — IPD/OPD/Emergency/CGHS/Corporate\n💰 Billing — Collection/Pending/Mode-wise\n🔬 Lab — Orders/Pending reports\n🩻 Radiology — Scans/Pending\n⚕️ OT — Operations/Scheduled\n💊 Pharmacy — Prescriptions\n\n📅 Time bhi specify kar sakte ho:\n"Kal ka collection" | "Is hafte patients" | "Is mahine ka collection"\n\nNeeche category choose karo ya type karo!`;

// ── Component ─────────────────────────────────────────────────────────────────

let _id = 0;
const nid = () => ++_id;

export default function BillingChatbot() {
  const [messages, setMessages] = useState<Message[]>([{ id: nid(), role: 'bot', text: GREETING }]);
  const [input, setInput] = useState('');
  const [openCat, setOpenCat] = useState<string | null>('👥 Patients');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (text: string) => {
    const q = text.trim(); if (!q) return;
    setInput('');
    const uid = nid(); const bid = nid();
    setMessages(prev => [
      ...prev,
      { id: uid, role: 'user', text: q },
      { id: bid, role: 'bot', text: '...', loading: true },
    ]);
    const intent = detectIntent(q.toLowerCase());
    const answer = intent !== 'faq' ? await queryLive(intent, q.toLowerCase()) : faqFallback(q);
    setMessages(prev => prev.map(m => m.id === bid ? { ...m, text: answer, loading: false } : m));
  };

  const reset = () => { setMessages([{ id: nid(), role: 'bot', text: GREETING }]); setInput(''); };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-blue-600 shrink-0 flex items-center gap-2">
        <Bot className="h-4 w-4 text-white" />
        <span className="text-sm font-semibold text-white">HMS Assistant</span>
        <span className="text-xs bg-green-400 text-green-900 rounded-full px-1.5 py-0.5 font-medium">LIVE</span>
        <button type="button" onClick={reset} title="Reset" className="ml-auto text-blue-200 hover:text-white">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${msg.role === 'bot' ? 'bg-blue-100' : 'bg-slate-200'}`}>
              {msg.role === 'bot' ? <Bot className="h-3.5 w-3.5 text-blue-600" /> : <User className="h-3.5 w-3.5 text-slate-600" />}
            </div>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-line shadow-sm ${
              msg.role === 'bot' ? 'bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-none' : 'bg-blue-600 text-white rounded-tr-none'
            }`}>
              {msg.loading
                ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Fetching…</span>
                : msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Category suggestions */}
      <div className="border-t shrink-0 overflow-y-auto max-h-52">
        {CATEGORIES.map(cat => (
          <div key={cat.label}>
            <button
              type="button"
              onClick={() => setOpenCat(p => p === cat.label ? null : cat.label)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100 border-b transition-colors"
            >
              <span>{cat.label}</span>
              {openCat === cat.label ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {openCat === cat.label && (
              <div className="flex flex-col divide-y border-b bg-white">
                {cat.qs.map(q => (
                  <button key={q} type="button" onClick={() => send(q)}
                    className="text-left text-xs px-3 py-1.5 hover:bg-blue-50 text-slate-700 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t shrink-0 flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Kuch bhi poochhein… (Hindi/English)"
          className="flex-1 text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <button type="button" onClick={() => send(input)} disabled={!input.trim()}
          className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 shrink-0">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
