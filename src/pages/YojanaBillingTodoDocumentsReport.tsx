import { useEffect, useMemo, useState } from 'react';
import { format, subHours } from 'date-fns';
import {
  ArrowLeft,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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

const TODO_REASONS = {
  admitted: 'Admitted in last 48 hours',
  discharged: 'Discharged in last 48 hours',
  operated: 'Operated in last 48 hours',
  extension: 'Extension to be taken and not taken in last 48 hours',
} as const;

type TodoReason = typeof TODO_REASONS[keyof typeof TODO_REASONS];

const SECTION_DEFINITIONS: { title: string; reason: TodoReason; empty: string }[] = [
  {
    title: 'Admitted in last 48 hours',
    reason: TODO_REASONS.admitted,
    empty: 'No recently admitted Yojana patients have pending documents for the selected filter.',
  },
  {
    title: 'Discharged in last 48 hours',
    reason: TODO_REASONS.discharged,
    empty: 'No recently discharged Yojana patients have pending documents for the selected filter.',
  },
  {
    title: 'Operated in last 48 hours',
    reason: TODO_REASONS.operated,
    empty: 'No recently operated Yojana patients have pending documents for the selected filter.',
  },
  {
    title: 'Extension to be taken and not taken in last 48 hours',
    reason: TODO_REASONS.extension,
    empty: 'No pending extension cases have pending documents for the selected filter.',
  },
];

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
  extensionStatus: string | null;
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
  extensionStatus: string | null;
  visit: any | null;
  reasons: Set<TodoReason>;
}

type UploadedPatientDocument = {
  patient_id: string | null;
  patient_name: string | null;
  category: string | null;
};

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
const rowVisit = (row: any) => Array.isArray(row?.visits) ? row.visits[0] : row?.visits;

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

const normalizeStatus = (value: string | null | undefined) =>
  normalizeValue(value).replace(/[\s-]+/g, '_');

const visitNeedsExtensionToBeTaken = (visit: any) => {
  const extensionOfStay = normalizeStatus(visit?.extension_of_stay);
  const extensionTaken = normalizeStatus(visit?.extension_taken);

  if (extensionOfStay === 'not_taken') return true;
  if (extensionOfStay === 'taken' || extensionOfStay === 'not_required') return false;
  if (extensionTaken === 'not_taken' || extensionTaken === 'no' || extensionTaken === 'pending') return true;

  return false;
};

