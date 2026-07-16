import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { CheckCircle2, Edit2, Eye, EyeOff, Plus, Printer, RotateCcw, Trash2, Users, Save } from 'lucide-react';

interface VisitRow {
  id: string;
  visit_id: string;
  visit_date: string;
  appointment_with: string | null;
  package_amount: string | null;
  patient_type: string | null;
  created_at: string;
  patients: { id: string; name: string; hospital_name: string | null; relationship_manager: string | null } | null;
  relationship_managers: { id: string; name: string; code: string | null; commission_percent: number | null } | null;
}

interface OverrideRow {
  id: string;
  entry_date: string;
  visit_id: string | null;
  patient_name: string;
  department: string | null;
  rm_name: string | null;
  cost: number;
  cut: number;
  hospital_type: string;
  is_hidden: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type CostSource = 'override' | 'advance' | 'final_pay' | 'package' | 'none';

type RowCategory = 'main' | 'direct' | 'manual';

interface DisplayRow {
  key: string;
  visitId: string | null;
  overrideId: string | null;
  patient_name: string;
  department: string;
  rm_name: string;
  hospital: string;
  patient_type: string; // 'OPD' | 'IPD' | '' (manual entries / unknown)
  rmId: string | null;
  rmPercent: number;
  cost: number;
  cut: number;
  cutIsSuggested: boolean; // true when cut was computed from the RM's saved %, not saved
  cost_source: CostSource;
  isManual: boolean;
  isHidden: boolean;
  category: RowCategory;
}

type PatientTypeFilter = 'all' | 'OPD' | 'IPD';

const COST_SOURCE_LABEL: Record<CostSource, string> = {
  override: 'man',
  advance: 'adv',
  final_pay: 'final',
  package: 'pkg',
  none: '',
};

interface ManualFormData {
  patient_name: string;
  department: string;
  rm_name: string;
  cost: string;
  cut: string;
  notes: string;
}

const initialManual: ManualFormData = {
  patient_name: '',
  department: '',
  rm_name: '',
  cost: '',
  cut: '',
  notes: '',
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const formatINR = (n: number): string => n.toLocaleString('en-IN');

const toNumber = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
};

const validCommissionPercent = (value: number | null | undefined): number => {
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 25;
};

// Treat blank RM as a walk-in "Direct" patient (matches the handwritten lists'
// "Direct PT" convention). Also covers the master relationship_managers entry
// literally named DIRECT (code 1012) so the display is consistent.
const isDirect = (rm: string | null | undefined): boolean => {
  if (!rm) return true;
  const s = rm.trim().toLowerCase();
  return s === '' || s === 'direct';
};

export function DailyRevenueReportSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reportDate, setReportDate] = useState<string>(todayIso());
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [draftCut, setDraftCut] = useState<string>('');
  const [draftCost, setDraftCost] = useState<string>('');
  const [draftRmId, setDraftRmId] = useState<string>(''); // '' means leave unchanged
  const [draftRmPercent, setDraftRmPercent] = useState<string>('');
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualFormData>(initialManual);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [detailsRow, setDetailsRow] = useState<DisplayRow | null>(null);
  const [onlyWithRm, setOnlyWithRm] = useState<boolean>(true);
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [patientTypeFilter, setPatientTypeFilter] = useState<PatientTypeFilter>('OPD');

  const hospitalType = user?.hospitalType ?? '';

  // Director sees patients from BOTH hospitals on one screen — no hospital_name filter.
  const visitsQuery = useQuery({
    queryKey: ['dailyRevenueVisits', reportDate],
    queryFn: async (): Promise<VisitRow[]> => {
      const { data, error } = await supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          visit_date,
          appointment_with,
          package_amount,
          patient_type,
          created_at,
          patients!inner ( id, name, hospital_name, relationship_manager ),
          relationship_managers ( id, name, code, commission_percent )
        `)
        .eq('visit_date', reportDate)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  // Sum advance payments per visit_id (text) so we can use them as the cost
  // when the package_amount field on the visit is empty.
  const visitIds: string[] = useMemo(
    () => (visitsQuery.data ?? []).map((v) => v.visit_id).filter(Boolean),
    [visitsQuery.data],
  );

  // RM master list — used by the inline RM picker on each row.
  const rmMasterQuery = useQuery({
    queryKey: ['dailyRevenueRmMaster'],
    queryFn: async (): Promise<Array<{ id: string; name: string; code: string | null; commission_percent: number | null }>> => {
      const { data, error } = await supabase
        .from('relationship_managers' as never)
        .select('id, name, code, commission_percent')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; name: string; code: string | null; commission_percent: number | null }>;
    },
    staleTime: 5 * 60 * 1000, // 5 min — master list rarely changes
  });

  const advanceQuery = useQuery({
    queryKey: ['dailyRevenueAdvance', visitIds.join(',')],
    queryFn: async (): Promise<Record<string, number>> => {
      if (visitIds.length === 0) return {};
      const { data, error } = await supabase
        .from('advance_payment' as never)
        .select('visit_id, advance_amount, returned_amount, status')
        .in('visit_id', visitIds);
      if (error) throw error;
      const sums: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as Array<{
        visit_id: string;
        advance_amount: number | string | null;
        returned_amount: number | string | null;
        status: string | null;
      }>) {
        if (r.status === 'CANCELLED') continue;
        const net = toNumber(r.advance_amount) - toNumber(r.returned_amount);
        sums[r.visit_id] = (sums[r.visit_id] ?? 0) + net;
      }
      return sums;
    },
    enabled: visitIds.length > 0,
  });

  const finalPayQuery = useQuery({
    queryKey: ['dailyRevenueFinalPay', visitIds.join(',')],
    queryFn: async (): Promise<Record<string, number>> => {
      if (visitIds.length === 0) return {};
      const { data, error } = await supabase
        .from('final_payments' as never)
        .select('visit_id, amount')
        .in('visit_id', visitIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as Array<{
        visit_id: string;
        amount: number | string | null;
      }>) {
        map[r.visit_id] = (map[r.visit_id] ?? 0) + toNumber(r.amount);
      }
      return map;
    },
    enabled: visitIds.length > 0,
  });

  // Director sees overrides from BOTH hospitals on one screen.
  const overridesQuery = useQuery({
    queryKey: ['dailyRevenueOverrides', reportDate],
    queryFn: async (): Promise<OverrideRow[]> => {
      const { data, error } = await supabase
        .from('daily_revenue_entries' as never)
        .select('*')
        .eq('entry_date', reportDate)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OverrideRow[];
    },
  });

  // Approval is date-specific: after approval, that day's report becomes a
  // read-only record. A separate table is used because a report can contain
  // visits that do not have a saved override row yet.
  const approvalQuery = useQuery({
    queryKey: ['dailyRevenueApproval', reportDate],
    queryFn: async (): Promise<{ approved_at: string; approved_by_email: string | null } | null> => {
      const { data, error } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .select('approved_at, approved_by_email')
        .eq('entry_date', reportDate)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as { approved_at: string; approved_by_email: string | null } | null;
    },
  });

  const isApproved = Boolean(approvalQuery.data?.approved_at);

  const rows: DisplayRow[] = useMemo(() => {
    const visits = visitsQuery.data ?? [];
    const overrides = overridesQuery.data ?? [];
    const advanceMap = advanceQuery.data ?? {};
    const finalPayMap = finalPayQuery.data ?? {};

    const overrideByVisit = new Map<string, OverrideRow>();
    for (const o of overrides) {
      if (o.visit_id) overrideByVisit.set(o.visit_id, o);
    }
    const rmByName = new Map(
      (rmMasterQuery.data ?? []).map((rm) => [rm.name.trim().toLowerCase(), rm]),
    );

    const visitRows: DisplayRow[] = visits.map((v) => {
      const o = overrideByVisit.get(v.id);

      // Priority: manual override > advance > bill prep > final pay > visits.package_amount.
      // visit_id (text, e.g. "IH25F27004") is the lookup key for billing tables.
      let cost = 0;
      let cost_source: CostSource = 'none';
      if (o && Number(o.cost) > 0) {
        cost = Number(o.cost);
        cost_source = 'override';
      } else if ((advanceMap[v.visit_id] ?? 0) > 0) {
        cost = advanceMap[v.visit_id];
        cost_source = 'advance';
      } else if ((finalPayMap[v.visit_id] ?? 0) > 0) {
        cost = finalPayMap[v.visit_id];
        cost_source = 'final_pay';
      } else if (toNumber(v.package_amount) > 0) {
        cost = toNumber(v.package_amount);
        cost_source = 'package';
      }

      // Direct patients (no RM) get no auto-suggested cut — there's no
      // RM to pay a commission to. A saved cut still wins if it's
      // explicitly set (e.g., one-off spot payment).
      // RM priority: override wins → visit FK → patient master text.
      const rmName = (o?.rm_name && o.rm_name.trim())
        || v.relationship_managers?.name
        || v.patients?.relationship_manager
        || '';
      const rowIsDirect = isDirect(rmName);
      const rmFromVisitMatchesName = v.relationship_managers
        && v.relationship_managers.name.trim().toLowerCase() === rmName.trim().toLowerCase();
      const rm = rowIsDirect
        ? null
        : rmFromVisitMatchesName
          ? v.relationship_managers
          : rmByName.get(rmName.trim().toLowerCase()) ?? null;
      const rmPercent = rowIsDirect ? 0 : validCommissionPercent(rm?.commission_percent);
      const savedCut = o ? Number(o.cut) : 0;
      const hasSavedCut = Boolean(o) && savedCut > 0;
      const suggestedCut = rowIsDirect ? 0 : Math.round((cost * rmPercent) / 100);
      return {
        key: `visit-${v.id}`,
        visitId: v.id,
        overrideId: o?.id ?? null,
        patient_name: v.patients?.name ?? '—',
        department: v.appointment_with ?? '',
        rm_name: rmName,
        hospital: v.patients?.hospital_name ?? '',
        patient_type: (v.patient_type ?? '').toUpperCase(),
        rmId: rm?.id ?? null,
        rmPercent,
        cost,
        cut: hasSavedCut ? savedCut : suggestedCut,
        cutIsSuggested: !hasSavedCut && suggestedCut > 0,
        cost_source,
        isManual: false,
        isHidden: Boolean(o?.is_hidden),
        category: rowIsDirect ? 'direct' : 'main',
      };
    });

    const manualRows: DisplayRow[] = overrides
      .filter((o) => !o.visit_id)
      .map((o) => {
        const rmName = o.rm_name ?? '';
        const rowIsDirect = isDirect(rmName);
        const rm = rowIsDirect ? null : rmByName.get(rmName.trim().toLowerCase()) ?? null;
        return {
          key: `manual-${o.id}`,
          visitId: null,
          overrideId: o.id,
          patient_name: o.patient_name,
          department: o.department ?? '',
          rm_name: rmName,
          hospital: o.hospital_type ?? '',
          patient_type: '',
          rmId: rm?.id ?? null,
          rmPercent: rowIsDirect ? 0 : validCommissionPercent(rm?.commission_percent),
          cost: Number(o.cost),
          cut: Number(o.cut),
          cutIsSuggested: false,
          cost_source: 'override' as const,
          isManual: true,
          isHidden: Boolean(o.is_hidden),
          category: rowIsDirect ? 'direct' : 'manual',
        };
      });

    let all = [...visitRows, ...manualRows];
    if (patientTypeFilter !== 'all') {
      all = all.filter((r) => r.patient_type === patientTypeFilter);
    }
    if (onlyWithRm) {
      all = all.filter((r) => !isDirect(r.rm_name));
    }
    if (!showHidden) {
      all = all.filter((r) => !r.isHidden);
    }
    return all;
  }, [visitsQuery.data, overridesQuery.data, advanceQuery.data, finalPayQuery.data, rmMasterQuery.data, onlyWithRm, patientTypeFilter, showHidden]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ cost: acc.cost + r.cost, cut: acc.cut + r.cut }), { cost: 0, cut: 0 }),
    [rows],
  );

  // Group rows by category to mirror the handwritten ledger sections.
  // Render order matches the physical sheets: Main → Direct → Manual / Other.
  const groupedRows = useMemo(() => {
    const order: ReadonlyArray<{ category: RowCategory; label: string }> = [
      { category: 'main', label: 'Main' },
      { category: 'direct', label: 'Direct' },
      { category: 'manual', label: 'Manual / Other' },
    ];
    return order
      .map(({ category, label }) => {
        const groupRows = rows.filter((r) => r.category === category);
        const subtotal = groupRows.reduce(
          (acc, r) => ({ cost: acc.cost + r.cost, cut: acc.cut + r.cut }),
          { cost: 0, cut: 0 },
        );
        return { category, label, rows: groupRows, subtotal };
      })
      .filter((g) => g.rows.length > 0);
  }, [rows]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueOverrides'] });
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueVisits'] });
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueApproval'] });
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueRmMaster'] });
  };

  const saveCutMutation = useMutation({
    mutationFn: async (row: DisplayRow) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      const cost = parseFloat(draftCost || '0');
      const draftedCut = parseFloat(draftCut || '0');
      if (isNaN(cost) || cost < 0) throw new Error('Cost must be ≥ 0');
      if (isNaN(draftedCut) || draftedCut < 0) throw new Error('Cut must be ≥ 0');

      // Override row is tagged with the visit's hospital, not the editor's.
      const rowHospital = row.hospital || hospitalType || 'hope';

      // Resolve the picked RM from the master list (if any).
      const pickedRm = draftRmId
        ? (rmMasterQuery.data ?? []).find((m) => m.id === draftRmId) ?? null
        : null;
      const finalRmName = pickedRm?.name ?? row.rm_name ?? null;
      // Changing the assigned RM must also change this visit's cut to that
      // RM's permanent rate. Editing only cost/cut still preserves a manually
      // entered cut amount.
      const rmChanged = Boolean(pickedRm && pickedRm.id !== row.rmId);
      const cut = rmChanged
        ? Math.round((cost * validCommissionPercent(pickedRm?.commission_percent)) / 100)
        : draftedCut;

      if (row.overrideId) {
        const { error } = await supabase
          .from('daily_revenue_entries' as never)
          .update({
            cost,
            cut,
            rm_name: finalRmName,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', row.overrideId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('daily_revenue_entries' as never).insert([
          {
            entry_date: reportDate,
            visit_id: row.visitId,
            patient_name: row.patient_name,
            department: row.department || null,
            rm_name: finalRmName,
            cost,
            cut,
            hospital_type: rowHospital,
          } as never,
        ]);
        if (error) throw error;
      }

      // Propagate the picked RM back to the visit itself, so other pages
      // (and future days) see it automatically without a manual override.
      if (pickedRm && row.visitId) {
        const { error: visitErr } = await supabase
          .from('visits')
          .update({ relationship_manager_id: pickedRm.id } as never)
          .eq('id', row.visitId);
        if (visitErr) {
          // Non-fatal: override already saved. Just warn.
          console.warn('Failed to update visit RM:', visitErr.message);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success('Saved');
      setEditingCutId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const addManualMutation = useMutation({
    mutationFn: async (data: ManualFormData) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      if (!data.patient_name.trim()) throw new Error('Patient name is required');
      const cost = parseFloat(data.cost || '0');
      const cut = parseFloat(data.cut || '0');
      if (isNaN(cost) || cost < 0) throw new Error('Cost must be ≥ 0');
      if (isNaN(cut) || cut < 0) throw new Error('Cut must be ≥ 0');
      const { error } = await supabase.from('daily_revenue_entries' as never).insert([
        {
          entry_date: reportDate,
          patient_name: data.patient_name.trim(),
          department: data.department.trim() || null,
          rm_name: data.rm_name.trim() || null,
          cost,
          cut,
          hospital_type: hospitalType || 'hope',
          notes: data.notes.trim() || null,
        } as never,
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Entry added');
      setIsManualDialogOpen(false);
      setManualForm(initialManual);
      setManualEditId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateManualMutation = useMutation({
    mutationFn: async (data: ManualFormData) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      if (!manualEditId) throw new Error('No row selected');
      const cost = parseFloat(data.cost || '0');
      const cut = parseFloat(data.cut || '0');
      const { error } = await supabase
        .from('daily_revenue_entries' as never)
        .update({
          patient_name: data.patient_name.trim(),
          department: data.department.trim() || null,
          rm_name: data.rm_name.trim() || null,
          cost,
          cut,
          notes: data.notes.trim() || null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', manualEditId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Updated');
      setIsManualDialogOpen(false);
      setManualForm(initialManual);
      setManualEditId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      const { error } = await supabase
        .from('daily_revenue_entries' as never)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Deleted');
      setDeleteId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Updating an RM's permanent rate also recalculates the row used to make the
  // change. Other saved/approved report rows remain unchanged.
  const saveRmRateMutation = useMutation({
    mutationFn: async (row: DisplayRow) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      if (!row.rmId || isDirect(row.rm_name)) throw new Error('Direct patients do not have an RM rate');
      const commissionPercent = parseFloat(draftRmPercent);
      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        throw new Error('RM % must be between 0 and 100');
      }
      const { error } = await supabase
        .from('relationship_managers' as never)
        .update({ commission_percent: commissionPercent } as never)
        .eq('id', row.rmId);
      if (error) throw error;

      const cut = Math.round((row.cost * commissionPercent) / 100);
      if (row.overrideId) {
        const { error: entryError } = await supabase
          .from('daily_revenue_entries' as never)
          .update({ cut, updated_at: new Date().toISOString() } as never)
          .eq('id', row.overrideId);
        if (entryError) throw entryError;
      } else if (row.visitId) {
        const rowHospital = row.hospital || hospitalType || 'hope';
        const { error: entryError } = await supabase
          .from('daily_revenue_entries' as never)
          .insert([{
            entry_date: reportDate,
            visit_id: row.visitId,
            patient_name: row.patient_name,
            department: row.department || null,
            rm_name: row.rm_name || null,
            cost: row.cost,
            cut,
            hospital_type: rowHospital,
          } as never]);
        if (entryError) throw entryError;
      }
    },
    onSuccess: () => {
      invalidate();
      setEditingRateId(null);
      toast.success('RM percentage and this row’s cut saved');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: async (row: DisplayRow) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');

      if (row.overrideId) {
        const { error } = await supabase
          .from('daily_revenue_entries' as never)
          .update({ is_hidden: !row.isHidden, updated_at: new Date().toISOString() } as never)
          .eq('id', row.overrideId);
        if (error) throw error;
        return !row.isHidden;
      }

      if (!row.visitId) throw new Error('Only saved report rows can be hidden');

      // A zero-value override carries just the hidden flag. It intentionally
      // leaves the live cost and suggested cut unchanged when restored.
      const { error } = await supabase
        .from('daily_revenue_entries' as never)
        .insert([{
          entry_date: reportDate,
          visit_id: row.visitId,
          patient_name: row.patient_name,
          department: row.department || null,
          rm_name: row.rm_name || null,
          cost: 0,
          cut: 0,
          hospital_type: row.hospital || hospitalType || 'hope',
          is_hidden: true,
        } as never]);
      if (error) throw error;
      return true;
    },
    onSuccess: (isNowHidden) => {
      invalidate();
      toast.success(isNowHidden ? 'Patient hidden from this report' : 'Patient restored to this report');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (isApproved) return;

      // Do not use upsert here. Some existing deployments have the approval
      // table without its entry_date unique constraint reflected in PostgREST's
      // schema cache, which makes `on_conflict=entry_date` return HTTP 409.
      const { data: existing, error: existingError } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .select('entry_date')
        .eq('entry_date', reportDate)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return;

      const { error } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .insert({
          entry_date: reportDate,
          approved_at: new Date().toISOString(),
          approved_by_email: user?.email ?? null,
        } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingCutId(null);
      setEditingRateId(null);
      invalidate();
      toast.success('Report approved. Editing is now disabled.');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const openInlineEdit = (row: DisplayRow) => {
    if (isApproved) return;
    setEditingRateId(null);
    setEditingCutId(row.key);
    setDraftCost(String(row.cost));
    setDraftCut(String(row.cut));
    // Pre-select the current RM in the dropdown if one is in the master list.
    const match = (rmMasterQuery.data ?? []).find(
      (m) => m.name.toLowerCase() === (row.rm_name ?? '').toLowerCase(),
    );
    setDraftRmId(match?.id ?? '');
  };

  const openRateEdit = (row: DisplayRow) => {
    if (isApproved || !row.rmId || isDirect(row.rm_name)) return;
    setEditingCutId(null);
    setEditingRateId(row.key);
    setDraftRmPercent(String(row.rmPercent));
  };

  const openManualAdd = () => {
    if (isApproved) return;
    setManualEditId(null);
    setManualForm(initialManual);
    setIsManualDialogOpen(true);
  };

  const openManualEdit = (row: DisplayRow) => {
    if (isApproved) return;
    if (!row.overrideId) return;
    setManualEditId(row.overrideId);
    setManualForm({
      patient_name: row.patient_name,
      department: row.department,
      rm_name: row.rm_name,
      cost: String(row.cost),
      cut: String(row.cut),
      notes: '',
    });
    setIsManualDialogOpen(true);
  };

  const submitManual = () => {
    if (manualEditId) updateManualMutation.mutate(manualForm);
    else addManualMutation.mutate(manualForm);
  };

  // Open a clean printable view in a new window — strips sidebar, filters,
  // action icons, and renders only the daily revenue list in a ledger-style
  // layout. Auto-triggers print dialog, then closes the window.
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      toast.error('Pop-up blocked. Allow pop-ups for this site to print.');
      return;
    }
    const esc = (s: unknown): string =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const fmt = (n: number): string => n.toLocaleString('en-IN');
    const prettyDate = new Date(reportDate).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    // Bucket rows by hospital so each hospital prints on its own page.
    // Preserve first-seen hospital order from groupedRows for stable output.
    const hospitalOrder: string[] = [];
    const hospitalBuckets = new Map<string, DisplayRow[]>();
    groupedRows.forEach((group) => {
      group.rows.forEach((r) => {
        const key = (r.hospital || 'Unspecified').trim() || 'Unspecified';
        if (!hospitalBuckets.has(key)) {
          hospitalBuckets.set(key, []);
          hospitalOrder.push(key);
        }
        hospitalBuckets.get(key)!.push(r);
      });
    });

    const categoryOrder: ReadonlyArray<{ category: RowCategory; label: string }> = [
      { category: 'main', label: 'Main' },
      { category: 'direct', label: 'Direct' },
      { category: 'manual', label: 'Manual / Other' },
    ];

    // Each hospital gets its own theme — Hope (blue, ESIC-style) and
    // Ayushman (saffron/green, PMJAY-style) print with distinct identity
    // so the director can tell them apart at a glance.
    interface HospitalTheme {
      cssClass: string;
      displayName: string;
      tagline: string;
      schemeLine: string;
    }
    const themeFor = (name: string): HospitalTheme => {
      const lower = name.toLowerCase();
      if (lower.includes('ayushman')) {
        return {
          cssClass: 'theme-ayushman',
          displayName: 'AYUSHMAN HOSPITAL',
          tagline: 'Pradhan Mantri Jan Arogya Yojana (PM-JAY)',
          schemeLine: 'PMJAY · Ayushman Bharat Scheme',
        };
      }
      if (lower.includes('hope')) {
        return {
          cssClass: 'theme-hope',
          displayName: 'HOPE HOSPITAL',
          tagline: 'Employees State Insurance Corporation (ESIC)',
          schemeLine: 'ESIC · CGHS · Corporate Panel',
        };
      }
      return {
        cssClass: 'theme-default',
        displayName: name.toUpperCase(),
        tagline: '',
        schemeLine: '',
      };
    };

    const hospitalSectionsHtml = hospitalOrder.map((hospitalName, hospitalIdx) => {
      const hospitalRows = hospitalBuckets.get(hospitalName) ?? [];
      const hospitalTotals = hospitalRows.reduce(
        (acc, r) => ({ cost: acc.cost + r.cost, cut: acc.cut + r.cut }),
        { cost: 0, cut: 0 },
      );
      const theme = themeFor(hospitalName);
      let runningIdx = 0;
      const categoriesHtml = categoryOrder
        .map(({ category, label }) => {
          const catRows = hospitalRows.filter((r) => r.category === category);
          if (catRows.length === 0) return '';
          const subtotal = catRows.reduce(
            (acc, r) => ({ cost: acc.cost + r.cost, cut: acc.cut + r.cut }),
            { cost: 0, cut: 0 },
          );
          const rowsHtml = catRows.map((r) => {
            runningIdx += 1;
            const rmDisplay = isDirect(r.rm_name)
              ? '<span class="pill direct">Direct</span>'
              : esc(r.rm_name);
            const typeBadge =
              r.patient_type === 'OPD' ? '<span class="pill opd">OPD</span>' :
              r.patient_type === 'IPD' ? '<span class="pill ipd">IPD</span>' : '';
            return `
              <tr>
                <td class="num">${runningIdx}</td>
                <td>${esc(r.patient_name)} ${typeBadge}</td>
                <td>${esc(r.department || '—')}</td>
                <td>${rmDisplay}</td>
                <td class="right">${r.rmPercent}%</td>
                <td class="right">${fmt(r.cost)}</td>
                <td class="right">${fmt(r.cut)}</td>
              </tr>`;
          }).join('');
          return `
            <tr class="section">
              <td colspan="7">${esc(label)}</td>
            </tr>
            ${rowsHtml}
            <tr class="subtotal">
              <td colspan="5" class="right">${esc(label)} Sub-total</td>
              <td class="right">Rs ${fmt(subtotal.cost)}</td>
              <td class="right">Rs ${fmt(subtotal.cut)}</td>
            </tr>`;
        })
        .join('');

      return `
        <section class="hospital-page ${theme.cssClass}${hospitalIdx > 0 ? ' page-break' : ''}">
          <div class="hospital-banner">
            <div class="hospital-banner-left">
              <div class="hospital-name">${theme.displayName}</div>
              ${theme.tagline ? `<div class="hospital-tagline">${esc(theme.tagline)}</div>` : ''}
            </div>
            <div class="hospital-banner-right">
              <div class="hospital-date">${esc(prettyDate)}</div>
              ${theme.schemeLine ? `<div class="hospital-scheme">${esc(theme.schemeLine)}</div>` : ''}
              <div class="hospital-meta">Patients: ${hospitalRows.length}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Patient Name</th>
                <th>Department</th>
                <th>RM Manager</th>
                <th class="right">RM %</th>
                <th class="right">Cost (Rs)</th>
                <th class="right">Cut (Rs)</th>
              </tr>
            </thead>
            <tbody>
              ${categoriesHtml}
              <tr class="hospital-total">
                <td colspan="5" class="right">${theme.displayName} Total</td>
                <td class="right">Rs ${fmt(hospitalTotals.cost)}</td>
                <td class="right">Rs ${fmt(hospitalTotals.cut)}</td>
              </tr>
            </tbody>
          </table>
          <div class="hospital-footer">
            <span>${theme.displayName}</span>
            <span>Daily Revenue Report · ${esc(reportDate)}</span>
          </div>
        </section>`;
    }).join('');

    const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>Daily Revenue Report — ${esc(reportDate)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; text-align: center; letter-spacing: 0.3px; }
  .sub { text-align: center; color: #555; font-size: 13px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #f3f4f6; padding: 7px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #111; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  thead th.right, td.right { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { color: #666; width: 28px; }
  tr.section td { background: #ecfdf5; color: #047857; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding: 7px 8px; border-bottom: 1px solid #d1fae5; padding-top: 12px; }
  tr.subtotal td { background: #f9fafb; font-style: italic; font-size: 11px; color: #444; }
  tr.grand td { background: #111; color: #fff; font-weight: 700; padding: 10px 8px; font-size: 13px; }
  .pill { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; margin-left: 4px; }
  .pill.direct { background: #f3f4f6; color: #555; }
  .pill.opd { background: #d1fae5; color: #065f46; }
  .pill.ipd { background: #fed7aa; color: #9a3412; }
  .meta { display: flex; justify-content: space-between; margin: 12px 0 6px; font-size: 11px; color: #666; }
  .footer { margin-top: 24px; text-align: center; color: #888; font-size: 10px; border-top: 1px solid #ddd; padding-top: 10px; }
  .hospital-page { margin-bottom: 32px; }
  .hospital-banner { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 16px; margin-bottom: 10px; border-radius: 4px; }
  .hospital-banner-left { display: flex; flex-direction: column; gap: 2px; }
  .hospital-banner-right { text-align: right; display: flex; flex-direction: column; gap: 2px; }
  .hospital-name { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .hospital-tagline { font-size: 11px; font-style: italic; opacity: 0.85; }
  .hospital-date { font-size: 12px; font-weight: 600; }
  .hospital-scheme { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.85; }
  .hospital-meta { font-size: 11px; }
  .hospital-footer { display: flex; justify-content: space-between; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 10px; padding-top: 6px; border-top: 1px dashed #999; color: #555; }

  /* Hope Hospital theme — calm clinical blue (ESIC) */
  .theme-hope .hospital-banner { background: linear-gradient(90deg, #1e3a8a, #3b82f6); color: #fff; border-left: 6px solid #1e3a8a; }
  .theme-hope thead th { background: #dbeafe; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; }
  .theme-hope tr.section td { background: #eff6ff; color: #1e3a8a; border-bottom: 1px solid #bfdbfe; }
  .theme-hope tr.subtotal td { background: #f5f9ff; color: #1e3a8a; }
  .theme-hope tr.hospital-total td { background: #1e3a8a; color: #fff; font-weight: 700; padding: 10px 8px; font-size: 12px; }
  .theme-hope .hospital-footer { color: #1e3a8a; border-top-color: #93c5fd; }

  /* Ayushman Hospital theme — saffron / leaf-green (PM-JAY) */
  .theme-ayushman .hospital-banner { background: linear-gradient(90deg, #c2410c, #f97316); color: #fff; border-left: 6px solid #14532d; }
  .theme-ayushman thead th { background: #fed7aa; color: #7c2d12; border-bottom: 2px solid #c2410c; }
  .theme-ayushman tr.section td { background: #fff7ed; color: #7c2d12; border-bottom: 1px solid #fed7aa; }
  .theme-ayushman tr.subtotal td { background: #fffaf0; color: #7c2d12; }
  .theme-ayushman tr.hospital-total td { background: #14532d; color: #fff; font-weight: 700; padding: 10px 8px; font-size: 12px; }
  .theme-ayushman .hospital-footer { color: #14532d; border-top-color: #86efac; }

  /* Default fallback */
  .theme-default .hospital-banner { background: linear-gradient(90deg, #ecfdf5, #ffffff); color: #064e3b; border-left: 6px solid #047857; }
  .theme-default tr.hospital-total td { background: #064e3b; color: #fff; font-weight: 700; padding: 9px 8px; font-size: 12px; }
  tr.grand td { background: #111; color: #fff; font-weight: 700; padding: 10px 8px; font-size: 13px; }
  .grand-total { margin-top: 18px; }
  @page { size: A4; margin: 14mm; }
  @media print {
    body { margin: 0; }
    tr { page-break-inside: avoid; }
    tr.section { page-break-after: avoid; }
    .hospital-page.page-break { page-break-before: always; break-before: page; }
    .hospital-page { page-break-inside: avoid; }
    .grand-total { page-break-before: always; break-before: page; }
  }
</style>
</head><body>
  <h1>Daily Revenue Report — Patient List &amp; RM Cuts</h1>
  <div class="sub">${esc(prettyDate)}</div>
  <div class="meta">
    <div>Rows: ${rows.length}${onlyWithRm ? ' · RM-only' : ''}${patientTypeFilter !== 'all' ? ` · ${esc(patientTypeFilter)}` : ''}</div>
    <div>Cut rate: per RM</div>
  </div>
  ${hospitalSectionsHtml || '<div style="text-align:center;padding:24px;color:#888;">No entries for this date</div>'}
  ${hospitalOrder.length > 0 ? `
  <section class="grand-total">
    <table>
      <tbody>
        <tr class="grand">
          <td colspan="5" class="right" style="width:70%">Grand Total — All Hospitals</td>
          <td class="right">Rs ${fmt(totals.cost)}</td>
          <td class="right">Rs ${fmt(totals.cut)}</td>
        </tr>
      </tbody>
    </table>
  </section>` : ''}
  <div class="footer">Generated ${esc(new Date().toLocaleString('en-IN'))}</div>
</body></html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  };

  const isLoading = visitsQuery.isLoading || overridesQuery.isLoading || approvalQuery.isLoading;
  const error = visitsQuery.error ?? overridesQuery.error ?? approvalQuery.error;

  return (
    <Card id="daily-revenue-report" className="border-l-4 border-l-emerald-500">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-600" />
          <CardTitle>Daily Revenue Report — Patient List & RM Cuts</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs" role="group" aria-label="Filter by patient type">
            {(['all', 'OPD', 'IPD'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setPatientTypeFilter(opt)}
                className={`px-2 py-1 ${
                  patientTypeFilter === opt
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                } ${opt !== 'all' ? 'border-l border-gray-300' : ''}`}
                aria-pressed={patientTypeFilter === opt}
              >
                {opt === 'all' ? 'All' : opt}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithRm}
              onChange={(e) => setOnlyWithRm(e.target.checked)}
              className="h-4 w-4"
            />
            Only with RM
          </label>
          <label className="flex items-center gap-1 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="h-4 w-4"
            />
            Show hidden
          </label>
          <Label htmlFor="daily_report_date" className="text-sm">Date</Label>
          <Input
            id="daily_report_date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="w-44"
          />
          <Button variant="outline" size="sm" className="gap-2" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={openManualAdd} disabled={isApproved}>
            <Plus className="h-4 w-4" /> Add Manual
          </Button>
          {isApproved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Approved
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" role="status" aria-label="Loading daily revenue report" />
          </div>
        ) : error ? (
          <div className="bg-red-50 p-4 rounded text-red-700 text-sm">
            Failed to load report.
            <div className="text-xs mt-1 opacity-70">{getErrorMessage(error)}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
            <p>No visits on {new Date(reportDate).toLocaleDateString('en-IN')}.</p>
            <p className="text-sm">Use "Add Manual" for entries not in the visits system.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>RM Manager</TableHead>
                  <TableHead className="text-right">RM %</TableHead>
                  <TableHead className="text-right">Cost (Rs)</TableHead>
                  <TableHead className="text-right">Cut (Rs)</TableHead>
                  <TableHead className="text-right print:hidden">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  let runningIdx = 0;
                  return groupedRows.map((group) => (
                    <React.Fragment key={`group-${group.category}`}>
                      <TableRow key={`header-${group.category}`}>
                        <TableCell
                          colSpan={9}
                          className="bg-emerald-50 text-emerald-700 text-xs font-semibold uppercase tracking-wide"
                        >
                          {group.label}
                        </TableCell>
                      </TableRow>
                      {group.rows.map((r) => {
                        runningIdx += 1;
                        const idx = runningIdx;
                        const editing = editingCutId === r.key;
                        const editingRate = editingRateId === r.key;
                        return (
                          <TableRow key={r.key} className={`hover:bg-gray-50 ${r.isHidden ? 'bg-amber-50/70 opacity-75' : ''}`}>
                            <TableCell>{idx}</TableCell>
                            <TableCell className="font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                <span>{r.patient_name}</span>
                                {r.patient_type === 'OPD' && (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-green-100 text-green-700">OPD</span>
                                )}
                                {r.patient_type === 'IPD' && (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-orange-100 text-orange-700">IPD</span>
                                )}
                                {r.isManual && <span className="text-xs text-gray-500">(manual)</span>}
                                {r.isHidden && <span className="text-xs font-medium text-amber-700">(hidden)</span>}
                              </span>
                            </TableCell>
                            <TableCell>
                              {r.hospital ? (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium uppercase ${
                                    r.hospital.toLowerCase().includes('ayushman')
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {r.hospital}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>{r.department || '—'}</TableCell>
                            <TableCell>
                              {editing ? (
                                <select
                                  value={draftRmId}
                                  onChange={(e) => setDraftRmId(e.target.value)}
                                  className="h-8 w-40 border border-gray-300 rounded px-1 text-sm bg-white"
                                >
                                  <option value="">— Direct —</option>
                                  {(rmMasterQuery.data ?? []).map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}{m.code ? ` (${m.code})` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : isDirect(r.rm_name) ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium uppercase bg-gray-100 text-gray-700">
                                  Direct
                                </span>
                              ) : (
                                r.rm_name
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {editingRate ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    aria-label={`RM percentage for ${r.rm_name}`}
                                    value={draftRmPercent}
                                    onChange={(e) => setDraftRmPercent(e.target.value)}
                                    className="h-8 w-20 text-right"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Save RM percentage"
                                    disabled={isApproved || saveRmRateMutation.isPending}
                                    onClick={() => saveRmRateMutation.mutate(r)}
                                  >
                                    <Save className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Cancel RM percentage edit"
                                    disabled={saveRmRateMutation.isPending}
                                    onClick={() => setEditingRateId(null)}
                                  >
                                    <span className="text-xs">Cancel</span>
                                  </Button>
                                </div>
                              ) : isDirect(r.rm_name) ? (
                                <span>0%</span>
                              ) : r.rmId ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span>{r.rmPercent}%</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 print:hidden"
                                    aria-label={`Edit RM percentage for ${r.rm_name}`}
                                    onClick={() => openRateEdit(r)}
                                    disabled={isApproved}
                                    title={isApproved ? 'This approved report is locked' : 'Change this RM’s percentage and recalculate this row'}
                                  >
                                    <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                                  </Button>
                                </div>
                              ) : (
                                <span title="This row's RM is not in the RM master list">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {editing ? (
                                <Input
                                  type="number"
                                  min="0"
                                  value={draftCost}
                                  onChange={(e) => setDraftCost(e.target.value)}
                                  className="h-8 w-24 ml-auto text-right"
                                />
                              ) : (
                                <span className="inline-flex items-baseline gap-1 justify-end">
                                  <span>Rs {formatINR(r.cost)}</span>
                                  {r.cost_source !== 'none' && (
                                    <span
                                      className="text-[10px] uppercase tracking-wide text-gray-400 print:hidden"
                                      title={`Cost source: ${r.cost_source}`}
                                    >
                                      {COST_SOURCE_LABEL[r.cost_source]}
                                    </span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {editing ? (
                                <Input
                                  type="number"
                                  min="0"
                                  value={draftCut}
                                  onChange={(e) => setDraftCut(e.target.value)}
                                  className="h-8 w-24 ml-auto text-right"
                                />
                              ) : (
                                <span
                                  className={r.cutIsSuggested ? 'italic text-gray-500' : ''}
                                  title={r.cutIsSuggested ? `Suggested @ ${r.rmPercent}% — click edit to save the actual value` : undefined}
                                >
                                  Rs {formatINR(r.cut)}
                                  {r.cutIsSuggested && (
                                    <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-400 print:hidden">sug</span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right space-x-1 print:hidden">
                              {editing ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Save"
                                    disabled={isApproved || saveCutMutation.isPending}
                                    onClick={() => saveCutMutation.mutate(r)}
                                  >
                                    <Save className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button variant="ghost" size="sm" aria-label="Cancel" disabled={isApproved} onClick={() => setEditingCutId(null)}>
                                    <span className="text-xs">Cancel</span>
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button variant="ghost" size="sm" aria-label="View patient details" onClick={() => setDetailsRow(r)}>
                                    <Eye className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Edit cost/cut"
                                    onClick={() => openInlineEdit(r)}
                                    disabled={isApproved}
                                    title={isApproved ? 'This approved report is locked' : 'Edit cost/cut'}
                                  >
                                    <Edit2 className="h-4 w-4 text-blue-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={r.isHidden ? 'Restore patient' : 'Hide patient'}
                                    onClick={() => toggleHiddenMutation.mutate(r)}
                                    disabled={isApproved || toggleHiddenMutation.isPending}
                                    title={isApproved ? 'This approved report is locked' : r.isHidden ? 'Restore patient' : 'Hide patient'}
                                  >
                                    {r.isHidden ? <RotateCcw className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-amber-600" />}
                                  </Button>
                                  {r.isManual && r.overrideId && (
                                    <>
                                      <Button variant="ghost" size="sm" aria-label="Full edit" onClick={() => openManualEdit(r)} disabled={isApproved}>
                                        <span className="text-xs text-gray-600">Edit</span>
                                      </Button>
                                      <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => setDeleteId(r.overrideId!)} disabled={isApproved}>
                                        <Trash2 className="h-4 w-4 text-red-600" />
                                      </Button>
                                    </>
                                  )}
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow key={`subtotal-${group.category}`} className="bg-gray-50 italic">
                        <TableCell colSpan={6} className="text-right">
                          {group.label} Sub-total
                        </TableCell>
                        <TableCell className="text-right">Rs {formatINR(group.subtotal.cost)}</TableCell>
                        <TableCell className="text-right">Rs {formatINR(group.subtotal.cut)}</TableCell>
                        <TableCell className="print:hidden" />
                      </TableRow>
                    </React.Fragment>
                  ));
                })()}
                <TableRow className="bg-gray-100 font-bold border-t-2">
                  <TableCell colSpan={6} className="text-right">Grand Total</TableCell>
                  <TableCell className="text-right">Rs {formatINR(totals.cost)}</TableCell>
                  <TableCell className="text-right">Rs {formatINR(totals.cut)}</TableCell>
                  <TableCell className="print:hidden text-right">
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate()}
                      disabled={isApproved || approveMutation.isPending}
                      className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {isApproved ? 'Approved' : approveMutation.isPending ? 'Approving...' : 'Approve'}
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-gray-500 mt-3 print:hidden">
              Visits pulled live from the system for the selected date. Cost is auto-filled from:
              advance payment <span className="text-gray-400">(adv)</span> →
              final payment <span className="text-gray-400">(final)</span> →
              visit package <span className="text-gray-400">(pkg)</span>. Cut is auto-suggested using the assigned RM's saved percentage
              <span className="text-gray-400"> (sug)</span> — use the RM % edit icon to change that RM's rate and recalculate this row, or the cost/cut edit icon to save this row
              <span className="text-gray-400"> (man)</span>. Saved values persist on every refresh.
            </p>
          </div>
        )}
      </CardContent>

      {/* Manual Add/Edit Dialog */}
      <Dialog open={isManualDialogOpen} onOpenChange={(open) => { if (!open) { setIsManualDialogOpen(false); setManualEditId(null); setManualForm(initialManual); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{manualEditId ? 'Edit Manual Entry' : 'Add Manual Entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="m_patient_name">Patient Name *</Label>
              <Input id="m_patient_name" value={manualForm.patient_name} maxLength={150}
                onChange={(e) => setManualForm({ ...manualForm, patient_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m_department">Department</Label>
                <Input id="m_department" placeholder="ENT, Derma, Gastro..." value={manualForm.department} maxLength={50}
                  onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="m_rm">RM Manager</Label>
                <Input id="m_rm" placeholder="Lakesh, AB, VBR..." value={manualForm.rm_name} maxLength={100}
                  onChange={(e) => setManualForm({ ...manualForm, rm_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m_cost">Cost (₹)</Label>
                <Input id="m_cost" type="number" min="0" step="0.01" value={manualForm.cost}
                  onChange={(e) => setManualForm({ ...manualForm, cost: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="m_cut">Cut (₹)</Label>
                <Input id="m_cut" type="number" min="0" step="0.01" value={manualForm.cut}
                  onChange={(e) => setManualForm({ ...manualForm, cut: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="m_notes">Notes (Optional)</Label>
              <Input id="m_notes" value={manualForm.notes} maxLength={500}
                onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsManualDialogOpen(false); setManualEditId(null); setManualForm(initialManual); }}>Cancel</Button>
            <Button onClick={submitManual} disabled={addManualMutation.isPending || updateManualMutation.isPending}>
              {manualEditId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient details dialog */}
      <PatientDetailsDialog
        row={detailsRow}
        reportDate={reportDate}
        onClose={() => setDetailsRow(null)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface PatientDetailsDialogProps {
  row: DisplayRow | null;
  reportDate: string;
  onClose: () => void;
}

interface FullPatientInfo {
  patient: Record<string, unknown> | null;
  visit: Record<string, unknown> | null;
  advances: Array<Record<string, unknown>>;
  finals: Array<Record<string, unknown>>;
}

function PatientDetailsDialog({ row, reportDate, onClose }: PatientDetailsDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['patientDetailsDialog', row?.visitId, row?.overrideId],
    queryFn: async (): Promise<FullPatientInfo> => {
      const result: FullPatientInfo = { patient: null, visit: null, advances: [], finals: [] };
      if (!row?.visitId) return result;

      const { data: v } = await supabase
        .from('visits')
        .select('id, visit_id, visit_date, appointment_with, package_amount, patient_type, status, billing_executive, admission_date, discharge_date, claim_id, reason_for_visit, patient_id')
        .eq('id', row.visitId)
        .maybeSingle();
      if (v) {
        result.visit = v as Record<string, unknown>;
        const patientId = (v as { patient_id?: string }).patient_id;
        if (patientId) {
          const { data: p } = await supabase
            .from('patients')
            .select('id, name, patients_id, age, gender, date_of_birth, phone, email, address, city_town, state, hospital_name, relationship_manager, corporate, insurance_person_no, blood_group, emergency_contact_name, emergency_contact_mobile')
            .eq('id', patientId)
            .maybeSingle();
          if (p) result.patient = p as Record<string, unknown>;
        }
        const visitIdText = (v as { visit_id?: string }).visit_id;
        if (visitIdText) {
          const [adv, fin] = await Promise.all([
            supabase.from('advance_payment' as never).select('*').eq('visit_id', visitIdText),
            supabase.from('final_payments' as never).select('*').eq('visit_id', visitIdText),
          ]);
          result.advances = (adv.data ?? []) as Array<Record<string, unknown>>;
          result.finals = (fin.data ?? []) as Array<Record<string, unknown>>;
        }
      }
      return result;
    },
    enabled: !!row,
  });

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  const fmtMoney = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (isNaN(n)) return '—';
    return `Rs ${n.toLocaleString('en-IN')}`;
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Patient Details — {row?.patient_name ?? ''}</DialogTitle>
        </DialogHeader>

        {!row ? null : isLoading ? (
          <div className="py-8 text-center text-gray-500">Loading patient details...</div>
        ) : (
          <div className="space-y-6 text-sm">
            {/* Summary (from the row) */}
            <section>
              <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Report Summary</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div><dt className="inline text-gray-500">Date: </dt><dd className="inline">{new Date(reportDate).toLocaleDateString('en-IN')}</dd></div>
                <div><dt className="inline text-gray-500">Hospital: </dt><dd className="inline">{row.hospital || '—'}</dd></div>
                <div><dt className="inline text-gray-500">Department: </dt><dd className="inline">{row.department || '—'}</dd></div>
                <div><dt className="inline text-gray-500">RM Manager: </dt><dd className="inline">{row.rm_name || '—'}</dd></div>
                <div><dt className="inline text-gray-500">Cost: </dt><dd className="inline font-medium">Rs {row.cost.toLocaleString('en-IN')}</dd></div>
                <div><dt className="inline text-gray-500">Cut: </dt><dd className="inline font-medium">Rs {row.cut.toLocaleString('en-IN')}{row.cutIsSuggested && <span className="ml-1 text-xs text-gray-400">(suggested)</span>}</dd></div>
                <div><dt className="inline text-gray-500">Cost source: </dt><dd className="inline">{COST_SOURCE_LABEL[row.cost_source] || '—'}</dd></div>
                <div><dt className="inline text-gray-500">Entry type: </dt><dd className="inline">{row.isManual ? 'Manual' : 'From visits'}</dd></div>
              </dl>
            </section>

            {/* Patient master */}
            {data?.patient && (
              <section>
                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Patient Master</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div><dt className="inline text-gray-500">UHID: </dt><dd className="inline">{fmt(data.patient.patients_id)}</dd></div>
                  <div><dt className="inline text-gray-500">Name: </dt><dd className="inline">{fmt(data.patient.name)}</dd></div>
                  <div><dt className="inline text-gray-500">Age: </dt><dd className="inline">{fmt(data.patient.age)}</dd></div>
                  <div><dt className="inline text-gray-500">Gender: </dt><dd className="inline">{fmt(data.patient.gender)}</dd></div>
                  <div><dt className="inline text-gray-500">Phone: </dt><dd className="inline">{fmt(data.patient.phone)}</dd></div>
                  <div><dt className="inline text-gray-500">Blood Group: </dt><dd className="inline">{fmt(data.patient.blood_group)}</dd></div>
                  <div className="col-span-2"><dt className="inline text-gray-500">Address: </dt><dd className="inline">{fmt(data.patient.address)}{data.patient.city_town ? `, ${fmt(data.patient.city_town)}` : ''}{data.patient.state ? `, ${fmt(data.patient.state)}` : ''}</dd></div>
                  <div><dt className="inline text-gray-500">Hospital: </dt><dd className="inline">{fmt(data.patient.hospital_name)}</dd></div>
                  <div><dt className="inline text-gray-500">RM (patient master): </dt><dd className="inline">{fmt(data.patient.relationship_manager)}</dd></div>
                  <div><dt className="inline text-gray-500">Corporate: </dt><dd className="inline">{fmt(data.patient.corporate)}</dd></div>
                  <div><dt className="inline text-gray-500">Insurance #: </dt><dd className="inline">{fmt(data.patient.insurance_person_no)}</dd></div>
                  <div><dt className="inline text-gray-500">Emergency: </dt><dd className="inline">{fmt(data.patient.emergency_contact_name)} {data.patient.emergency_contact_mobile ? `(${fmt(data.patient.emergency_contact_mobile)})` : ''}</dd></div>
                </dl>
              </section>
            )}

            {/* Visit info */}
            {data?.visit && (
              <section>
                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Visit</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div><dt className="inline text-gray-500">Visit ID: </dt><dd className="inline font-mono">{fmt(data.visit.visit_id)}</dd></div>
                  <div><dt className="inline text-gray-500">Visit Date: </dt><dd className="inline">{fmt(data.visit.visit_date)}</dd></div>
                  <div><dt className="inline text-gray-500">Type: </dt><dd className="inline">{fmt(data.visit.patient_type)}</dd></div>
                  <div><dt className="inline text-gray-500">Status: </dt><dd className="inline">{fmt(data.visit.status)}</dd></div>
                  <div><dt className="inline text-gray-500">Doctor / Dept: </dt><dd className="inline">{fmt(data.visit.appointment_with)}</dd></div>
                  <div><dt className="inline text-gray-500">Billing Executive: </dt><dd className="inline">{fmt(data.visit.billing_executive)}</dd></div>
                  <div><dt className="inline text-gray-500">Admission: </dt><dd className="inline">{fmt(data.visit.admission_date)}</dd></div>
                  <div><dt className="inline text-gray-500">Discharge: </dt><dd className="inline">{fmt(data.visit.discharge_date)}</dd></div>
                  <div><dt className="inline text-gray-500">Claim ID: </dt><dd className="inline">{fmt(data.visit.claim_id)}</dd></div>
                  <div><dt className="inline text-gray-500">Package Amt: </dt><dd className="inline">{fmtMoney(data.visit.package_amount)}</dd></div>
                  {data.visit.reason_for_visit ? (
                    <div className="col-span-2"><dt className="inline text-gray-500">Reason: </dt><dd className="inline">{fmt(data.visit.reason_for_visit)}</dd></div>
                  ) : null}
                </dl>
              </section>
            )}

            {/* Advance payments */}
            {data?.advances && data.advances.length > 0 && (
              <section>
                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Advance Payments ({data.advances.length})</h3>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-1">Date</th>
                      <th className="text-left p-1">Mode</th>
                      <th className="text-right p-1">Amount</th>
                      <th className="text-right p-1">Returned</th>
                      <th className="text-left p-1">Status</th>
                      <th className="text-left p-1">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.advances.map((a, i) => (
                      <tr key={String(a.id ?? i)} className="border-t">
                        <td className="p-1">{fmt(a.payment_date)}</td>
                        <td className="p-1">{fmt(a.payment_mode)}</td>
                        <td className="p-1 text-right">{fmtMoney(a.advance_amount)}</td>
                        <td className="p-1 text-right">{fmtMoney(a.returned_amount)}</td>
                        <td className="p-1">{fmt(a.status)}</td>
                        <td className="p-1">{fmt(a.reference_number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Final payments */}
            {data?.finals && data.finals.length > 0 && (
              <section>
                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Final Payments ({data.finals.length})</h3>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-1">Mode</th>
                      <th className="text-right p-1">Amount</th>
                      <th className="text-left p-1">Reason</th>
                      <th className="text-left p-1">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.finals.map((f, i) => (
                      <tr key={String(f.id ?? i)} className="border-t">
                        <td className="p-1">{fmt(f.mode_of_payment)}</td>
                        <td className="p-1 text-right">{fmtMoney(f.amount)}</td>
                        <td className="p-1">{fmt(f.reason_of_discharge)}</td>
                        <td className="p-1">{fmt(f.payment_remark)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {row.isManual && (
              <section className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800 text-xs">
                This is a manual entry not linked to any visit in the system. The patient master and visit sections are not available.
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DailyRevenueReportSection;
