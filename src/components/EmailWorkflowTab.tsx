import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Clock, ChevronDown, ChevronUp, Mail, AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmailStatus = 'pending' | 'approved' | 'rejected';
type EmailCategory = 'billing' | 'corporate' | 'tpa' | 'appointment' | 'general' | 'urgent';
type EmailUrgency = 'high' | 'medium' | 'low';

interface EmailInboxRow {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  body_preview: string | null;
  body_full: string | null;
  category: EmailCategory | null;
  urgency: EmailUrgency | null;
  draft_reply: string | null;
  status: EmailStatus;
  check_date: string;
  check_run: 'morning' | 'evening' | null;
  approved_at: string | null;
  created_at: string;
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function categoryBadgeClass(cat: EmailCategory | null): string {
  switch (cat) {
    case 'billing':     return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'corporate':   return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'tpa':         return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'urgent':      return 'bg-red-100 text-red-800 border-red-200';
    case 'appointment': return 'bg-teal-100 text-teal-800 border-teal-200';
    default:            return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function urgencyBadgeClass(u: EmailUrgency | null): string {
  switch (u) {
    case 'high':   return 'bg-red-100 text-red-800 border-red-200';
    case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low':    return 'bg-green-100 text-green-800 border-green-200';
    default:       return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Check-run status card
// ---------------------------------------------------------------------------

interface CheckRunCardProps {
  label: string;
  icon: string;
  emails: EmailInboxRow[];
  run: 'morning' | 'evening';
}

function CheckRunCard({ label, icon, emails, run }: CheckRunCardProps) {
  const count = emails.filter((e) => e.check_run === run).length;
  const done = count > 0;

  return (
    <Card
      className={`flex-1 border ${
        done ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 leading-tight">{label}</p>
          {done ? (
            <p className="text-xs text-green-700 mt-0.5 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Completed
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Pending
            </p>
          )}
        </div>
        {done && (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-600 text-white text-sm font-bold shrink-0">
            {count}
          </span>
        )}
        {!done && (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-300 text-gray-500 text-sm font-bold shrink-0">
            0
          </span>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single email card
// ---------------------------------------------------------------------------

interface EmailCardProps {
  email: EmailInboxRow;
  onApprove: (id: string, draftReply: string) => void;
  onReject: (id: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}

function EmailCard({ email, onApprove, onReject, isApproving, isRejecting }: EmailCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftText, setDraftText] = useState(email.draft_reply ?? '');
  const isUrgent = email.urgency === 'high' || email.category === 'urgent';
  const isPending = email.status === 'pending';

  return (
    <Card
      className={`border transition-shadow hover:shadow-md ${
        isUrgent ? 'border-red-400' : 'border-gray-200'
      }`}
    >
      <CardContent className="py-3 px-4 space-y-2">
        {/* Top row: from + badges */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {email.from_name ?? email.from_email}
            </p>
            <p className="text-xs text-gray-500 truncate">{email.from_email}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {email.category && (
              <Badge
                variant="outline"
                className={`text-xs px-1.5 py-0 ${categoryBadgeClass(email.category)}`}
              >
                {capitalize(email.category)}
              </Badge>
            )}
            {email.urgency && (
              <Badge
                variant="outline"
                className={`text-xs px-1.5 py-0 ${urgencyBadgeClass(email.urgency)}`}
              >
                {capitalize(email.urgency)}
              </Badge>
            )}
            {email.status === 'approved' && (
              <Badge className="text-xs px-1.5 py-0 bg-green-600 text-white">
                Approved {email.approved_at ? `· ${formatTime(email.approved_at)}` : ''}
              </Badge>
            )}
            {email.status === 'rejected' && (
              <Badge className="text-xs px-1.5 py-0 bg-red-600 text-white">Rejected</Badge>
            )}
          </div>
        </div>

        {/* Subject */}
        <p className="text-sm font-bold text-gray-800 leading-snug">{email.subject}</p>

        {/* Body preview */}
        {email.body_preview && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
            {email.body_preview}
          </p>
        )}

        {/* Draft reply toggle */}
        {(email.draft_reply || isPending) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium mt-1"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide draft reply' : 'View draft reply'}
          </button>
        )}

        {expanded && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Draft Reply
            </p>
            {isPending ? (
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={5}
                className="text-xs resize-none"
                placeholder="Draft reply will appear here..."
              />
            ) : (
              <div className="rounded-md bg-gray-50 border border-gray-200 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                {email.draft_reply ?? '—'}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {isPending && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="default"
              className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-3"
              disabled={isApproving || isRejecting}
              onClick={() => onApprove(email.id, draftText)}
            >
              {isApproving ? '...' : '✅ Approve & Send'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 text-xs h-7 px-3"
              disabled={isApproving || isRejecting}
              onClick={() => onReject(email.id)}
            >
              {isRejecting ? '...' : '❌ Reject'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EmailWorkflowTab() {
  const [filterTab, setFilterTab] = useState<FilterTab>('pending');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = todayISO();

  // ------ Query ------
  const { data: emails = [], isLoading, isError } = useQuery<EmailInboxRow[]>({
    queryKey: ['email_inbox', today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('email_inbox')
        .select('*')
        .eq('check_date', today)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailInboxRow[];
    },
    refetchInterval: 60_000,
  });

  // ------ Approve mutation ------
  const approveMutation = useMutation({
    mutationFn: async ({ id, draftReply }: { id: string; draftReply: string }) => {
      const { error } = await (supabase as any)
        .from('email_inbox')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      return { id, draftReply };
    },
    onSuccess: ({ id, draftReply }) => {
      queryClient.invalidateQueries({ queryKey: ['email_inbox', today] });
      const email = emails.find((e) => e.id === id);
      if (email) {
        const mailto =
          `mailto:${encodeURIComponent(email.from_email)}` +
          `?subject=${encodeURIComponent(`Re: ${email.subject}`)}` +
          `&body=${encodeURIComponent(draftReply)}`;
        window.open(mailto, '_blank');
      }
      toast({ title: 'Email approved', description: 'Draft reply opened in your mail client.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to approve email.', variant: 'destructive' });
    },
  });

  // ------ Reject mutation ------
  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('email_inbox')
        .update({ status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email_inbox', today] });
      toast({ title: 'Email rejected', description: 'The email has been marked as rejected.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to reject email.', variant: 'destructive' });
    },
  });

  // ------ Filtering ------
  const filtered = emails.filter((e) => {
    if (filterTab === 'all') return true;
    if (filterTab === 'pending') return e.status === 'pending';
    if (filterTab === 'approved') return e.status === 'approved';
    if (filterTab === 'rejected') return e.status === 'rejected';
    return true;
  });

  const tabDefs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending Approval' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  const countFor = (tab: FilterTab) => {
    if (tab === 'all') return emails.length;
    return emails.filter((e) => e.status === tab).length;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ---- Header: Check-run status cards ---- */}
      <div className="flex gap-3 px-4 pt-4 pb-2 shrink-0">
        <CheckRunCard
          label="Morning Check (9 AM)"
          icon="🌅"
          emails={emails}
          run="morning"
        />
        <CheckRunCard
          label="Evening Check (5 PM)"
          icon="🌆"
          emails={emails}
          run="evening"
        />
      </div>

      {/* ---- Filter tabs ---- */}
      <div className="flex gap-1 px-4 pb-2 shrink-0 border-b border-gray-100">
        {tabDefs.map((t) => {
          const active = filterTab === t.key;
          const cnt = countFor(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilterTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t.label}
              {cnt > 0 && (
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-bold ${
                    active ? 'bg-blue-400 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Email list ---- */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <Clock className="w-4 h-4 animate-spin" />
            Loading emails...
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center h-32 text-red-500 text-sm gap-2">
            <AlertCircle className="w-4 h-4" />
            Failed to load emails. Please refresh.
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <Mail className="w-10 h-10 text-gray-300" />
            {emails.length === 0 ? (
              <>
                <p className="text-gray-500 font-medium text-sm">No emails processed yet.</p>
                <p className="text-gray-400 text-xs">GAS runs at 9 AM &amp; 5 PM.</p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">No emails in this category.</p>
            )}
          </div>
        )}

        {!isLoading &&
          !isError &&
          filtered.map((email) => (
            <EmailCard
              key={email.id}
              email={email}
              onApprove={(id, draft) => approveMutation.mutate({ id, draftReply: draft })}
              onReject={(id) => rejectMutation.mutate(id)}
              isApproving={
                approveMutation.isPending &&
                (approveMutation.variables as { id: string })?.id === email.id
              }
              isRejecting={
                rejectMutation.isPending &&
                (rejectMutation.variables as string) === email.id
              }
            />
          ))}
      </div>
    </div>
  );
}

export default EmailWorkflowTab;
