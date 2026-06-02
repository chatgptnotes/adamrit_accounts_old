import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Copy, Building2, Search, Zap, History, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Corporate {
  id: string;
  name: string;
  email?: string | null;
  contact_person?: string | null;
  phone?: string | null;
}

interface EmailTemplate {
  id: string;
  label: string;
  subject: string;
  body: string;
}

const TEMPLATES: EmailTemplate[] = [
  {
    id: 'billing_summary',
    label: 'Billing Summary',
    subject: 'Monthly Billing Summary – {month} | Hope Hospital',
    body: `Dear {contact_person},\n\nPlease find attached the billing summary for {month} for {corporate_name}.\n\nFor any queries, please contact our corporate billing desk at billing@hopehospital.com or call us.\n\nWarm regards,\nHope Hospital – Corporate Billing Team`,
  },
  {
    id: 'claim_intimation',
    label: 'Claim Intimation',
    subject: 'Claim Intimation – {month} | {corporate_name}',
    body: `Dear {contact_person},\n\nThis is to intimate you that claims have been submitted on behalf of {corporate_name} for the month of {month}.\n\nKindly acknowledge receipt and process at the earliest.\n\nRegards,\nHope Hospital – TPA & Corporate Desk`,
  },
  {
    id: 'monthly_report',
    label: 'Monthly Utilisation Report',
    subject: 'Monthly Utilisation Report – {month} | {corporate_name}',
    body: `Dear {contact_person},\n\nPlease find below the monthly utilisation report for {corporate_name} for {month}.\n\nWe remain committed to providing the best healthcare services to your employees.\n\nRegards,\nHope Hospital`,
  },
  {
    id: 'payment_reminder',
    label: 'Payment Reminder',
    subject: 'Payment Reminder – Outstanding Dues | {corporate_name}',
    body: `Dear {contact_person},\n\nThis is a gentle reminder regarding outstanding dues for {corporate_name} with Hope Hospital.\n\nKindly arrange the payment at the earliest to avoid any disruption in empanelled services.\n\nRegards,\nHope Hospital – Accounts Team`,
  },
  {
    id: 'custom',
    label: 'Custom Message',
    subject: '',
    body: '',
  },
];

function applyTemplate(
  tpl: EmailTemplate,
  vars: { corporate_name: string; contact_person: string; month: string }
): { subject: string; body: string } {
  const replace = (str: string) =>
    str
      .replace(/{corporate_name}/g, vars.corporate_name)
      .replace(/{contact_person}/g, vars.contact_person)
      .replace(/{month}/g, vars.month);
  return { subject: replace(tpl.subject), body: replace(tpl.body) };
}

function buildMailtoLink(emails: string[], subject: string, body: string): string {
  const bcc = emails.filter(Boolean).join(',');
  const params = new URLSearchParams();
  if (bcc) params.set('bcc', bcc);
  params.set('subject', subject);
  params.set('body', body);
  return `mailto:?${params.toString().replace(/\+/g, '%20')}`;
}

function openMailto(link: string) {
  try {
    window.open(link, '_blank');
  } catch {
    window.location.href = link;
  }
}

interface EmailLog {
  id: string;
  recipient: string;
  corporate_name: string | null;
  subject: string;
  template_type: string | null;
  status: string;
  resend_id: string | null;
  error_message: string | null;
  sent_at: string;
}

