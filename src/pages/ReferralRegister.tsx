import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Search, RefreshCw, Users, Loader2, Lock } from 'lucide-react';

interface RegisterEntry {
  id: string;
  visit_uuid: string | null;
  visit_id: string;
  admission_date: string | null;
  patient_name: string;
  panel: string | null;
  marketing_executive: string | null;
  referral_doctor: string | null;
  shifted_from_ayushman_opd: boolean | null;
  executive_referral_doctor: string | null;
  changes_note: string | null;
  created_by: string | null;
  created_at: string;
}

interface VisitMatch {
  id: string;
  visit_id: string;
  admission_date: string | null;
  corporate: string | null;
  patients: { name: string; patients_id: string; corporate: string | null; hospital_name: string | null } | null;
  referees: { name: string } | null;
  relationship_managers: { name: string; code: string | null } | null;
}

const entriesTable = () => (supabase as any).from('referral_register_entries');

type MasterOption = { value: string; label: string; selectedLabel?: string };
interface RegisterRow {
  visit: VisitMatch;
  entry: RegisterEntry | null;
}

const formatMarketingExecutive = (name: string, code?: string | null) =>
  code ? `${name} (${code})` : name;

// Corporate short name mapping for the Panel column
const CORPORATE_SHORT_NAMES: Record<string, string> = {
  'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)': 'MJPJAY',
  'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)': 'PM-JAY',
  'Rashtriya Bal Swasthya Karyakram (RBSK)': 'RBSK',
  'Central Government Health Scheme (CGHS)': 'CGHS',
  'Ex Serviceman Contributory Health Scheme (ECHS)': 'ECHS',
  'Maharashtra Police Kutumb Arogya Yojana (MPKAY)': 'MPKAY',
  'MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana': 'MIKSSKAY',
  'Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)': 'MDKKSY',
  'Coal India Limited (CIL)': 'CIL',
  'Central Railways (C.Rly)': 'CR',
  'South Eastern Central Railway (SECR)': 'SECR',
  'Western Coalfield Limited (WCL)': 'WCL',
};
const getCorporateShortName = (fullName: string): string => CORPORATE_SHORT_NAMES[fullName] || fullName;

