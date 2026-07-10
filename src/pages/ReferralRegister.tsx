import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, RefreshCw, Users, Loader2 } from 'lucide-react';

interface ReferralRow {
  id: string;
  visit_id: string;
  admission_date: string | null;
  corporate: string | null;
  shifted_from_ayushman_opd: boolean | null;
  executive_referral_doctor: string | null;
  patients: {
    name: string;
    patients_id: string;
    corporate: string | null;
  } | null;
  referees: {
    name: string;
    specialty: string | null;
  } | null;
  relationship_managers: {
    name: string;
    code: string | null;
  } | null;
}

const ReferralRegister = () => {
  const { hospitalConfig } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [nameSearch, setNameSearch] = useState('');
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftDoctor, setDraftDoctor] = useState<Record<string, string>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from('visits')
        .select(`
          id, visit_id, admission_date, corporate, shifted_from_ayushman_opd, executive_referral_doctor,
          patients!inner(name, patients_id, corporate, hospital_name),
          referees:referring_doctor_id(name, specialty),
          relationship_managers:relationship_manager_id(name, code)
        `)
        .not('admission_date', 'is', null)
        .gte('admission_date', dateFrom)
        .lte('admission_date', dateTo)
        .order('admission_date', { ascending: false });

      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRows((data as ReferralRow[]) || []);
      setDraftDoctor({});
    } catch (error) {
      console.error('Failed to load referral register:', error);
      toast.error('Could not load the referral register.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, hospitalConfig?.name]);

  const updateVisit = async (visitId: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase as any).from('visits').update(patch).eq('id', visitId);
    if (error) {
      console.error('Failed to update referral register entry:', error);
      toast.error('Could not save. Please retry.');
      return false;
    }
    return true;
  };

  const handleAyushmanChange = async (row: ReferralRow, value: string) => {
    const parsed = value === 'yes' ? true : value === 'no' ? false : null;
    const saved = await updateVisit(row.id, { shifted_from_ayushman_opd: parsed });
    if (saved) {
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, shifted_from_ayushman_opd: parsed } : r)));
    }
  };

  const handleDoctorBlur = async (row: ReferralRow) => {
    const draft = draftDoctor[row.id];
    if (draft === undefined || draft === (row.executive_referral_doctor ?? '')) return;
    const value = draft.trim() || null;
    const saved = await updateVisit(row.id, { executive_referral_doctor: value });
    if (saved) {
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, executive_referral_doctor: value } : r)));
    }
  };

  const filteredRows = nameSearch.trim()
    ? rows.filter(row =>
        (row.patients?.name || '').toLowerCase().includes(nameSearch.trim().toLowerCase()) ||
        row.visit_id.toLowerCase().includes(nameSearch.trim().toLowerCase())
      )
    : rows;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Referral Register</h1>
          <p className="text-sm text-gray-500">
            Admissions with panel, marketing executive, and referral doctor details.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Admission from</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Admission to</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Patient name or visit ID"
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Date of Admission</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Panel</TableHead>
                  <TableHead>Marketing Executive</TableHead>
                  <TableHead>Referral Doctor</TableHead>
                  <TableHead>Shifted from Ayushman OPD</TableHead>
                  <TableHead>Doctor Who Referred to Executive</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-gray-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-gray-500">
                      No admissions found for the selected dates.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.admission_date
                          ? format(new Date(row.admission_date), 'dd MMM yyyy')
                          : '—'}
                      </TableCell>
                      <TableCell>{row.patients?.name || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.visit_id}</TableCell>
                      <TableCell>{row.corporate || row.patients?.corporate || '—'}</TableCell>
                      <TableCell>
                        {row.relationship_managers
                          ? `${row.relationship_managers.name}${row.relationship_managers.code ? ` (${row.relationship_managers.code})` : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {row.referees
                          ? `${row.referees.name}${row.referees.specialty ? ` (${row.referees.specialty})` : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={
                            row.shifted_from_ayushman_opd === true
                              ? 'yes'
                              : row.shifted_from_ayushman_opd === false
                              ? 'no'
                              : 'unset'
                          }
                          onValueChange={value => handleAyushmanChange(row, value)}
                        >
                          <SelectTrigger className="h-8 w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unset">—</SelectItem>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 min-w-[180px]"
                          placeholder="Doctor name"
                          value={draftDoctor[row.id] ?? row.executive_referral_doctor ?? ''}
                          onChange={e =>
                            setDraftDoctor(prev => ({ ...prev, [row.id]: e.target.value }))
                          }
                          onBlur={() => handleDoctorBlur(row)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && filteredRows.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              {filteredRows.length} admission{filteredRows.length > 1 ? 's' : ''} · Ayushman OPD and
              executive-referral doctor save automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReferralRegister;
