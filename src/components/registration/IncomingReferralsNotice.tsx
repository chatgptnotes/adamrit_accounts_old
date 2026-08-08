import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, FileText, Megaphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// DATA SOURCE: incoming_referrals — the same announcements the tablet tile
// "Incoming Referrals - Suraj Arpit" writes. Read-only here: the front office
// checks whether an arrival was already claimed before registering them.

interface ReferralDoc {
  name: string;
  url: string;
  category: string;
}

interface Announcement {
  id: string;
  patient_name: string;
  coming_from: string | null;
  referee_initials: string | null;
  is_direct: boolean;
  documents: ReferralDoc[] | null;
  status: 'ANNOUNCED' | 'LINKED' | 'CANCELLED';
  announced_by: string | null;
  linked_visit_id: string | null;
  created_at: string;
}

/** Matches the tablet tile's window. */
const WINDOW_HOURS = 48;

/**
 * Announcements from the last 48 hours, shown beside "Register New Patient".
 * The front office reads it before registering so a referral that has already
 * been claimed is not registered as a walk-in. Linking stays on the tablet
 * tile — nothing here writes.
 */
export const IncomingReferralsNotice: React.FC = () => {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['incoming-referrals-48h'],
    queryFn: async (): Promise<Announcement[]> => {
      // Last 48 hours, plus every still-awaited announcement however old, so
      // an unlinked claim never disappears from the front office's view.
      const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from('incoming_referrals')
        .select(
          'id, patient_name, coming_from, referee_initials, is_direct, documents, status, announced_by, linked_visit_id, created_at',
        )
        .neq('status', 'CANCELLED')
        .or(`created_at.gte.${since},status.eq.ANNOUNCED`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as Announcement[];
    },
    staleTime: 60 * 1000,
  });

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-5 w-5 text-orange-600" />
          Announced in the last 48 hours
          {announcements.length > 0 && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
              {announcements.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading announcements…</p>
        ) : announcements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing announced in the last 48 hours — check with marketing before registering a
            referred patient.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {announcements.map((item) => (
              <div key={item.id} className="rounded-lg border bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{item.patient_name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.is_direct && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        Direct
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        item.status === 'LINKED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.status === 'LINKED' ? 'Linked' : 'Awaited'}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.coming_from ? `From ${item.coming_from} · ` : ''}
                  {item.is_direct ? 'Walk-in' : `Referee ${item.referee_initials}`} ·{' '}
                  {format(new Date(item.created_at), 'dd MMM, HH:mm')}
                  {item.announced_by ? ` · by ${item.announced_by.split('@')[0]}` : ''}
                </p>
                {item.status === 'LINKED' && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
                    <Check className="h-3 w-3" />
                    Registered{item.linked_visit_id ? ` — visit ${item.linked_visit_id}` : ''}
                  </p>
                )}
                {(item.documents?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.documents!.map((doc, index) => (
                      <a
                        key={`${doc.url}-${index}`}
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-primary"
                      >
                        <FileText className="h-3 w-3" /> {doc.category}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
