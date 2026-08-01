import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Camera, Play, CheckCircle, Clock, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { format } from 'date-fns';

// DATA SOURCE: radiology_orders → filtered by date/dept → technician workflow

const DEPT_FILTERS = ['All', 'USG', 'X-Ray', 'CT', 'MRI', 'ECG', 'Mammography', 'BMD'];

const STATUS_CONFIG: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  ordered:     { label: 'Ordered',     color: 'bg-yellow-100 text-yellow-800', next: 'scheduled',   nextLabel: 'Schedule' },
  scheduled:   { label: 'Scheduled',   color: 'bg-blue-100 text-blue-800',    next: 'in_progress', nextLabel: 'Start Scan' },
  in_progress: { label: 'In Progress', color: 'bg-indigo-100 text-indigo-800', next: 'completed',  nextLabel: 'Mark Done' },
  completed:   { label: 'Completed',   color: 'bg-green-100 text-green-800' },
  cancelled:   { label: 'Cancelled',   color: 'bg-red-100 text-red-700' },
};

export default function RadiologyWorklist() {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [deptFilter, setDeptFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});

  // DATA SOURCE: radiology_orders for date + optional dept filter
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['radiology-worklist', date, deptFilter],
    queryFn: async () => {
      let q = supabase
        .from('radiology_orders')
        .select(`
          id, test_name, status, created_at, priority,
          visits (
            id,
            patients (id, name, age, gender, mobile)
          )
        `)
        .gte('created_at', new Date(`${date}T00:00:00`).toISOString())
        .lte('created_at', new Date(`${date}T23:59:59.999`).toISOString())
        .order('created_at', { ascending: true });

      if (deptFilter !== 'All') {
        q = q.ilike('test_name', `%${deptFilter}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const advanceStatus = useMutation({
    mutationFn: async ({ id, nextStatus, notes }: { id: string; nextStatus: string; notes?: string }) => {
      const updates: Record<string, string | null> = { status: nextStatus };
      const now = new Date().toISOString();
      if (nextStatus === 'in_progress') updates.scan_started_at = now;
      if (nextStatus === 'completed') {
        updates.scan_completed_at = now;
        if (notes) updates.radiologist_notes = notes;
      }
      const { error } = await supabase.from('radiology_orders').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { id }) => {
      toast.success('Status updated');
      setExpandedId(null);
      qc.invalidateQueries({ queryKey: ['radiology-worklist'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = orders.filter((o: any) => !['completed', 'cancelled'].includes(o.status));
  const done = orders.filter((o: any) => o.status === 'completed');

  const counts = DEPT_FILTERS.slice(1).reduce<Record<string, number>>((acc, d) => {
    acc[d] = orders.filter((o: any) => o.test_name?.toLowerCase().includes(d.toLowerCase())).length;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Camera className="w-6 h-6 text-purple-600" /> Radiology Worklist
          </h1>
          <p className="text-sm text-muted-foreground">Technician view — scan scheduling & completion</p>
        </div>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{orders.length}</div>
          <div className="text-xs text-muted-foreground">Total orders</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-orange-500">{pending.length}</div>
          <div className="text-xs text-muted-foreground">Pending</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{done.length}</div>
          <div className="text-xs text-muted-foreground">Completed</div>
        </Card>
      </div>

      {/* Dept filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {DEPT_FILTERS.map(d => (
          <Button
            key={d}
            size="sm"
            variant={deptFilter === d ? 'default' : 'outline'}
            onClick={() => setDeptFilter(d)}
            className="h-8 text-xs"
          >
            {d}
            {d !== 'All' && counts[d] > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">{counts[d]}</Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Order list */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No radiology orders for {format(new Date(date), 'dd MMM yyyy')}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => {
            const patient = o.visits?.patients;
            const cfg = STATUS_CONFIG[o.status] || { label: o.status, color: 'bg-gray-100 text-gray-600' };
            const isExpanded = expandedId === o.id;
            const isDone = o.status === 'completed';

            return (
              <Card key={o.id} className={`transition-shadow ${isDone ? 'opacity-70' : 'hover:shadow-md'}`}>
                <CardContent className="p-4">
                  <div
                    className="flex items-center justify-between gap-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : o.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{patient?.name || 'Unknown'}</span>
                        <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                        {o.priority === 'urgent' && (
                          <Badge className="text-xs bg-red-500 text-white">URGENT</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {o.test_name}
                        {patient?.age ? ` · ${patient.age}y ${patient.gender || ''}` : ''}
                        <span className="ml-2">{format(new Date(o.created_at), 'hh:mm a')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cfg.next && !isDone && (
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={e => {
                            e.stopPropagation();
                            if (cfg.next === 'completed') {
                              setExpandedId(o.id);
                            } else {
                              advanceStatus.mutate({ id: o.id, nextStatus: cfg.next! });
                            }
                          }}
                          disabled={advanceStatus.isPending}
                        >
                          {cfg.next === 'in_progress' && <Play className="w-3 h-3 mr-1" />}
                          {cfg.next === 'completed' && <CheckCircle className="w-3 h-3 mr-1" />}
                          {cfg.nextLabel}
                        </Button>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Expanded: report notes + complete */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-3">
                      {patient && (
                        <div className="text-xs text-muted-foreground">
                          Patient: {patient.name} · {patient.mobile || 'No mobile'}
                        </div>
                      )}
                      {!isDone && o.status === 'in_progress' && (
                        <>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">
                              <FileText className="w-3 h-3 inline mr-1" /> Report / Findings
                            </label>
                            <Textarea
                              placeholder="Enter radiologist findings or report summary…"
                              rows={3}
                              value={reportNotes[o.id] || ''}
                              onChange={e => setReportNotes(prev => ({ ...prev, [o.id]: e.target.value }))}
                            />
                          </div>
                          <Button
                            className="w-full bg-green-600 hover:bg-green-700"
                            onClick={() => advanceStatus.mutate({
                              id: o.id,
                              nextStatus: 'completed',
                              notes: reportNotes[o.id],
                            })}
                            disabled={advanceStatus.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-2" /> Mark Completed & Save Report
                          </Button>
                        </>
                      )}
                      {isDone && o.radiologist_notes && (
                        <div className="bg-gray-50 rounded p-2 text-xs">{o.radiologist_notes}</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
