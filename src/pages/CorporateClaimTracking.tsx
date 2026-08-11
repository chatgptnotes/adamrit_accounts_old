import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AlertCircle, ArrowUpDown, Calendar, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, FileSpreadsheet, History, Info, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck, Upload, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { corporateClaimFileFingerprint, parseCorporateClaimFile, schemeForProgramId, type CorporateClaimParsedFile } from '@/lib/corporateClaimTracking';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type Claim = Record<string, any>;
type SchemeFilter = 'ALL' | 'PMJAY' | 'MJPJAY' | 'UNRESOLVED';
type Stage = 'all' | 'under_treatment' | 'claims_to_be_submitted' | 'claims_sent_to_bank' | 'pending_with_payer' | 'payment_initiated' | 'payment_accomplished' | 'rejected';
type VerificationStatus = 'all' | 'matched' | 'unmatched' | 'ambiguous' | 'conflict' | 'invalid' | 'not_checked';
type AdmissionStatus = 'all' | 'active_ipd' | 'discharged' | 'not_ipd' | 'no_visit' | 'not_matched' | 'ambiguous' | 'conflict' | 'not_checked';

const STAGES: Exclude<Stage, 'all'>[] = ['under_treatment', 'claims_to_be_submitted', 'claims_sent_to_bank', 'pending_with_payer', 'payment_initiated', 'payment_accomplished', 'rejected'];
const STAGE_LABELS: Record<Exclude<Stage, 'all'>, string> = {
  under_treatment: 'Under Treatment',
  claims_to_be_submitted: 'To Be Submitted',
  claims_sent_to_bank: 'Sent To Bank',
  pending_with_payer: 'Pending With Payer',
  payment_initiated: 'Payment Initiated',
  payment_accomplished: 'Payment Accomplished',
  rejected: 'Rejected'
};

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  all: 'All Verification',
  matched: 'Matched',
  unmatched: 'Unmatched',
  ambiguous: 'Ambiguous',
  conflict: 'Conflict',
  invalid: 'Invalid',
  not_checked: 'Not Checked'
};

const ADMISSION_LABELS: Record<AdmissionStatus, string> = {
  all: 'All Admission',
  active_ipd: 'Active IPD',
  discharged: 'Discharged',
  not_ipd: 'Not IPD',
  no_visit: 'No Visit',
  not_matched: 'Not Matched',
  ambiguous: 'Ambiguous',
  conflict: 'Conflict',
  not_checked: 'Not Checked'
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
    if (!files.length || files.some((file) => file.fatalErrors.length)) return;

    setBusy(true);
    try {
      const contentFingerprints = await Promise.all(files.map(corporateClaimFileFingerprint));
      const { data, error } = await supabase.functions.invoke('corporate-claim-import', {
        body: {
          hospitalName: (hospitalType || 'hope').toLowerCase(),
          schemeCode: 'ALL',
          sourceKind: 'portal',
          files,
          contentFingerprints
        }
      });

      if (error) throw error;
      toast.success(`${data?.validRows || 0} valid row(s) imported; ${data?.duplicateFiles || 0} duplicate file(s) skipped.`);
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Saved import is unavailable until local Supabase is running.');
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
              {busy ? 'Processing…' : 'Import validated snapshot'}
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
        verification_state: 'not_checked',
        admission_status: 'not_checked',
        match_state: row.issues.length ? 'invalid' : 'preview',
        raw_government_status: row.originalValues['Case Status'],
        source_file_name: file.fileName,
        row_number: row.rowNumber,
        isPreview: true
      };
    })
  );
}

