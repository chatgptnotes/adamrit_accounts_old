import { useEffect, useMemo, useState } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ExternalLink, FileCheck2, FileText, Loader2, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PATIENT_DOC_CATEGORIES } from '@/tablet/hooks/usePatientDocs';
import { Input } from '@/components/ui/input';
import { DateRangePicker } from '@/components/ui/date-range-picker';

interface PatientRecord {
  patient_id: string | null;
  patient_name: string | null;
}

interface UploadedPatientDocument {
  patient_id: string | null;
  patient_name: string | null;
  category: string | null;
  created_at?: string | null;
}

interface DocumentRow {
  id: string;
  name: string;
  patientName: string | null;
  done: string[];
  left: string[];
}

const PAGE_SIZE = 10;
const UPLOAD_SCAN_SIZE = 400;
const normalizeValue = (value: string | null | undefined) => value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
const canonicalCategoryIds = PATIENT_DOC_CATEGORIES.map((document) => document.id);

// Every patient needs these. The rest are situational — a patient never
// admitted for surgery or dialysis will never have them, so counting them
// as "pending" made almost every patient look incomplete regardless of
// whether their actually-required documents were done.
const CORE_DOCUMENT_IDS = ['treatment_sheet', 'monitor_chart', 'lab_investigation', 'radiology_investigation', 'discharge_summary'];
const SURGERY_DOCUMENT_IDS = ['ot_notes', 'ot_photos', 'implant_invoice', 'implant_sticker'];
const DIALYSIS_DOCUMENT_IDS = ['dialysis'];

// Yojana schemes (MJPJAY/PMJAY and variants) aren't stored under one literal
// corporate value, so "Yojana" is a keyword match rather than an exact one.
const isMaharashtraYojana = (corporate: string | null | undefined) => {
  const value = (corporate || '').toLowerCase().trim();
  return value.includes('yojana') || value.includes('mjpjy') || value.includes('ayushman') ||
    value.includes('mahatma jyotiba') || value.includes('pmjay') || value.includes('ab-pmjay') ||
    value.includes('ab pmjay') || value.includes('maharashtra yojana');
};

