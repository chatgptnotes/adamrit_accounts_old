import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Building2, Download, FileSpreadsheet, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

const SCHEMES: Record<string, string> = {
  echs: 'ECHS',
  esic: 'ESIC',
  wcl: 'WCL',
  mpkay: 'MPKAY',
};

const DEFAULT_CATEGORIES = ['Dialysis', 'General Surgery', 'General Non-Dialysis', 'Unclassified'];
type Tab = 'dashboard' | 'import' | 'patients' | 'reports' | 'management';

type SchemeRecord = {
  id: string;
  patient_name: string;
  uhid: string | null;
  registration_id: string | null;
  external_id: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  category: string;
  status: string;
  source_file_name: string | null;
  imported_at: string;
  matched_patient_id: string | null;
  matched_visit_id: string | null;
  match_method: string | null;
  match_confidence: string;
  processing_error: string | null;
};

const headerAliases: Record<string, string[]> = {
  patientName: ['patient name', 'beneficiary name', 'name', 'member name'],
  uhid: ['uhid', 'patient id', 'patient no', 'hospital id'],
  registrationId: ['registration id', 'registration no', 'card no', 'card number', 'policy no'],
  externalId: ['claim id', 'case id', 'employee id', 'member id', 'esic no', 'echs no', 'beneficiary id'],
  admissionDate: ['admission date', 'date of admission', 'doa'],
  dischargeDate: ['discharge date', 'date of discharge', 'dod'],
  category: ['category', 'case category', 'treatment category'],
  status: ['status', 'claim status', 'case status'],
};

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalKey = (value: unknown) => normalize(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedHeader = (value: unknown) => normalize(value).toLowerCase();

const isPatientNameHeader = (value: unknown) => {
  const header = normalKey(value);
  return ['name', 'patientname', 'beneficiaryname', 'membername', 'nameofpatient', 'patientfullname'].includes(header) ||
    header.includes('patientname') || header.includes('beneficiaryname') || header.includes('membername');
};

function rawValueFor(row: Record<string, unknown>, aliases: string[]) {
  const aliasKeys = aliases.map(normalKey);
  const entry = Object.entries(row).find(([key]) => aliasKeys.includes(normalKey(key))) ||
    Object.entries(row).find(([key]) => {
      const header = normalKey(key);
      return aliasKeys.some((alias) => alias.length > 5 && header.includes(alias));
    });
  return entry?.[1];
}

function valueFor(row: Record<string, unknown>, aliases: string[]) {
  return normalize(rawValueFor(row, aliases));
}

function toDate(value: unknown): string | null {
  if (typeof value === 'number') {
    const excelDate = XLSX.SSF.parse_date_code(value);
    if (excelDate) return `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
  }
  const text = normalize(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function classify(category: string, raw: Record<string, unknown>) {
  if (category) return category;
  const text = Object.values(raw).join(' ').toLowerCase();
  if (/dialysis|haemodialysis|hemodialysis/.test(text)) return 'Dialysis';
  if (/surg|operation|procedure/.test(text)) return 'General Surgery';
  return 'General Non-Dialysis';
}

function currentUser() {
  try {
    const user = JSON.parse(localStorage.getItem('hmis_user') || '{}');
    return user.id || user.email || null;
  } catch { return null; }
}

/**
 * Existing HMIS patient and visit tables are deliberately read-only here.
 * The link is saved only on the new corporate_scheme_records row.
 */
async function findPatientLink(input: { patientName: string; uhid: string; registrationId: string; externalId: string }) {
  let candidates: any[] = [];
  const identifiers = [input.uhid, input.registrationId, input.externalId].filter((value) => /^[A-Za-z0-9/_-]+$/.test(value));
  if (identifiers.length) {
    const { data, error } = await db
      .from('patients')
      .select('id, name, patients_id, registration_id')
      .or(identifiers.flatMap((value) => [`patients_id.eq.${value}`, `registration_id.eq.${value}`]).join(','))
      .limit(3);
    if (error) throw error;
    candidates = data || [];
  }
  if (!candidates.length && input.patientName) {
    const { data, error } = await db.from('patients').select('id, name, patients_id, registration_id').eq('name', input.patientName).limit(3);
    if (error) throw error;
    candidates = data || [];
  }
  if (candidates.length !== 1) return { confidence: candidates.length ? 'ambiguous' : 'unmatched', patientId: null, visitId: null, method: null };

  const patient = candidates[0];
  const identifierMatch = identifiers.some((value) => [patient.patients_id, patient.registration_id].map(normalKey).includes(normalKey(value)));
  const method = identifierMatch ? 'UHID/registration identifier' : 'exact patient name';
  const { data: visit, error: visitError } = await db.from('visits').select('id').eq('patient_id', patient.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (visitError) throw visitError;

  return { confidence: 'matched', patientId: patient.id, visitId: visit?.id || null, method };
}

export default function CorporateSchemeModule() {
  const { schemeCode = '' } = useParams();
  const normalizedScheme = schemeCode.toLowerCase();
  const schemeName = SCHEMES[normalizedScheme] || schemeCode.toUpperCase();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [records, setRecords] = useState<SchemeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [newCategory, setNewCategory] = useState('');

  const loadRecords = async () => {
    setLoading(true);
    const { data, error } = await db.from('corporate_scheme_records').select('*').eq('scheme_code', schemeName).order('imported_at', { ascending: false }).limit(1000);
    if (error) toast.error(`Could not load ${schemeName} records: ${error.message}`);
    else setRecords(data || []);
    setLoading(false);
  };

  const loadSchemeConfig = async () => {
    const { data } = await db.from('corporate_schemes').select('categories').eq('scheme_code', schemeName).maybeSingle();
    const saved = data?.categories;
    if (Array.isArray(saved) && saved.length) setCategories(saved);
  };

  useEffect(() => { loadRecords(); loadSchemeConfig(); }, [schemeName]);

  const filtered = useMemo(() => records.filter((record) => {
    const needle = search.toLowerCase();
    return (!needle || [record.patient_name, record.uhid, record.registration_id, record.external_id].some((value) => value?.toLowerCase().includes(needle))) &&
      (status === 'all' || record.status === status) && (category === 'all' || record.category === category);
  }), [records, search, status, category]);
  const categoryOptions = useMemo(() => [...new Set([...categories, ...records.map((record) => record.category)])], [categories, records]);
  const metrics = useMemo(() => ({ total: records.length, pending: records.filter((record) => record.status === 'pending').length, processed: records.filter((record) => record.match_confidence === 'matched').length, unmatched: records.filter((record) => record.match_confidence !== 'matched').length }), [records]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { toast.error('Upload an Excel or CSV file.'); return; }
    setUploading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
      const headerRowIndex = sheetRows.findIndex((cells, index) => index < 20 && cells.some(isPatientNameHeader));
      if (headerRowIndex === -1) {
        throw new Error('Could not find a Patient Name column in the first 20 rows. Use Patient Name, Beneficiary Name, Member Name, or Name.');
      }
      const headers = sheetRows[headerRowIndex].map((cell, index) => normalize(cell) || `Column ${index + 1}`);
      const rows = sheetRows.slice(headerRowIndex + 1)
        .filter((cells) => cells.some((cell) => normalize(cell)))
        .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))) as Record<string, unknown>[];
      if (!rows.length) throw new Error('The file has no patient rows.');
      const inFileKeys = new Set<string>();
      const payload: any[] = [];
      let invalid = 0;
      let duplicates = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const patientName = valueFor(row, headerAliases.patientName);
        const uhid = valueFor(row, headerAliases.uhid);
        const registrationId = valueFor(row, headerAliases.registrationId);
        const externalId = valueFor(row, headerAliases.externalId);
        if (!patientName) { invalid += 1; continue; }
        const recordKey = normalKey(externalId || registrationId || uhid || `${patientName}|${valueFor(row, headerAliases.admissionDate)}`);
        if (!recordKey || inFileKeys.has(recordKey)) { duplicates += 1; continue; }
        inFileKeys.add(recordKey);
        let match = { confidence: 'unmatched', patientId: null as string | null, visitId: null as string | null, method: null as string | null };
        try { match = await findPatientLink({ patientName, uhid, registrationId, externalId }); }
        catch (error) { match = { confidence: 'error', patientId: null, visitId: null, method: error instanceof Error ? error.message : 'Patient lookup failed' }; }
        payload.push({ scheme_code: schemeName, record_key: recordKey, source_file_name: file.name, source_row_number: headerRowIndex + index + 2, imported_by: currentUser(), external_id: externalId || null, registration_id: registrationId || null, uhid: uhid || null, patient_name: patientName, admission_date: toDate(rawValueFor(row, headerAliases.admissionDate)), discharge_date: toDate(rawValueFor(row, headerAliases.dischargeDate)), category: classify(valueFor(row, headerAliases.category), row), status: valueFor(row, headerAliases.status).toLowerCase() || 'pending', matched_patient_id: match.patientId, matched_visit_id: match.visitId, match_method: match.method, match_confidence: match.confidence, processing_error: match.confidence === 'error' ? match.method : null, raw_data: row, updated_at: new Date().toISOString() });
      }
      if (!payload.length) throw new Error('No valid patient rows were found. Add a Patient Name column and try again.');
      for (let start = 0; start < payload.length; start += 100) {
        const { error } = await db.from('corporate_scheme_records').upsert(payload.slice(start, start + 100), { onConflict: 'scheme_code,record_key' });
        if (error) throw error;
      }
      toast.success(`${payload.length} ${schemeName} rows processed${invalid ? `; ${invalid} row(s) skipped` : ''}${duplicates ? `; ${duplicates} duplicate row(s) skipped` : ''}.`);
      await loadRecords();
      setTab('patients');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setUploading(false); }
  };

  const exportRecords = () => {
    const rows = filtered.map((record) => ({ 'Patient Name': record.patient_name, UHID: record.uhid || '', 'Registration ID': record.registration_id || '', 'External ID': record.external_id || '', 'Admission Date': record.admission_date || '', 'Discharge Date': record.discharge_date || '', Category: record.category, Status: record.status, 'Match Status': record.match_confidence, 'Matched By': record.match_method || '', 'Source File': record.source_file_name || '', Imported: record.imported_at }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), schemeName);
    XLSX.writeFile(workbook, `${schemeName.toLowerCase()}_scheme_records.xlsx`);
  };

  const saveCategories = async () => {
    const next = [...new Set([...categories, normalize(newCategory)])].filter(Boolean);
    const { error } = await db.from('corporate_schemes').update({ categories: next, updated_at: new Date().toISOString() }).eq('scheme_code', schemeName);
    if (error) toast.error(`Could not save categories: ${error.message}`);
    else { setCategories(next); setNewCategory(''); toast.success('Scheme categories saved.'); }
  };

  return <div className="min-h-screen bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="rounded-xl bg-blue-100 p-3 text-blue-700"><Building2 /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Corporate scheme</p><h1 className="text-2xl font-bold text-slate-900">{schemeName}</h1><p className="text-sm text-slate-500">Records, dashboard, imports, reports, and settings for {schemeName} only.</p></div></div><label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Upload className="h-4 w-4" />{uploading ? 'Processing…' : `Import ${schemeName} Excel`}<input className="hidden" type="file" accept=".xlsx,.xls,.csv" disabled={uploading} onChange={handleUpload} /></label></header>
    <nav className="flex flex-wrap gap-2">{(['dashboard', 'import', 'patients', 'reports', 'management'] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${tab === item ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{item}</button>)}</nav>
    {tab === 'dashboard' && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Total patients", metrics.total], ["Pending", metrics.pending], ["Matched & linked", metrics.processed], ["Needs review", metrics.unmatched]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{value}</p></div>)}</div><section className="rounded-xl border bg-white p-5"><h2 className="font-bold text-slate-900">Category summary</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{categoryOptions.map((item) => <div key={item} className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-600">{item}</span><strong className="float-right text-slate-900">{records.filter((record) => record.category === item).length}</strong></div>)}</div></section></>}
    {tab === 'import' && <section className="rounded-xl border bg-white p-6"><FileSpreadsheet className="mb-3 h-8 w-8 text-green-600" /><h2 className="text-xl font-bold text-slate-900">Import {schemeName} patient records</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Upload Excel or CSV. The system recognises common Patient Name, UHID, Registration ID, admission, category, and status columns. Every accepted row is saved in the new shared corporate record table with the {schemeName} scheme label. Existing HMIS patient and visit records are only read to create a link; they are never changed.</p><label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"><Upload className="h-4 w-4" />{uploading ? 'Processing…' : 'Choose file'}<input className="hidden" type="file" accept=".xlsx,.xls,.csv" disabled={uploading} onChange={handleUpload} /></label></section>}
    {(tab === 'patients' || tab === 'reports') && <section className="rounded-xl border bg-white p-5"><div className="mb-4 flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient, UHID, registration ID…" /></div><select className="rounded-lg border px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{[...new Set(records.map((record) => record.status))].map((item) => <option key={item}>{item}</option>)}</select><select className="rounded-lg border px-3 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</select><button onClick={exportRecords} className="inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"><Download className="h-4 w-4" />Export</button></div>{tab === 'reports' && <p className="mb-3 text-sm text-slate-600">This report is limited to {schemeName}; {filtered.length} matching record(s) are ready for export.</p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-slate-600"><tr>{['Patient', 'UHID / Registration', 'Category', 'Status', 'Patient link', 'Source'].map((item) => <th key={item} className="px-3 py-3 font-semibold">{item}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading…</td></tr> : filtered.length ? filtered.map((record) => <tr key={record.id} className="border-b"><td className="px-3 py-3 font-medium text-slate-900">{record.patient_name}</td><td className="px-3 py-3 text-slate-600">{record.uhid || record.registration_id || record.external_id || '—'}</td><td className="px-3 py-3">{record.category}</td><td className="px-3 py-3 capitalize">{record.status}</td><td className="px-3 py-3 capitalize">{record.match_confidence === 'matched' ? 'Linked only' : record.match_confidence}</td><td className="px-3 py-3 text-slate-600">{record.source_file_name || '—'}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-slate-500">No {schemeName} records found.</td></tr>}</tbody></table></div></section>}
    {tab === 'management' && <section className="rounded-xl border bg-white p-6"><h2 className="text-xl font-bold text-slate-900">{schemeName} management</h2><p className="mt-2 text-sm text-slate-600">Categories are configuration for this scheme only. They do not change PMJAY or any other corporate scheme.</p><div className="mt-5 flex flex-wrap gap-2">{categories.map((item) => <span key={item} className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">{item}</span>)}</div><div className="mt-5 flex max-w-md gap-2"><input className="flex-1 rounded-lg border px-3 py-2 text-sm" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Add category" /><button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white" onClick={saveCategories}>Save</button></div></section>}
  </div></div>;
}
