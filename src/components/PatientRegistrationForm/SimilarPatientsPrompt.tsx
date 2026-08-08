import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, UserCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

// A patient who has been here before must not be registered twice.
//
// The moment a name is typed, this looks for patients already on file whose
// name matches, and puts them in front of the person registering — with the
// patient ID, age, gender and phone, so the right one can be recognised. The
// form will not submit while a match is showing until either an existing
// patient is picked or the user states outright that this is a different
// person, which is recorded rather than assumed.

export interface SimilarPatient {
  id: string;
  name: string;
  patients_id: string | null;
  age: string | null;
  gender: string | null;
  phone: string | null;
  address: string | null;
  corporate: string | null;
  aadhaar_number: string | null;
  last_visit: string | null;
}

export interface SimilarPatientsState {
  /** Matches currently on screen. */
  matches: SimilarPatient[];
  /** The existing patient the user chose to register the visit against. */
  chosen: SimilarPatient | null;
  /** The user has stated this is somebody else. */
  declaredDifferent: boolean;
}

export const EMPTY_SIMILAR_STATE: SimilarPatientsState = {
  matches: [],
  chosen: null,
  declaredDifferent: false,
};

/** True when the form must not be submitted yet. */
export function similarPatientsBlockSubmit(state: SimilarPatientsState): boolean {
  return state.matches.length > 0 && !state.chosen && !state.declaredDifferent;
}

/**
 * Every word typed must begin a word of the candidate name, so "Ram Kumar"
 * finds "Ram Kumar Yadav" and "Ram" finds "Ram Meshram" — but not "Chaitali
 * Meshram", where "ram" only sits inside a word. Matching mid-word floods the
 * list with strangers and teaches everyone to ignore it.
 */
function namesLookAlike(typed: string, candidate: string): boolean {
  const typedWords = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const candidateWords = (candidate || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (
    typedWords.length > 0 &&
    typedWords.every((word) => candidateWords.some((part) => part.startsWith(word)))
  );
}

export function SimilarPatientsPrompt({
  typedName,
  hospitalName,
  value,
  onChange,
}: {
  typedName: string;
  hospitalName?: string | null;
  value: SimilarPatientsState;
  onChange: (state: SimilarPatientsState) => void;
}) {
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(typedName.trim()), 350);
    return () => clearTimeout(timer);
  }, [typedName]);

  const search = useQuery({
    queryKey: ['similar-patients', debounced, hospitalName],
    enabled: debounced.length >= 3,
    staleTime: 30_000,
    queryFn: async (): Promise<SimilarPatient[]> => {
      // The first word carries the search; the rest narrow it client-side, so
      // a middle name typed differently does not hide the match.
      const firstWord = debounced.split(/\s+/)[0];
      let query = (supabase as any)
        .from('patients')
        .select('id, name, patients_id, age, gender, phone, address, corporate, aadhaar_number, created_at')
        .ilike('name', `%${firstWord}%`)
        .limit(25);
      if (hospitalName) query = query.eq('hospital_name', hospitalName);
      const { data } = await query;
      return ((data ?? []) as any[])
        .filter((p) => namesLookAlike(debounced, p.name || ''))
        .map((p) => ({ ...p, last_visit: p.created_at ?? null }));
    },
  });

  const matches = search.data ?? [];

  // Keep the parent's copy of the matches in step, and drop a choice that no
  // longer belongs to what is typed.
  useEffect(() => {
    const chosenStillValid = value.chosen && matches.some((m) => m.id === value.chosen?.id);
    onChange({
      matches,
      chosen: chosenStillValid ? value.chosen : null,
      declaredDifferent: matches.length > 0 ? value.declaredDifferent : false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(matches.map((m) => m.id))]);

  if (debounced.length < 3) return null;

  if (search.isLoading) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking for an existing record…
      </p>
    );
  }

  if (matches.length === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> No patient of this name is registered yet.
      </p>
    );
  }

  if (value.chosen) {
    return (
      <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm">
        <p className="flex items-center gap-1 font-medium text-emerald-900">
          <UserCheck className="h-4 w-4" />
          Registering against {value.chosen.name}
          {value.chosen.patients_id ? ` (${value.chosen.patients_id})` : ''}
        </p>
        <button
          type="button"
          className="mt-1 text-xs text-emerald-800 underline"
          onClick={() => onChange({ ...value, chosen: null })}
        >
          Pick someone else
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
      <p className="flex items-center gap-1 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        {matches.length} patient{matches.length === 1 ? '' : 's'} of this name already registered
      </p>
      <p className="mb-2 text-xs text-amber-800">
        Pick the existing record so this visit joins their history. Register afresh only if this
        is genuinely a different person.
      </p>

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {matches.map((m) => (
          <button
            key={m.id}
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded border bg-white px-2 py-1.5 text-left hover:bg-blue-50"
            onClick={() => onChange({ ...value, chosen: m, declaredDifferent: false })}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[m.patients_id, m.age ? `${m.age}y` : null, m.gender, m.phone]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Button type="button" size="sm" variant="outline" className="shrink-0" tabIndex={-1}>
              Use this patient
            </Button>
          </button>
        ))}
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={value.declaredDifferent}
          onChange={(e) => onChange({ ...value, declaredDifferent: e.target.checked, chosen: null })}
        />
        This is a different person — register a new record
      </label>
    </div>
  );
}
