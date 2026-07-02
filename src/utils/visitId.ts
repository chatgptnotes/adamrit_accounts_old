import { supabase } from '@/integrations/supabase/client';

// Visits (and several related tables) are keyed two ways:
//   - `id`        uuid primary key            → use with .eq('id', ...)
//   - `visit_id`  readable code like IH26F28007 → use with .eq('visit_id', ...)
// Sending the readable code to a uuid column throws
// `invalid input syntax for type uuid` — always branch via isUuid first.
export const isUuid = (value: string | null | undefined): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

// Resolve either identifier form to the visit's uuid primary key.
// Returns null when the visit doesn't exist.
export async function resolveVisitUuid(idOrCode: string | null | undefined): Promise<string | null> {
  if (!idOrCode || idOrCode === 'undefined') return null;
  if (isUuid(idOrCode)) return idOrCode;
  const { data } = await supabase
    .from('visits')
    .select('id')
    .eq('visit_id', idOrCode)
    .maybeSingle();
  return data?.id ?? null;
}
