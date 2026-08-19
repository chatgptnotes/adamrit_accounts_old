import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Banknote, Camera, CheckCircle2, Edit2, Eye, EyeOff, FileCheck2, Loader2, Lock, Paperclip, Plus, Printer, RotateCcw, Trash2, Users, Save } from 'lucide-react';
import { LedgerAutocomplete, type LedgerAccountOption } from '@/components/accounting/LedgerAutocomplete';
import { approveReferralRow } from '@/lib/referral-invoice-service';
import { PayReferralBillDialog } from '@/components/PayReferralBillDialog';
import { useMarketingLiaisonNames } from '@/lib/marketingLiaisons';

interface VisitRow {
  id: string;
  visit_id: string;
  visit_date: string;
  discharge_date: string | null;
  appointment_with: string | null;
  package_amount: string | null;
  patient_type: string | null;
  created_at: string;
  patients: { id: string; name: string; hospital_name: string | null; relationship_manager: string | null } | null;
  relationship_managers: { id: string; name: string; code: string | null; commission_percent: number | null; ledger_account_id: string | null } | null;
  visit_relationship_managers?: Array<{ position: number; relationship_managers: { id: string; name: string; code: string | null; commission_percent: number | null; ledger_account_id: string | null } | null }>;
}

interface RmAllocation {
  id: string;
  name: string;
  ledgerId: string | null;
  amount: number;
  position: number;
  approvalId?: string | null;
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
  /**
   * An amount taken off the bill before the RM cut is worked out — an
   * expensive investigation, typically. `deduction_applied` is the switch:
   * an ignored deduction keeps its figure and reason on the row without
   * changing the cut.
   */
  deduction: number | null;
  deduction_reason: string | null;
  deduction_applied: boolean | null;
  created_at: string;
  updated_at: string;
  // The manager's creditor ledger, chosen on this report. Older rows have none
  // and fall back to matching rm_name against the master.
  rm_ledger_account_id: string | null;
  // Set once this cut has been raised for payment. A stamped row is paid and
  // locked; it is what stops the same cut being paid twice.
  approval_id: string | null;
  // Set when the per-row Approve has raised the M.L. Enterprises invoice.
  expense_bill_id: string | null;
}

/**
 * The handwritten calculation sheet Azhar uploads (or snaps) against a row
 * before it is approved. Sheets are per row per report date.
 */
