import { useEffect, useMemo, useState } from 'react';
import { endOfDay, format, startOfDay, subDays } from 'date-fns';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PATIENT_DOC_CATEGORIES } from '@/tablet/hooks/usePatientDocs';
import { Input } from '@/components/ui/input';
import {
  fetchLatestGovernmentPortalExtensionAlerts,
  type GovernmentPortalExtensionAlertRow,
} from '@/lib/governmentPortalReportDb';
import {
  appendDialysisSuffix,
  isDialysisText,
  isYojanaText,
} from '@/utils/dialysisPatientName';
import { formatDateOnlyForDisplay } from '@/utils/dateOnly';

type TodoReason = 'Admitted last 2 days' | 'Discharged last 2 days' | 'Surgery last 2 days' | 'Extension today';

interface TodoDocumentRow {
  id: string;
  patientId: string | null;
  patientName: string | null;
  displayName: string;
  patientsId: string | null;
  visitId: string | null;
  visitNumber: string | null;
  registrationId: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  surgeryDate: string | null;
  reasons: TodoReason[];
  done: string[];
  left: string[];
}

interface VisibleTodoDocumentRow extends TodoDocumentRow {
  visibleDone: string[];
  visibleLeft: string[];
}

interface TodoCandidate {
  key: string;
  patientId: string | null;
  patientName: string | null;
  patientsId: string | null;
  visitId: string | null;
  visitNumber: string | null;
  registrationId: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  surgeryDate: string | null;
  visit: any | null;
  reasons: Set<TodoReason>;
}

type UploadedPatientDocument = {
  patient_id: string | null;
  patient_name: string | null;
  category: string | null;
};

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40];
const DEFAULT_PAGE_SIZE = 10;
const CORE_DOCUMENT_IDS = ['treatment_sheet', 'monitor_chart', 'lab_investigation', 'radiology_investigation', 'discharge_summary'];
const SURGERY_DOCUMENT_IDS = ['ot_notes', 'ot_photos', 'implant_invoice', 'implant_sticker'];
const DIALYSIS_DOCUMENT_IDS = ['dialysis'];
const canonicalCategoryIds = PATIENT_DOC_CATEGORIES.map((document) => document.id);

const normalizeValue = (value: string | null | undefined) => value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
const normalizeLookup = (value: string | null | undefined) => value?.trim().toUpperCase() || '';
const unique = <T,>(items: T[]) => Array.from(new Set(items));
const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  return value.includes('T') ? format(new Date(value), 'dd/MM/yyyy') : formatDateOnlyForDisplay(value);
};

const rowPatient = (row: any) => Array.isArray(row?.patients) ? row.patients[0] : row?.patients;

const getVisitRegistration = (visit: any) =>
  normalizeLookup(visit?.yojana_registration_id);

const getVisitPortalLookupId = (visit: any) =>
  getVisitRegistration(visit) || normalizeLookup(visit?.claim_id);

const visitMatchesYojana = (visit: any) =>
  [
    visit?.corporate,
    visit?.insurance_type,
    rowPatient(visit)?.corporate,
    visit?.yojana_registration_id,
  ].some(isYojanaText);

const isWithinRange = (value: string | null | undefined, from: Date, to: Date) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
};

function getVisitReasons(visit: any, from: Date, to: Date): TodoReason[] {
  const reasons: TodoReason[] = [];
  if (isWithinRange(visit.admission_date, from, to)) reasons.push('Admitted last 2 days');
  if (isWithinRange(visit.discharge_date, from, to)) reasons.push('Discharged last 2 days');
  if (isWithinRange(visit.surgery_date, from, to)) reasons.push('Surgery last 2 days');
  return reasons;
}

