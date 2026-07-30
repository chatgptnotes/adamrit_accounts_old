import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Clock, BedDouble, RotateCcw, TrendingUp, Wallet, LogIn, RefreshCw } from 'lucide-react';

// Bed capacity is read from room_management; this is only the fallback for when
// no wards are configured yet.
const FALLBACK_TOTAL_BEDS = 42;

// BOR/BTR/BTI are all "per month" metrics and are benchmarked as such below, so
// every input has to come from the same rolling window. Previously the numerator
// was all-time while the denominator was TOTAL_BEDS * 30, which made BOR exceed
// 100% permanently (hidden by a Math.min clamp) and pinned BTI to 0.
const WINDOW_DAYS = 30;

const fetchKPIsData = async () => {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [visitsRes, accommRes, billsRes, roomsRes] = await Promise.all([
    supabase.from('visits').select('visit_type, is_discharged, discharge_date').gte('created_at', since),
    supabase.from('visit_accommodations').select('days').gte('start_date', since),
    supabase.from('bills').select('total_amount').gte('date', since),
    supabase.from('room_management').select('maximum_rooms'),
  ]);
  if (visitsRes.error) throw visitsRes.error;
  if (accommRes.error) throw accommRes.error;
  if (billsRes.error) throw billsRes.error;
  if (roomsRes.error) throw roomsRes.error;
  const totalBeds =
    (roomsRes.data || []).reduce((s, r) => s + (Number(r.maximum_rooms) || 0), 0) || FALLBACK_TOTAL_BEDS;
  return {
    visits: visitsRes.data || [],
    accommodations: accommRes.data || [],
    bills: billsRes.data || [],
    totalBeds,
  };
};

interface ClinicalKPIsProps {
  canSeeTile?: (tileId: string, role?: string | null) => boolean;
}

