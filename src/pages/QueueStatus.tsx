import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, CheckCircle, Share2, RefreshCw } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// DATA SOURCE: queue_tokens → today's tokens by department

// ─── Types ───────────────────────────────────────────────────────────────────

type TokenStatus = 'waiting' | 'called' | 'serving' | 'done' | 'skipped';

interface QueueToken {
  id: string;
  token_number: number;
  department: string;
  patient_name: string | null;
  status: TokenStatus;
  counter_name: string | null;
  called_at: string | null;
  served_at: string | null;
  created_at: string;
}

interface DeptSummary {
  dept: string;
  serving: QueueToken | null;
  waitingCount: number;
  prefix: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns today's midnight ISO string for filtering by created_at */
function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Builds the display token label, e.g. "L24" for Lab token 24 */
function tokenLabel(dept: string, tokenNumber: number): string {
  const prefix = dept.charAt(0).toUpperCase();
  return `${prefix}${tokenNumber}`;
}

/** Returns badge color classes based on status */
function statusColor(status: TokenStatus): string {
  switch (status) {
    case 'waiting':  return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'called':   return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'serving':  return 'bg-green-100 text-green-800 border-green-200';
    case 'done':     return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'skipped':  return 'bg-red-100 text-red-700 border-red-200';
    default:         return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

/** Human-readable status label */
function statusLabel(status: TokenStatus): string {
  switch (status) {
    case 'waiting':  return 'Waiting';
    case 'called':   return 'Called';
    case 'serving':  return 'Serving';
    case 'done':     return 'Done';
    case 'skipped':  return 'Skipped';
    default:         return status;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface RefreshIndicatorProps {
  lastUpdated: Date | null;
  isFetching: boolean;
}

/** Spinning refresh indicator with "Updated X seconds ago" label */
function RefreshIndicator({ lastUpdated, isFetching }: RefreshIndicatorProps) {
  const [, forceRender] = useState(0);

  // Tick every 5 s so the "X seconds ago" text stays fresh
  useEffect(() => {
    const t = setInterval(() => forceRender(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400">
      <RefreshCw
        size={12}
        className={isFetching ? 'animate-spin text-blue-400' : ''}
      />
      {lastUpdated ? (
        <span>Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
      ) : (
        <span>Loading…</span>
      )}
    </div>
  );
}

/** Copies the current page URL to clipboard */
function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: no-op — clipboard may not be available in non-HTTPS context
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      className="flex items-center gap-1.5 text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600 transition-colors"
    >
      <Share2 size={14} />
      {copied ? 'Copied!' : 'Share'}
    </Button>
  );
}

// ─── Personal Token View ──────────────────────────────────────────────────────

interface PersonalViewProps {
  dept: string;
  tokenNumber: number;
}

/** Full-screen personal view for a specific patient token */
function PersonalView({ dept, tokenNumber }: PersonalViewProps) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // DATA SOURCE: queue_tokens → today's tokens for this department
  const { data: tokens = [], isFetching } = useQuery<QueueToken[]>({
    queryKey: ['queue-status-personal', dept],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('queue_tokens')
        .select('id, token_number, department, patient_name, status, counter_name, called_at, served_at, created_at')
        .eq('department', dept)
        .gte('created_at', todayStart())
        .order('token_number', { ascending: true });
      if (error) throw error;
      setLastUpdated(new Date());
      return (data ?? []) as QueueToken[];
    },
    refetchInterval: 20000,
    staleTime: 4000,
  });

  const myToken = tokens.find(t => t.token_number === tokenNumber);

  // Count waiting tokens with lower token_number (patients ahead)
  const aheadCount = tokens.filter(
    t => t.status === 'waiting' && t.token_number < tokenNumber
  ).length;

  // Lowest token currently being served or called
  const nowServing = tokens
    .filter(t => t.status === 'serving' || t.status === 'called')
    .sort((a, b) => a.token_number - b.token_number)[0] ?? null;

  const status = myToken?.status ?? 'waiting';
  const label = tokenLabel(dept, tokenNumber);
  const isActive = status === 'called' || status === 'serving';

  // Status message and call-to-action text
  const statusMessage = (() => {
    switch (status) {
      case 'waiting':  return 'Please wait — you will be called soon.';
      case 'called':   return `Please proceed to ${myToken?.counter_name ?? 'the counter'}!`;
      case 'serving':  return 'You are being served now.';
      case 'done':     return 'Your visit is complete. Thank you!';
      case 'skipped':  return 'Your token was skipped. Please check with the staff.';
      default:         return 'Please wait.';
    }
  })();

  // Background accent for active states
  const cardAccent = isActive
    ? 'bg-gradient-to-br from-blue-50 to-green-50 border-blue-200'
    : status === 'done'
    ? 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-200'
    : 'bg-white border-gray-200';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">Hope Hospital</h1>
          <p className="text-xs text-gray-400 mt-0.5">Live Queue Status</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshIndicator lastUpdated={lastUpdated} isFetching={isFetching} />
          <ShareButton />
        </div>
      </header>

      {/* Main token card */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">

        {/* Token number card */}
        <div className={`w-full max-w-sm rounded-2xl border-2 p-8 shadow-md transition-all ${cardAccent}`}>
          {/* Department badge */}
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-widest">
              {dept}
            </span>
            <span className={`text-xs font-medium px-3 py-1 rounded-full border ${statusColor(status)}`}>
              {statusLabel(status)}
            </span>
          </div>

          {/* Giant token number */}
          <div className="text-center mb-6">
            <div
              className={`text-8xl font-extrabold tracking-tight leading-none transition-all ${
                isActive ? 'text-blue-600' : status === 'done' ? 'text-gray-400' : 'text-gray-800'
              }`}
            >
              {label}
            </div>
            {/* Animated pulse ring for active states */}
            {isActive && (
              <div className="flex justify-center mt-4">
                <span className="relative flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
                </span>
              </div>
            )}
          </div>

          {/* Status message */}
          <p
            className={`text-center text-base font-medium leading-snug ${
              isActive ? 'text-blue-700' : status === 'done' ? 'text-gray-500' : 'text-gray-600'
            }`}
          >
            {statusMessage}
          </p>
        </div>

        {/* Info pills */}
        <div className="w-full max-w-sm flex flex-col gap-3">

          {/* Patients ahead */}
          {(status === 'waiting') && (
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <Clock size={16} />
                <span className="text-sm">Patients ahead of you</span>
              </div>
              <span className="text-2xl font-bold text-gray-800">{aheadCount}</span>
            </div>
          )}

          {/* Now serving */}
          <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <CheckCircle size={16} />
              <span className="text-sm">Currently serving</span>
            </div>
            <span className="text-xl font-bold text-green-600">
              {nowServing
                ? tokenLabel(nowServing.department, nowServing.token_number)
                : '—'}
            </span>
          </div>

          {/* Called time (if applicable) */}
          {(status === 'called' || status === 'serving') && myToken?.called_at && (
            <div className="flex items-center justify-between bg-blue-50 rounded-xl border border-blue-100 px-5 py-4 shadow-sm">
              <span className="text-sm text-blue-600">Called at</span>
              <span className="text-sm font-semibold text-blue-700">
                {format(new Date(myToken.called_at), 'hh:mm a')}
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-gray-300">
        Powered by Adamrit
      </footer>
    </div>
  );
}

// ─── Department Overview View ─────────────────────────────────────────────────

/** Overview grid of all active departments from today's tokens */
function OverviewView() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // DATA SOURCE: queue_tokens → today's tokens → all departments
  const { data: tokens = [], isFetching } = useQuery<QueueToken[]>({
    queryKey: ['queue-status-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('queue_tokens')
        .select('id, token_number, department, patient_name, status, counter_name, called_at, served_at, created_at')
        .gte('created_at', todayStart())
        .order('token_number', { ascending: true });
      if (error) throw error;
      setLastUpdated(new Date());
      return (data ?? []) as QueueToken[];
    },
    refetchInterval: 20000,
    staleTime: 4000,
  });

  // Group tokens by department and compute stats
  const deptMap = new Map<string, QueueToken[]>();
  for (const t of tokens) {
    if (!deptMap.has(t.department)) deptMap.set(t.department, []);
    deptMap.get(t.department)!.push(t);
  }

  const summaries: DeptSummary[] = Array.from(deptMap.entries())
    .map(([dept, deptTokens]) => {
      const serving =
        deptTokens
          .filter(t => t.status === 'serving' || t.status === 'called')
          .sort((a, b) => a.token_number - b.token_number)[0] ?? null;
      const waitingCount = deptTokens.filter(t => t.status === 'waiting').length;
      return {
        dept,
        serving,
        waitingCount,
        prefix: dept.charAt(0).toUpperCase(),
      };
    })
    .sort((a, b) => a.dept.localeCompare(b.dept));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Hope Hospital</h1>
            <p className="text-xs text-gray-400 mt-0.5">Live Queue Status</p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshIndicator lastUpdated={lastUpdated} isFetching={isFetching} />
            <ShareButton />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {summaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
            <Clock size={32} className="opacity-40" />
            <p className="text-sm">No active queues today</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-4 uppercase tracking-widest font-medium">
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {summaries.map(({ dept, serving, waitingCount }) => (
                <DeptCard
                  key={dept}
                  dept={dept}
                  serving={serving}
                  waitingCount={waitingCount}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="text-center py-4 text-xs text-gray-300">
        Powered by Adamrit
      </footer>
    </div>
  );
}

// ─── Department Card ──────────────────────────────────────────────────────────

interface DeptCardProps {
  dept: string;
  serving: QueueToken | null;
  waitingCount: number;
}

/** Single department summary card in the overview grid */
function DeptCard({ dept, serving, waitingCount }: DeptCardProps) {
  const isActive = !!serving;

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm transition-all ${
        isActive
          ? 'bg-white border-green-200'
          : 'bg-white border-gray-200'
      }`}
    >
      {/* Dept name */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-bold text-gray-800 uppercase tracking-wide">
          {dept}
        </span>
        {isActive && (
          <span className="relative flex h-2.5 w-2.5 mt-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
        )}
      </div>

      {/* Now serving */}
      <div className="mb-2">
        <p className="text-xs text-gray-400 mb-0.5">Now serving</p>
        <p
          className={`text-3xl font-extrabold tracking-tight ${
            isActive ? 'text-green-600' : 'text-gray-300'
          }`}
        >
          {serving
            ? tokenLabel(serving.department, serving.token_number)
            : '—'}
        </p>
      </div>

      {/* Waiting count */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
        <Clock size={13} className="text-gray-400" />
        <span className="text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{waitingCount}</span>{' '}
          {waitingCount === 1 ? 'patient' : 'patients'} waiting
        </span>
      </div>
    </div>
  );
}

// ─── Page entry point ─────────────────────────────────────────────────────────

/**
 * Public patient-facing page. No auth required.
 * Shows personal queue status if ?dept=Lab&token=24, otherwise shows overview of all departments.
 */
export default function QueueStatus() {
  const [searchParams] = useSearchParams();

  const deptParam = searchParams.get('dept')?.trim() ?? '';
  const tokenParam = searchParams.get('token')?.trim() ?? '';
  const tokenNumber = parseInt(tokenParam, 10);

  const isPersonalView = deptParam.length > 0 && !isNaN(tokenNumber) && tokenNumber > 0;

  if (isPersonalView) {
    return <PersonalView dept={deptParam} tokenNumber={tokenNumber} />;
  }

  return <OverviewView />;
}
