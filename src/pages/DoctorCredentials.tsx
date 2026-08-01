import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Stamp, Search, Plus, X, Upload, Trash2 } from 'lucide-react';

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

    const { data: files } = await supabase.storage
      .from('uploads')
      .list(STAMP_FOLDER, { limit: 500, sortBy: { column: 'name', order: 'asc' } });
    const taken = new Set(rows.map(r => r.stamp_url).filter(Boolean) as string[]);
    setUnassigned((files || []).map(f => publicUrl(`${STAMP_FOLDER}/${f.name}`)).filter(u => !taken.has(u)));
    setLoading(false);
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

  const filtered = doctors.filter(d =>
    d.doctor_name.toLowerCase().includes(search.toLowerCase()));

  const imageCell = (doc: Doctor, field: 'stamp_url' | 'signature_url', label: string) => {
    const url = doc[field];
    return (
      <div className="flex flex-col items-start gap-1">
        {url ? (
          <div className="relative group">
            <img src={url} alt={label} className="h-12 max-w-[160px] object-contain bg-white border border-gray-200 rounded" />
            <button
              onClick={() => setField(doc.id, field, null)}
              title={`Remove ${label.toLowerCase()}`}
              className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 className="w-3 h-3 text-red-600" />
            </button>
          </div>
        ) : (
          <label className="cursor-pointer text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 border border-dashed border-gray-300 rounded px-2 py-2">
            <Upload className="w-3 h-3" /> Upload {label.toLowerCase()}
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

        <div className="relative mb-6">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search doctors..."
            className="w-full pl-10 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm" />
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
                  <img src={url} alt="Unassigned stamp" className="h-14 w-full object-contain mb-2" />
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) setField(e.target.value, 'stamp_url', url); }}
                    className="w-full px-2 py-1.5 bg-white border border-gray-300 rounded text-gray-900 text-xs">
                    <option value="">Assign to doctor...</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.doctor_name}</option>)}
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
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Doctor</th>
                  <th className="px-4 py-3 font-medium">Registration</th>
                  <th className="px-4 py-3 font-medium">Stamp</th>
                  <th className="px-4 py-3 font-medium">Signature</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(d => (
                  <tr key={d.id} className={busy === d.id ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{d.doctor_name}</div>
                      {(d.qualification || d.specialty) && (
                        <div className="text-xs text-gray-500">{d.qualification || d.specialty}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{d.registration_no || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3">{imageCell(d, 'stamp_url', 'Stamp')}</td>
                    <td className="px-4 py-3">{imageCell(d, 'signature_url', 'Signature')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorCredentials;