function getVisitReasons(visit: any, from: Date, to: Date): TodoReason[] {
  const reasons: TodoReason[] = [];
  if (isWithinRange(visit.admission_date, from, to)) reasons.push(TODO_REASONS.admitted);
  if (isWithinRange(visit.discharge_date, from, to)) reasons.push(TODO_REASONS.discharged);
  if (isWithinRange(visit.surgery_date, from, to)) reasons.push(TODO_REASONS.operated);

  const extensionTouchedInWindow = [
    visit.updated_at,
    visit.created_at,
    visit.admission_date,
    visit.discharge_date,
    visit.surgery_date,
  ].some((value) => isWithinRange(value, from, to));

  if (visitNeedsExtensionToBeTaken(visit) && extensionTouchedInWindow) {
    reasons.push(TODO_REASONS.extension);
  }

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
    existing.extensionStatus = existing.extensionStatus || input.extensionStatus;
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
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), [refreshTick]);
  const windowStart = useMemo(() => subHours(now, 48), [now]);
  const windowEnd = now;
  const dateWindowLabel = `${format(windowStart, 'dd/MM/yyyy HH:mm')} - ${format(windowEnd, 'dd/MM/yyyy HH:mm')}`;

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
          extension_of_stay,
          extension_taken,
          created_at,
          updated_at,
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
        .or(`admission_date.gte.${windowStart.toISOString()},discharge_date.gte.${windowStart.toISOString()},surgery_date.gte.${format(windowStart, 'yyyy-MM-dd')},created_at.gte.${windowStart.toISOString()},updated_at.gte.${windowStart.toISOString()}`)
        .order('admission_date', { ascending: false })
        .limit(1000);

      if (recentVisitsResult.error) throw recentVisitsResult.error;

      const completedOtSchedulesResult = await supabase
        .from('ot_schedule')
        .select(`
          id,
          patient_id,
          visit_id,
          surgery_name,
          scheduled_date,
          scheduled_time,
          status,
          actual_end_time,
          updated_at,
          patients(id, name, patients_id, phone, corporate, hospital_name),
          visits(
            id,
            visit_id,
            patient_id,
            admission_date,
            discharge_date,
            surgery_date,
            extension_of_stay,
            extension_taken,
            created_at,
            updated_at,
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
          )
        `)
        .eq('status', 'completed')
        .or(`actual_end_time.gte.${windowStart.toISOString()},updated_at.gte.${windowStart.toISOString()},scheduled_date.gte.${format(windowStart, 'yyyy-MM-dd')}`)
        .limit(1000);

      if (completedOtSchedulesResult.error) throw completedOtSchedulesResult.error;

      const recentOtPhotosResult = await supabase
        .from('file_uploads')
        .select('patient_id, patient_name, created_at')
        .eq('category', 'ot_photos')
        .gte('created_at', windowStart.toISOString())
        .lte('created_at', windowEnd.toISOString())
        .limit(1000);

      if (recentOtPhotosResult.error) throw recentOtPhotosResult.error;

      const otPhotoPatientIds = unique(
        ((recentOtPhotosResult.data || []) as any[])
          .map((row) => row.patient_id)
          .filter(Boolean),
      );

      const otPhotoVisitsResult = otPhotoPatientIds.length
        ? await supabase
          .from('visits')
          .select(`
            id,
            visit_id,
            patient_id,
            admission_date,
            discharge_date,
            surgery_date,
            extension_of_stay,
            extension_taken,
            created_at,
            updated_at,
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
          .in('patient_id', otPhotoPatientIds)
          .eq('patient_type', 'IPD')
          .order('admission_date', { ascending: false })
          .limit(1000)
        : { data: [], error: null } as any;

      if (otPhotoVisitsResult.error) throw otPhotoVisitsResult.error;

      const extensionSummary = await fetchLatestGovernmentPortalExtensionAlerts(500);
      const extensionRows = extensionSummary && isWithinRange(extensionSummary.createdAt, windowStart, windowEnd)
        ? extensionSummary.rows
        : [];
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
              extension_of_stay,
              extension_taken,
              created_at,
              updated_at,
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
              extension_of_stay,
              extension_taken,
              created_at,
              updated_at,
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
          extensionStatus: visit.extension_of_stay || visit.extension_taken || null,
          visit,
          reasons,
        });
      }

      for (const schedule of (completedOtSchedulesResult.data || []) as any[]) {
        const visit = rowVisit(schedule);
        const patient = rowPatient(visit) || rowPatient(schedule);
        if (!visitMatchesYojana(visit)) continue;
        addCandidate(candidates, {
          key: `ot-schedule:${schedule.id}`,
          patientId: visit?.patient_id || schedule.patient_id || patient?.id || null,
          patientName: patient?.name || null,
          patientsId: patient?.patients_id || null,
          visitId: visit?.id || schedule.visit_id || null,
          visitNumber: visit?.visit_id || null,
          registrationId: getVisitRegistration(visit) || null,
          admissionDate: visit?.admission_date || null,
          dischargeDate: visit?.discharge_date || null,
          surgeryDate: visit?.surgery_date || schedule.actual_end_time || schedule.scheduled_date || null,
          extensionStatus: visit?.extension_of_stay || visit?.extension_taken || null,
          visit,
          reasons: [TODO_REASONS.operated],
        });
      }

      const latestOtPhotoByPatient = new Map<string, any>();
      for (const row of (recentOtPhotosResult.data || []) as any[]) {
        if (!row.patient_id) continue;
        const existing = latestOtPhotoByPatient.get(row.patient_id);
        if (!existing || new Date(row.created_at).getTime() > new Date(existing.created_at).getTime()) {
          latestOtPhotoByPatient.set(row.patient_id, row);
        }
      }

      const seenPhotoPatients = new Set<string>();
      for (const visit of (otPhotoVisitsResult.data || []) as any[]) {
        if (!visit.patient_id || seenPhotoPatients.has(visit.patient_id)) continue;
        if (!visitMatchesYojana(visit)) continue;
        seenPhotoPatients.add(visit.patient_id);
        const patient = rowPatient(visit);
        const photo = latestOtPhotoByPatient.get(visit.patient_id);
        addCandidate(candidates, {
          key: `ot-photo:${visit.patient_id}`,
          patientId: visit.patient_id || patient?.id || null,
          patientName: patient?.name || photo?.patient_name || null,
          patientsId: patient?.patients_id || null,
          visitId: visit.id,
          visitNumber: visit.visit_id || null,
          registrationId: getVisitRegistration(visit) || null,
          admissionDate: visit.admission_date || null,
          dischargeDate: visit.discharge_date || null,
          surgeryDate: visit.surgery_date || photo?.created_at || null,
          extensionStatus: visit.extension_of_stay || visit.extension_taken || null,
          visit,
          reasons: [TODO_REASONS.operated],
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
          extensionStatus: visit.extension_of_stay || visit.extension_taken || 'not_taken',
          visit,
          reasons: [TODO_REASONS.extension],
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
          extensionStatus: 'not_taken',
          visit: null,
          reasons: [TODO_REASONS.extension],
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
          extensionStatus: candidate.extensionStatus,
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

  const sectionRows = useMemo(() => SECTION_DEFINITIONS.map((section) => ({
    ...section,
    rows: filteredRows.filter((row) => row.reasons.includes(section.reason)),
  })), [filteredRows]);

  const totalSectionRows = sectionRows.reduce((sum, section) => sum + section.rows.length, 0);
  const countForReason = (reason: TodoReason) => filteredRows.filter((row) => row.reasons.includes(reason)).length;

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
            h2 { margin: 18px 0 8px; font-size: 15px; }
            .section-meta { color: #6b7280; font-size: 11px; margin-bottom: 6px; }
            ul { margin: 0; padding-left: 17px; }
            li { margin: 2px 0; }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>To-do list for billing of Yojana patients today</h1>
              <div class="subtitle">Pending documents split by admissions, discharges, surgeries, and extension cases in the last 48 hours.</div>
            </div>
            <div class="meta">
              <div><strong>${filteredRows.length}</strong> unique pending patient${filteredRows.length === 1 ? '' : 's'}</div>
              <div><strong>${totalSectionRows}</strong> section item${totalSectionRows === 1 ? '' : 's'}</div>
              <div>Window ${esc(dateWindowLabel)}</div>
              <div>Printed ${esc(new Date().toLocaleString('en-IN'))}</div>
            </div>
          </header>
          ${sectionRows.map((section) => `
            <section>
              <h2>${esc(section.title)}</h2>
              <div class="section-meta">${section.rows.length} pending item${section.rows.length === 1 ? '' : 's'}</div>
              <table>
                <thead>
                  <tr>
                    <th style="width: 5%;">#</th>
                    <th style="width: 27%;">Patient</th>
                    <th style="width: 16%;">Dates</th>
                    <th style="width: 26%;">Documents Done</th>
                    <th style="width: 26%;">Documents Pending</th>
                  </tr>
                </thead>
                <tbody>
                  ${section.rows.length ? section.rows.map((row, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>
                        <div class="patient">${esc(row.displayName)}</div>
                        <div class="muted">${esc([row.patientsId, row.visitNumber, row.registrationId].filter(Boolean).join(' | '))}</div>
                      </td>
                      <td>
                        <div>Adm: ${esc(formatDateTime(row.admissionDate))}</div>
                        <div>Dis: ${esc(formatDateTime(row.dischargeDate))}</div>
                        <div>Surg: ${esc(formatDateTime(row.surgeryDate))}</div>
                      </td>
                      <td>${renderDocs(row.visibleDone)}</td>
                      <td>${renderDocs(row.visibleLeft)}</td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="5" class="muted">No pending patients for this section.</td>
                    </tr>
                  `}
                </tbody>
              </table>
            </section>
          `).join('')}
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
              Pending documents split by admissions, discharges, surgeries, and extension cases in the last 48 hours.
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search patient, visit, registration ID, or reason"
            className="h-10 w-full pl-9"
          />
        </div>
        <select
          value={documentFilter}
          onChange={(event) => setDocumentFilter(event.target.value)}
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
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Admitted</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{countForReason(TODO_REASONS.admitted)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Discharged</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{countForReason(TODO_REASONS.discharged)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Operated</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{countForReason(TODO_REASONS.operated)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Extensions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{countForReason(TODO_REASONS.extension)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 shadow-sm">
        <span>
          {filteredRows.length
            ? `${filteredRows.length} unique pending patient${filteredRows.length === 1 ? '' : 's'} across ${totalSectionRows} section item${totalSectionRows === 1 ? '' : 's'}`
            : 'No pending patients for the selected filters'}
        </span>
        {(search || documentFilter !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDocumentFilter('all');
            }}
            className="font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center text-gray-500 shadow-sm">
          <Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />
          Loading Yojana billing to-do list...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-12 text-center text-red-600 shadow-sm">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-5">
          {sectionRows.map((section) => (
            <section key={section.reason} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-800">{section.title}</h2>
                  <p className="text-sm text-gray-500">
                    {section.rows.length} pending item{section.rows.length === 1 ? '' : 's'}
                  </p>
                </div>
                {section.reason === TODO_REASONS.extension && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    Extension not taken
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full table-fixed divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-[26%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Patient</th>
                      <th className="w-[16%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Dates</th>
                      <th className="w-[25%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Done</th>
                      <th className="w-[25%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Pending</th>
                      <th className="w-[8%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {section.rows.map((row) => (
                      <tr key={`${section.reason}:${row.id}`} className="align-top hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-gray-800">{row.displayName}</div>
                          <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                            {row.patientsId ? <div>Patient ID: {row.patientsId}</div> : null}
                            {row.visitNumber ? <div>Visit: {row.visitNumber}</div> : null}
                            {row.registrationId ? <div>Reg: {row.registrationId}</div> : null}
                          </div>
                          {row.reasons.length > 1 ? <ReasonPills reasons={row.reasons} /> : null}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600">
                          <div>Adm: {formatDateTime(row.admissionDate)}</div>
                          <div>Dis: {formatDateTime(row.dischargeDate)}</div>
                          <div>Surg: {formatDateTime(row.surgeryDate)}</div>
                          {section.reason === TODO_REASONS.extension && row.extensionStatus ? (
                            <div className="mt-1 text-xs font-medium text-amber-700">Ext: {row.extensionStatus.replace(/_/g, ' ')}</div>
                          ) : null}
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
                    {section.rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-10 text-center text-gray-500">
                          {section.empty}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