function ClaimDetailDrawer({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  if (!claim) return null;

  const isPreview = claim.isPreview;

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
              {isPreview ? (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 text-sm">
                      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-900">Preview Mode - Not Verified</p>
                        <p className="text-amber-800">
                          This row is from the local file preview. Adamrit patient matching requires saved import with Supabase running.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <Label className="text-xs text-muted-foreground">Verification State</Label>
                          <Badge
                            variant={
                              claim.verification_state === 'matched' ? 'default' :
                              claim.verification_state === 'unmatched' || claim.verification_state === 'invalid' ? 'destructive' :
                              claim.verification_state === 'ambiguous' ? 'secondary' : 'outline'
                            }
                          >
                            {claim.verification_state || 'Not Checked'}
                          </Badge>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Admission Status</Label>
                          <Badge
                            variant={
                              claim.admission_status === 'active_ipd' ? 'default' :
                              claim.admission_status === 'discharged' || claim.admission_status === 'not_ipd' ? 'secondary' :
                              claim.admission_status === 'no_visit' || claim.admission_status === 'not_matched' ? 'destructive' : 'outline'
                            }
                          >
                            {ADMISSION_LABELS[claim.admission_status as AdmissionStatus] || claim.admission_status || 'Not Checked'}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

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
                </>
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
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Paid Amount</Label>
                      <p className="font-medium text-emerald-700">{formatMoney(claim.paid_amount)}</p>
                    </div>
                    {claim.utr && (
                      <div>
                        <Label className="text-xs text-muted-foreground">UTR</Label>
                        <p className="font-medium">{claim.utr}</p>
                      </div>
                    )}
                    {claim.payment_date && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Payment Date</Label>
                        <p className="font-medium">{formatDate(claim.payment_date)}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from('corporate_claims')
        .select('*')
        .eq('hospital_name', hospitalType || 'hope')
        .order('updated_at', { ascending: false });

      if (queryError) {
        setError('Saved data is unavailable. Local preview remains available; start local Supabase for persistence.');
      } else {
        setError('');
        setSaved((data || []).map((row: Claim) => ({ ...row, scheme_type: row.scheme_code })));
      }
    } catch (err) {
      setError('Database connection failed.');
    } finally {
      setLoading(false);
    }
  }, [hospitalType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const all = preview.length ? preview : saved;

  const scoped = useMemo(() => {
    if (scheme === 'ALL') return all;
    return all.filter((row) => row.scheme_type === scheme);
  }, [all, scheme]);

  const filtered = useMemo(() => {
    return scoped.filter((row) => {
      // Stage filter
      if (stage !== 'all' && row.current_stage !== stage) return false;

      // Verification filter
      if (verification !== 'all' && row.verification_state !== verification) return false;

      // Admission filter
      if (admission !== 'all' && row.admission_status !== admission) return false;

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
  }, [scoped, stage, verification, admission, search]);

  // Calculate dashboard metrics
  const metrics = useMemo(() => {
    const base = scoped;

    return {
      total: base.length,
      matched: base.filter((r) => r.verification_state === 'matched').length,
      active_ipd: base.filter((r) => r.admission_status === 'active_ipd').length,
      discharged: base.filter((r) => r.admission_status === 'discharged').length,
      unmatched: base.filter((r) => r.verification_state === 'unmatched').length,
      ambiguous: base.filter((r) => r.verification_state === 'ambiguous').length,
      conflict: base.filter((r) => r.verification_state === 'conflict' || r.verification_state === 'invalid').length,
      needs_review: base.filter((r) =>
        !['matched', 'manual_match', 'preview', 'not_checked'].includes(r.verification_state) ||
        !['active_ipd'].includes(r.admission_status)
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
            }}
          >
            {item === 'ALL' ? 'All' : item}
          </Button>
        ))}
      </div>

      {/* Dashboard Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Claims */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('all'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Claims</p>
            <p className="text-2xl font-bold">{metrics.total}</p>
          </CardContent>
        </Card>

        {/* Matched */}
        <Card onClick={() => { setStage('all'); setVerification('matched'); setAdmission('all'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Adamrit Matched</p>
            <p className="text-2xl font-bold text-blue-700">{metrics.matched}</p>
          </CardContent>
        </Card>

        {/* Active IPD */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('active_ipd'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Admitted</p>
            <p className="text-2xl font-bold text-green-700">{metrics.active_ipd}</p>
          </CardContent>
        </Card>

        {/* Discharged */}
        <Card onClick={() => { setStage('all'); setVerification('all'); setAdmission('discharged'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Discharged</p>
            <p className="text-2xl font-bold text-orange-700">{metrics.discharged}</p>
          </CardContent>
        </Card>

        {/* Unmatched */}
        <Card onClick={() => { setStage('all'); setVerification('unmatched'); setAdmission('all'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unmatched</p>
            <p className="text-2xl font-bold text-red-700">{metrics.unmatched}</p>
          </CardContent>
        </Card>

        {/* Ambiguous */}
        <Card onClick={() => { setStage('all'); setVerification('ambiguous'); setAdmission('all'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ambiguous</p>
            <p className="text-2xl font-bold text-amber-700">{metrics.ambiguous}</p>
          </CardContent>
        </Card>

        {/* Conflict/Invalid */}
        <Card onClick={() => { setStage('all'); setVerification('conflict'); setAdmission('all'); }} className="cursor-pointer hover:bg-accent/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Conflict/Invalid</p>
            <p className="text-2xl font-bold text-red-700">{metrics.conflict}</p>
          </CardContent>
        </Card>

        {/* Needs Review */}
        <Card onClick={() => { setStage('all'); }} className="cursor-pointer hover:bg-accent/50 border-amber-300 bg-amber-50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Needs Review</p>
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
            onClick={() => setStage(item)}
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
              <Button
                size="sm"
                variant="outline"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
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
          {(stage !== 'all' || verification !== 'all' || admission !== 'all') && (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !preview.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-accent/50"
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
                      <TableCell className="font-medium">{row.beneficiary_name || '—'}</TableCell>
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
                    </TableRow>
                  ))
                )}
                {!loading && !filtered.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
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
