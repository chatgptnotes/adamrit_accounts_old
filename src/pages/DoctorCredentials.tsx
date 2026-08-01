import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Stamp, Search, Plus, X, Upload, Trash2, PenLine, Building2 } from 'lucide-react';

const db = supabase as any;

// Where the stamps cut from the hospital's signature sheet live. Anything in
// this folder that no doctor claims yet is offered below as unassigned.
const STAMP_FOLDER = 'doctor-stamps';

interface Doctor {
  id: string;
  doctor_name: string;
  qualification: string | null;
  registration_no: string | null;
  specialty: string | null;
  signature_url: string | null;
  stamp_url: string | null;
}

// The app serves two hospitals, and a document should carry the seal of the one
// it was raised under. Same ids as HospitalType in src/types/hospital.ts.
const HOSPITALS = [
  { type: 'hope', label: 'Hope', fullName: 'Hope Multi-Specialty Hospital' },
  { type: 'ayushman', label: 'Ayushman', fullName: 'Ayushman Hospital' },
] as const;

const publicUrl = (path: string) =>
  supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl;

const DoctorCredentials: React.FC = () => {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'missing' | 'complete'>('all');
  const [seals, setSeals] = useState<Record<string, string | null>>({});

  const fetchAll = async () => {
    setLoading(true);
    const { data, error } = await db
      .from('doctor_credentials')
      .select('id, doctor_name, qualification, registration_no, specialty, signature_url, stamp_url')
      .eq('is_active', true)
      .order('doctor_name');
    if (error) {
      toast.error('Failed to load doctors');
      setLoading(false);
      return;
    }
    const rows: Doctor[] = data || [];
    setDoctors(rows);

    // The hospital seals live in their own table - they belong to the hospital,
    // not to any doctor. A missing table just means the migration has not run
    // yet, which must not take the rest of the page down with it.
    const { data: sealRows, error: sealError } = await db
      .from('hospital_stamps')
      .select('hospital_type, stamp_url');
    if (sealError) console.warn('[DoctorCredentials] hospital_stamps unavailable:', sealError.message);
    const sealMap: Record<string, string | null> = {};
    (sealRows || []).forEach((s: any) => { sealMap[s.hospital_type] = s.stamp_url; });
    setSeals(sealMap);

    const { data: files } = await supabase.storage
      .from('uploads')
      .list(STAMP_FOLDER, { limit: 500, sortBy: { column: 'name', order: 'asc' } });
    const taken = new Set([
      ...rows.map(r => r.stamp_url),
      ...Object.values(sealMap),
    ].filter(Boolean) as string[]);
    setUnassigned((files || []).map(f => publicUrl(`${STAMP_FOLDER}/${f.name}`)).filter(u => !taken.has(u)));
    setLoading(false);
  };

  const setSeal = async (hospitalType: string, value: string | null) => {
    setBusy(`seal:${hospitalType}`);
    const { error } = await db
      .from('hospital_stamps')
      .upsert({ hospital_type: hospitalType, stamp_url: value, updated_at: new Date().toISOString() },
        { onConflict: 'hospital_type' });
    setBusy(null);
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success(value ? 'Hospital seal saved' : 'Hospital seal removed');
    fetchAll();
  };

  const uploadSeal = async (hospitalType: string, file: File) => {
    setBusy(`seal:${hospitalType}`);
    const safe = file.name.replace(/[^a-z0-9.\-_]/gi, '_');
    const path = `${STAMP_FOLDER}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from('uploads').upload(path, file, {
      upsert: false,
      cacheControl: '3600',
    });
    if (error) { setBusy(null); toast.error(`Upload failed: ${error.message}`); return; }
    await setSeal(hospitalType, publicUrl(path));
  };

  useEffect(() => { fetchAll(); }, []);

  const setField = async (id: string, field: 'stamp_url' | 'signature_url', value: string | null) => {
    setBusy(id);
    const { error } = await db
      .from('doctor_credentials')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    setBusy(null);
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    toast.success(value ? 'Saved' : 'Removed');
    fetchAll();
  };

  // A scan straight off a phone keeps its own paper background. That is fine
  // here - the file is stored as uploaded and whoever supplies it decides how
  // clean it is.
  const uploadFor = async (doc: Doctor, field: 'stamp_url' | 'signature_url', file: File) => {
    setBusy(doc.id);
    const safe = file.name.replace(/[^a-z0-9.\-_]/gi, '_');
    const path = `${STAMP_FOLDER}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from('uploads').upload(path, file, {
      upsert: false,
      cacheControl: '3600',
    });
    if (error) { setBusy(null); toast.error(`Upload failed: ${error.message}`); return; }
    await setField(doc.id, field, publicUrl(path));
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const { error } = await db.from('doctor_credentials').insert({ doctor_name: name });
    if (error) { toast.error(`Could not add: ${error.message}`); return; }
    toast.success('Doctor added');
    setNewName(''); setShowAdd(false);
    fetchAll();
  };

  const withStamp = doctors.filter(d => d.stamp_url).length;
  const withSignature = doctors.filter(d => d.signature_url).length;

  const FILTERS = {
    all: () => true,
    missing: (d: Doctor) => !d.stamp_url || !d.signature_url,
    complete: (d: Doctor) => !!d.stamp_url && !!d.signature_url,
  } as const;

  const filtered = doctors
    .filter(d => d.doctor_name.toLowerCase().includes(search.toLowerCase()))
    .filter(FILTERS[filter]);

  // The stamps are transparent PNGs, so a plain white box hides whether the
  // background was actually removed. A faint checkerboard makes it visible.
  const CHECKS = {
    backgroundImage:
      'linear-gradient(45deg,#f1f5f9 25%,transparent 25%),linear-gradient(-45deg,#f1f5f9 25%,transparent 25%),' +
      'linear-gradient(45deg,transparent 75%,#f1f5f9 75%),linear-gradient(-45deg,transparent 75%,#f1f5f9 75%)',
    backgroundSize: '12px 12px',
    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0px',
  };

  const slot = (doc: Doctor, field: 'stamp_url' | 'signature_url', label: string, Icon: typeof Stamp) => {
    const url = doc[field];
    return (
      <div className="w-[46%] sm:w-40">
        <div className="flex items-center justify-end gap-1 mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          <Icon className="w-3 h-3" /> {label}
        </div>
        {url ? (
          <div className="relative group h-16 rounded-lg border border-gray-200 bg-white overflow-hidden" style={CHECKS}>
            <img src={url} alt={`${doc.doctor_name} ${label}`} className="w-full h-full object-contain p-1" />
            <button
              onClick={() => setField(doc.id, field, null)}
              title={`Remove ${label.toLowerCase()}`}
              className="absolute top-1 right-1 bg-white/90 border border-gray-300 rounded-full p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
              <Trash2 className="w-3 h-3 text-red-600" />
            </button>
          </div>
        ) : (
          <label className="h-16 rounded-lg border border-dashed border-gray-300 bg-gray-50 hover:bg-blue-50 hover:border-blue-400 cursor-pointer flex flex-col items-center justify-center gap-1 text-[11px] text-gray-500 hover:text-blue-700 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Upload
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy === doc.id}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadFor(doc, field, f); e.target.value = ''; }}
            />
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Stamp className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Doctor Credentials</h1>
          </div>
          <button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Add Doctor
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          The stamp and signature printed on a doctor's discharge summaries and reports.
          A doctor with neither gets a ruled blank space to sign by hand.
        </p>

        {/* The hospital's own seal, one per hospital the app serves. It is not
            any doctor's, so it sits above the doctor list rather than in it. */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">Hospital seal</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Printed beside the signing doctor's stamp. Each hospital has its own.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HOSPITALS.map(h => {
              const url = seals[h.type] ?? null;
              const key = `seal:${h.type}`;
              return (
                <div key={h.type} className={`flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3 ${busy === key ? 'opacity-50' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{h.label}</div>
                    <div className="text-xs text-gray-500 truncate">{h.fullName}</div>
                  </div>
                  {url ? (
                    <div className="relative group h-20 w-20 shrink-0 rounded-lg border border-gray-200 overflow-hidden" style={CHECKS}>
                      <img src={url} alt={`${h.label} seal`} className="w-full h-full object-contain p-1" />
                      <button
                        onClick={() => setSeal(h.type, null)}
                        title="Remove seal"
                        className="absolute top-1 right-1 bg-white/90 border border-gray-300 rounded-full p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </button>
                    </div>
                  ) : (
                    <label className="h-20 w-20 shrink-0 rounded-lg border border-dashed border-gray-300 bg-gray-50 hover:bg-blue-50 hover:border-blue-400 cursor-pointer flex flex-col items-center justify-center gap-1 text-[11px] text-gray-500 hover:text-blue-700 transition-colors">
                      <Upload className="w-3.5 h-3.5" /> Upload
                      <input type="file" accept="image/*" className="hidden" disabled={busy === key}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadSeal(h.type, f); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* How much of the master is actually usable today - a doctor without
            a stamp prints unsigned, so the gap is the number that matters. */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Doctors', value: doctors.length, tone: 'text-gray-900' },
            { label: 'With stamp', value: `${withStamp} / ${doctors.length}`, tone: withStamp ? 'text-green-700' : 'text-amber-600' },
            { label: 'With signature', value: `${withSignature} / ${doctors.length}`, tone: withSignature ? 'text-green-700' : 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</div>
              <div className={`text-xl font-semibold ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search doctors..."
              className="w-full pl-10 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm" />
          </div>
          <div className="flex gap-2">
            {([['all', 'All'], ['missing', 'Needs one'], ['complete', 'Complete']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${filter === key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {showAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Add Doctor</h2>
                <button onClick={() => setShowAdd(false)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Type the name exactly as it appears on the visit, so documents can find it.
              </p>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Dr. Full Name"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm mb-3" />
              <button onClick={handleAdd} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm">Add Doctor</button>
            </div>
          </div>
        )}

        {/* Stamps that have been uploaded but belong to nobody yet. Matching a
            stamp to a doctor by name is guesswork - the sheet says "Dr. Ramesh
            Sharma" while the visit may say something else entirely - and a
            stamp on the wrong doctor's summary is a false attestation. So the
            choice is made here, by a person who knows. */}
        {unassigned.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <h2 className="text-sm font-semibold text-amber-900 mb-1">
              {unassigned.length} unassigned stamp{unassigned.length !== 1 ? 's' : ''}
            </h2>
            <p className="text-xs text-amber-800 mb-3">
              Uploaded but not yet attached to a doctor. Pick the doctor each one belongs to.
              If the doctor is not listed, add them first.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {unassigned.map(url => (
                <div key={url} className="bg-white border border-amber-200 rounded-lg p-2">
                  <div className="h-16 rounded mb-2 border border-gray-100" style={CHECKS}>
                    <img src={url} alt="Unassigned stamp" className="h-full w-full object-contain p-1" />
                  </div>
                  {/* The round seal on the sheet is the hospital's, not a
                      doctor's, so a hospital is a valid target here too. */}
                  <select
                    defaultValue=""
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      if (v.startsWith('seal:')) setSeal(v.slice(5), url);
                      else setField(v, 'stamp_url', url);
                    }}
                    className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-900 text-xs">
                    <option value="">Assign to...</option>
                    <optgroup label="Hospital seal">
                      {HOSPITALS.map(h => <option key={h.type} value={`seal:${h.type}`}>{h.label} hospital seal</option>)}
                    </optgroup>
                    <optgroup label="Doctors">
                      {doctors.map(d => <option key={d.id} value={d.id}>{d.doctor_name}</option>)}
                    </optgroup>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No doctors found</div>
        ) : (
          /* One card per doctor: who they are reads top-left, and the stamp and
             signature sit bottom-right, where they fall on the documents these
             end up printed on. */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map(d => (
              <div key={d.id}
                className={`bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between transition-opacity ${busy === d.id ? 'opacity-50' : ''}`}>
                <div className="mb-3">
                  <div className="font-semibold text-gray-900 leading-tight">{d.doctor_name}</div>
                  {(d.qualification || d.specialty) && (
                    <div className="text-xs text-gray-500 mt-0.5">{d.qualification || d.specialty}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {d.registration_no ? `Reg. ${d.registration_no}` : 'No registration number on file'}
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  {slot(d, 'stamp_url', 'Stamp', Stamp)}
                  {slot(d, 'signature_url', 'Signature', PenLine)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorCredentials;
