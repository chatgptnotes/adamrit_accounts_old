import { Receipt, Mail, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, GitBranch, LayoutDashboard, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { supabaseAdmin } from '@/integrations/supabase/adminClient';
import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import BillingWorkflowDiagram from './BillingWorkflowDiagram';
import DailyBillingWorkflow from './DailyBillingWorkflow';
import BillingDashboardModal from './BillingDashboardModal';
import { useGmailChecker, REPLY_STYLES, STYLE_LABELS, type ReplyStyle } from './useGmailChecker';

type EmailStatus = 'pending' | 'approved' | 'rejected';

interface EmailRow {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  body_preview: string | null;
  body_full: string | null;
  category: string | null;
  urgency: string | null;
  draft_reply: string | null;
  status: EmailStatus;
  check_date: string;
  approved_at: string | null;
  created_at: string;
}

const urgencyColor: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

const categoryColor: Record<string, string> = {
  'corporate-query': 'bg-purple-100 text-purple-700',
  'corporate': 'bg-purple-100 text-purple-700',
  'tpa': 'bg-orange-100 text-orange-700',
  'approval-needed': 'bg-red-100 text-red-700',
  'document-request': 'bg-blue-100 text-blue-700',
  'general': 'bg-gray-100 text-gray-700',
};

function EmailCard({ email, onApprove, onReject, onRegenerate, onRephrase }: {
  email: EmailRow;
  onApprove: (id: string, reply: string) => void;
  onReject: (id: string) => void;
  onRegenerate: (id: string, feedback: string) => Promise<string>;
  onRephrase: (id: string, style: ReplyStyle) => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activePane, setActivePane] = useState<'email' | 'reply'>('email');
  const [draftText, setDraftText] = useState(email.draft_reply ?? '');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [rephrasing, setRephrasing] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);

  const isPending = email.status === 'pending';
  const borderColor = isPending ? 'border-l-yellow-400' : email.status === 'approved' ? 'border-l-green-500' : 'border-l-red-400';

  return (
    <Card className={`border-l-4 ${borderColor} cursor-pointer hover:shadow-md transition-shadow`}>
      <CardContent className="p-0">
        {/* Clickable header — click anywhere to open */}
        <div className="p-4 space-y-1" onClick={() => setExpanded(v => !v)}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <span className="font-semibold text-sm">{email.from_name || email.from_email}</span>
              <span className="text-xs text-gray-400">&lt;{email.from_email}&gt;</span>
              {email.category && (
                <Badge className={`text-xs ${categoryColor[email.category] ?? 'bg-gray-100 text-gray-700'}`}>
                  {email.category}
                </Badge>
              )}
              {email.urgency && (
                <Badge variant="outline" className={`text-xs ${urgencyColor[email.urgency] ?? ''}`}>
                  {email.urgency}
                </Badge>
              )}
              {email.status === 'approved' && <Badge className="text-xs bg-green-100 text-green-700">✓ Sent</Badge>}
              {email.status === 'rejected' && <Badge className="text-xs bg-red-100 text-red-700">✗ Rejected</Badge>}
            </div>
            <span className="text-xs text-gray-400 shrink-0">{expanded ? '▲' : '▼'}</span>
          </div>
          <p className="text-sm font-medium text-gray-800">{email.subject}</p>
          {!expanded && <p className="text-xs text-gray-500 line-clamp-2">{email.body_preview}</p>}
        </div>

        {/* Expanded: tabbed view */}
        {expanded && (
          <div className="border-t">
            {/* Tab switcher */}
            <div className="flex border-b bg-gray-50">
              <button
                onClick={() => setActivePane('email')}
                className={`px-4 py-2 text-xs font-medium ${activePane === 'email' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
              >
                📧 Full Email
              </button>
              <button
                onClick={() => setActivePane('reply')}
                className={`px-4 py-2 text-xs font-medium ${activePane === 'reply' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
              >
                ✏️ Draft Reply {isPending && <span className="ml-1 text-yellow-600">●</span>}
              </button>
            </div>

            {/* Email body pane */}
            {activePane === 'email' && (
              <div className="p-4">
                <div className="text-xs text-gray-400 mb-2">From: {email.from_name} &lt;{email.from_email}&gt;</div>
                <div className="text-xs text-gray-400 mb-3">Subject: {email.subject}</div>
                <pre className="text-sm whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-3 border max-h-[500px] overflow-y-auto">
                  {email.body_preview || 'No content available'}
                </pre>
                {isPending && (
                  <button
                    onClick={() => setActivePane('reply')}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    → Go to Draft Reply
                  </button>
                )}
              </div>
            )}

            {/* Reply pane */}
            {activePane === 'reply' && (
              <div className="p-4 space-y-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {isPending ? 'Edit draft reply before sending' : 'Sent reply'}
                </p>
                {isPending ? (
                  <Textarea
                    value={draftText}
                    onChange={e => setDraftText(e.target.value)}
                    rows={8}
                    className="text-sm font-mono"
                    placeholder="Type your reply here..."
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <pre className="text-sm whitespace-pre-wrap bg-gray-50 rounded p-3 border text-gray-700 max-h-48 overflow-y-auto">
                    {email.draft_reply || '—'}
                  </pre>
                )}

                {isPending && (
                  <>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Optional: make it shorter / more formal / add specific details..."
                        className="flex-1 text-xs border rounded px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={regenerating}
                        onClick={async e => {
                          e.stopPropagation();
                          setRegenerating(true);
                          const nd = await onRegenerate(email.id, feedback);
                          if (nd) setDraftText(nd);
                          setRegenerating(false);
                        }}
                      >
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                        {regenerating ? 'Generating…' : 'Regenerate'}
                      </Button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        disabled={loading || !draftText.trim()}
                        onClick={async e => { e.stopPropagation(); setLoading(true); await onApprove(email.id, draftText); setLoading(false); }}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        {loading ? 'Sending…' : 'Approve & Send'}
                      </Button>

                      {/* Re-phrase button with style picker */}
                      <div className="relative">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-purple-300 text-purple-700 hover:bg-purple-50"
                          disabled={rephrasing}
                          onClick={e => { e.stopPropagation(); setShowStylePicker(v => !v); }}
                        >
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${rephrasing ? 'animate-spin' : ''}`} />
                          {rephrasing ? 'Re-phrasing…' : 'Re-phrase ▾'}
                        </Button>
                        {showStylePicker && (
                          <div className="absolute bottom-full mb-1 left-0 bg-white border rounded-lg shadow-lg z-10 min-w-[140px]">
                            {REPLY_STYLES.map(style => (
                              <button
                                key={style}
                                onClick={async e => {
                                  e.stopPropagation();
                                  setShowStylePicker(false);
                                  setRephrasing(true);
                                  const nd = await onRephrase(email.id, style);
                                  if (nd) setDraftText(nd);
                                  setRephrasing(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-purple-50 hover:text-purple-700 first:rounded-t-lg last:rounded-b-lg"
                              >
                                {style === 'standard' && '📝 '}
                                {style === 'formal'   && '🎩 '}
                                {style === 'brief'    && '⚡ '}
                                {style === 'friendly' && '😊 '}
                                {STYLE_LABELS[style]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        disabled={loading}
                        onClick={async e => { e.stopPropagation(); setLoading(true); await onReject(email.id); setLoading(false); }}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type BillingTab = 'emails' | 'flowchart' | 'daily';

export default function BillingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<BillingTab>('emails');
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isChecking, setIsChecking] = useState(false);
  const { checkMail, regenerateDraft, rephraseDraft } = useGmailChecker();

  // Try account index 1 (chatgptnotes is 0, info@hopehospital.com is likely 1)
  // If wrong, change the number in the URL below to 2 or 3
  const HOSPITAL_GMAIL = 'https://mail.google.com/mail/u/1/#inbox';

  const billingTabs: { key: BillingTab; label: string; icon: React.ReactNode }[] = [
    { key: 'emails', label: 'Corporate Emails', icon: <Mail className="h-4 w-4" /> },
    { key: 'flowchart', label: 'Workflow Diagram', icon: <GitBranch className="h-4 w-4" /> },
    { key: 'daily', label: 'Daily Tasks', icon: <CalendarDays className="h-4 w-4" /> },
  ];

  const { data: emails = [], isLoading } = useQuery({
    queryKey: ['billing-email-inbox', filter, categoryFilter],
    queryFn: async () => {
      let q = supabaseAdmin
        .from('email_inbox')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (filter !== 'all') q = q.eq('status', filter);
      if (categoryFilter !== 'all') q = q.eq('category', categoryFilter);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmailRow[];
    },
    refetchInterval: 60_000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, reply }: { id: string; reply: string }) => {
      const { error } = await supabaseAdmin
        .from('email_inbox')
        .update({ status: 'approved', draft_reply: reply, approved_at: new Date().toISOString(), approved_by: 'staff' })
        .eq('id', id);
      if (error) throw error;
      return { id, reply };
    },
    onSuccess: ({ id, reply }) => {
      const email = emails.find(e => e.id === id);
      if (email) {
        const mailto =
          `mailto:${encodeURIComponent(email.from_email)}` +
          `?subject=${encodeURIComponent(`Re: ${email.subject}`)}` +
          `&body=${encodeURIComponent(reply)}`;
        window.open(mailto, '_blank');
      }
      toast({ title: 'Approved ✓', description: 'Reply opened in Gmail — click Send to deliver.' });
      queryClient.invalidateQueries({ queryKey: ['billing-email-inbox'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabaseAdmin
        .from('email_inbox')
        .update({ status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rejected', description: 'Email marked as rejected.' });
      queryClient.invalidateQueries({ queryKey: ['billing-email-inbox'] });
    },
  });

  const handleCheckMail = async () => {
    setIsChecking(true);
    try {
      const { saved } = await checkMail();
      toast({
        title: saved > 0 ? `Found ${saved} new email${saved !== 1 ? 's' : ''}` : 'No new emails',
        description: saved > 0 ? `${saved} draft replies created in Gmail Drafts.` : 'All emails are already up to date.',
      });
      queryClient.invalidateQueries({ queryKey: ['billing-email-inbox'] });
    } catch (err) {
      toast({
        title: 'Mail check failed',
        description: err instanceof Error ? err.message : 'Could not connect to mail.',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleRephrase = async (emailId: string, style: ReplyStyle): Promise<string> => {
    try {
      const newDraft = await rephraseDraft(emailId, style);
      toast({ title: `Re-phrased as ${STYLE_LABELS[style]}`, description: 'Draft updated — review and approve.' });
      return newDraft;
    } catch (err) {
      toast({ title: 'Re-phrase failed', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
      return '';
    }
  };

  const handleRegenerate = async (emailId: string, feedback: string): Promise<string> => {
    try {
      const newDraft = await regenerateDraft(emailId, feedback || undefined);
      toast({ title: 'Draft refreshed', description: 'New AI reply ready for review.' });
      return newDraft;
    } catch (err) {
      toast({
        title: 'Regenerate failed',
        description: err instanceof Error ? err.message : 'Could not generate new draft.',
        variant: 'destructive',
      });
      return '';
    }
  };

  const pending = emails.filter(e => e.status === 'pending').length;
  const tabs = [
    { key: 'pending', label: 'Pending', count: pending },
    { key: 'approved', label: 'Approved', count: null },
    { key: 'rejected', label: 'Rejected', count: null },
    { key: 'all', label: 'All', count: null },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Receipt className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Billing Automation</h2>
        <a
          href={HOSPITAL_GMAIL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-blue-500 hover:underline flex items-center gap-1"
        >
          <Mail className="h-3 w-3" />
          info@hopehospital.com
        </a>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b">
        {billingTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.key === 'emails' && pending > 0 && (
              <span className="ml-1 rounded-full bg-yellow-100 text-yellow-700 text-xs px-1.5 py-0.5">
                {pending}
              </span>
            )}
          </button>
        ))}

        {/* Billing Dashboard — opens modal directly on click */}
        <button
          onClick={() => setDashboardOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
        >
          <LayoutDashboard className="h-4 w-4" />
          Billing Dashboard
        </button>
      </div>

      {/* Modal — controlled from tab click */}
      <BillingDashboardModal open={dashboardOpen} onOpenChange={setDashboardOpen} />

      {/* Tab content */}
      {activeTab === 'flowchart' && <BillingWorkflowDiagram />}
      {activeTab === 'daily' && <DailyBillingWorkflow />}

      {activeTab === 'emails' && (
        <>
          {/* Manual check + schedule info */}
          <div className="flex items-center justify-between gap-3">
            <Button
              onClick={handleCheckMail}
              disabled={isChecking}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Mail className={`mr-2 h-4 w-4 ${isChecking ? 'animate-pulse' : ''}`} />
              {isChecking ? 'Checking mail…' : 'Start Checking Mail'}
            </Button>
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border flex-1">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Auto-checks at <strong>8:00 AM</strong>, <strong>12:00 PM</strong>, <strong>5:00 PM</strong> daily
              · info@hopehospital.com · Corporate / TPA emails only
            </div>
          </div>

          <div className="flex items-center justify-between">
            {pending > 0 && (
              <Badge className="bg-yellow-100 text-yellow-700 border border-yellow-200">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {pending} pending approval
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['billing-email-inbox'] })}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {/* Category filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {['all', 'tpa', 'corporate', 'billing', 'urgent', 'general'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  categoryFilter === cat
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'
                }`}
              >
                {cat === 'all' ? 'All Categories' : cat.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-1 border-b">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  filter === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className="ml-1.5 rounded-full bg-yellow-100 text-yellow-700 text-xs px-1.5 py-0.5">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Email list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Mail className="mr-2 h-5 w-5 animate-pulse" />
              Loading emails...
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <CheckCircle2 className="h-10 w-10 text-green-300" />
              <p className="text-sm">
                {filter === 'pending' ? 'No emails pending approval.' : 'No emails found.'}
              </p>
              <p className="text-xs">Next auto-check runs at the scheduled time.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {emails.map(email => (
                <EmailCard
                  key={email.id}
                  email={email}
                  onApprove={(id, reply) => approveMutation.mutateAsync({ id, reply })}
                  onReject={id => rejectMutation.mutateAsync(id)}
                  onRegenerate={handleRegenerate}
                  onRephrase={handleRephrase}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
