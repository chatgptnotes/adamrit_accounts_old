import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AlertCircle, AlertTriangle, ArrowUpDown, Calendar, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, FileSpreadsheet, History, Info, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck, Upload, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { corporateClaimFileFingerprint, parseCorporateClaimFile, schemeForProgramId, checkPaymentStatus, autoMatchClaimByNameAndDate, storePatientLinkage, type CorporateClaimParsedFile } from '@/lib/corporateClaimTracking';
import { exportClaimsToCSV, exportClaimsToExcel, exportReconciliationReport, type ClaimExportFilters, type ClaimRow } from '@/lib/corporateClaimReports';
import { generateReconciliationReport, type ReconciliationReport } from '@/lib/corporateClaimReconciliation';
import { reconcilePaymentsAndUTRs, exportPaymentUTRReconciliation } from '@/lib/paymentUTRReconciliation';
import { generateManagementSummary } from '@/lib/corporateClaimSummaries';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type Claim = Record<string, any> & {
  id: string;
  scheme_type: string;
  beneficiary_name: string;
  government_registration_id?: string;
  government_program_id?: string;
  current_stage: string;
  claimed_amount?: number | string;
  approved_amount?: number | string;
  paid_amount?: number | string;
  payment_state?: string;
  verification_state: VerificationStatus | 'pending';
  admission_status: AdmissionStatus | 'pending';
  match_state?: string;
  raw_government_status?: string;
  source_file_name?: string;
  row_number?: number;
  isPreview?: boolean;
  verification_evidence?: Record<string, unknown>;
  matched_patient?: { id: string; name: string; patients_id?: string; registration_id?: string };
  matched_visit?: { id: string; patient_type: string; admission_date?: string; discharge_date?: string; visit_id?: string };
  payment_status?: {
    hasBill: boolean;
    billDetails?: { bill_amount?: number; received_amount?: number; tds_amount?: number; date_of_submission?: string };
    paymentCount: number;
    totalPaid: number;
  };
  utr?: string;
  payment_date?: string | null;
  remark?: string; // NEW: Remarks from CSV for needs review cases
  merged_count?: number; // NEW: Number of rows merged for this patient
};
type SchemeFilter = 'ALL' | 'PMJAY' | 'MJPJAY' | 'UNRESOLVED';
type Stage = 'all' | 'under_treatment' | 'claims_to_be_submitted' | 'claims_sent_to_bank' | 'pending_with_payer' | 'payment_initiated' | 'payment_accomplished' | 'rejected';
type VerificationStatus = 'all' | 'matched' | 'unmatched' | 'ambiguous' | 'conflict' | 'invalid' | 'not_checked';
type AdmissionStatus = 'all' | 'active_ipd' | 'discharged' | 'not_ipd' | 'no_visit' | 'not_matched' | 'ambiguous' | 'conflict' | 'not_checked';

const STAGES: Exclude<Stage, 'all'>[] = ['under_treatment', 'claims_to_be_submitted', 'pending_with_payer', 'payment_accomplished', 'rejected'];
const STAGE_LABELS: Record<Exclude<Stage, 'all'>, string> = {
  under_treatment: 'Under Treatment',
  claims_to_be_submitted: 'To Be Submitted',
  claims_sent_to_bank: 'Sent To Bank',
  pending_with_payer: 'Pending With Payer',
  payment_initiated: 'Payment Initiated',
  payment_accomplished: 'Payment Accomplished',
  rejected: 'Rejected'
};

const VERIFICATION_LABELS: Record<VerificationStatus | 'pending', string> = {
  all: 'All Verification',
  matched: 'Matched',
  unmatched: 'Unmatched',
  ambiguous: 'Ambiguous',
  conflict: 'Conflict',
  invalid: 'Invalid',
  not_checked: 'Not Checked',
  pending: 'Pending Verification'
};

const ADMISSION_LABELS: Record<AdmissionStatus | 'pending', string> = {
  all: 'All Admission',
  active_ipd: 'Active IPD',
  discharged: 'Discharged',
  not_ipd: 'Not IPD',
  no_visit: 'No Visit',
  not_matched: 'Not Matched',
  ambiguous: 'Ambiguous',
  conflict: 'Conflict',
  not_checked: 'Not Checked',
  pending: 'Pending Verification'
};

const REVIEW_CATEGORIES = [
  { value: 'invalid', label: 'Invalid Data', color: 'destructive' },
  { value: 'unresolved_scheme', label: 'Unresolved Scheme', color: 'destructive' },
  { value: 'unmatched', label: 'Unmatched Patient', color: 'destructive' },
  { value: 'ambiguous', label: 'Ambiguous Patient', color: 'destructive' },
  { value: 'identifier_conflict', label: 'Identifier Conflict', color: 'destructive' },
  { value: 'no_visit', label: 'No Visit', color: 'destructive' },
  { value: 'not_ipd', label: 'Not IPD', color: 'destructive' },
  { value: 'discharged', label: 'Discharged', color: 'destructive' },
  { value: 'payment_conflict', label: 'Payment Conflict', color: 'destructive' }
] as const;

// ============================================================================
// Live Verification: Query existing Adamrit patients/visits directly
// ============================================================================