const ReferralRegister = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [nameSearch, setNameSearch] = useState('');
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<VisitMatch | null>(null);
  const [entryForm, setEntryForm] = useState({
    marketingExecutive: '',
    referralDoctor: '',
    ayushman: 'unset',
    executiveDoctor: '',
    changesNote: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: relationshipManagerOptions = [] } = useQuery({
    queryKey: ['referral-register-rm-options'],
    enabled: dialogOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('relationship_managers')
        .select('name, code')
        .order('name');
      if (error) throw error;
      return (data || []).map(row => ({
        value: row.name,
        label: formatMarketingExecutive(row.name, row.code),
        selectedLabel: row.name,
      })) as MasterOption[];
    },
  });

  const { data: refereeOptions = [] } = useQuery({
    queryKey: ['referral-register-referee-options'],
    enabled: dialogOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referees')
        .select('name, specialty')
        .order('name');
      if (error) throw error;
      return (data || []).map(row => ({
        value: row.name,
        label: row.specialty ? `${row.name} (${row.specialty})` : row.name,
        selectedLabel: row.name,
      })) as MasterOption[];
    },
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const selectClause = `
        id, visit_id, admission_date, corporate,
        patients!inner(name, patients_id, corporate, hospital_name),
        referees:referring_doctor_id(name),
        relationship_managers:relationship_manager_id(name, code)
      `;
      const [entriesResult, visitsResult] = await Promise.all([
        entriesTable()
          .select('*')
          .gte('admission_date', dateFrom)
          .lte('admission_date', dateTo)
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('visits')
          .select(selectClause)
          .not('admission_date', 'is', null)
          .gte('admission_date', dateFrom)
          .lte('admission_date', dateTo)
          .order('admission_date', { ascending: false }),
      ]);
      if (entriesResult.error) throw entriesResult.error;
      if (visitsResult.error) throw visitsResult.error;

      const savedEntries = (entriesResult.data as RegisterEntry[]) || [];
      const savedByVisit = new Map(
        savedEntries.map(entry => [entry.visit_uuid || entry.visit_id, entry]),
      );
      const HopeAndAyushmanAdmissions = ((visitsResult.data as VisitMatch[]) || []).filter(
        visit => {
          const hospital = visit.patients?.hospital_name?.toLowerCase() || '';
          return hospital.includes('hope') || hospital.includes('ayushman');
        },
      );
      setRows(HopeAndAyushmanAdmissions.map(visit => ({
        visit,
        entry: savedByVisit.get(visit.id) || savedByVisit.get(visit.visit_id) || null,
      })));
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
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedVisit) return;
    setEntryForm({
      marketingExecutive: selectedVisit.relationship_managers?.name || '',
      referralDoctor: selectedVisit.referees?.name || '',
      ayushman: 'unset',
      executiveDoctor: '',
      changesNote: '',
    });
  }, [selectedVisit]);

  const ensureRelationshipManager = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { data: existing } = await supabase
      .from('relationship_managers')
      .select('name, code')
      .ilike('name', trimmed)
      .limit(1);
    if (existing?.[0]) {
      setEntryForm(prev => ({ ...prev, marketingExecutive: existing[0].name }));
      return;
    }
    const { data: inserted, error } = await supabase
      .from('relationship_managers')
      .insert([{ name: trimmed }])
      .select('name, code')
      .single();
    if (error) {
      const { data: refetched } = await supabase
        .from('relationship_managers')
        .select('name, code')
        .ilike('name', trimmed)
        .limit(1);
      if (refetched?.[0]) {
        setEntryForm(prev => ({ ...prev, marketingExecutive: refetched[0].name }));
        return;
      }
      throw error;
    }
    setEntryForm(prev => ({ ...prev, marketingExecutive: inserted.name }));
    queryClient.invalidateQueries({ queryKey: ['referral-register-rm-options'] });
    toast.success(`Added "${inserted.name}" to relationship managers.`);
  };

  const ensureReferee = async (
    name: string,
    field: 'referralDoctor' | 'executiveDoctor',
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { data: existing } = await supabase
      .from('referees')
      .select('name')
      .ilike('name', trimmed)
      .limit(1);
    if (existing?.[0]) {
      setEntryForm(prev => ({ ...prev, [field]: existing[0].name }));
      return;
    }
    const { data: inserted, error } = await supabase
      .from('referees')
      .insert([{ name: trimmed }])
      .select('name')
      .single();
    if (error) {
      const { data: refetched } = await supabase
        .from('referees')
        .select('name')
        .ilike('name', trimmed)
        .limit(1);
      if (refetched?.[0]) {
        setEntryForm(prev => ({ ...prev, [field]: refetched[0].name }));
        return;
      }
      throw error;
    }
    setEntryForm(prev => ({ ...prev, [field]: inserted.name }));
    queryClient.invalidateQueries({ queryKey: ['referral-register-referee-options'] });
    toast.success(`Added "${inserted.name}" to referral doctors.`);
  };

  const resetDialog = () => {
    setDialogOpen(false);
    setSelectedVisit(null);
    setEntryForm({
      marketingExecutive: '',
      referralDoctor: '',
      ayushman: 'unset',
      executiveDoctor: '',
      changesNote: '',
    });
  };

  const handleSave = async () => {
    if (!selectedVisit?.admission_date) {
      toast.error('Select an admitted patient first.');
      return;
    }
    setSaving(true);
    try {
      const rmMatch = relationshipManagerOptions.find(
        opt => opt.value === entryForm.marketingExecutive,
      );
      const marketingExecutive = entryForm.marketingExecutive.trim()
        ? rmMatch?.label || entryForm.marketingExecutive.trim()
        : null;

      const { error } = await entriesTable().insert({
        visit_uuid: selectedVisit.id,
        visit_id: selectedVisit.visit_id,
        admission_date: selectedVisit.admission_date.slice(0, 10),
        patient_name: selectedVisit.patients?.name || '—',
        panel: selectedVisit.corporate || selectedVisit.patients?.corporate || null,
        marketing_executive: marketingExecutive,
        referral_doctor: entryForm.referralDoctor.trim() || null,
        shifted_from_ayushman_opd:
          entryForm.ayushman === 'yes' ? true : entryForm.ayushman === 'no' ? false : null,
        executive_referral_doctor: entryForm.executiveDoctor.trim() || null,
        changes_note: entryForm.changesNote.trim() || null,
        created_by: user?.email || user?.username || null,
      });
      if (error) throw error;
      toast.success('Entry saved. Entries cannot be edited or deleted.');
      resetDialog();
      fetchData();
    } catch (error) {
      console.error('Failed to save referral register entry:', error);
      toast.error('Could not save the entry. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const filteredRows = nameSearch.trim()
    ? rows.filter(({ visit }) =>
        (visit.patients?.name || '').toLowerCase().includes(nameSearch.trim().toLowerCase()) ||
        visit.visit_id.toLowerCase().includes(nameSearch.trim().toLowerCase())
      )
    : rows;

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Referral Register</h1>
            <p className="text-sm text-gray-500">
              Hope and Ayushman admissions are listed automatically. Complete each entry once; it locks after saving.
            </p>
          </div>
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
                  <TableHead>Changes / Remarks</TableHead>
                  <TableHead>Entered</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-10 text-center text-gray-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-10 text-center text-gray-500">
                      No Hope or Ayushman admissions for the selected dates.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map(({ visit, entry }) => (
                    <TableRow key={visit.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {visit.admission_date ? format(new Date(visit.admission_date), 'dd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell>{visit.patients?.name || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{visit.visit_id}</TableCell>
                      <TableCell>{getCorporateShortName(visit.corporate || visit.patients?.corporate || '') || '—'}</TableCell>
                      <TableCell>{entry?.marketing_executive || visit.relationship_managers?.name || '—'}</TableCell>
                      <TableCell>{entry?.referral_doctor || visit.referees?.name || '—'}</TableCell>
                      <TableCell>
                        {entry?.shifted_from_ayushman_opd === true
                          ? 'Yes'
                          : entry?.shifted_from_ayushman_opd === false
                          ? 'No'
                          : '—'}
                      </TableCell>
                      <TableCell>{entry?.executive_referral_doctor || '—'}</TableCell>
                      <TableCell className="max-w-[260px] whitespace-pre-wrap text-sm">
                        {entry?.changes_note || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-gray-500">
                        {entry ? <>{format(new Date(entry.created_at), 'dd MMM yyyy HH:mm')}
                          {entry.created_by ? <><br />{entry.created_by}</> : null}</> : '—'}
                      </TableCell>
                      <TableCell>
                        {entry ? (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Lock className="h-3.5 w-3.5" />
                            Saved
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedVisit(visit);
                              setDialogOpen(true);
                            }}
                          >
                            Complete entry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && filteredRows.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
              <Lock className="h-3.5 w-3.5" />
              Saved entries are read-only. Unsaved admissions can be completed from the Action column.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={open => !open && resetDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete referral entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedVisit && (
              <div className="space-y-1 rounded-md border bg-gray-50 p-3 text-sm">
                <p className="font-semibold text-gray-900">{selectedVisit.patients?.name}</p>
                <p className="text-xs text-gray-600">
                  {selectedVisit.visit_id} · Adm {selectedVisit.admission_date
                    ? format(new Date(selectedVisit.admission_date), 'dd MMM yyyy')
                    : '—'}
                </p>
                <p className="text-xs text-gray-600">
                  Panel: {getCorporateShortName(selectedVisit.corporate || selectedVisit.patients?.corporate || '') || '—'}
                </p>
              </div>
            )}

            {selectedVisit && (
              <>
                <div className="space-y-1.5">
                  <Label>Marketing executive / relationship manager</Label>
                  <SearchableSelect
                    options={[
                      ...relationshipManagerOptions,
                      ...(entryForm.marketingExecutive &&
                      !relationshipManagerOptions.some(opt => opt.value === entryForm.marketingExecutive)
                        ? [{
                            value: entryForm.marketingExecutive,
                            label: entryForm.marketingExecutive,
                          }]
                        : []),
                    ]}
                    value={entryForm.marketingExecutive}
                    onValueChange={value =>
                      setEntryForm(prev => ({ ...prev, marketingExecutive: value }))
                    }
                    onCreateOption={async name => {
                      try {
                        await ensureRelationshipManager(name);
                      } catch (error) {
                        console.error('Failed to add relationship manager:', error);
                        toast.error('Could not add marketing executive.');
                      }
                    }}
                    placeholder="Search marketing executive..."
                    searchPlaceholder="Search or add relationship manager..."
                    emptyText="No marketing executive found."
                    createOptionLabel={input => `Add "${input}" to master`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Referral doctor</Label>
                  <SearchableSelect
                    options={[
                      ...refereeOptions,
                      ...(entryForm.referralDoctor &&
                      !refereeOptions.some(opt => opt.value === entryForm.referralDoctor)
                        ? [{
                            value: entryForm.referralDoctor,
                            label: entryForm.referralDoctor,
                          }]
                        : []),
                    ]}
                    value={entryForm.referralDoctor}
                    onValueChange={value =>
                      setEntryForm(prev => ({ ...prev, referralDoctor: value }))
                    }
                    onCreateOption={async name => {
                      try {
                        await ensureReferee(name, 'referralDoctor');
                      } catch (error) {
                        console.error('Failed to add referral doctor:', error);
                        toast.error('Could not add referral doctor.');
                      }
                    }}
                    placeholder="Search referral doctor..."
                    searchPlaceholder="Search or add referral doctor..."
                    emptyText="No referral doctor found."
                    createOptionLabel={input => `Add "${input}" to master`}
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label>Shifted from Ayushman OPD</Label>
              <Select
                value={entryForm.ayushman}
                onValueChange={value => setEntryForm(prev => ({ ...prev, ayushman: value }))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">—</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Doctor who referred to the marketing executive</Label>
              <SearchableSelect
                options={[
                  ...refereeOptions,
                  ...(entryForm.executiveDoctor &&
                  !refereeOptions.some(opt => opt.value === entryForm.executiveDoctor)
                    ? [{
                        value: entryForm.executiveDoctor,
                        label: entryForm.executiveDoctor,
                      }]
                    : []),
                ]}
                value={entryForm.executiveDoctor}
                onValueChange={value =>
                  setEntryForm(prev => ({ ...prev, executiveDoctor: value }))
                }
                onCreateOption={async name => {
                  try {
                    await ensureReferee(name, 'executiveDoctor');
                  } catch (error) {
                    console.error('Failed to add executive referral doctor:', error);
                    toast.error('Could not add doctor.');
                  }
                }}
                placeholder="Search doctor..."
                searchPlaceholder="Search or add doctor..."
                emptyText="No doctor found."
                createOptionLabel={input => `Add "${input}" to master`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="changes-note">Changes / remarks</Label>
              <Textarea
                id="changes-note"
                value={entryForm.changesNote}
                onChange={e => setEntryForm(prev => ({ ...prev, changesNote: e.target.value }))}
                placeholder="Mention any changes in addition to what was selected during registration"
                rows={3}
              />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <Lock className="h-3.5 w-3.5" />
              Once saved, this entry cannot be edited or deleted.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !selectedVisit}>
              {saving ? 'Saving...' : 'Save entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReferralRegister;