export const ClinicalKPIs = ({ canSeeTile }: ClinicalKPIsProps) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['clinical-kpis'],
    queryFn: fetchKPIsData,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const kpi = (() => {
    if (!data) return null;
    const { visits, accommodations, bills, totalBeds } = data;
    const totalVisits = visits.length;
    const ipdAdmissions = visits.filter(v => ['patient-admission', 'ipd', 'IPD'].includes(v.visit_type));
    const ipdCount = ipdAdmissions.length;
    const dischargeCount = visits.filter(v => v.is_discharged).length;
    const activeIpd = ipdAdmissions.filter(v => !v.is_discharged).length;
    const totalInpatientDays = accommodations.reduce((s, a) => s + (a.days || 0), 0);
    const alosNum = dischargeCount > 0 ? totalInpatientDays / dischargeCount : 0;
    const alos = alosNum > 0 ? alosNum.toFixed(1) : '—';
    const totalRevenue = bills.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    const availableBedDays = totalBeds * WINDOW_DAYS;
    // No clamp: a BOR above 100% means occupancy is being double-counted or beds
    // are mis-configured, and that needs to be visible rather than rounded away.
    const bor = availableBedDays > 0 ? Math.round((totalInpatientDays / availableBedDays) * 100) : 0;
    const btr = totalBeds > 0 ? (dischargeCount / totalBeds).toFixed(1) : '—';
    const bti = dischargeCount > 0 ? ((availableBedDays - totalInpatientDays) / dischargeCount).toFixed(1) : '—';
    const arpp = totalVisits > 0 ? Math.round(totalRevenue / totalVisits) : 0;
    const admissionRate = totalVisits > 0 ? Math.round((ipdCount / totalVisits) * 100) : 0;
    return { alos, bor, btr, bti, arpp, admissionRate, totalVisits, ipdCount, dischargeCount, totalRevenue, activeIpd, totalBeds };
  })();

  const allKpiCards = kpi ? [
    { title: 'ALOS', subtitle: 'Avg Length of Stay', value: kpi.alos === '—' ? '—' : `${kpi.alos} days`, benchmark: '< 4 days', good: kpi.alos !== '—' && parseFloat(kpi.alos) <= 4, color: 'from-blue-500 to-blue-600', icon: Clock, detail: `${kpi.dischargeCount} total discharges`, tileId: 'c-alos' },
    { title: 'BOR', subtitle: 'Bed Occupancy Rate', value: `${kpi.bor}%`, benchmark: '75–85% ideal', good: kpi.bor >= 75 && kpi.bor <= 85, color: 'from-purple-500 to-purple-600', icon: BedDouble, detail: `${kpi.totalBeds} beds configured`, tileId: 'c-bor' },
    { title: 'BTR', subtitle: 'Bed Turnover Rate', value: kpi.btr === '—' ? '—' : `${kpi.btr}×`, benchmark: '> 4× per month', good: kpi.btr !== '—' && parseFloat(kpi.btr) >= 4, color: 'from-green-500 to-green-600', icon: RotateCcw, detail: `${kpi.dischargeCount} discharges`, tileId: 'c-btr' },
    { title: 'BTI', subtitle: 'Bed Turnover Interval', value: kpi.bti === '—' ? '—' : `${kpi.bti} days`, benchmark: '< 1 day', good: kpi.bti !== '—' && parseFloat(kpi.bti) <= 1, color: 'from-amber-500 to-amber-600', icon: TrendingUp, detail: 'Empty bed time', tileId: 'c-bti' },
    { title: 'ARPP', subtitle: 'Avg Revenue Per Visit', value: `₹${kpi.arpp.toLocaleString('en-IN')}`, benchmark: '> ₹5,000', good: kpi.arpp >= 5000, color: 'from-emerald-500 to-emerald-600', icon: Wallet, detail: `₹${(kpi.totalRevenue / 100000).toFixed(1)}L total`, tileId: 'c-arpp' },
    { title: 'Admission Rate', subtitle: 'IPD Conversion', value: `${kpi.admissionRate}%`, benchmark: '15–25% ideal', good: kpi.admissionRate >= 15 && kpi.admissionRate <= 25, color: 'from-rose-500 to-rose-600', icon: LogIn, detail: `${kpi.ipdCount} of ${kpi.totalVisits} visits`, tileId: 'c-admission-rate' },
  ] : [];

  const kpiCards = canSeeTile ? allKpiCards.filter((c) => canSeeTile(c.tileId)) : allKpiCards;

  if (isLoading) {
    return <div className="space-y-3 mb-6">
      <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    </div>;
  }

  if (error) return (
    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
      KPI error: {(error as Error).message} <button onClick={() => refetch()} className="ml-2 underline">Retry</button>
    </div>
  );

  return (
    <div className="mb-6 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-bold text-gray-700">Clinical KPIs</span>
            <span className="ml-2 text-xs text-gray-400">{kpi?.totalBeds ?? FALLBACK_TOTAL_BEDS} beds · Last {WINDOW_DAYS} days · {kpi?.activeIpd} currently admitted</span>
          </div>
          <button onClick={() => refetch()} className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpiCards.map((card) => (
            <div key={card.title} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className={`bg-gradient-to-br ${card.color} px-3 py-2 flex items-center justify-between`}>
                <div>
                  <div className="text-white/80 text-[10px] font-medium">{card.title}</div>
                  <div className="text-white font-extrabold text-lg leading-tight">{card.value}</div>
                </div>
                <card.icon className="w-5 h-5 text-white/60" />
              </div>
              <div className="px-3 py-2 space-y-1">
                <div className="text-[10px] text-gray-500">{card.subtitle}</div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${card.good ? 'bg-green-500' : 'bg-amber-400'}`} />
                  <span className={`text-[10px] font-medium ${card.good ? 'text-green-600' : 'text-amber-600'}`}>{card.benchmark}</span>
                </div>
                <div className="text-[10px] text-gray-400">{card.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