export default function PatientDocumentsReport() {
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [documents, setDocuments] = useState<UploadedPatientDocument[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'complete'>('all');
  const [documentFilter, setDocumentFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Default view: only discharged Yojana patients. Either can be widened via
  // the dropdowns (a specific corporate, "all corporates", "all patients", or
  // "admitted patients" only).
  const [corporateFilter, setCorporateFilter] = useState('yojana');
  const [corporateOptions, setCorporateOptions] = useState<string[]>([]);
  const [patientStatusFilter, setPatientStatusFilter] = useState<'discharged' | 'admitted' | 'all'>('discharged');
  const [surgeryPatientIds, setSurgeryPatientIds] = useState<Set<string>>(new Set());
  const [dialysisPatientIds, setDialysisPatientIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, Number(searchParams.get('page') || '1'));

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

      // This is deliberately the same source as Documents & Photos. It avoids
      // the slow summary RPC that was timing out on the report page.
      const scanLimit = currentPage * UPLOAD_SCAN_SIZE;
      let query = supabase
        .from('file_uploads')
        .select('patient_id, patient_name, category, created_at')
        .in('category', canonicalCategoryIds)
        .order('created_at', { ascending: false })
        .range(0, scanLimit - 1);

      const searchTerm = search.trim().replace(/[,%()]/g, '');
      if (searchTerm) {
        query = query.or(`patient_name.ilike.%${searchTerm}%,patient_id.ilike.%${searchTerm}%`);
      }

      if (dateRange?.from) {
        query = query.gte('created_at', startOfDay(dateRange.from).toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', endOfDay(dateRange.to).toISOString());
      }

      const scanResult = await query;
      if (scanResult.error) throw scanResult.error;
      if (!active) return;

      const patientMap = new Map<string, PatientRecord>();
      for (const upload of (scanResult.data || []) as UploadedPatientDocument[]) {
        const key = normalizeValue(upload.patient_id) || `name:${normalizeValue(upload.patient_name)}`;
        if (!key || patientMap.has(key)) continue;
        patientMap.set(key, { patient_id: upload.patient_id, patient_name: upload.patient_name });
      }

      const candidates = Array.from(patientMap.values());

      // Corporate/discharge status live on patients & visits, not file_uploads,
      // so resolve them for every candidate before slicing pages — filtering
      // after slicing would make pagination counts wrong.
      const allCandidateIds = Array.from(new Set(candidates.map((patient) => patient.patient_id).filter(Boolean) as string[]));
      const corporateByPatient = new Map<string, string | null>();
      const dischargedByPatient = new Map<string, boolean>();

      if (allCandidateIds.length) {
        const [patientsResult, visitsResult] = await Promise.all([
          supabase.from('patients').select('id, corporate').in('id', allCandidateIds),
          supabase.from('visits').select('patient_id, discharge_date').in('patient_id', allCandidateIds).order('admission_date', { ascending: false }),
        ]);
        if (patientsResult.error) throw patientsResult.error;
        if (visitsResult.error) throw visitsResult.error;
        if (!active) return;

        for (const patientRow of patientsResult.data || []) corporateByPatient.set(patientRow.id, patientRow.corporate);
        // Rows arrive latest-admission-first, so the first row seen per patient is their current/most recent visit.
        for (const visitRow of visitsResult.data || []) {
          if (!dischargedByPatient.has(visitRow.patient_id)) dischargedByPatient.set(visitRow.patient_id, !!visitRow.discharge_date);
        }

        const seenCorporates = Array.from(corporateByPatient.values()).filter(Boolean) as string[];
        if (seenCorporates.length) {
          setCorporateOptions((prev) => Array.from(new Set([...prev, ...seenCorporates])).sort());
        }
      }

      const filteredCandidates = candidates.filter((patient) => {
        if (!patient.patient_id) return corporateFilter === 'all' && patientStatusFilter === 'all';

        const corporate = corporateByPatient.get(patient.patient_id) || '';
        if (corporateFilter === 'yojana' && !isMaharashtraYojana(corporate)) return false;
        if (corporateFilter !== 'all' && corporateFilter !== 'yojana' && corporate !== corporateFilter) return false;

        if (patientStatusFilter !== 'all') {
          const isDischarged = dischargedByPatient.get(patient.patient_id);
          if (isDischarged === undefined) return false; // no visit on record — can't confirm, exclude under a strict filter
          if (patientStatusFilter === 'discharged' && !isDischarged) return false;
          if (patientStatusFilter === 'admitted' && isDischarged) return false;
        }

        return true;
      });

      const start = (currentPage - 1) * PAGE_SIZE;
      const pagePatients = filteredCandidates.slice(start, start + PAGE_SIZE);
      const patientIds = Array.from(new Set(pagePatients.map((patient) => patient.patient_id).filter(Boolean) as string[]));
      const patientNames = Array.from(new Set(pagePatients.map((patient) => patient.patient_name).filter(Boolean) as string[]));

      const results = await Promise.all([
        patientIds.length
          ? (() => { let q = supabase.from('file_uploads').select('patient_id, patient_name, category, created_at').in('patient_id', patientIds).in('category', canonicalCategoryIds); if (dateRange?.from) q = q.gte('created_at', startOfDay(dateRange.from).toISOString()); if (dateRange?.to) q = q.lte('created_at', endOfDay(dateRange.to).toISOString()); return q; })()
          : Promise.resolve({ data: [], error: null }),
        patientNames.length
          ? (() => { let q = supabase.from('file_uploads').select('patient_id, patient_name, category, created_at').in('patient_name', patientNames).in('category', canonicalCategoryIds); if (dateRange?.from) q = q.gte('created_at', startOfDay(dateRange.from).toISOString()); if (dateRange?.to) q = q.lte('created_at', endOfDay(dateRange.to).toISOString()); return q; })()
          : Promise.resolve({ data: [], error: null }),
        patientIds.length
          ? supabase.from('visits').select('patient_id').in('patient_id', patientIds).not('surgery_date', 'is', null)
          : Promise.resolve({ data: [], error: null }),
        patientIds.length
          ? supabase.from('dialysis_sessions').select('patient_id').in('patient_id', patientIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const documentsError = results.find((result) => result.error)?.error;
      if (documentsError) throw documentsError;
      if (!active) return;

      setPatients(pagePatients);
      setDocuments([...(results[0].data || []), ...(results[1].data || [])] as UploadedPatientDocument[]);
      setSurgeryPatientIds(new Set((results[2].data || []).map((row: { patient_id: string | null }) => row.patient_id).filter(Boolean) as string[]));
      setDialysisPatientIds(new Set((results[3].data || []).map((row: { patient_id: string | null }) => row.patient_id).filter(Boolean) as string[]));
      setHasNextPage((scanResult.data || []).length === scanLimit && filteredCandidates.length > start + PAGE_SIZE);
      setLoading(false);
    };

    load().catch((loadError) => {
      if (!active) return;
      setPatients([]);
      setDocuments([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load patient documents.');
      setLoading(false);
    });

    return () => { active = false; };
  }, [currentPage, search, dateRange, corporateFilter, patientStatusFilter]);

  const rows = useMemo<DocumentRow[]>(() => {
    const documentsByPatient = new Map<string, UploadedPatientDocument[]>();
    for (const document of documents) {
      if (!document.category) continue;
      for (const key of [normalizeValue(document.patient_id), `name:${normalizeValue(document.patient_name)}`].filter(Boolean)) {
        documentsByPatient.set(key, [...(documentsByPatient.get(key) || []), document]);
      }
    }

    return patients.map((patient) => {
      const patientDocuments = [
        ...(documentsByPatient.get(normalizeValue(patient.patient_id)) || []),
        ...(documentsByPatient.get(`name:${normalizeValue(patient.patient_name)}`) || []),
      ];
      const uploadedCategories = new Set(patientDocuments.map((document) => normalizeValue(document.category)));
      const needsSurgeryDocs = !!(patient.patient_id && surgeryPatientIds.has(patient.patient_id));
      const needsDialysisDocs = !!(patient.patient_id && dialysisPatientIds.has(patient.patient_id));
      const done = PATIENT_DOC_CATEGORIES.filter((document) => uploadedCategories.has(normalizeValue(document.id))).map((document) => document.label);
      const left = PATIENT_DOC_CATEGORIES.filter((document) => {
        if (uploadedCategories.has(normalizeValue(document.id))) return false;
        if (CORE_DOCUMENT_IDS.includes(document.id)) return true;
        if (SURGERY_DOCUMENT_IDS.includes(document.id)) return needsSurgeryDocs;
        if (DIALYSIS_DOCUMENT_IDS.includes(document.id)) return needsDialysisDocs;
        return false;
      }).map((document) => document.label);
      return {
        id: patient.patient_id || patient.patient_name || 'unknown-patient',
        name: patient.patient_name || patient.patient_id || 'Unnamed patient',
        patientName: patient.patient_name,
        done,
        left,
      };
    }).filter((row) => {
      if (statusFilter === 'pending' && row.left.length === 0) return false;
      if (statusFilter === 'complete' && row.left.length > 0) return false;
      return documentFilter === 'all' || row.done.includes(documentFilter);
    });
  }, [documents, patients, statusFilter, documentFilter, surgeryPatientIds, dialysisPatientIds]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/reports-center" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Back to Reports Center"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="rounded-xl bg-primary/10 p-2 text-primary"><FileCheck2 className="h-6 w-6" /></div>
        <div><h1 className="text-2xl font-bold text-gray-800">Patient Documents</h1><p className="text-sm text-gray-500">Uploaded and pending documents for each patient.</p></div>
      </div>

      <div className="mb-6 flex justify-end">
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><Input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search patient / ID" className="h-10 w-full pl-9" /></div>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); resetPage(); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"><option value="all">All statuses</option><option value="pending">Documents pending</option><option value="complete">All documents complete</option></select>
          <select value={documentFilter} onChange={(event) => { setDocumentFilter(event.target.value); resetPage(); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"><option value="all">Any uploaded document</option>{PATIENT_DOC_CATEGORIES.map((document) => <option key={document.id} value={document.label}>{document.label}</option>)}</select>
          <select value={corporateFilter} onChange={(event) => { setCorporateFilter(event.target.value); resetPage(); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"><option value="yojana">Yojana patients</option><option value="all">All corporates</option>{corporateOptions.map((corporate) => <option key={corporate} value={corporate}>{corporate}</option>)}</select>
          <select value={patientStatusFilter} onChange={(event) => { setPatientStatusFilter(event.target.value as typeof patientStatusFilter); resetPage(); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-primary/30"><option value="discharged">Discharged patients</option><option value="all">All patients</option><option value="admitted">Admitted patients only</option></select>
          <DateRangePicker date={dateRange} onDateChange={(range) => { setDateRange(range); resetPage(); }} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-3 text-sm text-gray-500">
          <span>{rows.length ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${(currentPage - 1) * PAGE_SIZE + rows.length} uploaded patients` : 'No uploaded patients'}</span>
          {(search || statusFilter !== 'all' || documentFilter !== 'all' || dateRange || corporateFilter !== 'yojana' || patientStatusFilter !== 'discharged') && <button type="button" onClick={() => { setSearch(''); setStatusFilter('all'); setDocumentFilter('all'); setDateRange(undefined); setCorporateFilter('yojana'); setPatientStatusFilter('discharged'); resetPage(); }} className="font-medium text-primary hover:underline">Clear filters</button>}
        </div>
        <div className="overflow-x-auto"><table className="min-w-[980px] w-full table-fixed divide-y divide-gray-200"><thead className="bg-gray-50"><tr><th className="w-1/5 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Patient Name</th><th className="w-[35%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Done</th><th className="w-[35%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Documents Left</th><th className="w-[10%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-500"><Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />Loading patient documents...</td></tr>}
            {!loading && error && <tr><td colSpan={4} className="px-5 py-12 text-center text-red-600">{error}</td></tr>}
            {!loading && !error && rows.map((row) => <tr key={row.id} className="align-top hover:bg-gray-50"><td className="px-5 py-4"><div className="font-semibold text-gray-800">{row.name}</div>{row.done.length > 0 && row.left.length > 0 && <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Partially complete</span>}</td><td className="px-5 py-4"><CountBadge count={row.done.length} tone="done" />{row.done.length ? <DocumentList items={row.done} tone="done" /> : <span className="mt-2 block text-sm text-gray-400">None</span>}</td><td className="px-5 py-4"><CountBadge count={row.left.length} tone="left" />{row.left.length ? <DocumentList items={row.left} tone="left" /> : <span className="mt-2 block text-sm font-medium text-green-600">All required documents complete</span>}</td><td className="px-5 py-4">{row.patientName && <Link to={`/advance-statement-report?search=${encodeURIComponent(row.patientName)}&includeDischarged=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5" title="View registration ID and other details in Advance Statement Report"><ExternalLink className="h-3.5 w-3.5" />Details</Link>}</td></tr>)}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-500">No patients found.</td></tr>}
          </tbody></table></div>
      </div>

      {!loading && !error && (currentPage > 1 || hasNextPage) && <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"><span className="text-sm text-gray-500">Page {currentPage}</span><div className="flex items-center gap-1"><button type="button" onClick={() => goToPage(1)} disabled={currentPage === 1} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button><button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => goToPage(currentPage + 1)} disabled={!hasNextPage} className="rounded-md border p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button></div></div>}
    </div>
  );
}

function DocumentList({ items, tone }: { items: string[]; tone: 'done' | 'left' }) {
  return <ul className={tone === 'left' ? 'mt-2 flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto pr-2 text-sm leading-5' : 'mt-2 max-h-44 space-y-1 overflow-y-auto pr-2 text-sm leading-5'}>{items.map((item) => <li key={item} className={tone === 'left' ? 'flex max-w-full items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700' : 'flex items-start gap-2 text-green-700'}>{tone === 'done' ? <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0" />}<span className={tone === 'left' ? 'break-words' : undefined}>{item}</span></li>)}</ul>;
}

function CountBadge({ count, tone }: { count: number; tone: 'done' | 'left' }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{count} {tone === 'done' ? 'done' : 'left'}</span>;
}