async function verifyClaimAgainstAdamrit(claim: Claim) {
  const regId = claim.government_registration_id;
  const progId = claim.government_program_id;
  const hospitalName = (claim.hospital_name || 'hope').toLowerCase();

  if (!regId && !progId) {
    return { status: 'unmatched', patient: null, visit: null, admissionStatus: 'no_visit' };
  }

  try {
    // Step 1: Check linkage table first (previous manual/auto matches)
    const { data: linkage } = await supabase
      .from('patient_government_linkage')
      .select('patient_id')
      .eq('hospital_name', hospitalName)
      .or(`government_id.eq.${regId},government_id.eq.${progId}`)
      .maybeSingle();

    if (linkage) {
      // Use existing linkage - load patient and visit
      const { data: patient } = await supabase
        .from('patients')
        .select('id, name, patients_id, registration_id, pmjay_program_id')
        .eq('id', linkage.patient_id)
        .maybeSingle();

      if (patient) {
        const { data: visit } = await supabase
          .from('visits')
          .select('id, visit_id, patient_type, admission_date, discharge_date')
          .eq('patient_id', patient.id)
          .order('admission_date', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        let admissionStatus = 'no_visit';
        if (visit) {
          if (visit.patient_type !== 'IPD') {
            admissionStatus = 'not_ipd';
          } else if (!visit.admission_date) {
            admissionStatus = 'not_ipd';
          } else if (visit.discharge_date) {
            admissionStatus = 'discharged';
          } else {
            admissionStatus = 'active_ipd';
          }
        }

        return {
          status: 'matched',
          patient,
          visit,
          admissionStatus,
          evidence: {
            matched_by: 'linkage_table',
            patient_id: patient.id,
            visit_id: visit?.id
          }
        };
      }
    }

    // Step 2: Try auto-match by name + date
    const claimDate = claim.preauth_date || claim.payment_date;
    const autoMatch = await autoMatchClaimByNameAndDate(
      claim.beneficiary_name,
      claimDate,
      hospitalName
    );

    if (autoMatch) {
      // Store the linkage for future use
      await storePatientLinkage(
        hospitalName,
        autoMatch.patient_id,
        regId || progId || '',
        regId ? 'registration_id' : 'program_id',
        'auto_name_date'
      );

      // Load patient and visit data
      const { data: patient } = await supabase
        .from('patients')
        .select('id, name, patients_id, registration_id, pmjay_program_id')
        .eq('id', autoMatch.patient_id)
        .maybeSingle();

      if (patient) {
        const { data: visit } = await supabase
          .from('visits')
          .select('id, visit_id, patient_type, admission_date, discharge_date')
          .eq('patient_id', patient.id)
          .order('admission_date', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        let admissionStatus = 'no_visit';
        if (visit) {
          if (visit.patient_type !== 'IPD') {
            admissionStatus = 'not_ipd';
          } else if (!visit.admission_date) {
            admissionStatus = 'not_ipd';
          } else if (visit.discharge_date) {
            admissionStatus = 'discharged';
          } else {
            admissionStatus = 'active_ipd';
          }
        }

        return {
          status: 'matched',
          patient,
          visit,
          admissionStatus,
          evidence: {
            matched_by: 'auto_name_date',
            patient_id: patient.id,
            visit_id: visit?.id
          }
        };
      }
    }

    // Step 3: Direct lookup (existing IDs might work)
    const { data: patient } = await supabase
      .from('patients')
      .select('id, name, patients_id, registration_id, pmjay_program_id')
      .or(`registration_id.eq.${regId},patients_id.eq.${progId},pmjay_program_id.eq.${progId}`)
      .limit(1)
      .maybeSingle();

    if (patient) {
      const { data: visit } = await supabase
        .from('visits')
        .select('id, visit_id, patient_type, admission_date, discharge_date')
        .eq('patient_id', patient.id)
        .order('admission_date', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      let admissionStatus = 'no_visit';
      if (visit) {
        if (visit.patient_type !== 'IPD') {
          admissionStatus = 'not_ipd';
        } else if (!visit.admission_date) {
          admissionStatus = 'not_ipd';
        } else if (visit.discharge_date) {
          admissionStatus = 'discharged';
        } else {
          admissionStatus = 'active_ipd';
        }
      }

      return {
        status: 'matched',
        patient,
        visit,
        admissionStatus,
        evidence: {
          matched_by: patient.registration_id === regId ? 'registration_id' : 'program_id',
          patient_id: patient.id,
          visit_id: visit?.id
        }
      };
    }

    // Step 4: Not found anywhere
    return { status: 'unmatched', patient: null, visit: null, admissionStatus: 'no_visit' };
  } catch (error) {
    // Error during verification - return error status
    return { status: 'error', patient: null, visit: null, admissionStatus: 'error' };
  }
}

const formatMoney = (value: unknown) => {
  if (value === null || value === undefined || value === '' || value === '—') return '—';
  const num = Number(value);
  if (!Number.isFinite(num) || isNaN(num)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
};

const formatDate = (value: unknown) => {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  return String(value);
};

// ============================================================================
// Deduplication: Merge duplicate patient records by beneficiary name
// ============================================================================

const STAGE_PRIORITY: Record<string, number> = {
  'payment_accomplished': 6,
  'payment_initiated': 5,
  'pending_with_payer': 4,
  'claims_sent_to_bank': 3,
  'claims_to_be_submitted': 2,
  'under_treatment': 1,
  'rejected': 0
};

function deduplicateClaims(claims: Claim[]): Claim[] {
  // Group by beneficiary name (case-insensitive, trimmed)
  const grouped = new Map<string, Claim[]>();

  claims.forEach(claim => {
    const key = String(claim.beneficiary_name || '').toLowerCase().trim();
    if (!key) return;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(claim);
  });

  // Merge duplicates
  const deduplicated: Claim[] = [];

  grouped.forEach((group, beneficiaryName) => {
    if (group.length === 1) {
      // No duplicates - keep as-is
      deduplicated.push(group[0]);
      return;
    }

    // Duplicates exist - merge them
    // Sort by stage priority (most recent first)
    const sorted = [...group].sort((a, b) => {
      const priorityA = STAGE_PRIORITY[a.current_stage] || 0;
      const priorityB = STAGE_PRIORITY[b.current_stage] || 0;
      return priorityB - priorityA;
    });

    const primary = sorted[0]; // Most recent status
    const allIDs = sorted.map(c => c.id);

    // Collect all unique government IDs
    const allRegIDs = [...new Set(sorted.map(c => c.government_registration_id).filter(Boolean))];
    const allProgIDs = [...new Set(sorted.map(c => c.government_program_id).filter(Boolean))];

    // Collect all unique remarks
    const allRemarks = [...new Set(sorted.map(c => c.remark).filter(Boolean))].join('; ');

    // Create merged claim
    const merged: Claim = {
      ...primary,
      government_registration_id: allRegIDs[0] || primary.government_registration_id,
      government_program_id: allProgIDs[0] || primary.government_program_id,
      remark: allRemarks || primary.remark,
      merged_count: sorted.length,
      id: primary.id
    };

    deduplicated.push(merged);
  });

  // Add any claims without beneficiary names
  const nameless = claims.filter(c => !String(c.beneficiary_name || '').trim());
  deduplicated.push(...nameless);

  return deduplicated;
}

// ============================================================================
// Components
// ============================================================================

function PortalImport({ onPreview, onImported }: { onPreview: (files: CorporateClaimParsedFile[]) => void; onImported: () => void }) {
  const { hospitalType } = useAuth();
  const [files, setFiles] = useState<CorporateClaimParsedFile[]>([]);
  const [busy, setBusy] = useState(false);

  const readFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;

    setBusy(true);
    try {
      const parsed = await Promise.all(selected.map(parseCorporateClaimFile));
      setFiles(parsed);
      onPreview(parsed);

      if (parsed.some((file) => file.fatalErrors.length)) {
        toast.error('Some files need correction before import.');
      } else {
        toast.success(`${parsed.length} file(s) validated locally.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Files could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const importSnapshot = async () => {
    if (!files.length) {
      toast.error('No files to save. Please upload files first.');
      return;
    }
    if (files.some((file) => file.fatalErrors.length)) {
      toast.error('Cannot save files with fatal errors. Please fix errors first.');
      return;
    }

    setBusy(true);
    try {
      const contentFingerprints = await Promise.all(files.map(corporateClaimFileFingerprint));

      // Save to simplified snapshot table (no Edge Function needed)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = contentFingerprints[i];

        // Check for duplicate
        const { data: existing } = await supabase
          .from('corporate_claim_snapshots')
          .select('id')
          .eq('content_hash', hash)
          .maybeSingle();

        if (!existing) {
          await supabase.from('corporate_claim_snapshots').insert({
            hospital_name: (hospitalType || 'hope').toLowerCase(),
            scheme_code: 'ALL',
            file_name: file.fileName,
            parsed_data: file,
            content_hash: hash
          });
        }
      }

      toast.success(`${files.length} file(s) saved to snapshots.`);
      onImported();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CorporateClaimTracking] Import error:', error);
      toast.error(`Failed to save snapshots: ${errorMsg}. Check Supabase RLS policies and hospital context.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-indigo-200 bg-indigo-50/40">
      <CardHeader>
        <div className="flex gap-3">
          <ShieldCheck className="h-5 w-5 text-indigo-700" />
          <div>
            <CardTitle className="text-base">Protected portal import</CardTitle>
            <CardDescription>
              Upload all six files together. Duplicate content is skipped and only new tracking tables are written.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input type="file" accept=".csv,.xls,.xlsx" multiple onChange={readFiles} disabled={busy} />
        <p className="text-xs text-muted-foreground">
          PJ… = PMJAY, MJ… = MJPJAY. Other Program IDs are Unresolved.
        </p>
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file) => (
              <div key={file.fileName} className="flex items-center justify-between rounded border bg-background p-2 text-sm">
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
                  {file.fileName} · {file.rows.length} rows
                </span>
                <Badge variant={file.fatalErrors.length ? 'destructive' : 'outline'}>
                  {file.fatalErrors.length ? 'Needs correction' : file.fileType}
                </Badge>
              </div>
            ))}
            <Button
              onClick={importSnapshot}
              disabled={busy || files.some((file) => file.fatalErrors.length)}
            >
              <Upload className="mr-2 h-4 w-4" />
              {busy ? 'Saving…' : 'Save snapshot'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function previewClaims(files: CorporateClaimParsedFile[]): Claim[] {
  return files.flatMap((file) =>
    file.rows.map((row) => {
      const caseStatus = String(row.originalValues['Case Status'] || '').toLowerCase();
      let stage: string = file.fileType;

      if (file.fileType === 'claims_approved_from_bank') {
        if (caseStatus.includes('accomplished')) stage = 'payment_accomplished';
        else if (caseStatus.includes('initiated')) stage = 'payment_initiated';
      }

      return {
        id: `preview-${file.fileName}-${row.rowNumber}`,
        scheme_type: schemeForProgramId(row.originalValues['Program ID']),
        beneficiary_name: row.originalValues['Beneficiary Name'],
        government_registration_id: row.originalValues['Registration ID'],
        government_program_id: row.originalValues['Program ID'],
        current_stage: stage,
        claimed_amount: row.normalizedValues.claim_amount,
        approved_amount: row.normalizedValues.approved_amount,
        paid_amount: row.normalizedValues.paid_amount,
        payment_state: row.normalizedValues.paid_amount ? 'received' : 'not_due',
        verification_state: 'pending', // Will be verified against live data
        admission_status: 'pending', // Will be verified against live data
        match_state: row.issues.length ? 'invalid' : 'preview',
        raw_government_status: row.originalValues['Case Status'],
        source_file_name: file.fileName,
        row_number: row.rowNumber,
        isPreview: true, // Still marks source, but verification happens immediately
        remark: String(row.originalValues['Remark'] || row.originalValues['Reason'] || '').trim() // Extract remarks from CSV
      };
    })
  );
}

// Helper function to check if a claim is stale (>120 days since discharge)
function isStaleClaim(row: Claim): boolean {
  if (!row.matched_visit?.discharge_date) return false;
  const dischargeDate = new Date(row.matched_visit.discharge_date);
  const today = new Date();
  const daysDiff = Math.floor((today.getTime() - dischargeDate.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff > 120;
}

function ClaimDetailDrawer({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  if (!claim) return null;

  const isPreview = claim.isPreview;

  // Calculate days pending from discharge date
  const calculateDaysPending = (): number | null => {
    if (!claim.matched_visit?.discharge_date) return null;
    const dischargeDate = new Date(claim.matched_visit.discharge_date);
    const today = new Date();
    const daysDiff = Math.floor((today.getTime() - dischargeDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff > 0 ? daysDiff : 0;
  };

  const daysPending = calculateDaysPending();
  const isStaleClaim = daysPending !== null && daysPending > 120;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-background shadow-xl">
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Claim Details</h2>
              <p className="text-sm text-muted-foreground">
                {claim.beneficiary_name || 'Unknown Patient'}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Portal Evidence Section */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
              <Info className="h-4 w-4" />
              Portal Evidence
            </h3>
            <div className="space-y-3">
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Scheme</Label>
                      <p className="font-medium">{claim.scheme_type || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Stage</Label>
                      <p className="font-medium">{STAGE_LABELS[claim.current_stage as Exclude<Stage, 'all'>] || claim.current_stage}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Registration ID</Label>
                      <p className="font-medium">{claim.government_registration_id || '—'}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Program ID</Label>
                      <p className="font-medium">{claim.government_program_id || '—'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {claim.source_file_name && (
                <Card>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">Source File</Label>
                        <p className="font-medium">{claim.source_file_name}</p>
                      </div>
                      {claim.row_number && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Row Number</Label>
                          <p className="font-medium">{claim.row_number}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {claim.remark && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Remark / Issue</Label>
                    <p className="text-sm font-medium text-amber-900">{claim.remark}</p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Claimed Amount</Label>
                      <p className="font-medium">{formatMoney(claim.claimed_amount)}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Approved Amount</Label>
                      <p className="font-medium">{formatMoney(claim.approved_amount)}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Paid Amount</Label>
                      <p className="font-medium text-emerald-700">{formatMoney(claim.paid_amount)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {claim.raw_government_status && (
                <Card>
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Case Status</Label>
                    <p className="text-sm">{claim.raw_government_status}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </section>

          <Separator />

          {/* Adamrit Verification Section */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Adamrit Verification
            </h3>
            <div className="space-y-3">
              {claim.matched_patient && (
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium text-green-900">Matched Patient</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Name:</span> {claim.matched_patient.name}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Patient ID:</span> {claim.matched_patient.patients_id || '—'}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Registration ID:</span> {claim.matched_patient.registration_id || '—'}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Internal ID:</span> {claim.matched_patient.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Verification State</Label>
                      <Badge
                        variant={
                          claim.verification_state === 'matched' ? 'default' :
                          claim.verification_state === 'unmatched' || claim.verification_state === 'invalid' ? 'destructive' :
                          claim.verification_state === 'ambiguous' ? 'secondary' :
                          claim.verification_state === 'pending' ? 'secondary' : 'outline'
                        }
                      >
                        {claim.verification_state === 'pending' ? 'Pending Verification' :
                         VERIFICATION_LABELS[claim.verification_state as VerificationStatus] || claim.verification_state || 'Not Checked'}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Admission Status</Label>
                      <Badge
                        variant={
                          claim.admission_status === 'active_ipd' ? 'default' :
                          claim.admission_status === 'discharged' || claim.admission_status === 'not_ipd' ? 'secondary' :
                          claim.admission_status === 'no_visit' || claim.admission_status === 'not_matched' ? 'destructive' :
                          claim.admission_status === 'pending' ? 'secondary' : 'outline'
                        }
                      >
                        {claim.admission_status === 'pending' ? 'Pending Verification' :
                         ADMISSION_LABELS[claim.admission_status as AdmissionStatus] || claim.admission_status || 'Not Checked'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {claim.matched_visit && (
                <Card className={isStaleClaim ? 'border-amber-300 bg-amber-50' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs text-muted-foreground">Latest Visit</Label>
                      {isStaleClaim && (
                        <div className="flex items-center gap-1 text-amber-600" title="Claim pending for over 120 days">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">Stale Claim</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-xs grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">Type:</span> {claim.matched_visit.patient_type}
                      </div>
                      {claim.matched_visit.admission_date && (
                        <div>
                          <span className="text-muted-foreground">Admitted:</span> {formatDate(claim.matched_visit.admission_date)}
                        </div>
                      )}
                      {claim.matched_visit.discharge_date && (
                        <div>
                          <span className="text-muted-foreground">Discharged:</span> {formatDate(claim.matched_visit.discharge_date)}
                        </div>
                      )}
                      {daysPending !== null && (
                        <div className={isStaleClaim ? 'font-medium text-amber-700' : ''}>
                          <span className="text-muted-foreground">Days Pending:</span>{' '}
                          {daysPending} {isStaleClaim && '(⚠️ Over 4 months)'}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Visit ID:</span> {claim.matched_visit.id.slice(0, 8)}...
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {claim.verification_evidence && (
                <Card>
                  <CardContent className="p-4">
                    <Label className="text-xs text-muted-foreground">Match Evidence</Label>
                    <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                      {JSON.stringify(claim.verification_evidence, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          </section>

          <Separator />

          {/* Payment Details */}
          {Number(claim.paid_amount || 0) > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
                <History className="h-4 w-4" />
                Payment Details
              </h3>
              <div className="space-y-3">
                {/* Government Payment Data */}
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">Government Portal Payment</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">Paid Amount (Portal)</Label>
                        <p className="font-medium text-emerald-700">{formatMoney(claim.paid_amount)}</p>
                      </div>
                      {claim.utr && (
                        <div>
                          <Label className="text-xs text-muted-foreground">UTR (Portal)</Label>
                          <p className="font-medium">{claim.utr}</p>
                        </div>
                      )}
                      {claim.payment_date && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Payment Date (Portal)</Label>
                          <p className="font-medium">{formatDate(claim.payment_date)}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Adamrit Billing Data */}
                {claim.payment_status && (
                  <Card className={claim.payment_status.hasBill ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}>
                    <CardContent className="p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                        {claim.payment_status.hasBill ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                            <span className="text-green-900">Bill Found in Adamrit</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3 text-amber-600" />
                            <span className="text-amber-900">No Bill in Adamrit</span>
                          </>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        {claim.payment_status.billDetails && (
                          <>
                            <div>
                              <Label className="text-xs text-muted-foreground">Bill Amount</Label>
                              <p className="font-medium">{formatMoney(claim.payment_status.billDetails.bill_amount)}</p>
                            </div>
                            {claim.payment_status.billDetails.received_amount && (
                              <div>
                                <Label className="text-xs text-muted-foreground">Received Amount</Label>
                                <p className="font-medium">{formatMoney(claim.payment_status.billDetails.received_amount)}</p>
                              </div>
                            )}
                            {claim.payment_status.billDetails.tds_amount && (
                              <div>
                                <Label className="text-xs text-muted-foreground">TDS Amount</Label>
                                <p className="font-medium">{formatMoney(claim.payment_status.billDetails.tds_amount)}</p>
                              </div>
                            )}
                            {claim.payment_status.billDetails.date_of_submission && (
                              <div>
                                <Label className="text-xs text-muted-foreground">Submission Date</Label>
                                <p className="font-medium">{formatDate(claim.payment_status.billDetails.date_of_submission)}</p>
                              </div>
                            )}
                          </>
                        )}
                        <div>
                          <Label className="text-xs text-muted-foreground">Payment Transactions</Label>
                          <p className="font-medium">{claim.payment_status.paymentCount} transaction(s)</p>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Total Paid (Adamrit)</Label>
                          <p className="font-medium">{formatMoney(claim.payment_status.totalPaid)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          )}

          {/* Status Badge Legend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status Reference</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <Badge className="mr-2">Matched</Badge>
                <span className="text-muted-foreground">Exact Registration ID / Program ID match found</span>
              </div>
              <div>
                <Badge variant="destructive" className="mr-2">Unmatched</Badge>
                <span className="text-muted-foreground">No matching Adamrit patient found</span>
              </div>
              <div>
                <Badge variant="secondary" className="mr-2">Ambiguous</Badge>
                <span className="text-muted-foreground">Multiple patients matched - manual review required</span>
              </div>
              <div>
                <Badge variant="outline" className="mr-2">Active IPD</Badge>
                <span className="text-muted-foreground">Patient is currently admitted (IPD + admission date + no discharge)</span>
              </div>
              <div>
                <Badge className="mr-2" style={{ background: 'hsl(var(--secondary))' }}>Discharged</Badge>
                <span className="text-muted-foreground">Patient was discharged</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Operations() {
  const { hospitalType } = useAuth();
  const [saved, setSaved] = useState<Claim[]>([]);
  const [preview, setPreview] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);

  // Filters
  const [scheme, setScheme] = useState<SchemeFilter>('ALL');
  const [stage, setStage] = useState<Stage>('all');
  const [verification, setVerification] = useState<VerificationStatus>('all');
  const [admission, setAdmission] = useState<AdmissionStatus>('all');
  const [search, setSearch] = useState('');
  const [showOnlyNeedsReview, setShowOnlyNeedsReview] = useState(false);
  const [activeIPDOnly, setActiveIPDOnly] = useState(false); // NEW: Filter for active IPD only
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Load from snapshots table (simplified approach)
      const { data, error: queryError } = await supabase
        .from('corporate_claim_snapshots')
        .select('*')
        .eq('hospital_name', (hospitalType || 'hope').toLowerCase())
        .order('created_at', { ascending: false });

      if (queryError) {
        const errorMsg = queryError.message || 'Unknown error';
        console.error('[CorporateClaimTracking] Query error:', queryError);
        setError(`Failed to load saved data: ${errorMsg}. Local preview remains available; check Supabase connection and RLS policies.`);
      } else {
        setError('');
        // Expand parsed_data from snapshots into claim rows
        const expandedClaims = (data || []).flatMap((snapshot: { parsed_data: CorporateClaimParsedFile }) => {
          const file = snapshot.parsed_data;
          return file.rows.map((row) => {
            const caseStatus = String(row.originalValues['Case Status'] || '').toLowerCase();
            let stage: string = file.fileType;
            if (file.fileType === 'claims_approved_from_bank') {
              if (caseStatus.includes('accomplished')) stage = 'payment_accomplished';
              else if (caseStatus.includes('initiated')) stage = 'payment_initiated';
            }
            return {
              id: `saved-${snapshot.id}-${row.rowNumber}`,
              scheme_type: schemeForProgramId(row.originalValues['Program ID']),
              beneficiary_name: row.originalValues['Beneficiary Name'],
              government_registration_id: row.originalValues['Registration ID'],
              government_program_id: row.originalValues['Program ID'],
              current_stage: stage,
              claimed_amount: row.normalizedValues.claim_amount,
              approved_amount: row.normalizedValues.approved_amount,
              paid_amount: row.normalizedValues.paid_amount,
              payment_state: row.normalizedValues.paid_amount ? 'received' : 'not_due',
              verification_state: 'pending',
              admission_status: 'pending',
              utr: row.normalizedValues.utr,
              payment_date: row.normalizedValues.payment_date,
              source_file_name: file.fileName,
              row_number: row.rowNumber,
              isPreview: false,
              remark: String(row.originalValues['Remark'] || row.originalValues['Reason'] || '').trim() // Extract remarks from CSV
            };
          });
        });
        setSaved(expandedClaims);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[CorporateClaimTracking] Refresh error:', err);
      setError(`Database connection failed: ${errorMsg}. Check Supabase configuration and RLS policies.`);
    } finally {
      setLoading(false);
    }
  }, [hospitalType]);

  const handleExport = async (type: 'csv' | 'excel' | 'reconciliation' | 'payment-utr') => {
    const claimsToExport: ClaimRow[] = filtered.map(row => ({
      id: row.id,
      scheme_type: row.scheme_type,
      beneficiary_name: row.beneficiary_name,
      government_registration_id: row.government_registration_id,
      government_program_id: row.government_program_id,
      current_stage: row.current_stage,
      claimed_amount: row.claimed_amount,
      approved_amount: row.approved_amount,
      paid_amount: row.paid_amount,
      tds_amount: row.tds_amount,
      rf_amount: row.rf_amount,
      utr: row.utr,
      payment_date: row.payment_date,
      preauth_date: row.preauth_date,
      verification_state: row.verification_state,
      admission_status: row.admission_status,
      matched_patient: row.matched_patient,
      matched_visit: row.matched_visit,
      raw_government_status: row.raw_government_status,
      source_file_name: row.source_file_name,
      row_number: row.row_number
    }));

    const filters: ClaimExportFilters = {
      scheme: scheme === 'ALL' ? 'ALL' : scheme === 'PMJAY' ? 'PMJAY' : 'MJPJAY',
      stage: stage === 'all' ? 'all' : stage,
      verificationState: verification === 'all' ? 'all' : verification,
      admissionStatus: admission === 'all' ? 'all' : admission
    };

    try {
      switch (type) {
        case 'csv':
          exportClaimsToCSV(claimsToExport, filters);
          toast.success('CSV export started');
          break;
        case 'excel':
          exportClaimsToExcel(claimsToExport, filters);
          toast.success('Excel export started');
          break;
        case 'reconciliation':
          exportReconciliationReport(claimsToExport, filters);
          toast.success('Reconciliation report export started');
          break;
        case 'payment-utr':
          exportPaymentUTRReconciliation(claimsToExport);
          toast.success('Payment/UTR reconciliation export started');
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  const [verifiedCount, setVerifiedCount] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);

  // Verify preview claims against live Adamrit data
  useEffect(() => {
    if (preview.length === 0) return;
    // Skip if already verified (verifiedCount matches current length)
    if (preview.length === verifiedCount && !isVerifying) return;

    const verifyPreviewClaims = async () => {
      setIsVerifying(true);
      try {
        const verifiedClaims = await Promise.all(
          preview.map(async (claim) => {
            // Skip already verified claims
            if (claim.verification_state !== 'pending' && claim.verification_state !== 'not_checked') {
              return claim;
            }

            // Verify patient and visit
            const result = await verifyClaimAgainstAdamrit(claim);

            // Check payment status if claim has paid_amount
            let paymentStatus = undefined;
            if (Number(claim.paid_amount || 0) > 0 && result.patient?.id && result.visit?.visit_id) {
              paymentStatus = await checkPaymentStatus(result.patient.id, result.visit.visit_id);
            }

            return {
              ...claim,
              verification_state: result.status,
              admission_status: result.admissionStatus,
              verification_evidence: result.evidence,
              matched_patient: result.patient,
              matched_visit: result.visit,
              payment_status: paymentStatus
            };
          })
        );
        setPreview(verifiedClaims);
        setVerifiedCount(verifiedClaims.length);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyPreviewClaims();
  }, [preview.length, verifiedCount]);

  // Verify saved claims against live Adamrit data (when loaded from database)
  const [savedVerifiedCount, setSavedVerifiedCount] = useState(0);
  useEffect(() => {
    if (saved.length === 0) return;
    // Skip if already verified
    if (saved.length === savedVerifiedCount && !isVerifying) return;

    const verifySavedClaims = async () => {
      setIsVerifying(true);
      try {
        const verifiedClaims = await Promise.all(
          saved.map(async (claim) => {
            // Skip already verified claims
            if (claim.verification_state !== 'pending' && claim.verification_state !== 'not_checked') {
              return claim;
            }

            // Verify patient and visit
            const result = await verifyClaimAgainstAdamrit(claim);

            // Check payment status if claim has paid_amount
            let paymentStatus = undefined;
            if (Number(claim.paid_amount || 0) > 0 && result.patient?.id && result.visit?.visit_id) {
              paymentStatus = await checkPaymentStatus(result.patient.id, result.visit.visit_id);
            }

            return {
              ...claim,
              verification_state: result.status,
              admission_status: result.admissionStatus,
              verification_evidence: result.evidence,
              matched_patient: result.patient,
              matched_visit: result.visit,
              payment_status: paymentStatus
            };
          })
        );
        setSaved(verifiedClaims);
        setSavedVerifiedCount(verifiedClaims.length);
      } finally {
        setIsVerifying(false);
      }
    };

    verifySavedClaims();
  }, [saved.length, savedVerifiedCount]);

  const all = useMemo(() => {
    const rawData = preview.length ? preview : saved;
    return deduplicateClaims(rawData); // Apply deduplication
  }, [preview, saved]);

  const scoped = useMemo(() => {
    if (scheme === 'ALL') return all;
    return all.filter((row) => row.scheme_type === scheme);
  }, [all, scheme]);

  const filtered = useMemo(() => {
    return scoped.filter((row) => {
      // Needs Review quick filter
      if (showOnlyNeedsReview) {
        const needsReview = ['unmatched', 'invalid', 'ambiguous', 'conflict', 'pending'].includes(row.verification_state);
        if (!needsReview) return false;
      }

      // Stage filter
      if (stage !== 'all' && row.current_stage !== stage) return false;

      // Verification filter
      if (verification !== 'all' && row.verification_state !== verification) return false;

      // Admission filter
      if (admission !== 'all' && row.admission_status !== admission) return false;

      // Active IPD Only filter
      if (activeIPDOnly && row.admission_status !== 'active_ipd') return false;

      // Search filter
      if (search.trim()) {
        const searchLower = search.trim().toLowerCase();
        return [
          row.beneficiary_name,
          row.government_registration_id,
          row.government_program_id,
          row.raw_government_status,
          row.utr
        ].some((value) => String(value || '').toLowerCase().includes(searchLower));
      }

      return true;
    });
  }, [scoped, stage, verification, admission, search, showOnlyNeedsReview, activeIPDOnly]);

  // Calculate dashboard metrics
  const metrics = useMemo(() => {
    const base = scoped;
    const uniqueBeneficiaries = new Set(base.map(r => String(r.beneficiary_name || '').toLowerCase().trim()));

    return {
      total: base.length,
      unique_patients: uniqueBeneficiaries.size, // NEW: Count unique patients
      // Count actual verification states (no preview distinction)
      matched: base.filter((r) => r.verification_state === 'matched').length,
      active_ipd: base.filter((r) => r.admission_status === 'active_ipd').length,
      discharged: base.filter((r) => r.admission_status === 'discharged').length,
      unmatched: base.filter((r) => r.verification_state === 'unmatched').length,
      ambiguous: base.filter((r) => r.verification_state === 'ambiguous').length,
      conflict: base.filter((r) => r.verification_state === 'conflict' || r.verification_state === 'invalid').length,
      // Count rows that need review (pending verification + issues)
      // Needs Review = Unmatched, Invalid, Ambiguous, Conflict, or Pending
      needs_review: base.filter((r) =>
        ['unmatched', 'invalid', 'ambiguous', 'conflict', 'pending'].includes(r.verification_state)
      ).length,
      paid_rows: base.filter((r) => Number(r.paid_amount || 0) > 0).length,
      paid_total: base.reduce((sum, r) => sum + Number(r.paid_amount || 0), 0)
    };
  }, [scoped]);

  const paidTotal = formatMoney(metrics.paid_total);

  return (
    <div className="space-y-5">
      <PortalImport
        onPreview={(files) => setPreview(previewClaims(files))}
        onImported={refresh}
      />

      {/* Scheme Filters */}
      <div className="flex flex-wrap gap-2 rounded-lg border bg-background p-2">
        <span className="self-center px-2 text-sm font-semibold">Scheme:</span>
        {(['ALL', 'PMJAY', 'MJPJAY', 'UNRESOLVED'] as SchemeFilter[]).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={scheme === item ? 'default' : 'outline'}
            onClick={() => {
              setScheme(item);
              setStage('all');
              setVerification('all');
              setAdmission('all');
              setShowOnlyNeedsReview(false);
            }}
          >
            {item === 'ALL' ? 'All' : item}
          </Button>
        ))}
      </div>

      {/* Active IPD Filter */}
      <div className="flex flex-wrap gap-2 rounded-lg border bg-background p-2">
        <span className="self-center px-2 text-sm font-semibold">Quick Filter:</span>
        <Button
          size="sm"
          variant={activeIPDOnly ? 'default' : 'outline'}
          onClick={() => {
            setActiveIPDOnly(!activeIPDOnly);
            if (!activeIPDOnly) {
              setAdmission('active_ipd');
            } else {
              setAdmission('all');
            }
          }}
        >
          Active IPD Only {activeIPDOnly && '(On)'}
        </Button>
      </div>

      {/* Preview Mode Banner */}
      {preview.length > 0 && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="p-4 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-blue-900">
                Live Verification Active
                {isVerifying && ' - Verifying claims...'}
              </p>
              <p className="text-blue-800 mt-1">
                Claim data is verified directly against Adamrit patients and visits in real-time.
                Click <strong>"Save snapshot"</strong> to persist files for future reference.
              </p>
            </div>
            {isVerifying && (
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Dashboard Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Claims */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('all'); setShowOnlyNeedsReview(false); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unique Patients</p>
            <p className="text-2xl font-bold">{metrics.unique_patients}</p>
            <p className="text-xs text-muted-foreground">{metrics.total} total rows</p>
          </CardContent>
        </Card>

        {/* Matched */}
        <Card onClick={() => { setStage('all'); setVerification('matched'); setAdmission('all'); setShowOnlyNeedsReview(false); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Adamrit Matched</p>
            <p className="text-2xl font-bold text-blue-700">{metrics.matched}</p>
          </CardContent>
        </Card>

        {/* Active IPD */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('active_ipd'); setShowOnlyNeedsReview(false); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Admitted</p>
            <p className="text-2xl font-bold text-green-700">{metrics.active_ipd}</p>
          </CardContent>
        </Card>

        {/* Discharged */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('discharged'); setShowOnlyNeedsReview(false); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Discharged</p>
            <p className="text-2xl font-bold text-orange-700">{metrics.discharged}</p>
          </CardContent>
        </Card>

        {/* Unmatched */}
        <Card onClick={() => { setStage('all'); setVerification('unmatched'); setAdmission('all'); setShowOnlyNeedsReview(false); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unmatched</p>
            <p className="text-2xl font-bold text-red-700">{metrics.unmatched}</p>
          </CardContent>
        </Card>

        {/* Needs Review */}
        <Card onClick={() => {
          setShowOnlyNeedsReview(!showOnlyNeedsReview);
          setStage('all');
          setVerification('all');
          setAdmission('all');
        }} className={`cursor-pointer hover:bg-accent/50 border-amber-300 bg-amber-50 ${showOnlyNeedsReview ? 'ring-2 ring-amber-500' : ''}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Needs Review {showOnlyNeedsReview && '(Active)'}</p>
            <p className="text-2xl font-bold text-amber-700">{metrics.needs_review}</p>
          </CardContent>
        </Card>

        {/* Paid Total */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Paid Total ({metrics.paid_rows} rows)</p>
            <p className="text-2xl font-bold text-emerald-700">{paidTotal}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stage Filter Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((item) => (
          <Card
            key={item}
            onClick={() => {
              setStage(item);
              setShowOnlyNeedsReview(false);
            }}
            className="cursor-pointer hover:bg-accent/50"
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{STAGE_LABELS[item]}</p>
              <p className="text-2xl font-bold">
                {scoped.filter((row) => row.current_stage === item).length}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Worklist Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Claim Worklist</CardTitle>
              <CardDescription>
                {preview.length
                  ? 'Local portal preview — rows shown directly from the selected files.'
                  : 'Saved tracking data from Supabase.'}
              </CardDescription>
            </div>
            {!preview.length && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refresh}
                  disabled={loading}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport('csv')}
                  disabled={loading || filtered.length === 0}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport('excel')}
                  disabled={loading || filtered.length === 0}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport('reconciliation')}
                  disabled={loading || filtered.length === 0}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Reconciliation
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport('payment-utr')}
                  disabled={loading || filtered.length === 0}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Payment/UTR Check
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters Row */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient, IDs, UTR, status..."
              />
            </div>

            <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
              <SelectTrigger>
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={verification} onValueChange={(v) => setVerification(v as VerificationStatus)}>
              <SelectTrigger>
                <SelectValue placeholder="All Verification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verification</SelectItem>
                {Object.entries(VERIFICATION_LABELS).filter(([k]) => k !== 'all').map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={admission} onValueChange={(v) => setAdmission(v as AdmissionStatus)}>
              <SelectTrigger>
                <SelectValue placeholder="All Admission" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Admission</SelectItem>
                {Object.entries(ADMISSION_LABELS).filter(([k]) => k !== 'all').map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active Filters Display */}
          {(stage !== 'all' || verification !== 'all' || admission !== 'all' || showOnlyNeedsReview) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {stage !== 'all' && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  Stage: {STAGE_LABELS[stage as Exclude<Stage, 'all'>]}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setStage('all')} />
                </Badge>
              )}
              {verification !== 'all' && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  Verification: {VERIFICATION_LABELS[verification]}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setVerification('all')} />
                </Badge>
              )}
              {admission !== 'all' && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  Admission: {ADMISSION_LABELS[admission]}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setAdmission('all')} />
                </Badge>
              )}
              {showOnlyNeedsReview && (
                <Badge variant="secondary" className="flex items-center gap-1 bg-amber-100">
                  Needs Review
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setShowOnlyNeedsReview(false)} />
                </Badge>
              )}
            </div>
          )}

          {error && !preview.length && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mr-2 inline h-4 w-4" />
              {error}
            </div>
          )}

          {/* Data Table */}
          <div className="max-h-[600px] overflow-auto rounded border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Scheme</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Registration / Program ID</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Admission</TableHead>
                  <TableHead>Amounts</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !preview.length ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const stale = isStaleClaim(row);
                    return (
                    <TableRow
                      key={row.id}
                      className={`cursor-pointer hover:bg-accent/50 ${stale ? 'bg-amber-50 hover:bg-amber-100' : ''}`}
                      onClick={() => setSelectedClaim(row)}
                    >
                      <TableCell>
                        <Badge
                          variant={
                            row.scheme_type === 'PMJAY' ? 'default' :
                              row.scheme_type === 'MJPJAY' ? 'secondary' : 'destructive'
                          }
                        >
                          {row.scheme_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.beneficiary_name || '—'}
                        {row.merged_count && row.merged_count > 1 && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            Merged {row.merged_count}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.government_registration_id || '—'}
                        <p className="text-xs text-muted-foreground">{row.government_program_id || '—'}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{STAGE_LABELS[row.current_stage as Exclude<Stage, 'all'>] || row.current_stage}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.verification_state === 'matched' ? 'default' :
                              row.verification_state === 'unmatched' || row.verification_state === 'invalid' ? 'destructive' :
                                row.verification_state === 'ambiguous' ? 'secondary' : 'outline'
                          }
                        >
                          {row.verification_state || 'Not Checked'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.admission_status === 'active_ipd' ? 'default' :
                              row.admission_status === 'discharged' || row.admission_status === 'not_ipd' ? 'secondary' :
                                row.admission_status === 'no_visit' || row.admission_status === 'not_matched' ? 'destructive' : 'outline'
                          }
                        >
                          {ADMISSION_LABELS[row.admission_status as AdmissionStatus] || row.admission_status || 'Not Checked'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <div>Claim: {formatMoney(row.claimed_amount)}</div>
                          <div>Approved: {formatMoney(row.approved_amount)}</div>
                        </div>
                      </TableCell>
                      <TableCell className={Number(row.paid_amount || 0) > 0 ? 'text-emerald-700 font-medium' : ''}>
                        {formatMoney(row.paid_amount)}
                      </TableCell>
                      <TableCell>
                        {row.remark ? (
                          <Badge variant="secondary" className="text-xs max-w-[200px] truncate" title={row.remark}>
                            {row.remark}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="w-8">
                        {stale && (
                          <AlertTriangle className="h-4 w-4 text-amber-600" title="Stale claim: Pending over 120 days" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                  })
                )}
                {!loading && !filtered.length && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      No records match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Records Count */}
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {scoped.length} records
            {preview.length && ' (local preview)'}
          </div>
        </CardContent>
      </Card>

      {/* Claim Detail Drawer */}
      <ClaimDetailDrawer claim={selectedClaim} onClose={() => setSelectedClaim(null)} />
    </div>
  );
}

export default function CorporateClaimTracking() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            Government claims
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Corporate Claim Tracking
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Combined PMJAY and MJPJAY intake with separate scheme filters. Portal data is verified against Adamrit patients and visits.
            Existing HMIS records are never updated.
          </p>
        </header>
        <Operations />
      </div>
    </div>
  );
}