function addCandidate(
  candidates: Map<string, TodoCandidate>,
  input: Omit<TodoCandidate, 'reasons'> & { reasons: TodoReason[] },
) {
  const key = input.patientId ? `patient:${input.patientId}` : input.registrationId ? `reg:${input.registrationId}` : input.key;
  const existing = candidates.get(key);
  if (existing) {
    input.reasons.forEach((reason) => existing.reasons.add(reason));
    existing.visit = existing.visit || input.visit;
    existing.visitId = existing.visitId || input.visitId;
    existing.visitNumber = existing.visitNumber || input.visitNumber;
    existing.registrationId = existing.registrationId || input.registrationId;
    existing.patientName = existing.patientName || input.patientName;
    existing.patientsId = existing.patientsId || input.patientsId;
    existing.admissionDate = existing.admissionDate || input.admissionDate;
    existing.dischargeDate = existing.dischargeDate || input.dischargeDate;
    existing.surgeryDate = existing.surgeryDate || input.surgeryDate;
    return;
  }

  candidates.set(key, {
    ...input,
    reasons: new Set(input.reasons),
  });
}

function getRequiredDocuments(candidate: TodoCandidate, hasAnySurgery: boolean, hasDialysis: boolean) {
  const visitIndicatesDialysis = [
    candidate.visit?.package_name,
    candidate.visit?.treatment_type,
    candidate.visit?.reason_for_visit,
    candidate.visit?.sst_treatment,
    candidate.visit?.cghs_code,
  ].some(isDialysisText);

  return PATIENT_DOC_CATEGORIES.filter((document) => {
    if (CORE_DOCUMENT_IDS.includes(document.id)) return true;
    if (SURGERY_DOCUMENT_IDS.includes(document.id)) return hasAnySurgery || Boolean(candidate.surgeryDate);
    if (DIALYSIS_DOCUMENT_IDS.includes(document.id)) return hasDialysis || visitIndicatesDialysis;
    return false;
  });
}