const CorporateMailer = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'compose' | 'history'>('compose');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('billing_summary');
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [month, setMonth] = useState(() =>
    new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  );

  const { data: corporates = [], isLoading, error } = useQuery({
    queryKey: ['corporates-mailer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corporate')
        .select('id, name, email, contact_person, phone')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Corporate[];
    },
  });

  const { data: emailLogs = [] } = useQuery({
    queryKey: ['email-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EmailLog[];
    },
  });

  const handleSendViaAPI = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      toast({ title: 'No companies selected', variant: 'destructive' }); return;
    }
    setIsSending(true);
    try {
      const body: Record<string, unknown> = {
        type: templateId,
        month,
        corporateIds: ids,
      };
      if (templateId === 'custom') {
        body.subject = customSubject;
        body.body = customBody;
      }
      const { data, error } = await supabase.functions.invoke('send-corporate-emails', { body });
      if (error) throw error;
      const { sent = 0, failed = 0, skipped = 0 } = data as { sent: number; failed: number; skipped: number };
      toast({
        title: `Emails sent: ${sent}`,
        description: `${failed > 0 ? `${failed} failed. ` : ''}${skipped > 0 ? `${skipped} skipped (no email on file).` : ''}`,
        variant: failed > 0 ? 'destructive' : 'default',
      });
      queryClient.invalidateQueries({ queryKey: ['email-logs'] });
      setActiveTab('history');
    } catch (err) {
      toast({
        title: 'Send failed',
        description: err instanceof Error ? err.message : 'Check RESEND_API_KEY in Supabase secrets.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const filtered = useMemo(
    () =>
      corporates.filter(
        c =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.contact_person ?? '').toLowerCase().includes(search.toLowerCase())
      ),
    [corporates, search]
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const activeTpl = TEMPLATES.find(t => t.id === templateId)!;

  const previewContent = useMemo(() => {
    if (templateId === 'custom') return { subject: customSubject, body: customBody };
    return applyTemplate(activeTpl, {
      corporate_name: '[Corporate Name]',
      contact_person: '[Contact Person]',
      month,
    });
  }, [templateId, activeTpl, customSubject, customBody, month]);

  const selectedWithEmail = corporates.filter(c => selected.has(c.id) && c.email);

  const handleSendSelected = () => {
    if (selectedWithEmail.length === 0) {
      toast({
        title: 'No emails available',
        description: 'None of the selected companies have email addresses.',
        variant: 'destructive',
      });
      return;
    }
    const link = buildMailtoLink(
      selectedWithEmail.map(c => c.email!),
      previewContent.subject,
      previewContent.body
    );
    openMailto(link);
  };

  const handleBccAll = () => {
    const emails = corporates.filter(c => c.email).map(c => c.email!);
    if (emails.length === 0) {
      toast({ title: 'No emails found', description: 'No companies have email addresses.', variant: 'destructive' });
      return;
    }
    openMailto(buildMailtoLink(emails, previewContent.subject, previewContent.body));
  };

  const handleCopyEmails = async () => {
    const source = selected.size > 0
      ? corporates.filter(c => selected.has(c.id) && c.email)
      : corporates.filter(c => c.email);
    const list = source.map(c => c.email!).join(', ');
    if (!list) {
      toast({ title: 'No emails to copy', variant: 'destructive' });
      return;
    }
    await navigator.clipboard.writeText(list);
    toast({ title: 'Copied!', description: `${source.length} email address${source.length === 1 ? '' : 'es'} copied to clipboard.` });
  };

  const handleSendOne = (corp: Corporate) => {
    if (!corp.email) {
      toast({ title: 'No email', description: `${corp.name} has no email address on file.`, variant: 'destructive' });
      return;
    }
    let subject: string;
    let body: string;
    if (templateId === 'custom') {
      subject = customSubject;
      body = customBody;
    } else {
      const resolved = applyTemplate(activeTpl, {
        corporate_name: corp.name,
        contact_person: corp.contact_person ?? corp.name,
        month,
      });
      subject = resolved.subject;
      body = resolved.body;
    }
    openMailto(buildMailtoLink([corp.email], subject, body));
  };

  const isCustomValid = templateId !== 'custom' || (customSubject.trim() && customBody.trim());

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading corporate list…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-8 text-sm text-destructive">
        Could not load corporates. Check the Supabase connection.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="h-5 w-5 text-primary" /> Corporate Mailer
          </h2>
          <p className="text-sm text-muted-foreground">
            Send billing emails via API (auto-logged) or open your email client manually.
          </p>
        </div>
        <div className="flex gap-1 border rounded-lg p-1 bg-muted/30">
          <button type="button"
            onClick={() => setActiveTab('compose')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'compose' ? 'bg-white shadow-sm text-blue-600' : 'text-muted-foreground hover:text-foreground'}`}>
            <Send className="h-3.5 w-3.5" /> Compose
          </button>
          <button type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'history' ? 'bg-white shadow-sm text-blue-600' : 'text-muted-foreground hover:text-foreground'}`}>
            <History className="h-3.5 w-3.5" /> History
            {emailLogs.length > 0 && <Badge className="ml-1 h-4 px-1 text-xs">{emailLogs.length}</Badge>}
          </button>
        </div>
      </div>

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent At</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emailLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    No emails sent yet. Use "Send via API" to send and track emails here.
                  </TableCell>
                </TableRow>
              ) : emailLogs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{log.corporate_name ?? log.recipient}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{log.subject}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{log.template_type ?? 'custom'}</Badge>
                  </TableCell>
                  <TableCell>
                    {log.status === 'sent'
                      ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />Sent</span>
                      : <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3.5 w-3.5" />Failed</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Compose section */}
      {activeTab === 'compose' && <div className="space-y-4">

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select template" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATES.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Month:</span>
          <Input
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="w-36"
          />
        </div>
      </div>

      {/* Custom template fields */}
      {templateId === 'custom' && (
        <div className="space-y-2">
          <Input
            placeholder="Email subject…"
            value={customSubject}
            onChange={e => setCustomSubject(e.target.value)}
          />
          <Textarea
            placeholder="Email body…"
            rows={5}
            value={customBody}
            onChange={e => setCustomBody(e.target.value)}
          />
        </div>
      )}

      {/* Preview */}
      {templateId !== 'custom' && (
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Preview</p>
            <p className="text-sm font-medium">{previewContent.subject || '(no subject)'}</p>
            <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">{previewContent.body}</p>
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Primary: Send via API */}
        <Button
          onClick={handleSendViaAPI}
          disabled={selected.size === 0 || !isCustomValid || isSending}
          size="sm"
          className="bg-green-600 hover:bg-green-700"
        >
          {isSending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
          Send via API
          {selected.size > 0 && !isSending && (
            <Badge className="ml-1.5 bg-white/20 text-white text-xs px-1.5 py-0">{selected.size}</Badge>
          )}
        </Button>

        {/* Divider */}
        <span className="text-muted-foreground text-xs">or</span>

        {/* Fallback: mailto */}
        <Button
          onClick={handleSendSelected}
          disabled={selected.size === 0 || !isCustomValid}
          size="sm"
          variant="outline"
        >
          <Send className="h-4 w-4 mr-1.5" />
          Open in Email Client
        </Button>
        <Button
          onClick={handleBccAll}
          disabled={!isCustomValid}
          size="sm"
          variant="outline"
        >
          BCC All ({corporates.filter(c => c.email).length})
        </Button>
        <Button onClick={handleCopyEmails} size="sm" variant="outline">
          <Copy className="h-4 w-4 mr-1.5" />
          Copy Emails
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-20 text-right">Send</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  No companies found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(corp => (
                <TableRow key={corp.id} className={selected.has(corp.id) ? 'bg-blue-50/40' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(corp.id)}
                      onCheckedChange={() => toggleOne(corp.id)}
                      aria-label={`Select ${corp.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{corp.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {corp.contact_person ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {corp.email ? (
                      <span className="text-blue-600">{corp.email}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={!corp.email || !isCustomValid}
                      onClick={() => handleSendOne(corp)}
                      title={corp.email ? `Send to ${corp.email}` : 'No email on file'}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      </div>} {/* end compose section */}
    </div>
  );
};

export default CorporateMailer;
