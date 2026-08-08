import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Loader2, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface RegistrationReferral {
  id: string;
  patient_name: string;
  coming_from: string | null;
  referee_initials: string | null;
  is_direct: boolean;
  status: 'ANNOUNCED' | 'LINKED' | 'CANCELLED';
  announced_by: string | null;
  created_at: string;
}

const WINDOW_HOURS = 48;

interface ReferralSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (referral: RegistrationReferral) => void;
}

export const ReferralSelectionDialog: React.FC<ReferralSelectionDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
}) => {
  const { data: referrals = [], isLoading, isError } = useQuery({
    queryKey: ['registration-referral-selection'],
    enabled: open,
    queryFn: async (): Promise<RegistrationReferral[]> => {
      const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from('incoming_referrals')
        .select('id, patient_name, coming_from, referee_initials, is_direct, status, announced_by, created_at')
        .eq('status', 'ANNOUNCED')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as RegistrationReferral[];
    },
  });

  const direct: RegistrationReferral = {
    id: 'direct-walk-in',
    patient_name: 'Direct / Walk-in patient',
    coming_from: null,
    referee_initials: null,
    is_direct: true,
    status: 'ANNOUNCED',
    announced_by: null,
    created_at: new Date().toISOString(),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select referral before registration</DialogTitle>
          <DialogDescription>
            Choose an announcement from the last 48 hours, or select Direct for a walk-in patient.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading announcements…
          </div>
        ) : isError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Announcements could not be loaded. Please try again before registering.
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {[...referrals, direct].map((referral) => (
              <Button
                key={referral.id}
                type="button"
                variant="outline"
                className="h-auto w-full justify-start gap-3 p-4 text-left"
                onClick={() => {
                  onSelect(referral);
                  onOpenChange(false);
                }}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                  {referral.is_direct ? <UserRound className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{referral.patient_name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {referral.is_direct
                      ? 'Walk-in — no referral cut'
                      : `${referral.coming_from ? `From ${referral.coming_from} · ` : ''}Referee ${referral.referee_initials || '—'} · ${format(new Date(referral.created_at), 'dd MMM, HH:mm')}`}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
