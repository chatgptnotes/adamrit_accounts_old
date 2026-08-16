import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { supabase } from '@/integrations/supabase/client';

export interface Icd11Entry {
  id: string;
  code: string | null;
  title: string;
  definition: string | null;
  class_kind: string | null;
  chapter_no: string | null;
  chapter_title: string | null;
  uri: string;
  synonyms: string[] | null;
  is_leaf: boolean;
}

/**
 * Search the WHO ICD-11 master.
 *
 * Searches `search_text`, a generated column covering the code, the title and
 * the WHO's own index terms and inclusions — so a clinician's wording finds the
 * entry even when it is not the WHO's preferred title. PostgREST has no
 * partial-text operator for the synonyms array itself, which is why that column
 * exists.
 *
 * Leaf entities first: chapters and blocks are grouping nodes, and coding a
 * patient to "Chapter 01" is not a diagnosis.
 */
export const useSearchableIcd11 = (minLength = 2) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debounced] = useDebounce(searchTerm, 250);
  const term = debounced.trim();

  const query = useQuery({
    queryKey: ['icd11-search', term],
    enabled: term.length >= minLength,
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<Icd11Entry[]> => {
      const safe = term.replace(/[%,()]/g, '');
      const { data, error } = await (supabase as any)
        .from('icd11_codes')
        .select('id, code, title, definition, class_kind, chapter_no, chapter_title, uri, synonyms, is_leaf')
        .eq('is_active', true)
        .ilike('search_text', `%${safe}%`)
        .order('is_leaf', { ascending: false })
        .order('code', { nullsFirst: false })
        .limit(50);
      // Loudly. An empty list here would read as "no such diagnosis in ICD-11",
      // which is a clinical statement, not a failed query.
      if (error) throw error;
      return data || [];
    },
  });

  return {
    results: query.data || [],
    isLoading: query.isFetching,
    isError: query.isError,
    error: query.error,
    /** True when the master has never been loaded — a different thing from no match. */
    searchTerm,
    setSearchTerm,
    tooShort: term.length > 0 && term.length < minLength,
  };
};

/** Whether the ICD-11 master has been loaded at all, so a screen can say so. */
export const useIcd11MasterStatus = () =>
  useQuery({
    queryKey: ['icd11-master-status'],
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<{ loaded: boolean; count: number; release: string | null }> => {
      const { count, error } = await (supabase as any)
        .from('icd11_codes')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      const total = Number(count) || 0;
      let release: string | null = null;
      if (total > 0) {
        const { data } = await (supabase as any)
          .from('icd11_codes')
          .select('release_version')
          .not('release_version', 'is', null)
          .limit(1);
        release = data?.[0]?.release_version ?? null;
      }
      return { loaded: total > 0, count: total, release };
    },
  });
