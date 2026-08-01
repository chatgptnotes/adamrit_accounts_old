import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type DeadlineRecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface PaymentDeadline {
  id: string;
  service_name: string;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue';
  hospital_type: string;
  notes?: string;
  created_at: string;
  recurrence_type?: DeadlineRecurrenceType;
  recurrence_interval?: number;
  recurrence_weekdays?: number[] | null;
  recurrence_day_of_month?: number | null;
  recurrence_end_date?: string | null;
  last_recycled_at?: string | null;
}

export function usePaymentDeadlines() {
  const { user } = useAuth();
  const hospitalType = user?.hospitalType;

  return useQuery({
    queryKey: ['paymentDeadlines', hospitalType],
    queryFn: async (): Promise<PaymentDeadline[]> => {
      if (!hospitalType) throw new Error('Hospital type not available');
      const { data, error } = await supabase
        .from('payment_deadlines')
        .select('*')
        .eq('hospital_type', hospitalType)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data || []) as PaymentDeadline[];
    },
    enabled: !!hospitalType,
  });
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatRecurrenceRule(deadline: PaymentDeadline): string {
  const type = deadline.recurrence_type ?? 'none';
  if (type === 'none' || !type) return '';
  const interval = deadline.recurrence_interval && deadline.recurrence_interval > 1
    ? `${deadline.recurrence_interval} `
    : '';
  switch (type) {
    case 'daily':
      return interval ? `Every ${interval} days` : 'Daily';
    case 'weekly': {
      const days = (deadline.recurrence_weekdays ?? []).slice().sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d] ?? String(d)).join(', ');
      return interval ? `Every ${interval} week${deadline.recurrence_interval! > 1 ? 's' : ''}${days ? ' on ' + days : ''}` : `Weekly${days ? ' on ' + days : ''}`;
    }
    case 'monthly': {
      const dom = deadline.recurrence_day_of_month;
      return interval ? `Every ${interval} month${deadline.recurrence_interval! > 1 ? 's' : ''}${dom ? ' (day ' + dom + ')' : ''}` : `Monthly${dom ? ' (day ' + dom + ')' : ''}`;
    }
    case 'yearly':
      return interval ? `Every ${interval} years` : 'Yearly';
    default:
      return '';
  }
}

export function nextRecurrenceDate(
  currentDate: string | Date,
  deadline: Pick<PaymentDeadline, 'recurrence_type' | 'recurrence_interval' | 'recurrence_day_of_month' | 'recurrence_end_date'>,
): string | null {
  const type = deadline.recurrence_type ?? 'none';
  if (type === 'none') return null;
  const interval = Math.max(1, deadline.recurrence_interval ?? 1);
  const base = new Date(currentDate);
  if (Number.isNaN(base.getTime())) return null;
  let next = new Date(base);
  switch (type) {
    case 'daily': next.setDate(next.getDate() + interval); break;
    case 'weekly': next.setDate(next.getDate() + 7 * interval); break;
    case 'monthly': {
      const targetDay = deadline.recurrence_day_of_month ?? base.getDate();
      const nextMonth = new Date(base.getFullYear(), base.getMonth() + interval, 1);
      const clampedDay = Math.min(targetDay, 28);
      next = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), clampedDay);
      break;
    }
    case 'yearly': next.setFullYear(next.getFullYear() + interval); break;
    default: return null;
  }
  if (deadline.recurrence_end_date) {
    const end = new Date(deadline.recurrence_end_date);
    if (next > end) return null;
  }
  return next.toISOString().slice(0, 10);
}