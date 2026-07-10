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
import { Search, RefreshCw, Users, Loader2, Plus, Lock } from 'lucide-react';

interface RegisterEntry {
  id: string;
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
  admission_date: string;
  corporate: string | null;
  patients: { name: string; patients_id: string; corporate: string | null; hospital_name: string | null } | null;
  referees: { name: string } | null;
  relationship_managers: { name: string; code: string | null } | null;
}

const entriesTable = () => (supabase as any).from('referral_register_entries');

type MasterOption = { value: string; label: string; selectedLabel?: string };

const formatMarketingExecutive = (name: string, code?: string | null) =>
  code ? `${name} (${code})` : name;

const ReferralRegister = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [nameSearch, setNameSearch] = useState('');
  const [rows, setRows] = useState<RegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [visitQueryText, setVisitQueryText] = useState('');
  const [visitSearch, setVisitSearch] = useState('');
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

  useEffect(() => {
    const timer = setTimeout(() => setVisitSearch(visitQueryText), 300);
    return () => clearTimeout(timer);
  }, [visitQueryText]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await entriesTable()
        .select('*')
        .gte('admission_date', dateFrom)
        .lte('admission_date', dateTo)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data as RegisterEntry[]) || []);
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

  // Search admissions across Hope and Ayushman — by patient name, patient ID, or visit ID.
  const { data: visitMatches } = useQuery({
    queryKey: ['referral-register-visit-search', visitSearch],
    enabled: dialogOpen && !selectedVisit && visitSearch.trim().length >= 2,
    queryFn: async () => {
      const safe = visitSearch.trim().replace(/[%_,()]/g, '');
      if (safe.length < 2) return [] as VisitMatch[];
      const selectClause = `
        id, visit_id, admission_date, corporate,
        patients!inner(name, patients_id, corporate, hospital_name),
        referees:referring_doctor_id(name),
        relationship_managers:relationship_manager_id(name, code)
      `;
      const [byPatient, byVisitId] = await Promise.all([
        (supabase as any)
          .from('visits')
          .select(selectClause)
          .not('admission_date', 'is', null)
          .or(`name.ilike.%${safe}%,patients_id.ilike.%${safe}%`, { foreignTable: 'patients' })
          .order('admission_date', { ascending: false })
          .limit(10),
        (supabase as any)
          .from('visits')
          .select(selectClause)
          .not('admission_date', 'is', null)
          .ilike('visit_id', `%${safe}%`)
          .order('admission_date', { ascending: false })
          .limit(10),
      ]);
      if (byPatient.error) throw byPatient.error;
      if (byVisitId.error) throw byVisitId.error;
      const merged: VisitMatch[] = [...(byPatient.data || []), ...(byVisitId.data || [])];
      const unique = new Map(merged.map(v => [v.id, v]));
      return Array.from(unique.values()).slice(0, 10);
    },
  });

  useEffect(() => {
    if (!selectedVisit) return;
    setEntryForm(prev => ({
      ...prev,
      marketingExecutive: selectedVisit.relationship_managers?.name || '',
      referralDoctor: selectedVisit.referees?.name || '',
    }));
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
    setVisitQueryText('');
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
    if (!selectedVisit) {
      toast.error('Search and select an admission first.');
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
    ? rows.filter(row =>
        row.patient_name.toLowerCase().includes(nameSearch.trim().toLowerCase()) ||
        row.visit_id.toLowerCase().includes(nameSearch.trim().toLowerCase())
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
              Append-only register — entries cannot be edited or deleted once saved. Add a new row to record changes.
            </p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Entry
        </Button>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-gray-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-gray-500">
                      No entries for the selected dates. Use “Add Entry” to record one.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.admission_date ? format(new Date(row.admission_date), 'dd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell>{row.patient_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.visit_id}</TableCell>
                      <TableCell>{row.panel || '—'}</TableCell>
                      <TableCell>{row.marketing_executive || '—'}</TableCell>
                      <TableCell>{row.referral_doctor || '—'}</TableCell>
                      <TableCell>
                        {row.shifted_from_ayushman_opd === true
                          ? 'Yes'
                          : row.shifted_from_ayushman_opd === false
                          ? 'No'
                          : '—'}
                      </TableCell>
                      <TableCell>{row.executive_referral_doctor || '—'}</TableCell>
                      <TableCell className="max-w-[260px] whitespace-pre-wrap text-sm">
                        {row.changes_note || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-gray-500">
                        {format(new Date(row.created_at), 'dd MMM yyyy HH:mm')}
                        {row.created_by ? <><br />{row.created_by}</> : null}
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
              {filteredRows.length} entr{filteredRows.length > 1 ? 'ies' : 'y'} — read-only once saved.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={open => !open && resetDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add register entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!selectedVisit ? (
              <div className="space-y-1.5">
                <Label htmlFor="visit-search">Find admission</Label>
                <div className="relative">
                  <Input
                    id="visit-search"
                    value={visitQueryText}
                    onChange={e => setVisitQueryText(e.target.value)}
                    placeholder="Search Hope / Ayushman by patient name, patient ID or visit ID"
                    autoComplete="off"
                  />
                  {(visitMatches?.length ?? 0) > 0 && (
                    <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-white shadow-md">
                      {visitMatches!.map(match => (
                        <button
                          key={match.id}
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-gray-100"
                          onClick={() => setSelectedVisit(match)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-medium">{match.patients?.name}</span>
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">
                              {match.patients?.hospital_name || '—'}
                            </span>
                          </span>
                          <span className="text-xs text-gray-500">
                            {match.visit_id} · Adm {format(new Date(match.admission_date), 'dd MMM yyyy')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Search Hope / Ayushman admissions, then confirm marketing executive and referral doctor from master.
                </p>
              </div>
            ) : (
              <div className="space-y-1 rounded-md border bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-900">{selectedVisit.patients?.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSelectedVisit(null)}
                  >
                    Change
                  </Button>
                </div>
                <p className="text-xs text-gray-600">
                  {selectedVisit.visit_id} · Adm {format(new Date(selectedVisit.admission_date), 'dd MMM yyyy')}
                </p>
                <p className="text-xs text-gray-600">
                  Panel: {selectedVisit.corporate || selectedVisit.patients?.corporate || '—'}
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
