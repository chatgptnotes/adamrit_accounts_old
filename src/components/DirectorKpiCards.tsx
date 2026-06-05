import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { LogIn, LogOut, Stethoscope, Wallet, BedDouble, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDirectorKpis, type KpiPeriod } from '@/hooks/useDirectorKpis';

const PERIOD_LABELS: Record<Exclude<KpiPeriod, 'specific'>, string> = {
  today: 'Today',
  month: 'This month',
  year: 'This year',
};

// Always returns a real month name so the card subtitle matches the data shown
// (an empty specific-month picker falls back to the current month, like getDateRange).
function formatMonthLabel(specificMonth: string): string {
  const valid = /^\d{4}-\d{2}$/.test(specificMonth);
  const now = new Date();
  const [y, m] = valid
    ? specificMonth.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function DirectorKpiCards() {
  const [period, setPeriod] = useState<KpiPeriod>('month');
  const [specificMonth, setSpecificMonth] = useState('');
  const { data, isLoading, error, refetch } = useDirectorKpis(period, specificMonth);

  const periodLabel =
    period === 'specific' ? formatMonthLabel(specificMonth) : PERIOD_LABELS[period];

  const fmtCount = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
  const fmtMoney = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

  const cards = [
    { title: 'Admissions', value: fmtCount(data.admissions), subtitle: periodLabel, icon: LogIn, color: 'from-blue-500 to-blue-600', route: '/currently-admitted' },
    { title: 'Discharges', value: fmtCount(data.discharges), subtitle: periodLabel, icon: LogOut, color: 'from-green-500 to-green-600', route: '/discharged-patients' },
    { title: 'OPD Visits', value: fmtCount(data.opdVisits), subtitle: periodLabel, icon: Stethoscope, color: 'from-purple-500 to-purple-600', route: '/todays-opd' },
    { title: 'Collection', value: fmtMoney(data.collection), subtitle: periodLabel, icon: Wallet, color: 'from-emerald-500 to-emerald-600', route: '/accounting' },
    { title: 'Currently Admitted', value: fmtCount(data.activeIpd), subtitle: 'Live', icon: BedDouble, color: 'from-amber-500 to-amber-600', route: '/currently-admitted' },
    { title: 'Pending Approvals', value: fmtCount(data.pendingApprovals), subtitle: 'Live', icon: Clock, color: 'from-rose-500 to-rose-600', route: '/bill-approvals' },
  ];

  // Upper bound for the month picker — directors should not query future months.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-gray-700">Hospital Overview</span>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as KpiPeriod)}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="specific">Specific Month</SelectItem>
            </SelectContent>
          </Select>
          {period === 'specific' && (
            <Input
              type="month"
              value={specificMonth}
              max={currentMonth}
              onChange={(e) => setSpecificMonth(e.target.value)}
              className="h-9 w-[160px]"
              aria-label="Select month"
            />
          )}
        </div>
      </div>

      {error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          Failed to load dashboard metrics: {error.message}
          <button onClick={() => refetch()} className="ml-2 underline">
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[88px] bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map((card) => (
            <Link
              key={card.title}
              to={card.route}
              title={`Open ${card.title}`}
              className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden block transition-transform hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <div
                className={`bg-gradient-to-br ${card.color} px-3 py-2 flex items-center justify-between`}
              >
                <div>
                  <div className="text-white/80 text-[10px] font-medium">{card.title}</div>
                  <div className="text-white font-extrabold text-lg leading-tight">
                    {card.value}
                  </div>
                </div>
                <card.icon className="w-5 h-5 text-white/60" />
              </div>
              <div className="px-3 py-2">
                <div className="text-[10px] text-gray-400">{card.subtitle}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
