import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { uploadPatientDocs } from '@/tablet/hooks/usePatientDocs';

// DATA SOURCE: visits.discharge_mode = 'death' + file_uploads in the three
// death categories.
//
// A death during treatment needs three things on file against the patient, and
// they are easy to lose in the hour it happens. This shows them as a list of
// three, each either attached or missing, wherever the patient's documents are
// open. It renders nothing at all for a patient who did not die, so the panel
// is unchanged for everyone else.

export const DEATH_FILE_ITEMS = [
  { category: 'death_certificate', label: 'Death certificate', accept: 'image/*,application/pdf' },
  { category: 'death_summary', label: 'Death summary', accept: 'image/*,application/pdf' },
  { category: 'body_handover_photo', label: 'Body handover photo', accept: 'image/*' },
] as const;

export function DeathFileChecklist({
  patientId,
  patientName,
  visitId,
  knownDeath = false,
}: {
  /** patients.id (uuid) — file_uploads is keyed on it. */
  patientId: string;
  patientName?: string | null;
  /** The printed visit code, e.g. IH26A05023. */
  visitId?: string | null;
  /** Set by a caller that already lists deaths, to skip the lookup. */
  knownDeath?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Only a visit that ended in a death asks for these.
  const isDeath = useQuery({
    queryKey: ['death-file-visit', visitId],
    enabled: !!visitId && !knownDeath,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('visits')
        .select('discharge_mode')
        .eq('visit_id', visitId)
        .maybeSingle();
      return (data?.discharge_mode || '').toLowerCase() === 'death';
    },
  });

  const docs = useQuery({
    queryKey: ['death-file-docs', patientId],
    enabled: !!patientId && (knownDeath || isDeath.data === true),
    staleTime: 15_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('file_uploads')
        .select('id, category, file_url, file_name, created_at')
        .eq('patient_id', patientId)
        .in('category', DEATH_FILE_ITEMS.map((i) => i.category))
        .order('created_at', { ascending: false });
      const byCategory: Record<string, any> = {};
      for (const row of data || []) if (!byCategory[row.category]) byCategory[row.category] = row;
      return byCategory;
    },
  });

  if (!knownDeath && isDeath.data !== true) return null;

  const held = docs.data || {};
  const missing = DEATH_FILE_ITEMS.filter((item) => !held[item.category]);

  const onFile = async (category: string, file?: File) => {
    if (!file) return;
    setBusy(category);
    try {
      await uploadPatientDocs([file], {
        patientId,
        patientName: patientName || 'Patient',
        category: category as any,
        uploadedBy: user?.id ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['death-file-docs', patientId] });
      toast.success(`${DEATH_FILE_ITEMS.find((i) => i.category === category)?.label} attached.`);
    } catch (error: any) {
      toast.error(error?.message || 'Could not attach the document');
    } finally {
      setBusy(null);
      const input = inputs.current[category];
      if (input) input.value = '';
      const camera = inputs.current[`${category}-camera`];
      if (camera) camera.value = '';
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        missing.length ? 'border-red-300 bg-red-50/70' : 'border-emerald-300 bg-emerald-50/70'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        {missing.length ? (
          <AlertTriangle className="h-4 w-4 text-red-600" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        )}
        <h4 className={`text-sm font-semibold ${missing.length ? 'text-red-900' : 'text-emerald-900'}`}>
          Death file — {DEATH_FILE_ITEMS.length - missing.length} of {DEATH_FILE_ITEMS.length} on record
        </h4>
      </div>

      <div className="space-y-2">
        {DEATH_FILE_ITEMS.map((item) => {
          const doc = held[item.category];
          return (
            <div key={item.category} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                {doc ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border-2 border-red-400" />
                )}
                {item.label}
              </span>

              {doc ? (
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" /> View
                </a>
              ) : (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy === item.category}
                    onClick={() => inputs.current[item.category]?.click()}
                    className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {busy === item.category ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload
                  </button>
                  <button
                    type="button"
                    disabled={busy === item.category}
                    onClick={() => inputs.current[`${item.category}-camera`]?.click()}
                    title={`Photograph the ${item.label.toLowerCase()}`}
                    aria-label={`Photograph the ${item.label.toLowerCase()}`}
                    className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}

              <input
                ref={(el) => { inputs.current[item.category] = el; }}
                type="file"
                accept={item.accept}
                className="hidden"
                onChange={(e) => void onFile(item.category, e.target.files?.[0])}
              />
              <input
                ref={(el) => { inputs.current[`${item.category}-camera`] = el; }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onFile(item.category, e.target.files?.[0])}
              />
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-xs text-red-800">
          Still to attach: {missing.map((m) => m.label.toLowerCase()).join(', ')}.
        </p>
      )}
    </div>
  );
}