function DocumentList({ items, tone }: { items: string[]; tone: 'done' | 'left' }) {
  return (
    <ul className={tone === 'left' ? 'mt-2 flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto pr-2 text-sm leading-5' : 'mt-2 max-h-44 space-y-1 overflow-y-auto pr-2 text-sm leading-5'}>
      {items.map((item) => (
        <li key={item} className={tone === 'left' ? 'flex max-w-full items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700' : 'flex items-start gap-2 text-green-700'}>
          {tone === 'done' ? <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className={tone === 'left' ? 'break-words' : undefined}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CountBadge({ count, tone }: { count: number; tone: 'done' | 'left' }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
      {count} {tone === 'done' ? 'done' : 'left'}
    </span>
  );
}

function ReasonPills({ reasons }: { reasons: TodoReason[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {reasons.map((reason) => (
        <span key={reason} className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
          {reason}
        </span>
      ))}
    </div>
  );
}

export default function YojanaBillingTodoDocumentsReport() {
  const [allRows, setAllRows] = useState<TodoDocumentRow[]>([]);
  const [search, setSearch] = useState('');
  const [documentFilter, setDocumentFilter] = useState('all');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, Number(searchParams.get('page') || '1'));

  const today = useMemo(() => new Date(), []);
  const windowStart = useMemo(() => startOfDay(subDays(today, 2)), [today]);
  const windowEnd = useMemo(() => endOfDay(today), [today]);
  const dateWindowLabel = `${format(windowStart, 'dd/MM/yyyy')} - ${format(windowEnd, 'dd/MM/yyyy')}`;

  const goToPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(Math.max(1, page)));
    setSearchParams(next, { replace: true });
  };
  const resetPage = () => goToPage(1);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      const recentVisitsResult = await supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          patient_id,
          admission_date,
          discharge_date,
          surgery_date,
          package_name,
          treatment_type,
          reason_for_visit,
          sst_treatment,
          cghs_code,
          corporate,
          insurance_type,
          yojana_registration_id,
          claim_id,
          patients(id, name, patients_id, phone, corporate, hospital_name)
        `)
        .eq('patient_type', 'IPD')
        .or(`admission_date.gte.${windowStart.toISOString()},discharge_date.gte.${windowStart.toISOString()},surgery_date.gte.${format(windowStart, 'yyyy-MM-dd')}`)
        .order('admission_date', { ascending: false })
        .limit(1000);

      if (recentVisitsResult.error) throw recentVisitsResult.error;

      const extensionSummary = await fetchLatestGovernmentPortalExtensionAlerts(500);
      const extensionRows = extensionSummary?.rows || [];
      const extensionIds = unique(extensionRows.map((row) => normalizeLookup(row.registrationId)).filter(Boolean));

      const extensionVisitResults = extensionIds.length
        ? await Promise.all([
          supabase
            .from('visits')
            .select(`
              id,
              visit_id,
              patient_id,
              admission_date,
              discharge_date,
              surgery_date,
              package_name,
              treatment_type,
              reason_for_visit,
              sst_treatment,
              cghs_code,
              corporate,
              insurance_type,
              yojana_registration_id,
              claim_id,
              patients(id, name, patients_id, phone, corporate, hospital_name)
            `)
            .in('yojana_registration_id', extensionIds),
          supabase
            .from('visits')
            .select(`
              id,
              visit_id,
              patient_id,
              admission_date,
              discharge_date,
              surgery_date,
              package_name,
              treatment_type,
              reason_for_visit,
              sst_treatment,
              cghs_code,
              corporate,
              insurance_type,
              yojana_registration_id,
              claim_id,
              patients(id, name, patients_id, phone, corporate, hospital_name)
            `)
            .in('claim_id', extensionIds),
        ])
        : [];

      for (const result of extensionVisitResults) {
        if (result.error) throw result.error;
      }

      if (!active) return;

      const candidates = new Map<string, TodoCandidate>();
      const extensionByRegistration = new Map<string, GovernmentPortalExtensionAlertRow>();
      for (const row of extensionRows) {
        const registrationId = normalizeLookup(row.registrationId);
        if (registrationId) extensionByRegistration.set(registrationId, row);
      }

      for (const visit of (recentVisitsResult.data || []) as any[]) {
        if (!visitMatchesYojana(visit)) continue;
        const patient = rowPatient(visit);
        const reasons = getVisitReasons(visit, windowStart, windowEnd);
        if (reasons.length === 0) continue;
        addCandidate(candidates, {
          key: `visit:${visit.id}`,
          patientId: visit.patient_id || patient?.id || null,
          patientName: patient?.name || null,
          patientsId: patient?.patients_id || null,
          visitId: visit.id,
          visitNumber: visit.visit_id || null,
          registrationId: getVisitRegistration(visit) || null,
          admissionDate: visit.admission_date || null,
          dischargeDate: visit.discharge_date || null,
          surgeryDate: visit.surgery_date || null,
          visit,
          reasons,
        });
      }

      const matchedExtensionIds = new Set<string>();
      for (const visit of extensionVisitResults.flatMap((result) => result.data || []) as any[]) {
        const portalLookupId = getVisitPortalLookupId(visit);
        if (!portalLookupId || !extensionByRegistration.has(portalLookupId)) continue;
        matchedExtensionIds.add(portalLookupId);
        const patient = rowPatient(visit);
        const extensionRow = extensionByRegistration.get(portalLookupId);
        addCandidate(candidates, {
          key: `visit:${visit.id}`,
          patientId: visit.patient_id || patient?.id || null,
          patientName: patient?.name || extensionRow?.beneficiaryName || null,
          patientsId: patient?.patients_id || null,
          visitId: visit.id,
          visitNumber: visit.visit_id || null,
          registrationId: getVisitRegistration(visit) || extensionRow?.registrationId || null,
          admissionDate: visit.admission_date || null,
          dischargeDate: visit.discharge_date || null,
          surgeryDate: visit.surgery_date || null,
          visit,
          reasons: ['Extension today'],
        });
      }

      for (const row of extensionRows) {
        const registrationId = normalizeLookup(row.registrationId);
        if (registrationId && matchedExtensionIds.has(registrationId)) continue;
        addCandidate(candidates, {
          key: `portal:${row.rowNumber}:${registrationId || normalizeValue(row.beneficiaryName)}`,
          patientId: null,
          patientName: row.beneficiaryName || null,
          patientsId: null,
          visitId: null,
          visitNumber: null,
          registrationId: registrationId || null,
          admissionDate: null,
          dischargeDate: null,
          surgeryDate: null,
          visit: null,
          reasons: ['Extension today'],
        });
      }

      const candidateList = Array.from(candidates.values());
      const patientIds = unique(candidateList.map((candidate) => candidate.patientId).filter(Boolean) as string[]);

      const [uploadsResult, surgeriesResult, dialysisResult] = await Promise.all([
        patientIds.length
          ? supabase
            .from('file_uploads')
            .select('patient_id, patient_name, category')
            .in('patient_id', patientIds)
            .in('category', canonicalCategoryIds)
            .limit(20000)
          : Promise.resolve({ data: [], error: null } as any),
        patientIds.length
          ? supabase
            .from('visits')
            .select('patient_id')
            .in('patient_id', patientIds)
            .not('surgery_date', 'is', null)
          : Promise.resolve({ data: [], error: null } as any),
        patientIds.length
          ? supabase
            .from('dialysis_sessions')
            .select('patient_id')
            .in('patient_id', patientIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (uploadsResult.error) throw uploadsResult.error;
      if (surgeriesResult.error) throw surgeriesResult.error;
      if (dialysisResult.error) throw dialysisResult.error;

      const documentsByPatient = new Map<string, UploadedPatientDocument[]>();
      for (const upload of (uploadsResult.data || []) as UploadedPatientDocument[]) {
        if (!upload.patient_id || !upload.category) continue;
        documentsByPatient.set(upload.patient_id, [...(documentsByPatient.get(upload.patient_id) || []), upload]);
      }

      const surgeryPatientIds = new Set<string>();
      for (const row of surgeriesResult.data || []) if (row.patient_id) surgeryPatientIds.add(row.patient_id);

      const dialysisPatientIds = new Set<string>();
      for (const row of dialysisResult.data || []) if (row.patient_id) dialysisPatientIds.add(row.patient_id);

      const computedRows = candidateList.map((candidate) => {
        const uploadedCategories = new Set(
          (candidate.patientId ? documentsByPatient.get(candidate.patientId) || [] : [])
            .map((upload) => normalizeValue(upload.category)),
        );
        const hasAnySurgery = Boolean(candidate.patientId && surgeryPatientIds.has(candidate.patientId));
        const hasDialysis = Boolean(candidate.patientId && dialysisPatientIds.has(candidate.patientId));
        const requiredDocuments = getRequiredDocuments(candidate, hasAnySurgery, hasDialysis);
        const done = requiredDocuments
          .filter((document) => uploadedCategories.has(normalizeValue(document.id)))
          .map((document) => document.label);
        const left = requiredDocuments
          .filter((document) => !uploadedCategories.has(normalizeValue(document.id)))
          .map((document) => document.label);
        const displayName = appendDialysisSuffix(
          candidate.patientName || candidate.registrationId || 'Unnamed patient',
          visitMatchesYojana(candidate.visit) && (hasDialysis || [candidate.visit?.package_name, candidate.visit?.treatment_type, candidate.visit?.reason_for_visit].some(isDialysisText)),
        );

        return {
          id: candidate.patientId || candidate.registrationId || candidate.key,
          patientId: candidate.patientId,
          patientName: candidate.patientName,
          displayName,
          patientsId: candidate.patientsId,
          visitId: candidate.visitId,
          visitNumber: candidate.visitNumber,
          registrationId: candidate.registrationId,
          admissionDate: candidate.admissionDate,
          dischargeDate: candidate.dischargeDate,
          surgeryDate: candidate.surgeryDate,
          reasons: Array.from(candidate.reasons),
          done,
          left,
        };
      })
        .filter((row) => row.left.length > 0)
        .sort((left, right) => right.reasons.length - left.reasons.length || left.displayName.localeCompare(right.displayName));

      setAllRows(computedRows);
      setLoading(false);
    };

    load().catch((loadError) => {
      if (!active) return;
      setAllRows([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load today\'s Yojana billing to-do list.');
      setLoading(false);
    });

    return () => { active = false; };
  }, [refreshTick, windowEnd, windowStart]);

  const filteredRows = useMemo<VisibleTodoDocumentRow[]>(() => {
    const term = search.trim().toLowerCase();
    return allRows.flatMap((row) => {
      if (term) {
        const haystack = [
          row.displayName,
          row.patientsId,
          row.visitNumber,
          row.registrationId,
          row.reasons.join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return [];
      }

      const visibleDone = documentFilter === 'all' ? row.done : row.done.filter((item) => item === documentFilter);
      const visibleLeft = documentFilter === 'all' ? row.left : row.left.filter((item) => item === documentFilter);
      if (visibleLeft.length === 0) return [];
      return [{ ...row, visibleDone, visibleLeft }];
    });
  }, [allRows, documentFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const rows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const handlePrint = () => {
    if (filteredRows.length === 0) return;
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      window.alert('Pop-up blocked. Allow pop-ups for this site to print the report.');
      return;
    }

    const esc = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const renderDocs = (items: string[]) => items.length
      ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
      : '<span class="muted">None</span>';

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>To-do list for billing of Yojana patients today</title>
          <style>
            @page { margin: 14mm; size: A4 landscape; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
            header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 14px; }
            h1 { margin: 0 0 4px; font-size: 22px; line-height: 1.2; }
            .subtitle { color: #6b7280; font-size: 12px; }
            .meta { text-align: right; color: #4b5563; line-height: 1.6; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; vertical-align: top; text-align: left; }
            th { background: #f3f4f6; color: #4b5563; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
            tr { break-inside: avoid; page-break-inside: avoid; }
            .patient { font-weight: 700; font-size: 13px; }
            .muted { color: #9ca3af; }
            .reasons span { display: inline-block; margin: 0 4px 4px 0; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 700; }
            ul { margin: 0; padding-left: 17px; }
            li { margin: 2px 0; }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>To-do list for billing of Yojana patients today</h1>
              <div class="subtitle">Pending patient documents for recent admissions, discharges, surgeries, and today's extension list.</div>
            </div>
            <div class="meta">
              <div><strong>${filteredRows.length}</strong> pending patient${filteredRows.length === 1 ? '' : 's'}</div>
              <div>Window ${esc(dateWindowLabel)}</div>
              <div>Printed ${esc(new Date().toLocaleString('en-IN'))}</div>
            </div>
          </header>
          <table>
            <thead>
              <tr>
                <th style="width: 5%;">#</th>
                <th style="width: 22%;">Patient</th>
                <th style="width: 19%;">Reason</th>
                <th style="width: 14%;">Dates</th>
                <th style="width: 20%;">Documents Done</th>
                <th style="width: 20%;">Documents Pending</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRows.map((row, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>
                    <div class="patient">${esc(row.displayName)}</div>
                    <div class="muted">${esc([row.patientsId, row.visitNumber, row.registrationId].filter(Boolean).join(' | '))}</div>
                  </td>
                  <td><div class="reasons">${row.reasons.map((reason) => `<span>${esc(reason)}</span>`).join('')}</div></td>
                  <td>
                    <div>Adm: ${esc(formatDateTime(row.admissionDate))}</div>
                    <div>Dis: ${esc(formatDateTime(row.dischargeDate))}</div>
                    <div>Surg: ${esc(formatDateTime(row.surgeryDate))}</div>
                  </td>
                  <td>${renderDocs(row.visibleDone)}</td>
                  <td>${renderDocs(row.visibleLeft)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>
            window.onload = () => {
              window.print();
              window.onafterprint = () => window.close();
            };
          </script>
        </body>
      </html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/reports-center" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Back to Reports Center">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">To-do list for billing of Yojana patients today</h1>
            <p className="text-sm text-gray-500">
              Pending documents for recent admissions, discharges, surgeries, and today's extension list.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshTick((value) => value + 1)}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.99]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || !!error || filteredRows.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_260px_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
            placeholder="Search patient, visit, registration ID, or reason"
            className="h-10 w-full pl-9"
          />
        </div>
        <select
          value={documentFilter}
          onChange={(event) => {
            setDocumentFilter(event.target.value);
            resetPage();
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">All pending document types</option>
          {PATIENT_DOC_CATEGORIES.map((document) => (
            <option key={document.id} value={document.label}>{document.label}</option>
          ))}
        </select>
        <div className="flex items-center rounded-md border border-blue-100 bg-blue-50 px-3 text-sm font-medium text-blue-700">
          Window: {dateWindowLabel}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending patients</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{filteredRows.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Admissions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{allRows.filter((row) => row.reasons.includes('Admitted last 2 days')).length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Discharges</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{allRows.filter((row) => row.reasons.includes('Discharged last 2 days')).length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Extensions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{allRows.filter((row) => row.reasons.includes('Extension today')).length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-3 text-sm text-gray-500">
          <span>{rows.length ? `Showing ${(safePage - 1) * pageSize + 1}-${(safePage - 1) * pageSize + rows.length} of ${filteredRows.length} pending patients` : 'No pending patients'}</span>
          {(search || documentFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setDocumentFilter('all');
                resetPage();
              }}
              className="font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full table-fixed divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-[20%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Patient</th>
                <th className="w-[18%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">To-do reason</th>
                <th className="w-[15%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Dates</th>
                <th className="w-[22%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Done</th>
                <th className="w-[20%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Pending</th>
                <th className="w-[5%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                    <Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />
                    Loading Yojana billing to-do list...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-red-600">{error}</td>
                </tr>
              )}
              {!loading && !error && rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-800">{row.displayName}</div>
                    <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                      {row.patientsId ? <div>Patient ID: {row.patientsId}</div> : null}
                      {row.visitNumber ? <div>Visit: {row.visitNumber}</div> : null}
                      {row.registrationId ? <div>Reg: {row.registrationId}</div> : null}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <ReasonPills reasons={row.reasons} />
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">
                    <div>Adm: {formatDateTime(row.admissionDate)}</div>
                    <div>Dis: {formatDateTime(row.dischargeDate)}</div>
                    <div>Surg: {formatDateTime(row.surgeryDate)}</div>
                  </td>
                  <td className="px-5 py-4">
                    <CountBadge count={row.visibleDone.length} tone="done" />
                    {row.visibleDone.length ? <DocumentList items={row.visibleDone} tone="done" /> : <span className="mt-2 block text-sm text-gray-400">None</span>}
                  </td>
                  <td className="px-5 py-4">
                    <CountBadge count={row.visibleLeft.length} tone="left" />
                    <DocumentList items={row.visibleLeft} tone="left" />
                  </td>
                  <td className="px-5 py-4">
                    <Link
                      to={`/advance-statement-report?search=${encodeURIComponent(row.patientName || row.registrationId || row.displayName)}&includeDischarged=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                      title="View registration ID and billing details in Advance Statement Report"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Details
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                    No pending Yojana patient documents found for today's billing to-do list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !error && filteredRows.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <label htmlFor="page-size">Rows per page</label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                resetPage();
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <span className="text-sm text-gray-500">Page {safePage} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => goToPage(1)} disabled={safePage === 1} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => goToPage(safePage + 1)} disabled={safePage >= totalPages} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
