import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { MessageCircle, Send, CheckCircle, Clock, Search, Phone, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { composeReportReadyMessage, openWhatsApp } from '@/lib/patient-whatsapp';

// DATA SOURCE: lab_results with result_status=final grouped by patient → bulk WhatsApp delivery tracking

interface PatientReport {
  patient_id: string;
  patient_name: string;
  mobile: string | null;
  tests: string[];
  latest_result: string;
  wa_sent: boolean;
}

export default function ReportDelivery() {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  // DATA SOURCE: lab_results final reports for the selected date
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['report-delivery', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lab_results')
        .select('patient_id, test_name, created_at, patients (id, name, mobile)')
        .not('result_value', 'is', null)
        .gte('created_at', `${date}T00:00:00`)
        .lte('created_at', `${date}T23:59:59`)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Group by patient
      const map = new Map<string, PatientReport>();
      for (const row of (data || []) as any[]) {
        const patient = row.patients;
        if (!patient) continue;
        const pid = patient.id;
        if (!map.has(pid)) {
          map.set(pid, {
            patient_id: pid,
            patient_name: patient.name,
            mobile: patient.mobile,
            tests: [],
            latest_result: row.created_at,
            wa_sent: false,
          });
        }
        const entry = map.get(pid)!;
        if (!entry.tests.includes(row.test_name)) entry.tests.push(row.test_name);
      }
      return Array.from(map.values());
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const sendWhatsApp = async (report: PatientReport) => {
    if (!report.mobile) {
      toast.error(`No mobile for ${report.patient_name}`);
      return;
    }
    setSending(prev => ({ ...prev, [report.patient_id]: true }));
    try {
      const testsStr = report.tests.slice(0, 5).join(', ');
      const message = composeReportReadyMessage(report.patient_name, `lab reports for ${testsStr}`);
      const mobile = report.mobile.replace(/\D/g, '');

      const { error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: {
          mobile,
          patient_name: report.patient_name,
          message,
          patient_id: report.patient_id,
        },
      });

      if (error) {
        // Fall back to opening the chat pre-filled
        if (!openWhatsApp(report.mobile, message)) {
          toast.error(`Mobile number for ${report.patient_name} is not usable for WhatsApp.`);
          return;
        }
        toast.success(`WhatsApp opened for ${report.patient_name}`);
      } else {
        toast.success(`Report sent to ${report.patient_name}`);
      }
      setSentIds(prev => new Set([...prev, report.patient_id]));
    } catch {
      toast.error('Failed to send');
    } finally {
      setSending(prev => ({ ...prev, [report.patient_id]: false }));
    }
  };

  const sendAll = async (unsent: PatientReport[]) => {
    for (const r of unsent) {
      if (r.mobile) await sendWhatsApp(r);
    }
  };

  const filtered = reports.filter(r =>
    !search || r.patient_name.toLowerCase().includes(search.toLowerCase()) || r.mobile?.includes(search)
  );

  const hasMobile = filtered.filter(r => !!r.mobile);
  const noMobile = filtered.filter(r => !r.mobile);
  const unsent = hasMobile.filter(r => !sentIds.has(r.patient_id));
  const sentCount = hasMobile.filter(r => sentIds.has(r.patient_id)).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-green-600" /> Report Delivery
          </h1>
          <p className="text-sm text-muted-foreground">Send lab report notifications via WhatsApp</p>
        </div>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{reports.length}</div>
          <div className="text-xs text-muted-foreground">Patients with reports</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{hasMobile.length}</div>
          <div className="text-xs text-muted-foreground">Have mobile</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-orange-500">{unsent.length}</div>
          <div className="text-xs text-muted-foreground">Not yet sent</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">{sentCount}</div>
          <div className="text-xs text-muted-foreground">Sent this session</div>
        </Card>
      </div>

      {/* Bulk send */}
      {unsent.length > 0 && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-4">
          <div>
            <p className="font-semibold text-green-800">{unsent.length} reports pending delivery</p>
            <p className="text-xs text-green-600">Will send WhatsApp to all patients with registered mobiles</p>
          </div>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => sendAll(unsent)}
          >
            <Send className="w-4 h-4 mr-2" /> Send All ({unsent.length})
          </Button>
        </div>
      )}

      {/* Search */}
      {reports.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search patient or mobile…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Patient list */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No reports for {format(new Date(date), 'dd MMM yyyy')}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Patients with mobile */}
          {hasMobile.length > 0 && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">With Mobile ({hasMobile.length})</p>
              {hasMobile.filter(r => !search || r.patient_name.toLowerCase().includes(search.toLowerCase()) || r.mobile?.includes(search)).map(r => {
                const isSent = sentIds.has(r.patient_id);
                const isSending = sending[r.patient_id];
                return (
                  <Card key={r.patient_id} className={`transition-opacity ${isSent ? 'opacity-60' : ''}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{r.patient_name}</span>
                          {isSent && <Badge className="bg-green-100 text-green-800 text-xs">Sent</Badge>}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Phone className="w-3 h-3" /> {r.mobile}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.tests.slice(0, 4).map(t => (
                            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                          ))}
                          {r.tests.length > 4 && (
                            <Badge variant="outline" className="text-xs">+{r.tests.length - 4}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isSent ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-700 border-green-300 hover:bg-green-50 h-9"
                            onClick={() => sendWhatsApp(r)}
                            disabled={isSending}
                          >
                            {isSending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              : <MessageCircle className="w-3.5 h-3.5 mr-1" />}
                            Send
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}

          {/* Patients without mobile */}
          {noMobile.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">No Mobile Registered ({noMobile.length})</p>
              {noMobile.filter(r => !search || r.patient_name.toLowerCase().includes(search.toLowerCase())).map(r => (
                <Card key={r.patient_id} className="opacity-50">
                  <CardContent className="p-3 flex items-center justify-between">
                    <span className="text-sm">{r.patient_name}</span>
                    <span className="text-xs text-muted-foreground">{r.tests.length} test{r.tests.length !== 1 ? 's' : ''}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
