import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Search, RefreshCw, ChevronLeft, ChevronRight, Activity, Loader2 } from 'lucide-react';
import VitalsDialog from '@/components/casualty/VitalsDialog';
import AddEmergencyPatientDialog from '@/components/casualty/AddEmergencyPatientDialog';

const PAGE_SIZE = 50;

interface CasualtyRow {
  id: string;
  visit_id: string;
  visit_date: string;
  created_at: string;
  reason_for_visit: string | null;
  status: string | null;
  corporate: string | null;
  patients: {
    name: string;
    patients_id: string;
    corporate: string | null;
  } | null;
  ward?: string;
  bp?: string;
  pulse?: number;
}

const statusVariant = (status: string | null) => {
  if (status === 'completed') return 'default';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
};

const CasualtyRegister = () => {
  const { hospitalConfig } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [nameSearch, setNameSearch] = useState('');
  const [rows, setRows] = useState<CasualtyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const [vitalsTarget, setVitalsTarget] = useState<CasualtyRow | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const fromISO = startOfDay(new Date(dateFrom)).toISOString();
      const toISO = endOfDay(new Date(dateTo)).toISOString();

      let query = (supabase as any)
        .from('visits')
        .select(`
          id, visit_id, visit_date, created_at, reason_for_visit, status, corporate,
          patients!inner(name, patients_id, corporate)
        `)
        .eq('patient_type', 'Emergency')
        .gte('visit_date', dateFrom)
        .lte('visit_date', dateTo)
        .order('visit_date', { ascending: true });

      if (hospitalConfig?.name) {
        query = query.eq('hospital_name', hospitalConfig.name);
      }

      const { data: visits, error } = await query;
      if (error) throw error;

      if (!visits || visits.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const visitIds = visits.map((v: any) => v.id);

      // Fetch latest ward shifting per visit
      const { data: shiftings } = await (supabase as any)
        .from('ward_shiftings')
        .select('visit_id, shifting_ward, shifting_date')
        .in('visit_id', visitIds)
        .order('shifting_date', { ascending: false });

      const wardMap: Record<string, string> = {};
      (shiftings || []).forEach((s: any) => {
        if (!wardMap[s.visit_id]) wardMap[s.visit_id] = s.shifting_ward;
      });

      // Fetch latest vitals per visit
      const { data: vitals } = await (supabase as any)
        .from('casualty_vitals')
        .select('visit_id, bp, pulse, recorded_at')
        .in('visit_id', visitIds)
        .order('recorded_at', { ascending: false });

      const vitalsMap: Record<string, { bp: string; pulse: number }> = {};
      (vitals || []).forEach((v: any) => {
        if (!vitalsMap[v.visit_id]) vitalsMap[v.visit_id] = { bp: v.bp, pulse: v.pulse };
      });

      const enriched: CasualtyRow[] = visits.map((v: any) => ({
        ...v,
        ward: wardMap[v.id] || null,
        bp: vitalsMap[v.id]?.bp || null,
        pulse: vitalsMap[v.id]?.pulse || null,
      }));

      // Client-side name filter
      const filtered = nameSearch.trim()
        ? enriched.filter((r: CasualtyRow) =>
            r.patients?.name?.toLowerCase().includes(nameSearch.toLowerCase())
          )
        : enriched;

      setRows(filtered);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo, hospitalConfig?.name]);

  const filteredRows = nameSearch.trim()
    ? rows.filter((r) => r.patients?.name?.toLowerCase().includes(nameSearch.toLowerCase()))
    : rows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Casualty Register</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Emergency Patient
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Patient Name</label>
              <Input
                placeholder="Search name..."
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                className="w-52"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No emergency patients found for the selected date range.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Sr.</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Reg No</TableHead>
                    <TableHead>Time of Arrival</TableHead>
                    <TableHead>Reason / Complaint</TableHead>
                    <TableHead>Panel</TableHead>
                    <TableHead>BP / Pulse</TableHead>
                    <TableHead>Ward Transferred To</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell>{startIndex + index + 1}</TableCell>
                      <TableCell className="font-medium">{row.patients?.name || '-'}</TableCell>
                      <TableCell className="text-sm font-mono">{row.visit_id || '-'}</TableCell>
                      <TableCell className="text-sm">
                        {row.created_at ? format(new Date(row.created_at), 'hh:mm a') : '-'}
                      </TableCell>
                      <TableCell className="max-w-40 truncate">{row.reason_for_visit || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {row.corporate || row.patients?.corporate || 'Private'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <button
                          className="flex items-center gap-1 text-sm hover:text-primary transition-colors"
                          onClick={() => setVitalsTarget(row)}
                          title="Click to record/update vitals"
                        >
                          <Activity className="h-3 w-3" />
                          {row.bp || row.pulse
                            ? `${row.bp || '-'} / ${row.pulse ? row.pulse + ' bpm' : '-'}`
                            : <span className="text-muted-foreground">Add vitals</span>
                          }
                        </button>
                      </TableCell>
                      <TableCell>{row.ward || <span className="text-muted-foreground">Not shifted</span>}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status || 'waiting'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">Page {currentPage} of {totalPages}</span>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Vitals Dialog */}
      {vitalsTarget && (
        <VitalsDialog
          open={!!vitalsTarget}
          onOpenChange={(open) => { if (!open) setVitalsTarget(null); }}
          visitId={vitalsTarget.id}
          patientName={vitalsTarget.patients?.name || ''}
          initialBp={vitalsTarget.bp}
          initialPulse={vitalsTarget.pulse}
          onSaved={fetchData}
        />
      )}

      {/* Add Emergency Patient Dialog */}
      <AddEmergencyPatientDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={fetchData}
      />
    </div>
  );
};

export default CasualtyRegister;
