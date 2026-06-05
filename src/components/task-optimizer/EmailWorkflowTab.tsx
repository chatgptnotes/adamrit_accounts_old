import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, Mail, AlertCircle, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

interface EmailItem {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_preview: string | null;
  category: string | null;
  urgency: string | null;
  received_at: string | null;
  check_run: string | null;
  check_date: string | null;
  draft_reply: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
}

const CATEGORY_STYLES: Record<string, string> = {
  billing:     'bg-blue-100 text-blue-700 border-blue-200',
  corporate:   'bg-purple-100 text-purple-700 border-purple-200',
  tpa:         'bg-orange-100 text-orange-700 border-orange-200',
  appointment: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  urgent:      'bg-red-100 text-red-700 border-red-200',
  general:     'bg-slate-100 text-slate-600 border-slate-200',
};

const URGENCY_STYLES: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-green-100 text-green-700',
};

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── Check Run Status Card ─────────────────────────────────────────────────────

function CheckRunCard({ run, emails }: { run: 'morning' | 'evening'; emails: EmailItem[] }) {
  const count = emails.filter(e => e.check_run === run).length;
  const label = run === 'morning' ? '🌅 Morning Check' : '🌆 Evening Check';
  const time  = run === 'morning' ? '9:00 AM' : '5:00 PM';
  const isDone = count > 0;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${isDone ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isDone ? 'bg-green-500' : 'bg-slate-300'}`}>
        {isDone ? <CheckCircle2 className="h-4 w-4 text-white" /> : <Clock className="h-4 w-4 text-white" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{time} IST — {isDone ? `${count} email${count > 1 ? 's' : ''} processed` : 'Pending'}</p>
      </div>
      {isDone && <Badge className="bg-green-100 text-green-700 border-green-200">{count}</Badge>}
    </div>
  );
}

// ── Individual Email Card ─────────────────────────────────────────────────────

function EmailCard({ email, onApprove, onReject }: {
  email: EmailItem;
  onApprove: (id: string, reply: string) => void;
  onReject:  (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState(email.draft_reply ?? '');
  const isUrgent = email.urgency === 'high' || email.category === 'urgent';

  return (
    <div className={`rounded-lg border bg-white transition-all ${isUrgent ? 'border-red-300 shadow-sm' : 'border-slate-200'}`}>
      {/* Email header */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {email.category && (
                <Badge variant="outline" className={`text-xs ${CATEGORY_STYLES[email.category] ?? CATEGORY_STYLES.general}`}>
                  {email.category}
                </Badge>
              )}
              {email.urgency && (
                <Badge className={`text-xs ${URGENCY_STYLES[email.urgency] ?? ''}`}>
                  {email.urgency === 'high' && <AlertCircle className="h-3 w-3 mr-1" />}
                  {email.urgency}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{email.check_run === 'morning' ? '🌅 Morning' : '🌆 Evening'}</span>
            </div>
            <p className="text-sm font-semibold text-slate-800 truncate">{email.subject ?? '(no subject)'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              From: <span className="font-medium">{email.from_name ?? email.from_email}</span>
              {email.from_name && <span className="ml-1 opacity-70">&lt;{email.from_email}&gt;</span>}
            </p>
            {email.body_preview && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{email.body_preview}</p>
            )}
          </div>

          {/* Status or actions */}
          <div className="shrink-0">
            {email.status === 'approved' && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Approved
              </span>
            )}
            {email.status === 'rejected' && (
              <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                <XCircle className="h-3.5 w-3.5" /> Rejected
              </span>
            )}
            {email.status === 'sent' && (
              <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                <Send className="h-3.5 w-3.5" /> Sent
              </span>
            )}
          </div>
        </div>

        {/* Draft reply toggle */}
        {email.draft_reply && (
          <button
            type="button"
            onClick={() => setExpanded(p => !p)}
            className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Hide draft reply' : 'View draft reply'}
          </button>
        )}
      </div>

      {/* Expanded draft reply */}
      {expanded && (
        <div className="px-4 pb-4 border-t bg-slate-50/50 pt-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Draft Reply</p>
          <Textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={5}
            className="text-xs"
            placeholder="No draft reply prepared."
          />
          {email.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-xs h-8"
                onClick={() => onApprove(email.id, reply)}
                disabled={!reply.trim()}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve & Send
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => onReject(email.id)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Pending actions (when not expanded) */}
      {!expanded && email.status === 'pending' && (
        <div className="px-4 pb-3 flex gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-xs h-7"
            onClick={() => { setExpanded(true); }}
          >
            Review & Approve
          </Button>
          <Button
            size="sm" variant="outline"
            className="text-xs h-7 border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => onReject(email.id)}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Tab Component ────────────────────────────────────────────────────────

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';

export default function EmailWorkflowTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('pending');

  const { data: emails = [], isLoading } = useQuery({
    queryKey: ['email-inbox-today'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_inbox')
        .select('*')
        .eq('check_date', todayStr())
        .order('urgency', { ascending: true }) // high first
        .order('received_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailItem[];
    },
    refetchInterval: 60000, // refresh every 60s
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EmailItem> }) => {
      const { error } = await supabase.from('email_inbox').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['email-inbox-today'] }),
  });

  const handleApprove = (id: string, reply: string) => {
    const email = emails.find(e => e.id === id);
    if (!email) return;
    // Open mailto with the reply
    const mailto = `mailto:${email.from_email}?subject=Re: ${encodeURIComponent(email.subject ?? '')}&body=${encodeURIComponent(reply)}`;
    try { window.open(mailto, '_blank'); } catch { window.location.href = mailto; }
    // Mark approved
    updateMutation.mutate({ id, updates: { status: 'approved', approved_at: new Date().toISOString() } });
    toast({ title: 'Approved', description: `Reply opened for ${email.from_name ?? email.from_email}` });
  };

  const handleReject = (id: string) => {
    updateMutation.mutate({ id, updates: { status: 'rejected' } });
    toast({ title: 'Rejected', description: 'Email marked as rejected.' });
  };

  const filtered = emails.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'pending') return e.status === 'pending';
    if (filter === 'approved') return e.status === 'approved' || e.status === 'sent';
    if (filter === 'rejected') return e.status === 'rejected';
    return true;
  });

  const counts = {
    all: emails.length,
    pending: emails.filter(e => e.status === 'pending').length,
    approved: emails.filter(e => e.status === 'approved' || e.status === 'sent').length,
    rejected: emails.filter(e => e.status === 'rejected').length,
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Check run status */}
      <div className="px-4 py-3 bg-white border-b shrink-0">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Today's Email Checks</p>
        <div className="grid grid-cols-2 gap-2">
          <CheckRunCard run="morning" emails={emails} />
          <CheckRunCard run="evening" emails={emails} />
        </div>
        {emails.length === 0 && !isLoading && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 rounded-lg px-3 py-2 border">
            <Mail className="h-3.5 w-3.5" />
            No emails processed yet today. GAS script runs at 9 AM &amp; 5 PM IST.
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 bg-white border-b shrink-0">
        {([
          { id: 'pending',  label: 'Pending Approval' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'all',      label: 'All' },
        ] as { id: FilterTab; label: string }[]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span className={`rounded-full px-1.5 text-xs font-bold ${filter === t.id ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Email list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading emails…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">
              {filter === 'pending' ? 'No emails pending approval' : `No ${filter} emails`}
            </p>
            <p className="text-xs mt-1 opacity-70">
              {emails.length === 0 ? 'GAS runs at 9 AM & 5 PM and writes to this tab automatically.' : 'Switch to "All" to see everything.'}
            </p>
          </div>
        ) : (
          filtered.map(email => (
            <EmailCard
              key={email.id}
              email={email}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </div>
    </div>
  );
}
