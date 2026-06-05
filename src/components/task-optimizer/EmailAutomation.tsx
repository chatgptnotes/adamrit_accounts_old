import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Send, History, CheckCircle2, Clock,
  Building2, Search, Copy, ChevronRight, Mail, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Corporate {
  id: string;
  name: string;
  email: string | null;
  contact_person: string | null;
  phone: string | null;
}

interface EmailLog {
  id: string;
  recipient: string;
  corporate_name: string | null;
  subject: string;
  template_type: string | null;
  status: string;
  sent_at: string;
}

// ── Schedule definitions ──────────────────────────────────────────────────────

interface Schedule {
  id: string;
  label: string;
  description: string;
  templateId: string;
  icon: string;
  isDue: (d: Date) => boolean;
  nextDue: (from: Date) => Date;
}

const SCHEDULES: Schedule[] = [
  {
    id: 'monthly_billing',
    label: 'Monthly Billing Summary',
    description: 'Sent on the 1st of every month to all empanelled corporates',
    templateId: 'billing_summary',
    icon: '📋',
    isDue: (d) => d.getDate() === 1,
    nextDue: (from) => {
      const d = new Date(from);
      d.setDate(1);
      if (from.getDate() > 1) d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
  {
    id: 'weekly_reminder',
    label: 'Weekly Payment Reminder',
    description: 'Sent every Friday to corporates with outstanding dues',
    templateId: 'payment_reminder',
    icon: '⏳',
    isDue: (d) => d.getDay() === 5,
    nextDue: (from) => {
      const d = new Date(from);
      const daysUntilFriday = (5 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntilFriday);
      return d;
    },
  },
  {
    id: 'monthly_intimation',
    label: 'Monthly Claim Intimation',
    description: 'Sent on the 5th of every month for claim processing',
    templateId: 'claim_intimation',
    icon: '📨',
    isDue: (d) => d.getDate() === 5,
    nextDue: (from) => {
      const d = new Date(from);
      d.setDate(5);
      if (from.getDate() > 5) d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
];

// ── Templates ─────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  label: string;
  subject: string;
  body: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'billing_summary',
    label: 'Monthly Billing Summary',
    subject: 'Monthly Billing Summary – {month} | Hope Hospital',
    body: `Dear {contact_person},

Please find attached the billing summary for {corporate_name} for the month of {month}.

Kindly review and share with your HR / Accounts team. For any queries, contact our billing desk.

Warm regards,
Hope Hospital – Corporate Billing Team
billing@hopehospital.com`,
  },
  {
    id: 'payment_reminder',
    label: 'Payment Reminder',
    subject: 'Payment Reminder – Outstanding Dues | {corporate_name}',
    body: `Dear {contact_person},

This is a gentle reminder regarding outstanding dues for {corporate_name} with Hope Hospital.

Kindly arrange payment at the earliest to avoid any disruption in empanelled services.

Regards,
Hope Hospital – Accounts Team`,
  },
  {
    id: 'claim_intimation',
    label: 'Claim Intimation',
    subject: 'Claim Intimation – {month} | {corporate_name}',
    body: `Dear {contact_person},

This is to intimate you that claims have been submitted on behalf of {corporate_name} for {month}.

Kindly acknowledge receipt and process at the earliest.

Regards,
Hope Hospital – TPA & Corporate Desk`,
  },
  {
    id: 'monthly_report',
    label: 'Monthly Utilisation Report',
    subject: 'Monthly Utilisation Report – {month} | {corporate_name}',
    body: `Dear {contact_person},

Please find the monthly utilisation report for {corporate_name} for {month}.

We remain committed to providing the best healthcare services to your employees.

Regards,
Hope Hospital`,
  },
  {
    id: 'custom',
    label: 'Custom Message',
    subject: '',
    body: '',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyVars(str: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
    str,
  );
}

function buildMailto(emails: string[], subject: string, body: string): string {
  const p = new URLSearchParams();
  if (emails.length) p.set('bcc', emails.join(','));
  p.set('subject', subject);
  p.set('body', body);
  return `mailto:?${p.toString().replace(/\+/g, '%20')}`;
}

function openMailto(link: string) {
  try { window.open(link, '_blank'); } catch { window.location.href = link; }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function currentMonth(): string {
  return new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = 'schedule' | 'compose' | 'history';

export default function EmailAutomation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('schedule');

  // Compose state
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('billing_summary');
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [month, setMonth] = useState(currentMonth);

  // ── Data ──
  const { data: corporates = [], isLoading } = useQuery({
    queryKey: ['corporates-email'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corporate')
        .select('id, name, email, contact_person, phone')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Corporate[];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ['email-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EmailLog[];
    },
  });

  const withEmail = corporates.filter(c => c.email);
  const today = new Date();
  const dueToday = SCHEDULES.filter(s => s.isDue(today));

  // ── Log helper ──
  const logSend = async (emails: string[], subject: string, templateType: string, corps: Corporate[]) => {
    const rows = corps
      .filter(c => c.email)
      .map(c => ({
        recipient: c.email!,
        corporate_name: c.name,
        subject,
        template_type: templateType,
        status: 'queued',
      }));
    if (rows.length) {
      await supabase.from('email_logs').insert(rows);
      queryClient.invalidateQueries({ queryKey: ['email-logs'] });
    }
  };

  // ── Schedule send ──
  const handleScheduleSend = async (schedule: Schedule) => {
    if (!withEmail.length) {
      toast({ title: 'No emails on file', variant: 'destructive' }); return;
    }
    const tpl = TEMPLATES.find(t => t.id === schedule.templateId)!;
    const subject = applyVars(tpl.subject, { month, corporate_name: 'All Corporates', contact_person: 'Team' });
    const body    = applyVars(tpl.body,    { month, corporate_name: '{corporate_name}', contact_person: '{contact_person}' });
    openMailto(withEmail.map(c => c.email!), subject, body);
    await logSend(withEmail.map(c => c.email!), subject, schedule.templateId, withEmail);
    toast({ title: `Email opened for ${withEmail.length} companies`, description: 'Click Send in your email client to complete.' });
    setTab('history');
  };

  // ── Compose send ──
  const filtered = useMemo(() =>
    corporates.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.contact_person ?? '').toLowerCase().includes(search.toLowerCase())
    ), [corporates, search]);

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggleOne = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelected(prev => {
      const n = new Set(prev);
      allSelected ? filtered.forEach(c => n.delete(c.id)) : filtered.forEach(c => n.add(c.id));
      return n;
    });

  const activeTpl = TEMPLATES.find(t => t.id === templateId)!;
  const selectedCorps = corporates.filter(c => selected.has(c.id));
  const selectedWithEmail = selectedCorps.filter(c => c.email);

  const resolvedContent = useMemo(() => {
    if (templateId === 'custom') return { subject: customSubject, body: customBody };
    return {
      subject: applyVars(activeTpl.subject, { month, corporate_name: '[Corporate Name]', contact_person: '[Contact]' }),
      body:    applyVars(activeTpl.body,    { month, corporate_name: '[Corporate Name]', contact_person: '[Contact]' }),
    };
  }, [templateId, activeTpl, customSubject, customBody, month]);

  const handleComposeSend = async () => {
    if (!selectedWithEmail.length) {
      toast({ title: 'No emails selected', variant: 'destructive' }); return;
    }
    const emails = selectedWithEmail.map(c => c.email!);
    openMailto(emails, resolvedContent.subject, resolvedContent.body);
    await logSend(emails, resolvedContent.subject, templateId, selectedWithEmail);
    toast({ title: `Opened for ${emails.length} companies`, description: 'Click Send in your email client.' });
    setTab('history');
  };

  const handleSendOne = async (corp: Corporate) => {
    if (!corp.email) { toast({ title: `${corp.name} has no email`, variant: 'destructive' }); return; }
    const { subject, body } = templateId === 'custom'
      ? { subject: customSubject, body: customBody }
      : {
          subject: applyVars(activeTpl.subject, { month, corporate_name: corp.name, contact_person: corp.contact_person ?? corp.name }),
          body:    applyVars(activeTpl.body,    { month, corporate_name: corp.name, contact_person: corp.contact_person ?? corp.name }),
        };
    openMailto([corp.email], subject, body);
    await logSend([corp.email], subject, templateId, [corp]);
  };

  const handleCopyAll = async () => {
    const src = selected.size > 0 ? selectedWithEmail : withEmail;
    await navigator.clipboard.writeText(src.map(c => c.email!).join(', '));
    toast({ title: `Copied ${src.length} emails` });
  };

  const isCustomValid = templateId !== 'custom' || (customSubject.trim() && customBody.trim());

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5 text-primary" /> Email Automation
          </h2>
          <p className="text-sm text-muted-foreground">
            Scheduled corporate emails — opens Gmail/Outlook with all addresses pre-filled.
          </p>
        </div>
        {/* Due today badge */}
        {dueToday.length > 0 && (
          <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-sm px-3 py-1 animate-pulse">
            <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
            {dueToday.length} email{dueToday.length > 1 ? 's' : ''} due today
          </Badge>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: 'schedule', icon: <CalendarClock className="h-3.5 w-3.5" />, label: 'Schedule' },
          { id: 'compose',  icon: <Send className="h-3.5 w-3.5" />,         label: 'Compose' },
          { id: 'history',  icon: <History className="h-3.5 w-3.5" />,      label: `History ${logs.length ? `(${logs.length})` : ''}` },
        ] as const).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${
              tab === t.id ? 'bg-white border border-b-white text-blue-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── SCHEDULE TAB ── */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          {/* Due today alert */}
          {dueToday.length > 0 && (
            <Card className="border-orange-300 bg-orange-50">
              <CardContent className="py-4 px-5">
                <p className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Due Today — {fmtDate(today)}
                </p>
                <div className="space-y-2">
                  {dueToday.map(s => (
                    <div key={s.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-orange-200">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{s.icon}</span>
                        <div>
                          <p className="text-sm font-semibold">{s.label}</p>
                          <p className="text-xs text-muted-foreground">{withEmail.length} companies with email on file</p>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => handleScheduleSend(s)} className="bg-orange-600 hover:bg-orange-700">
                        <Send className="h-3.5 w-3.5 mr-1.5" /> Send Now
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* All schedules */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                All Scheduled Emails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {SCHEDULES.map(s => {
                const next = s.nextDue(today);
                const isToday = s.isDue(today);
                const lastSent = logs.find(l => l.template_type === s.templateId);
                return (
                  <div key={s.id} className={`flex items-center justify-between rounded-lg border p-4 ${isToday ? 'border-orange-300 bg-orange-50' : 'bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{s.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{s.label}</p>
                          {isToday && <Badge className="bg-orange-100 text-orange-700 text-xs">Due Today</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Next: {fmtDate(isToday ? today : next)}
                          </span>
                          {lastSent && (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Last: {new Date(lastSent.sent_at).toLocaleDateString('en-IN')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{withEmail.length} companies</span>
                      <Button
                        size="sm" variant={isToday ? 'default' : 'outline'}
                        onClick={() => handleScheduleSend(s)}
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" /> Send
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Companies with email', value: withEmail.length, icon: '🏢' },
              { label: 'Total emails sent', value: logs.length, icon: '📧' },
              { label: 'Schedules active', value: SCHEDULES.length, icon: '📅' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl mb-1">{s.icon}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── COMPOSE TAB ── */}
      {tab === 'compose' && (
        <div className="space-y-4">
          {/* Controls row */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search companies…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Month:</span>
              <Input value={month} onChange={e => setMonth(e.target.value)} className="w-36" />
            </div>
          </div>

          {/* Custom template fields */}
          {templateId === 'custom' && (
            <div className="space-y-2">
              <Input placeholder="Email subject…" value={customSubject} onChange={e => setCustomSubject(e.target.value)} />
              <Textarea placeholder="Email body…" rows={5} value={customBody} onChange={e => setCustomBody(e.target.value)} />
            </div>
          )}

          {/* Preview */}
          {templateId !== 'custom' && (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="py-3 px-4 space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Preview</p>
                <p className="text-sm font-medium">{resolvedContent.subject || '(no subject)'}</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-3">{resolvedContent.body}</p>
              </CardContent>
            </Card>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={handleComposeSend} disabled={selected.size === 0 || !isCustomValid} size="sm">
              <Send className="h-4 w-4 mr-1.5" />
              Send to Selected
              {selected.size > 0 && <Badge className="ml-1.5 bg-white/20 text-white text-xs px-1.5 py-0">{selected.size}</Badge>}
            </Button>
            <Button onClick={() => {
              openMailto(withEmail.map(c => c.email!), resolvedContent.subject, resolvedContent.body);
              logSend(withEmail.map(c => c.email!), resolvedContent.subject, templateId, withEmail);
            }} disabled={!isCustomValid} size="sm" variant="outline">
              <Send className="h-4 w-4 mr-1.5" /> BCC All ({withEmail.length})
            </Button>
            <Button onClick={handleCopyAll} size="sm" variant="outline">
              <Copy className="h-4 w-4 mr-1.5" /> Copy{selected.size > 0 ? ' Selected' : ' All'} Emails
            </Button>
          </div>

          {/* Company table */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading companies…</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-16 text-right">Send</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No companies found.</TableCell>
                    </TableRow>
                  ) : filtered.map(corp => (
                    <TableRow key={corp.id} className={selected.has(corp.id) ? 'bg-blue-50/40' : ''}>
                      <TableCell>
                        <Checkbox checked={selected.has(corp.id)} onCheckedChange={() => toggleOne(corp.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{corp.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{corp.contact_person ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {corp.email
                          ? <span className="text-blue-600">{corp.email}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          disabled={!corp.email || !isCustomValid}
                          onClick={() => handleSendOne(corp)}
                          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
                          title={corp.email ? `Send to ${corp.email}` : 'No email'}
                        >
                          <ChevronRight className="h-4 w-4 text-blue-600" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{logs.length} emails logged</p>
            <Badge variant="outline" className="text-xs">
              Status "queued" = opened in email client
            </Badge>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No emails sent yet. Use Schedule or Compose tab to send.
                    </TableCell>
                  </TableRow>
                ) : logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{log.corporate_name ?? log.recipient}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{log.subject}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{log.template_type ?? 'custom'}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`flex items-center gap-1 text-xs ${
                        log.status === 'sent' ? 'text-green-600' : log.status === 'failed' ? 'text-destructive' : 'text-amber-600'
                      }`}>
                        {log.status === 'sent'
                          ? <CheckCircle2 className="h-3.5 w-3.5" />
                          : <Clock className="h-3.5 w-3.5" />}
                        {log.status === 'queued' ? 'Opened in client' : log.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