function CalcSheetCell({ rowKey, reportDate, uploadedBy }: {
  rowKey: string;
  reportDate: string;
  uploadedBy: string | null;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { data: sheets = [] } = useQuery({
    queryKey: ['revenue-calc-sheets', reportDate, rowKey],
    queryFn: async (): Promise<{ id: string; url: string }[]> => {
      const { data, error } = await (supabase as any)
        .from('revenue_calc_sheets')
        .select('id, url')
        .eq('report_date', reportDate)
        .eq('row_key', rowKey)
        .order('created_at');
      if (error) return [];
      return (data || []) as { id: string; url: string }[];
    },
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: max 12 MB`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `revenue-calc-sheets/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
        const { error: upErr } = await supabase.storage.from('uploads').upload(path, file, {
          contentType: file.type || 'application/octet-stream',
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('uploads').getPublicUrl(path);
        const { error: insErr } = await (supabase as any).from('revenue_calc_sheets').insert({
          row_key: rowKey,
          report_date: reportDate,
          url: pub.publicUrl,
          path,
          uploaded_by: uploadedBy,
        });
        if (insErr) throw new Error(insErr.message);
      }
      toast.success('Calculation sheet uploaded.');
      queryClient.invalidateQueries({ queryKey: ['revenue-calc-sheets', reportDate, rowKey] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <span className="mb-1 flex items-center gap-1 print:hidden">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[11px]"
        disabled={busy}
        title="Snap / upload the calculated sheet before approving"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        Sheet
      </Button>
      {sheets.map((sheet, index) => (
        <a
          key={sheet.id}
          href={sheet.url}
          target="_blank"
          rel="noreferrer"
          title={`Calculation sheet ${index + 1}`}
          className="text-blue-600"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </a>
      ))}
      {sheets.length === 0 && (
        <span className="text-[10px] text-amber-600" title="No calculated sheet uploaded yet">
          no sheet
        </span>
      )}
    </span>
  );
}

/** What became of a cut that has been raised for payment. */
interface ApprovalState {
  id: string;
  status: string;
  isPaid: boolean;
  jvVoucherNumber: string | null;
  paymentVoucherNumber: string | null;
}

type CostSource = 'bill' | 'bill_prep' | 'visit_charges' | 'override' | 'advance' | 'final_pay' | 'package' | 'none';

type RowCategory = 'main' | 'direct' | 'manual';

interface DisplayRow {
  key: string;
  visitId: string | null;
  overrideId: string | null;
  /**
   * The day this row belongs to — its discharge or visit date, or the entry
   * date it was already saved under. Over a date range each row must be filed
   * on its own day, not on whatever day the report happens to end on.
   */
  entryDate: string;
  patient_name: string;
  department: string;
  rm_name: string;
  hospital: string;
  patient_type: string; // 'OPD' | 'IPD' | '' (manual entries / unknown)
  rmId: string | null;
  rmPercent: number;
  cost: number;
  /** Taken off the bill before the cut is worked out, when applied. */
  deduction: number;
  deductionReason: string;
  deductionApplied: boolean;
  /** cost − deduction when applied; what rmPercent is actually charged on. */
  cutBase: number;
  cut: number;
  cutIsSuggested: boolean; // true when cut was computed from the RM's saved %, not saved
  cost_source: CostSource;
  isManual: boolean;
  isHidden: boolean;
  category: RowCategory;
  /** Ledger this row's cut is payable to, or null when there is none to pay. */
  rmLedgerId: string | null;
  /** Non-null once the cut has been raised and paid (legacy pay-immediately flow). */
  approvalId: string | null;
  /** Non-null once the per-row Approve raised its M.L. Enterprises invoice. */
  expenseBillId: string | null;
  rms: RmAllocation[];
}

type PatientTypeFilter = 'all' | 'OPD' | 'IPD';

const COST_SOURCE_LABEL: Record<CostSource, string> = {
  bill: 'bill',
  bill_prep: 'bill',
  visit_charges: 'opd',
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
  /** The manager is picked as a real ledger, so the row can be paid. */
  rm_ledger: LedgerAccountOption | null;
  cost: string;
  cut: string;
  notes: string;
}

interface ManualPatientSearchResult {
  patientId: string;
  patientName: string;
  visitId: string;
}

const initialManual: ManualFormData = {
  patient_name: '',
  department: '',
  rm_name: '',
  rm_ledger: null,
  cost: '',
  cut: '',
  notes: '',
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
};

// IST, not UTC: before 05:30 IST a UTC date is still on yesterday, which would
// hand the report the wrong "today" every morning.
const todayIso = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** Which visits column decides that a patient belongs on the report. */
type DateBasis = 'visit' | 'discharge';

// Both visit_date and discharge_date are plain DATE columns. Comparing them
// against an IST-bounded timestamp does not narrow the day — Postgres casts
// the timestamp back down to its UTC date, which silently drags in the
// previous day. Plain YYYY-MM-DD on both sides is what actually works.
const asDay = (value: string | null | undefined): string => (value ? value.slice(0, 10) : '');

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

export function DailyRevenueReportSection({
  defaultPatientType = 'OPD',
  title = 'Daily Revenue Report — Patient List & RM Cuts',
  dateBasis = 'visit',
  rangeDays = 0,
  enablePay = false,
}: {
  /** Which patient list this section opens on — the Director Dashboard mounts one OPD and one IPD copy. */
  defaultPatientType?: PatientTypeFilter;
  title?: string;
  /**
   * Which date decides that a patient belongs on this report. The Director's
   * copies list the day's registrations; Azhar's tile lists discharges, which
   * is when the cut is actually settled.
   */
  dateBasis?: DateBasis;
  /** 0 keeps the single-day picker. Any other value opens on that many days ending today. */
  rangeDays?: number;
  /** Show a Pay button on invoiced rows instead of sending the user to the Expense Bill page. */
  enablePay?: boolean;
} = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isRangeReport = rangeDays > 0;
  const [fromDate, setFromDate] = useState<string>(
    isRangeReport ? isoDaysAgo(rangeDays - 1) : todayIso(),
  );
  const [toDate, setToDate] = useState<string>(todayIso());
  const [payingRow, setPayingRow] = useState<DisplayRow | null>(null);
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [draftCut, setDraftCut] = useState<string>('');
  const [draftCost, setDraftCost] = useState<string>('');
  const [draftRmIds, setDraftRmIds] = useState<string[]>([]);
  const [draftRmPercent, setDraftRmPercent] = useState<string>('');
  const [editingDeductionId, setEditingDeductionId] = useState<string | null>(null);
  const [draftDeduction, setDraftDeduction] = useState<string>('');
  const [draftDeductionReason, setDraftDeductionReason] = useState<string>('');
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [isLockConfirmOpen, setIsLockConfirmOpen] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualFormData>(initialManual);
  const [selectedManualPatientId, setSelectedManualPatientId] = useState<string | null>(null);
  const [isManualPatientDropdownOpen, setIsManualPatientDropdownOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [detailsRow, setDetailsRow] = useState<DisplayRow | null>(null);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  // Off by default: the report opens showing every patient of the day. Narrowing
  // to RM-bearing rows is the reader's choice to make, not something done for them.
  const [onlyWithRm, setOnlyWithRm] = useState<boolean>(false);
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [patientTypeFilter, setPatientTypeFilter] = useState<PatientTypeFilter>(defaultPatientType);

  const hospitalType = user?.hospitalType ?? '';
  const [debouncedManualPatientSearch] = useDebounce(manualForm.patient_name, 300);
  // Remove PostgREST filter delimiters before using the search term in ilike.
  const safeManualPatientSearch = debouncedManualPatientSearch.replace(/[%,()]/g, ' ').trim();

  // This picker deliberately searches only after the user starts typing. It
  // queries visits (rather than loading the patient master) so every result
  // can show the Visit ID requested by the Director.
  const manualPatientSearchQuery = useQuery({
    queryKey: ['dailyRevenueManualPatientSearch', safeManualPatientSearch],
    enabled: isManualDialogOpen && !manualEditId && safeManualPatientSearch.length >= 2,
    queryFn: async (): Promise<ManualPatientSearchResult[]> => {
      const { data, error } = await supabase
        .from('visits')
        .select('visit_id, created_at, patients!inner(id, name)')
        .ilike('patients.name', `%${safeManualPatientSearch}%`)
        .order('created_at', { ascending: false })
        // A small over-fetch lets us de-duplicate patients with several visits
        // while keeping the visible result list capped at ten.
        .limit(30)
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw error;

      const uniquePatients = new Map<string, ManualPatientSearchResult>();
      for (const visit of (data ?? []) as unknown as Array<{
        visit_id: string | null;
        patients: { id: string; name: string } | null;
      }>) {
        if (!visit.patients || !visit.visit_id || uniquePatients.has(visit.patients.id)) continue;
        uniquePatients.set(visit.patients.id, {
          patientId: visit.patients.id,
          patientName: visit.patients.name,
          visitId: visit.visit_id,
        });
        if (uniquePatients.size === 10) break;
      }
      return [...uniquePatients.values()];
    },
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  // Director sees patients from BOTH hospitals on one screen — no hospital_name filter.
  const visitsQuery = useQuery({
    queryKey: ['dailyRevenueVisits', dateBasis, fromDate, toDate],
    queryFn: async (): Promise<VisitRow[]> => {
      const query = supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          visit_date,
          discharge_date,
          appointment_with,
          package_amount,
          patient_type,
          created_at,
          patients!inner ( id, name, hospital_name, relationship_manager ),
          relationship_managers!visits_relationship_manager_id_fkey ( id, name, code, commission_percent, ledger_account_id )
          , visit_relationship_managers (
              position,
              relationship_managers ( id, name, code, commission_percent, ledger_account_id )
            )
        `);
      // A bounded range on discharge_date is deliberate: the column carries
      // junk far-future values (5202-07-28), which an open-ended filter would
      // pull onto the report.
      const column = dateBasis === 'discharge' ? 'discharge_date' : 'visit_date';
      const { data, error } = await query
        .gte(column, fromDate)
        .lte(column, toDate)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  // Billing tables use the printed visit code while daily_revenue_entries uses
  // the visit UUID. Keep both keys available so every registered OPD and IPD
  // patient resolves their own bill, rather than a payment or saved RM amount.
  const visitIds: string[] = useMemo(
    () => (visitsQuery.data ?? []).map((v) => v.visit_id).filter(Boolean),
    [visitsQuery.data],
  );
  const billVisitKeys: string[] = useMemo(
    () => Array.from(new Set(
      (visitsQuery.data ?? []).flatMap((v) => [v.id, v.visit_id]).filter(Boolean),
    )),
    [visitsQuery.data],
  );
  // The visit_* charge tables key on the UUID alone, never the printed code.
  const visitUuids: string[] = useMemo(
    () => (visitsQuery.data ?? []).map((v) => v.id).filter(Boolean),
    [visitsQuery.data],
  );

  // RM master list — used by the inline RM picker on each row.
  const rmMasterQuery = useQuery({
    queryKey: ['dailyRevenueRmMaster'],
    queryFn: async (): Promise<Array<{ id: string; name: string; code: string | null; short_code: string | null; commission_percent: number | null; ledger_account_id: string | null; liaison_user_id: string | null }>> => {
      const { data, error } = await supabase
        .from('relationship_managers' as never)
        .select('id, name, code, short_code, commission_percent, ledger_account_id, liaison_user_id')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; name: string; code: string | null; short_code: string | null; commission_percent: number | null; ledger_account_id: string | null; liaison_user_id: string | null }>;
    },
    staleTime: 5 * 60 * 1000, // 5 min — master list rarely changes
  });

  // Who on the marketing side liaisons each RM. Resolved by RM id where the
  // row has one, and by name otherwise — a manual row carries only the typed
  // name, and that is exactly the row someone rings up about.
  const liaisonNames = useMarketingLiaisonNames();
  const liaisonByRmId = useMemo(() => {
    const map = new Map<string, string>();
    for (const manager of rmMasterQuery.data ?? []) {
      const name = manager.liaison_user_id ? liaisonNames[manager.liaison_user_id] : null;
      if (name) map.set(manager.id, name);
    }
    return map;
  }, [rmMasterQuery.data, liaisonNames]);
  const liaisonByRmName = useMemo(() => {
    const map = new Map<string, string>();
    for (const manager of rmMasterQuery.data ?? []) {
      const name = manager.liaison_user_id ? liaisonNames[manager.liaison_user_id] : null;
      if (name) map.set(manager.name.trim().toLowerCase(), name);
    }
    return map;
  }, [rmMasterQuery.data, liaisonNames]);

  // The short code the report shows in place of an RM's name. Resolved by id
  // where the row has one and by name otherwise, the same way the liaison is.
  const shortCodeByRmId = useMemo(() => {
    const map = new Map<string, string>();
    for (const manager of rmMasterQuery.data ?? []) {
      if (manager.short_code) map.set(manager.id, manager.short_code);
    }
    return map;
  }, [rmMasterQuery.data]);
  const shortCodeByRmName = useMemo(() => {
    const map = new Map<string, string>();
    for (const manager of rmMasterQuery.data ?? []) {
      if (manager.short_code) map.set(manager.name.trim().toLowerCase(), manager.short_code);
    }
    return map;
  }, [rmMasterQuery.data]);

  /** An RM's short code, falling back to their name while none is set. */
  const rmDisplay = (manager: { id?: string; name: string }) =>
    (manager.id && shortCodeByRmId.get(manager.id))
    || shortCodeByRmName.get((manager.name || '').trim().toLowerCase())
    || manager.name;

  /** The liaison(s) behind a row's RMs, deduped — a row can carry three RMs. */
  const liaisonsForRow = (row: { rms: RmAllocation[]; rmId: string | null; rm_name: string }) => {
    const managers = row.rms.length
      ? row.rms
      : [{ id: row.rmId || '', name: row.rm_name } as RmAllocation];
    const names = new Set<string>();
    for (const manager of managers) {
      const hit =
        (manager.id && liaisonByRmId.get(manager.id)) ||
        liaisonByRmName.get((manager.name || '').trim().toLowerCase());
      if (hit) names.add(hit);
    }
    return [...names].join(', ');
  };

  // A patient's billed amount is the authoritative RM-cut base. Bills can be
  // linked by either visit UUID or printed visit ID, depending on the screen
  // that created them. Ignore draft/empty (zero) rows and retain the most
  // recently updated usable bill for each key.
  const billsQuery = useQuery({
    queryKey: ['dailyRevenueBills', billVisitKeys.join(',')],
    queryFn: async (): Promise<Record<string, number>> => {
      if (billVisitKeys.length === 0) return {};
      const { data, error } = await supabase
        .from('bills')
        .select('visit_id, total_amount, updated_at')
        .in('visit_id', billVisitKeys)
        .order('updated_at', { ascending: false });
      if (error) throw error;

      const amounts: Record<string, number> = {};
      for (const bill of data ?? []) {
        const visitKey = bill.visit_id;
        const amount = toNumber(bill.total_amount);
        if (visitKey && amount > 0 && amounts[visitKey] === undefined) amounts[visitKey] = amount;
      }
      return amounts;
    },
    enabled: billVisitKeys.length > 0,
  });

  // Submitted corporate/Yojana bills live in bill_preparation. It is still a
  // bill-level source and covers visits where the general bills total has not
  // yet been populated.
  const billPreparationQuery = useQuery({
    queryKey: ['dailyRevenueBillPreparation', visitIds.join(',')],
    queryFn: async (): Promise<Record<string, number>> => {
      if (visitIds.length === 0) return {};
      const { data, error } = await supabase
        .from('bill_preparation')
        .select('visit_id, bill_amount')
        .in('visit_id', visitIds);
      if (error) throw error;

      const amounts: Record<string, number> = {};
      for (const bill of data ?? []) {
        const amount = toNumber(bill.bill_amount);
        if (bill.visit_id && amount > 0) amounts[bill.visit_id] = amount;
      }
      return amounts;
    },
    enabled: visitIds.length > 0,
  });

  // An OPD visit never produces a bills row -- the Final Bill save is the only
  // thing that writes one, and OPD patients are billed on the Invoice screen,
  // which adds the charges up on screen and stores nothing. So both bill
  // lookups above miss for every one of them, and the cut used to fall through
  // to whatever cost had been typed by hand. v_visit_charge_totals is the same
  // arithmetic the invoice prints, keyed on the visit UUID.
  const visitChargesQuery = useQuery({
    queryKey: ['dailyRevenueVisitCharges', visitUuids.join(',')],
    queryFn: async (): Promise<Record<string, number>> => {
      if (visitUuids.length === 0) return {};
      const { data, error } = await (supabase as any)
        .from('v_visit_charge_totals')
        .select('visit_id, charge_total')
        .in('visit_id', visitUuids);
      // Degrade honestly rather than block the report: until the migration is
      // applied the view does not exist, and every other cost source still works.
      if (error) {
        console.warn('[daily-revenue] visit charge totals unavailable', error.message);
        return {};
      }

      const amounts: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ visit_id: string; charge_total: number | string | null }>) {
        const amount = toNumber(row.charge_total);
        if (row.visit_id && amount > 0) amounts[row.visit_id] = amount;
      }
      return amounts;
    },
    enabled: visitUuids.length > 0,
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
    queryKey: ['dailyRevenueOverrides', fromDate, toDate],
    queryFn: async (): Promise<OverrideRow[]> => {
      const { data, error } = await supabase
        .from('daily_revenue_entries' as never)
        .select('*')
        .gte('entry_date', fromDate)
        .lte('entry_date', toDate)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OverrideRow[];
    },
  });

  const overrideIds = (overridesQuery.data ?? []).map((row) => row.id);
  const allocationsQuery = useQuery({
    queryKey: ['dailyRevenueRmAllocations', overrideIds.join(',')],
    enabled: overrideIds.length > 0,
    queryFn: async (): Promise<Array<{ revenue_entry_id: string; relationship_manager_id: string | null; position: number; rm_name: string; rm_ledger_account_id: string | null; allocated_cut: number; approval_id: string | null }>> => {
      const { data, error } = await (supabase as any).from('daily_revenue_rm_allocations')
        .select('revenue_entry_id, relationship_manager_id, position, rm_name, rm_ledger_account_id, allocated_cut, approval_id')
        .in('revenue_entry_id', overrideIds).order('position');
      if (error) throw error;
      return data ?? [];
    },
  });

  // What was posted for the cuts already raised, so a paid row can name its
  // vouchers rather than just claiming to be paid.
  const approvalIds: string[] = useMemo(
    () => Array.from(new Set(
      [
        ...(overridesQuery.data ?? []).map((o) => o.approval_id),
        ...(allocationsQuery.data ?? []).map((allocation) => allocation.approval_id),
      ].filter(Boolean) as string[],
    )),
    [overridesQuery.data, allocationsQuery.data],
  );

  const paymentStateQuery = useQuery({
    queryKey: ['dailyRevenuePayments', approvalIds.join(',')],
    enabled: approvalIds.length > 0,
    queryFn: async (): Promise<Record<string, ApprovalState>> => {
      const { data, error } = await (supabase as any)
        .from('approval_queue')
        .select('id, status, is_paid, jv_voucher_id, payment_voucher_id')
        .in('id', approvalIds);
      if (error) throw error;
      const approvals = (data ?? []) as Array<{
        id: string; status: string; is_paid: boolean;
        jv_voucher_id: string | null; payment_voucher_id: string | null;
      }>;

      const voucherIds = approvals
        .flatMap((a) => [a.jv_voucher_id, a.payment_voucher_id])
        .filter(Boolean) as string[];
      const { data: vouchers } = voucherIds.length
        ? await (supabase as any).from('vouchers').select('id, voucher_number').in('id', voucherIds)
        : { data: [] };
      const numberById = new Map<string, string>(
        ((vouchers ?? []) as Array<{ id: string; voucher_number: string }>)
          .map((v) => [v.id, v.voucher_number]),
      );

      const map: Record<string, ApprovalState> = {};
      for (const a of approvals) {
        map[a.id] = {
          id: a.id,
          status: a.status,
          isPaid: Boolean(a.is_paid),
          jvVoucherNumber: a.jv_voucher_id ? numberById.get(a.jv_voucher_id) ?? null : null,
          paymentVoucherNumber: a.payment_voucher_id ? numberById.get(a.payment_voucher_id) ?? null : null,
        };
      }
      return map;
    },
  });

  const paymentState = paymentStateQuery.data ?? {};

  // Approval is date-specific: after approval, that day's report becomes a
  // read-only record. A separate table is used because a report can contain
  // visits that do not have a saved override row yet. A multi-day view has no
  // single day to lock, so the lock is simply not offered there.
  const isSingleDay = fromDate === toDate;
  const approvalQuery = useQuery({
    queryKey: ['dailyRevenueApproval', toDate],
    enabled: isSingleDay,
    queryFn: async (): Promise<{ approved_at: string; approved_by_email: string | null } | null> => {
      const { data, error } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .select('approved_at, approved_by_email')
        .eq('entry_date', toDate)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as { approved_at: string; approved_by_email: string | null } | null;
    },
  });

  const isApproved = isSingleDay && Boolean(approvalQuery.data?.approved_at);

  const rows: DisplayRow[] = useMemo(() => {
    const visits = visitsQuery.data ?? [];
    const overrides = overridesQuery.data ?? [];
    const billMap = billsQuery.data ?? {};
    const billPreparationMap = billPreparationQuery.data ?? {};
    const visitChargeMap = visitChargesQuery.data ?? {};
    const advanceMap = advanceQuery.data ?? {};
    const finalPayMap = finalPayQuery.data ?? {};
    const savedAllocations = allocationsQuery.data ?? [];
    const allocationsByEntry = new Map<string, typeof savedAllocations>();
    for (const allocation of savedAllocations) {
      const list = allocationsByEntry.get(allocation.revenue_entry_id) ?? [];
      list.push(allocation);
      allocationsByEntry.set(allocation.revenue_entry_id, list);
    }

    const overrideByVisit = new Map<string, OverrideRow>();
    for (const o of overrides) {
      if (o.visit_id) overrideByVisit.set(o.visit_id, o);
    }
    const rmByName = new Map(
      (rmMasterQuery.data ?? []).map((rm) => [rm.name.trim().toLowerCase(), rm]),
    );

    const visitRows: DisplayRow[] = visits.map((v) => {
      const o = overrideByVisit.get(v.id);

      // Priority: actual visit bill > submitted bill > the visit's own charges >
      // legacy saved RM amount > payments > package. This keeps every registered
      // OPD/IPD patient's cut anchored to the bill and prevents old ₹1,000
      // overrides from masking it. The charges sit above the override for the
      // same reason the two bill sources do: an OPD visit has no bills row to
      // find, so without them every OPD cut fell back to a typed figure.
      let cost = 0;
      let cost_source: CostSource = 'none';
      const billAmount = billMap[v.id] ?? billMap[v.visit_id] ?? 0;
      const preparedBillAmount = billPreparationMap[v.visit_id] ?? 0;
      const visitChargeAmount = visitChargeMap[v.id] ?? 0;
      if (billAmount > 0) {
        cost = billAmount;
        cost_source = 'bill';
      } else if (preparedBillAmount > 0) {
        cost = preparedBillAmount;
        cost_source = 'bill_prep';
      } else if (visitChargeAmount > 0) {
        cost = visitChargeAmount;
        cost_source = 'visit_charges';
      } else if (o && Number(o.cost) > 0) {
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
      const persisted = o ? allocationsByEntry.get(o.id) ?? [] : [];
      // An applied deduction comes off the bill before the commission is
      // worked out; ignored, it is carried on the row but changes nothing.
      const deduction = Math.max(0, toNumber(o?.deduction));
      const deductionApplied = Boolean(o?.deduction_applied) && deduction > 0;
      const cutBase = Math.max(0, cost - (deductionApplied ? deduction : 0));
      const suggestedCut = rowIsDirect ? 0 : Math.round((cutBase * rmPercent) / 100);
      // A saved cut was worked out against the cost saved beside it. Once the
      // row resolves to a different cost -- a real bill has turned up since --
      // that cut belongs to a bill nobody is billing, and holding on to it left
      // kriti bai lodhi reading Rs 13,700 with a cut of Rs 250 beside it.
      //
      // A settled row keeps every figure it was settled on: its invoice is
      // raised and its journals are posted against that number.
      const rowIsSettled = Boolean(o?.approval_id) || Boolean(o?.expense_bill_id)
        || persisted.some((allocation) => allocation.approval_id);
      const savedCostBasis = toNumber(o?.cost);
      const savedCutIsStale = hasSavedCut && !rowIsSettled && savedCostBasis > 0
        && Math.round(savedCostBasis) !== Math.round(cost);
      const useSavedCut = hasSavedCut && !savedCutIsStale;
      const totalCut = useSavedCut ? savedCut : suggestedCut;
      const visitManagers = [...(v.visit_relationship_managers ?? [])]
        .sort((a, b) => a.position - b.position).map((item) => item.relationship_managers).filter(Boolean) as Array<{ id: string; name: string; ledger_account_id: string | null }>;
      // The saved per-RM split is a division of the saved cut, so it goes stale
      // with it -- otherwise the managers' figures still add up to the old one.
      const keepPersistedAmounts = persisted.length > 0 && !savedCutIsStale;
      const managerSources = persisted.length
        ? persisted.map((a) => ({ id: a.relationship_manager_id ?? '', name: a.rm_name, ledgerId: a.rm_ledger_account_id, position: a.position, amount: Number(a.allocated_cut), approvalId: a.approval_id }))
        : visitManagers.length
          ? visitManagers.map((m, index) => ({ id: m.id, name: m.name, ledgerId: m.ledger_account_id, position: index + 1, amount: 0 }))
          : rm ? [{ id: rm.id, name: rm.name, ledgerId: (rm as any).ledger_account_id ?? null, position: 1, amount: totalCut }] : [];
      const totalPaise = Math.round(totalCut * 100);
      const rms = managerSources.map((m, index) => ({ ...m, amount: keepPersistedAmounts ? m.amount : (Math.floor(totalPaise / managerSources.length) + (index < totalPaise % managerSources.length ? 1 : 0)) / 100 }));
      // A saved row keeps the day it was filed under; an unsaved one takes the
      // day it is being read by, so a range never re-dates anybody.
      const basisDate = asDay(dateBasis === 'discharge' ? v.discharge_date : v.visit_date);
      return {
        key: `visit-${v.id}`,
        visitId: v.id,
        overrideId: o?.id ?? null,
        entryDate: o?.entry_date ?? basisDate ?? toDate,
        patient_name: v.patients?.name ?? '—',
        department: v.appointment_with ?? '',
        rm_name: rmName,
        hospital: v.patients?.hospital_name ?? '',
        patient_type: (v.patient_type ?? '').toUpperCase(),
        rmId: rm?.id ?? null,
        rmPercent,
        cost,
        deduction,
        deductionReason: o?.deduction_reason ?? '',
        deductionApplied,
        cutBase,
        cut: totalCut,
        cutIsSuggested: !useSavedCut && suggestedCut > 0,
        cost_source,
        isManual: false,
        isHidden: Boolean(o?.is_hidden),
        category: rowIsDirect ? 'direct' : 'main',
        // What the row was saved against wins; the master's mapping is the
        // fallback for rows saved before the ledger was recorded here.
        rmLedgerId: o?.rm_ledger_account_id ?? rm?.ledger_account_id ?? null,
        approvalId: o?.approval_id ?? persisted.find((allocation) => allocation.approval_id)?.approval_id ?? null,
        expenseBillId: o?.expense_bill_id ?? null,
        rms,
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
          entryDate: o.entry_date,
          patient_name: o.patient_name,
          department: o.department ?? '',
          rm_name: rmName,
          hospital: o.hospital_type ?? '',
          patient_type: '',
          rmId: rm?.id ?? null,
          rmPercent: rowIsDirect ? 0 : validCommissionPercent(rm?.commission_percent),
          cost: Number(o.cost),
          deduction: Math.max(0, toNumber(o.deduction)),
          deductionReason: o.deduction_reason ?? '',
          deductionApplied: Boolean(o.deduction_applied) && toNumber(o.deduction) > 0,
          cutBase: Math.max(
            0,
            Number(o.cost) - (o.deduction_applied ? Math.max(0, toNumber(o.deduction)) : 0),
          ),
          cut: Number(o.cut),
          cutIsSuggested: false,
          cost_source: 'override' as const,
          isManual: true,
          isHidden: Boolean(o.is_hidden),
          category: rowIsDirect ? 'direct' : 'manual',
          rmLedgerId: o.rm_ledger_account_id ?? rm?.ledger_account_id ?? null,
          approvalId: o.approval_id ?? null,
          expenseBillId: o.expense_bill_id ?? null,
          rms: (allocationsByEntry.get(o.id) ?? []).map((a) => ({ id: a.relationship_manager_id ?? '', name: a.rm_name, ledgerId: a.rm_ledger_account_id, amount: Number(a.allocated_cut), position: a.position, approvalId: a.approval_id })),
        };
      });

    let all = [...visitRows, ...manualRows];
    if (patientTypeFilter !== 'all') {
      // Manual revenue rows are not OPD/IPD visits, so they have no patient
      // type. Keep them visible in their own section for either view instead
      // of silently excluding a successfully saved manual entry.
      all = all.filter((r) => r.isManual || r.patient_type === patientTypeFilter);
    }
    if (onlyWithRm) {
      all = all.filter((r) => !isDirect(r.rm_name));
    }
    if (!showHidden) {
      all = all.filter((r) => !r.isHidden);
    }
    return all;
  }, [visitsQuery.data, overridesQuery.data, allocationsQuery.data, billsQuery.data, billPreparationQuery.data, visitChargesQuery.data, advanceQuery.data, finalPayQuery.data, rmMasterQuery.data, onlyWithRm, patientTypeFilter, showHidden, dateBasis, toDate]);

  const totals = useMemo(
    () => rows.reduce(
      (acc, r) => ({
        cost: acc.cost + r.cost,
        // Only deductions actually applied are totalled — an ignored one
        // changed nothing, so counting it would overstate what came off.
        deduction: acc.deduction + (r.deductionApplied ? r.deduction : 0),
        cut: acc.cut + r.cut,
      }),
      { cost: 0, deduction: 0, cut: 0 },
    ),
    [rows],
  );

  // What is still owed on each raised invoice, so a row that has been paid
  // stops offering Pay. Only fetched where Pay is offered at all.
  const billIds: string[] = useMemo(
    () => Array.from(new Set(rows.map((r) => r.expenseBillId).filter(Boolean) as string[])),
    [rows],
  );
  const billOutstandingQuery = useQuery({
    queryKey: ['dailyRevenueBillOutstanding', billIds.join(',')],
    enabled: enablePay && billIds.length > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await (supabase as any)
        .from('v_expense_bills_outstanding')
        .select('id, outstanding')
        .in('id', billIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const bill of (data ?? []) as Array<{ id: string; outstanding: number | string }>) {
        map[bill.id] = toNumber(bill.outstanding);
      }
      return map;
    },
  });
  const outstandingByBill = billOutstandingQuery.data ?? {};

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
          (acc, r) => ({
            cost: acc.cost + r.cost,
            deduction: acc.deduction + (r.deductionApplied ? r.deduction : 0),
            cut: acc.cut + r.cut,
          }),
          { cost: 0, deduction: 0, cut: 0 },
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
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueRmAllocations'] });
    queryClient.invalidateQueries({ queryKey: ['dailyRevenueBillOutstanding'] });
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

      const pickedRms = draftRmIds.map((id) => (rmMasterQuery.data ?? []).find((m) => m.id === id)).filter(Boolean) as NonNullable<typeof rmMasterQuery.data>;
      if (pickedRms.length < 1 || pickedRms.length > 3) throw new Error('Choose between one and three relationship managers');
      const choosingDirect = pickedRms.some((manager) => isDirect(manager.name));
      if (choosingDirect && pickedRms.length > 1) throw new Error('Direct cannot be combined with another RM');
      const pickedRm = pickedRms[0];
      const finalRmName = pickedRm.name;
      // Changing the assigned RM must also change this visit's cut to that
      // RM's permanent rate. Editing only cost/cut still preserves a manually
      // entered cut amount.
      const rmChanged = choosingDirect
        ? !isDirect(row.rm_name)
        : Boolean(pickedRm.id !== row.rmId);
      const selectionChanged = row.rms.map((rm) => rm.id).filter(Boolean).join(',') !== pickedRms.map((manager) => manager.id).join(',');
      const cut = choosingDirect
        ? 0
        : selectionChanged && pickedRms.length > 1
        ? draftedCut
        : rmChanged
        ? Math.round((cost * validCommissionPercent(pickedRm.commission_percent)) / 100)
        : draftedCut;

      let entryId = row.overrideId;
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
        const { data, error } = await supabase.from('daily_revenue_entries' as never).insert([
          {
            entry_date: row.entryDate,
            visit_id: row.visitId,
            patient_name: row.patient_name,
            department: row.department || null,
            rm_name: finalRmName,
            cost,
            cut,
            hospital_type: rowHospital,
          } as never,
        ]).select('id').single();
        if (error) throw error;
        entryId = (data as unknown as { id: string }).id;
      }
      const { error: allocationError } = await (supabase as any).rpc('set_daily_revenue_relationship_managers', {
        p_entry_id: entryId, p_manager_ids: pickedRms.map((manager) => manager.id),
      });
      if (allocationError) throw allocationError;
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
          // A manual entry belongs to the day the report is looking at; over a
          // range that is the last day shown.
          entry_date: toDate,
          patient_name: data.patient_name.trim(),
          department: data.department.trim() || null,
          rm_name: data.rm_name.trim() || null,
          rm_ledger_account_id: data.rm_ledger?.id ?? null,
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
          rm_ledger_account_id: data.rm_ledger?.id ?? null,
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
            entry_date: row.entryDate,
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

  /**
   * Save a row's deduction — the amount, why, and whether it counts.
   *
   * The cut is not written here. It is recomputed from (cost − deduction) on
   * the next read for any row that has not had a cut saved by hand, so the
   * figure on screen always matches the base beside it. A row whose cut was
   * already fixed manually keeps that number; the deduction then shows what
   * the base would be, and Save Cut is what re-applies it.
   */
  const saveDeductionMutation = useMutation({
    mutationFn: async (
      { row, amount, reason, applied }:
        { row: DisplayRow; amount: number; reason: string; applied: boolean },
    ) => {
      if (isApproved) throw new Error('This report has already been approved and is locked');
      if (row.approvalId || row.expenseBillId) {
        throw new Error('This cut has already been raised — its deduction can no longer change');
      }
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid deduction amount');
      if (amount > row.cost) {
        throw new Error(`A deduction cannot exceed the bill of ₹${row.cost.toLocaleString('en-IN')}`);
      }
      if (applied && (amount <= 0 || !reason.trim())) {
        throw new Error('A deduction that is applied needs an amount and a reason');
      }

      const patch = {
        deduction: amount,
        deduction_reason: reason.trim() || null,
        deduction_applied: applied,
        updated_at: new Date().toISOString(),
      };

      if (row.overrideId) {
        const { error } = await supabase
          .from('daily_revenue_entries' as never)
          .update(patch as never)
          .eq('id', row.overrideId);
        if (error) throw error;
        return;
      }

      if (!row.visitId) throw new Error('Only report rows can carry a deduction');

      // First deduction on a live visit row: persist the row as it stands, so
      // the cost the deduction was judged against is the one on record.
      const { error } = await supabase
        .from('daily_revenue_entries' as never)
        .insert([{
          entry_date: row.entryDate,
          visit_id: row.visitId,
          patient_name: row.patient_name,
          department: row.department || null,
          rm_name: row.rm_name || null,
          cost: row.cost,
          cut: 0,
          hospital_type: row.hospital || hospitalType || 'hope',
          ...patch,
        } as never]);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setEditingDeductionId(null);
      toast.success('Deduction saved — the cut now follows it');
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
          entry_date: row.entryDate,
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

  // ── Paying the managers ────────────────────────────────────────────────
  //
  // A cut can only be paid once its row exists in daily_revenue_entries — that
  // row is what carries the approval stamp. Rows generated from a visit have no
  // saved row until someone edits them, so one is written on the way to paying.
  const ensureEntryRow = async (row: DisplayRow): Promise<string> => {
    if (row.overrideId) {
      // Write the figures being approved back onto the saved row FIRST.
      // approve_daily_revenue_referral reads the amount from the entry, while
      // the invoice PDF is built from what is on screen, so a saved row left
      // holding an older cost and cut would print one number and post another
      // -- which is exactly what a stale cut beside a freshly resolved bill is.
      // When nothing has moved this rewrites the same values.
      const { data: saved, error: figuresError } = await supabase
        .from('daily_revenue_entries' as never)
        .update({ cost: row.cost, cut: row.cut, updated_at: new Date().toISOString() } as never)
        .eq('id', row.overrideId)
        .select('id');
      if (figuresError) throw figuresError;
      // An update matching no row is not an error. Approving on a row that was
      // never actually written is how a cut gets invoiced at a figure the books
      // never saw.
      if (!saved || (saved as unknown as unknown[]).length === 0) {
        throw new Error('This row could not be saved before approval — reload the report and try again');
      }
      if (row.rms.length) {
        const { error } = await (supabase as any).rpc('set_daily_revenue_relationship_managers', { p_entry_id: row.overrideId, p_manager_ids: row.rms.map((rm) => rm.id) });
        if (error) throw error;
      }
      return row.overrideId;
    }
    const { data, error } = await supabase
      .from('daily_revenue_entries' as never)
      .insert([{
        entry_date: row.entryDate,
        visit_id: row.visitId,
        patient_name: row.patient_name,
        department: row.department || null,
        rm_name: row.rm_name || null,
        rm_ledger_account_id: row.rmLedgerId,
        cost: row.cost,
        cut: row.cut,
        hospital_type: row.hospital || hospitalType || 'hope',
      } as never])
      .select('id')
      .single();
    if (error) {
      // A previous attempt may have inserted the row before its posting
      // failed (one row per visit is enforced by a unique index). Reuse it
      // instead of dead-ending every retry on the duplicate key.
      if ((error as { code?: string }).code === '23505' && row.visitId) {
        const { data: existing } = await supabase
          .from('daily_revenue_entries' as never)
          .select('id')
          .eq('visit_id', row.visitId)
          .maybeSingle();
        const existingId = (existing as unknown as { id: string } | null)?.id;
        if (existingId) return existingId;
      }
      throw error;
    }
    const id = (data as unknown as { id: string }).id;
    const managerIds = row.rms.map((rm) => rm.id).filter(Boolean);
    if (managerIds.length) {
      const { error: allocationError } = await (supabase as any).rpc('set_daily_revenue_relationship_managers', { p_entry_id: id, p_manager_ids: managerIds });
      if (allocationError) throw allocationError;
    }
    return id;
  };

  /** A real commission not yet raised — through either the old pay flow or the new invoice flow. */
  const isOwed = (row: DisplayRow): boolean =>
    !row.approvalId && !row.expenseBillId && !row.isHidden && !isDirect(row.rm_name) && row.cut > 0;

  /** Cuts on this report still waiting for their per-row Approve. */
  const pendingApproveRows = rows.filter(isOwed);
  const pendingApproveCount = pendingApproveRows.length;
  const pendingApproveTotal = pendingApproveRows.reduce((sum, r) => sum + r.cut, 0);

  // Per-row Approve: raises the M.L. Enterprises invoice for this one patient
  // and posts both companies' journals. Nothing is paid — the bill lands
  // outstanding on the Expense Bill page.
  //
  // Deliberately allowed on a locked day. The lock freezes the sheet's figures,
  // not the invoicing: a day locked while cuts were still pending used to
  // strand them with no way to ever raise their bill.
  const approveRowMutation = useMutation({
    mutationFn: async (row: DisplayRow) => {
      const entryId = await ensureEntryRow(row);
      return approveReferralRow({
        entryId,
        patientName: row.patient_name,
        rmName: row.rms.length ? row.rms.map((rm) => rm.name).join(', ') : row.rm_name,
        hospital: row.hospital || hospitalType || 'hope',
        amount: row.cut,
        entryDate: row.entryDate,
        createdBy: user?.email ?? user?.username,
      });
    },
    onSuccess: (result) => {
      invalidate();
      toast.success(
        `Invoice ${result.billNumber} raised — hospital bill posted, ML journals ${result.salesVoucher} & ${result.commissionVoucher}. Pay it from the Expense Bill page.`,
      );
    },
    onError: (err) => {
      // The entry row may now exist even though posting failed — refresh so
      // the retry goes through the saved row.
      invalidate();
      toast.error(getErrorMessage(err));
    },
    onSettled: () => setApprovingKey(null),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (isApproved) return;
      if (!isSingleDay) throw new Error('Pick a single date before locking the day');

      // Locking the day no longer pays anything — each row is approved (and
      // later paid from the Expense Bill page) on its own. The lock simply
      // freezes the sheet as the day's record.
      let paidSummary = '';
      if (pendingApproveCount > 0) {
        paidSummary = ` ${pendingApproveCount} cut(s) are still un-approved — their figures can no longer be edited, but you can still approve them.`;
      }

      // Do not use upsert here. Some existing deployments have the approval
      // table without its entry_date unique constraint reflected in PostgREST's
      // schema cache, which makes `on_conflict=entry_date` return HTTP 409.
      const { data: existing, error: existingError } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .select('entry_date')
        .eq('entry_date', toDate)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return paidSummary;

      const { error } = await supabase
        .from('daily_revenue_report_approvals' as never)
        .insert({
          entry_date: toDate,
          approved_at: new Date().toISOString(),
          approved_by_email: user?.email ?? null,
        } as never);
      if (error) throw error;
      return paidSummary;
    },
    onSuccess: (paidSummary) => {
      setEditingCutId(null);
      setEditingRateId(null);
      invalidate();
      toast.success(`Day locked. Editing is now disabled.${paidSummary ?? ''}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const openInlineEdit = (row: DisplayRow) => {
    if (isApproved) return;
    if (row.expenseBillId || row.approvalId) {
      toast.error('This row is invoiced or paid and cannot be edited. Cancel the invoice first if a correction is required.');
      return;
    }
    setEditingRateId(null);
    setEditingCutId(row.key);
    setDraftCost(String(row.cost));
    setDraftCut(String(row.cut));
    // Pre-select the current RM in the dropdown if one is in the master list.
    const match = (rmMasterQuery.data ?? []).find(
      (m) => m.name.toLowerCase() === (row.rm_name ?? '').toLowerCase(),
    );
    const direct = (rmMasterQuery.data ?? []).find((manager) => isDirect(manager.name));
    setDraftRmIds(row.rms.map((rm) => rm.id).filter(Boolean).length
      ? row.rms.map((rm) => rm.id).filter(Boolean)
      : isDirect(row.rm_name) && direct ? [direct.id] : match ? [match.id] : []);
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
    setSelectedManualPatientId(null);
    setIsManualPatientDropdownOpen(false);
    setIsManualDialogOpen(true);
  };

  const openManualEdit = async (row: DisplayRow) => {
    if (isApproved) return;
    if (!row.overrideId) return;
    setManualEditId(row.overrideId);
    // Read the row's ledger back in full so the dialog shows its code, not just
    // the name the report happens to print.
    let ledger: LedgerAccountOption | null = null;
    if (row.rmLedgerId) {
      const { data } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .eq('id', row.rmLedgerId)
        .maybeSingle();
      ledger = (data as LedgerAccountOption) ?? null;
    }
    setManualForm({
      patient_name: row.patient_name,
      department: row.department,
      rm_name: row.rm_name,
      rm_ledger: ledger,
      cost: String(row.cost),
      cut: String(row.cut),
      notes: '',
    });
    setSelectedManualPatientId(null);
    setIsManualPatientDropdownOpen(false);
    setIsManualDialogOpen(true);
  };

  const submitManual = () => {
    if (manualEditId) {
      updateManualMutation.mutate(manualForm);
      return;
    }
    if (!selectedManualPatientId) {
      toast.error('Select a patient from the search results');
      return;
    }
    addManualMutation.mutate(manualForm);
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
    const longDate = (day: string): string => new Date(day).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const prettyDate = isSingleDay ? longDate(toDate) : `${longDate(fromDate)} to ${longDate(toDate)}`;
    const dateLabel = isSingleDay ? toDate : `${fromDate} to ${toDate}`;
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
            const printedRmDisplay = isDirect(r.rm_name)
              ? '<span class="pill direct">Direct</span>'
              : esc(r.rms.length ? r.rms.map((rm) => `${rmDisplay(rm)}${r.rms.length > 1 ? ` (Rs ${formatINR(rm.amount)})` : ''}`).join(', ') : rmDisplay({ id: r.rmId ?? undefined, name: r.rm_name }));
            const typeBadge =
              r.patient_type === 'OPD' ? '<span class="pill opd">OPD</span>' :
              r.patient_type === 'IPD' ? '<span class="pill ipd">IPD</span>' : '';
            return `
              <tr>
                <td class="num">${runningIdx}</td>
                <td>${esc(r.patient_name)} ${typeBadge}</td>
                <td>${esc(r.department || '—')}</td>
                <td>${printedRmDisplay}</td>
                <td>${esc(liaisonsForRow(r) || '—')}</td>
                <td class="right">${r.rmPercent}%</td>
                <td class="right">${fmt(r.cost)}</td>
                <td class="right">${fmt(r.cut)}</td>
              </tr>`;
          }).join('');
          return `
            <tr class="section">
              <td colspan="8">${esc(label)}</td>
            </tr>
            ${rowsHtml}
            <tr class="subtotal">
              <td colspan="6" class="right">${esc(label)} Sub-total</td>
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
                <th>Marketing Liaison</th>
                <th class="right">RM %</th>
                <th class="right">Cost (Rs)</th>
                <th class="right">Cut (Rs)</th>
              </tr>
            </thead>
            <tbody>
              ${categoriesHtml}
              <tr class="hospital-total">
                <td colspan="6" class="right">${theme.displayName} Total</td>
                <td class="right">Rs ${fmt(hospitalTotals.cost)}</td>
                <td class="right">Rs ${fmt(hospitalTotals.cut)}</td>
              </tr>
            </tbody>
          </table>
          <div class="hospital-footer">
            <span>${theme.displayName}</span>
            <span>Daily Revenue Report · ${esc(dateLabel)}</span>
          </div>
        </section>`;
    }).join('');

    const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>Daily Revenue Report — ${esc(dateLabel)}</title>
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
          <CardTitle>{title}</CardTitle>
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
          {isRangeReport ? (
            <>
              <Label htmlFor="daily_report_from" className="text-sm">From</Label>
              <Input
                id="daily_report_from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
              <Label htmlFor="daily_report_to" className="text-sm">To</Label>
              <Input
                id="daily_report_to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </>
          ) : (
            <>
              <Label htmlFor="daily_report_date" className="text-sm">Date</Label>
              <Input
                id="daily_report_date"
                type="date"
                value={toDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setToDate(e.target.value);
                }}
                className="w-44"
              />
            </>
          )}
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
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-gray-50 p-2 print:hidden">
          <FileCheck2 className="h-4 w-4 text-gray-500" />
          <span className="text-xs text-gray-600">
            Approve on a row raises that patient's M.L. Enterprises implant invoice and posts
            the journals in both companies' books.{' '}
            {enablePay
              ? 'Pay then settles that invoice from cash or bank, exactly as the Expense Bill page does.'
              : 'The bill is paid later from the Expense Bill page.'}{' '}
            {isSingleDay
              ? 'Lock Day freezes this sheet’s figures — pending invoices can still be raised afterwards.'
              : 'Pick a single date to lock a day’s sheet.'}
          </span>
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
            <p>
              {dateBasis === 'discharge' ? 'No discharges' : 'No visits'}{' '}
              {isSingleDay
                ? `on ${new Date(toDate).toLocaleDateString('en-IN')}`
                : `between ${new Date(fromDate).toLocaleDateString('en-IN')} and ${new Date(toDate).toLocaleDateString('en-IN')}`}
              .
            </p>
            <p className="text-sm">
              Use "Add Manual" for anything not shown here.
            </p>
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
                  <TableHead>Marketing Liaison</TableHead>
                  <TableHead className="text-right">RM %</TableHead>
                  <TableHead className="text-right">Cost (Rs)</TableHead>
                  <TableHead className="text-right">Deduction (Rs)</TableHead>
                  <TableHead className="text-right">Cut (Rs)</TableHead>
                  <TableHead className="print:hidden">Approval</TableHead>
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
                          colSpan={12}
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
                                <div className="max-h-32 min-w-52 space-y-1 overflow-y-auto rounded border bg-white p-2">
                                    {(rmMasterQuery.data ?? []).map((manager) => {
                                      const checked = draftRmIds.includes(manager.id);
                                      const directConflict = isDirect(manager.name) && draftRmIds.length > 0 && !checked;
                                      const hasDirect = draftRmIds.some((id) => isDirect((rmMasterQuery.data ?? []).find((item) => item.id === id)?.name));
                                      const disabled = !checked && (draftRmIds.length >= 3 || directConflict || hasDirect);
                                      return (
                                        <label key={manager.id} className="flex items-center gap-2 text-xs">
                                          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => {
                                            setDraftRmIds(checked ? draftRmIds.filter((id) => id !== manager.id) : [...draftRmIds, manager.id]);
                                          }} />
                                          <span>{manager.name}{manager.code ? ` (${manager.code})` : ''}{draftRmIds[0] === manager.id ? ' · Primary' : ''}</span>
                                        </label>
                                      );
                                    })}
                                </div>
                              ) : isDirect(r.rm_name) ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium uppercase bg-gray-100 text-gray-700">
                                  Direct
                                </span>
                              ) : (
                                <div className="space-y-0.5">
                                  {(r.rms.length ? r.rms : [{ id: r.rmId || '', name: r.rm_name, ledgerId: r.rmLedgerId, amount: r.cut, position: 1 }]).map((rm, index) => (
                                    <div key={`${rm.id}-${index}`} className="whitespace-nowrap text-xs">
                                      <span className="font-medium">{rmDisplay(rm)}</span>
                                      {r.rms.length > 1 && <span className="ml-1 text-gray-500">₹{formatINR(rm.amount)}</span>}
                                      {index === 0 && r.rms.length > 1 && <span className="ml-1 text-[10px] text-blue-600">Primary</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {liaisonsForRow(r) || <span className="text-gray-400">—</span>}
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
                            {/* Deduction — an amount taken off the bill before the
                                cut is worked out. Applying it is a choice: the
                                figure and reason stay on the row either way. */}
                            <TableCell className="text-right align-top">
                              {editingDeductionId === r.key ? (
                                <div className="flex w-56 flex-col gap-1 ml-auto print:hidden">
                                  <Input
                                    type="number"
                                    min="0"
                                    max={r.cost}
                                    value={draftDeduction}
                                    onChange={(e) => setDraftDeduction(e.target.value)}
                                    placeholder="Amount"
                                    className="h-8 text-right"
                                    autoFocus
                                  />
                                  <Input
                                    value={draftDeductionReason}
                                    onChange={(e) => setDraftDeductionReason(e.target.value)}
                                    placeholder="Reason — e.g. MRI Brain"
                                    className="h-8 text-left text-xs"
                                  />
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      disabled={saveDeductionMutation.isPending}
                                      onClick={() => saveDeductionMutation.mutate({
                                        row: r,
                                        amount: parseFloat(draftDeduction) || 0,
                                        reason: draftDeductionReason,
                                        applied: true,
                                      })}
                                    >
                                      Deduct
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      disabled={saveDeductionMutation.isPending}
                                      title="Keep the amount and reason on the row, but calculate the cut on the full bill"
                                      onClick={() => saveDeductionMutation.mutate({
                                        row: r,
                                        amount: parseFloat(draftDeduction) || 0,
                                        reason: draftDeductionReason,
                                        applied: false,
                                      })}
                                    >
                                      Ignore
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => setEditingDeductionId(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-end gap-0.5">
                                  {r.deduction > 0 ? (
                                    <>
                                      <span className={r.deductionApplied ? 'text-amber-700' : 'text-gray-400 line-through'}>
                                        Rs {formatINR(r.deduction)}
                                      </span>
                                      {r.deductionReason && (
                                        <span className="max-w-[160px] truncate text-[10px] text-gray-500" title={r.deductionReason}>
                                          {r.deductionReason}
                                        </span>
                                      )}
                                      {r.deductionApplied && (
                                        <span className="text-[10px] text-gray-500">
                                          cut on Rs {formatINR(r.cutBase)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs print:hidden"
                                    disabled={isApproved || Boolean(r.approvalId) || Boolean(r.expenseBillId)}
                                    title={
                                      isApproved
                                        ? 'This approved report is locked'
                                        : (r.approvalId || r.expenseBillId)
                                          ? 'This cut has already been raised'
                                          : 'Deduct an amount before the cut is calculated'
                                    }
                                    onClick={() => {
                                      setEditingDeductionId(r.key);
                                      setDraftDeduction(r.deduction ? String(r.deduction) : '');
                                      setDraftDeductionReason(r.deductionReason);
                                    }}
                                  >
                                    {r.deduction > 0 ? 'Change' : 'Deduct'}
                                  </Button>
                                </div>
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
                            <TableCell className="print:hidden">
                              <CalcSheetCell rowKey={r.key} reportDate={r.entryDate} uploadedBy={user?.email || null} />
                              {r.approvalId ? (
                                // Already paid. Name the vouchers, because the
                                // point of the button was to get them into the
                                // Day Book where they can be looked up.
                                <span className="inline-flex flex-col">
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                                  </span>
                                  <span className="text-[10px] text-gray-500">
                                    {paymentState[r.approvalId]?.paymentVoucherNumber
                                      ? `${paymentState[r.approvalId]?.paymentVoucherNumber} · JV ${paymentState[r.approvalId]?.jvVoucherNumber ?? '—'}`
                                      : 'raised, posting incomplete'}
                                  </span>
                                </span>
                              ) : r.expenseBillId ? (
                                <span className="inline-flex flex-col items-start gap-1">
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                    <FileCheck2 className="h-3.5 w-3.5" /> Invoiced
                                  </span>
                                  {enablePay ? (
                                    outstandingByBill[r.expenseBillId] === 0 ? (
                                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                                      </span>
                                    ) : (
                                      <Button
                                        size="sm"
                                        className="h-7 gap-1 bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
                                        title={`Pay ${r.patient_name}'s referral invoice`}
                                        onClick={() => setPayingRow(r)}
                                      >
                                        <Banknote className="h-3.5 w-3.5" /> Pay
                                      </Button>
                                    )
                                  ) : (
                                    <span className="text-[10px] text-gray-500">
                                      pay from Expense Bill page
                                    </span>
                                  )}
                                </span>
                              ) : !isOwed(r) ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 px-2 text-xs"
                                  disabled={approvingKey !== null}
                                  title={`Raise the M.L. Enterprises invoice for ${r.patient_name} and post the journals`}
                                  onClick={() => { setApprovingKey(r.key); approveRowMutation.mutate(r); }}
                                >
                                  {approvingKey === r.key
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                                  Approve
                                </Button>
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
                                    disabled={isApproved || Boolean(r.expenseBillId || r.approvalId)}
                                    title={isApproved ? 'This approved report is locked' : r.expenseBillId || r.approvalId ? 'This invoiced or paid row is locked' : 'Edit cost/cut'}
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
                        <TableCell colSpan={7} className="text-right">
                          {group.label} Sub-total
                        </TableCell>
                        <TableCell className="text-right">Rs {formatINR(group.subtotal.cost)}</TableCell>
                        <TableCell className="text-right">
                          {group.subtotal.deduction > 0 ? `Rs ${formatINR(group.subtotal.deduction)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right">Rs {formatINR(group.subtotal.cut)}</TableCell>
                        <TableCell className="print:hidden" />
                        <TableCell className="print:hidden" />
                      </TableRow>
                    </React.Fragment>
                  ));
                })()}
                <TableRow className="bg-gray-100 font-bold border-t-2">
                  <TableCell colSpan={7} className="text-right">Grand Total</TableCell>
                  <TableCell className="text-right">Rs {formatINR(totals.cost)}</TableCell>
                  <TableCell className="text-right">
                    {totals.deduction > 0 ? `Rs ${formatINR(totals.deduction)}` : '—'}
                  </TableCell>
                  <TableCell className="text-right">Rs {formatINR(totals.cut)}</TableCell>
                  <TableCell className="print:hidden text-right text-xs text-gray-600">
                    {pendingApproveCount > 0 && `${pendingApproveCount} to approve`}
                    {pendingApproveCount === 0 && rows.some((r) => r.approvalId || r.expenseBillId) && 'all approved'}
                  </TableCell>
                  <TableCell className="print:hidden text-right">
                    {/* A lock freezes one day's sheet, so it is only offered
                        when the report is showing exactly one day. */}
                    {isSingleDay && (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (pendingApproveCount > 0) setIsLockConfirmOpen(true);
                          else approveMutation.mutate();
                        }}
                        disabled={isApproved || approveMutation.isPending}
                        className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                        title={
                          pendingApproveCount > 0
                            ? `${pendingApproveCount} cut(s) are still un-approved — locking freezes their figures, but they can still be approved`
                            : 'Freezes this day’s sheet as the record'
                        }
                      >
                        {approveMutation.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Lock className="h-4 w-4" />}
                        {isApproved ? 'Locked' : approveMutation.isPending ? 'Locking...' : 'Lock Day'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-gray-500 mt-3 print:hidden">
              Visits pulled live from the system for the selected date. Cost is auto-filled from:
              the patient's bill <span className="text-gray-400">(bill)</span> →
              the visit's own charges, which is where an OPD patient's total lives <span className="text-gray-400">(opd)</span> →
              advance payment <span className="text-gray-400">(adv)</span> →
              final payment <span className="text-gray-400">(final)</span> →
              visit package <span className="text-gray-400">(pkg)</span>. A bill or a charge total outranks a cost typed by hand, so an
              old figure cannot hold a cut below the patient's real bill. Cut is auto-suggested using the assigned RM's saved percentage
              <span className="text-gray-400"> (sug)</span> — use the RM % edit icon to change that RM's rate and recalculate this row, or the cost/cut edit icon to save this row
              <span className="text-gray-400"> (man)</span>. Saved values persist on every refresh.
            </p>
          </div>
        )}
      </CardContent>

      {/* Locking with cuts still un-invoiced is allowed, but it is almost
          always a mistake, so it has to be confirmed. */}
      <AlertDialog open={isLockConfirmOpen} onOpenChange={setIsLockConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock the day with {pendingApproveCount} cut(s) un-approved?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingApproveCount} cut(s) totalling Rs {formatINR(pendingApproveTotal)} have no
              M.L. Enterprises invoice yet. Locking freezes this sheet's figures — you can still
              approve those rows afterwards, but their cost, cut and RM can no longer be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => approveMutation.mutate()}
            >
              Lock Day
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual Add/Edit Dialog */}
      <Dialog open={isManualDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsManualDialogOpen(false);
          setManualEditId(null);
          setManualForm(initialManual);
          setSelectedManualPatientId(null);
          setIsManualPatientDropdownOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{manualEditId ? 'Edit Manual Entry' : 'Add Manual Entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="m_patient_name">Patient Name *</Label>
              {manualEditId ? (
                <Input id="m_patient_name" value={manualForm.patient_name} maxLength={150}
                  onChange={(e) => setManualForm({ ...manualForm, patient_name: e.target.value })} />
              ) : (
                <div className="relative">
                  <Input
                    id="m_patient_name"
                    value={manualForm.patient_name}
                    maxLength={150}
                    autoComplete="off"
                    placeholder="Type at least 2 letters to search..."
                    onFocus={() => setIsManualPatientDropdownOpen(true)}
                    onChange={(e) => {
                      setManualForm({ ...manualForm, patient_name: e.target.value });
                      setSelectedManualPatientId(null);
                      setIsManualPatientDropdownOpen(true);
                    }}
                  />
                  {isManualPatientDropdownOpen && (
                    <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                      {manualForm.patient_name.trim().length < 2 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">Type at least 2 letters to search patients.</p>
                      ) : manualPatientSearchQuery.isFetching ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">Searching patients...</p>
                      ) : manualPatientSearchQuery.isError ? (
                        <p className="px-3 py-2 text-sm text-destructive">Could not search patients. Please try again.</p>
                      ) : (manualPatientSearchQuery.data ?? []).length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No matching patients found.</p>
                      ) : (
                        (manualPatientSearchQuery.data ?? []).map((patient) => (
                          <button
                            key={patient.patientId}
                            type="button"
                            className="flex w-full flex-col rounded-sm px-3 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setManualForm({ ...manualForm, patient_name: patient.patientName });
                              setSelectedManualPatientId(patient.patientId);
                              setIsManualPatientDropdownOpen(false);
                            }}
                          >
                            <span className="text-sm font-medium">{patient.patientName}</span>
                            <span className="text-xs text-muted-foreground">Visit ID: {patient.visitId}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {!manualEditId && (
                <p className="mt-1 text-xs text-muted-foreground">Select a patient from the search results.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m_department">Department</Label>
                <Input id="m_department" placeholder="ENT, Derma, Gastro..." value={manualForm.department} maxLength={50}
                  onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="m_rm">RM Manager (ledger)</Label>
                {/* The manager is picked as a ledger, by code or by name, so the
                    row can be paid without anyone guessing which account the
                    typed name meant. */}
                <LedgerAutocomplete
                  value={manualForm.rm_ledger}
                  companyId={null}
                  placeholder="Search by ledger code or name..."
                  onChange={(ledger) =>
                    setManualForm({
                      ...manualForm,
                      rm_ledger: ledger,
                      // The report prints the name, so it follows the ledger.
                      rm_name: ledger?.account_name ?? '',
                    })
                  }
                />
                {manualForm.rm_ledger?.account_code ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Ledger {manualForm.rm_ledger.account_code}
                  </p>
                ) : (
                  // A manager who has no ledger yet must still be recordable —
                  // the day's takings are a fact whether or not accounting has
                  // caught up. The row is kept and simply cannot be paid until
                  // someone gives that manager a ledger.
                  <div className="mt-2">
                    <Input
                      id="m_rm"
                      placeholder="…or type a name for a manager with no ledger"
                      value={manualForm.rm_name}
                      maxLength={100}
                      onChange={(e) => setManualForm({ ...manualForm, rm_name: e.target.value })}
                    />
                    {manualForm.rm_name.trim() && !isDirect(manualForm.rm_name) && (
                      <p className="mt-1 text-xs text-amber-700">
                        No ledger picked — this row will be recorded but cannot be paid
                        until “{manualForm.rm_name.trim()}” has one.
                      </p>
                    )}
                  </div>
                )}
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
            <Button variant="outline" onClick={() => {
              setIsManualDialogOpen(false);
              setManualEditId(null);
              setManualForm(initialManual);
              setSelectedManualPatientId(null);
              setIsManualPatientDropdownOpen(false);
            }}>Cancel</Button>
            <Button onClick={submitManual} disabled={addManualMutation.isPending || updateManualMutation.isPending || (!manualEditId && !selectedManualPatientId)}>
              {manualEditId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient details dialog */}
      <PatientDetailsDialog
        row={detailsRow}
        reportDate={detailsRow?.entryDate ?? toDate}
        onClose={() => setDetailsRow(null)}
      />

      {/* Pay an already-invoiced cut without leaving the report */}
      {payingRow?.expenseBillId && (
        <PayReferralBillDialog
          expenseBillId={payingRow.expenseBillId}
          patientName={payingRow.patient_name}
          onClose={() => setPayingRow(null)}
          onPaid={() => {
            setPayingRow(null);
            invalidate();
          }}
        />
      )}

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
                <div><dt className="inline text-gray-500">RM Manager: </dt><dd className="inline">{row.rms.length ? row.rms.map((rm) => `${rm.name} (₹${formatINR(rm.amount)})`).join(', ') : row.rm_name || '—'}</dd></div>
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
