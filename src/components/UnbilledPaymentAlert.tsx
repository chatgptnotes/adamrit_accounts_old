import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// DATA SOURCE: v_recon_alerts — debits read off a payment phone or a bank
// statement that could not be tied to a bill.
//
// The rule is that money only leaves against a bill in the system. A breach
// of it should reach the management the same day rather than waiting for
// someone to open a tile, so this raises it once per director per day: seen
// and dismissed, it stays quiet until tomorrow or until a new one appears.

const DIRECTOR_ROLES = new Set(['superadmin', 'super_admin', 'admin', 'cmd', 'director']);

export function UnbilledPaymentAlert() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isDirector = DIRECTOR_ROLES.has((user?.role || '').toLowerCase().trim());

  const alerts = useQuery({
    queryKey: ['unbilled-payment-alert'],
    enabled: isDirector,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('v_recon_alerts')
        .select('id, amount, counterparty, txn_date, source_holder, source_label, days_old')
        .limit(50);
      return data || [];
    },
  });

  const rows = alerts.data || [];
  const total = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  // Fingerprint of what is outstanding: a new exception reopens the dialog
  // the same day, an unchanged list does not.
  const fingerprint = `${new Date().toDateString()}|${rows.map((r: any) => r.id).sort().join(',')}`;
  const seenKey = 'unbilled-payment-alert-seen';

  useEffect(() => {
    if (!isDirector || rows.length === 0) return;
    if (sessionStorage.getItem(seenKey) === fingerprint) return;
    setOpen(true);
  }, [isDirector, rows.length, fingerprint]);

  const dismiss = () => {
    sessionStorage.setItem(seenKey, fingerprint);
    setOpen(false);
  };

  if (!isDirector || rows.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="h-5 w-5" />
            {rows.length} payment{rows.length === 1 ? '' : 's'} with no bill
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          ₹{total.toLocaleString('en-IN')} left a payment phone or a bank account without a bill
          behind it in the system.
        </p>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {rows.slice(0, 8).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.counterparty || 'Unnamed payee'}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.source_holder || r.source_label, new Date(r.txn_date).toLocaleDateString('en-IN'),
                    r.days_old > 0 ? `${r.days_old} day${r.days_old === 1 ? '' : 's'} ago` : 'today']
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-red-700">
                ₹{Number(r.amount).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
          {rows.length > 8 && (
            <p className="text-xs text-muted-foreground">…and {rows.length - 8} more.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={dismiss}>
            Later
          </Button>
          <Button
            onClick={() => { dismiss(); navigate('/t/reconciliation-tilak'); }}
          >
            Review them
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
