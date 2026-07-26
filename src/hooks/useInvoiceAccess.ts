// Access state for a locked private-patient invoice.
//
// Holds the grant token the browser exchanges for invoice content. The token is
// kept in sessionStorage rather than localStorage, so it dies with the tab
// instead of quietly surviving until someone clears their browser — a 15-minute
// window should not outlive the session that opened it.
//
// The token is opaque and server-minted. Nothing here decides whether access is
// allowed; that judgement lives in get_invoice_content() in Postgres. This hook
// only decides what to render.
//
// Password-only for now. The database already supports SMS one-time codes; when
// Twilio is provisioned, a request step slots in ahead of unlock() without
// changing anything below it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface InvoiceLockState {
  found: boolean;
  bill_id: string;
  bill_no: string | null;
  visit_id: string | null;
  patient_name: string | null;
  is_private: boolean;
  is_paid: boolean;
  is_locked: boolean;
}

interface StoredGrant {
  token: string;
  expiresAt: string;
}

const storageKey = (billId: string) => `invoice-grant:${billId}`;

const readGrant = (billId: string): StoredGrant | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(billId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGrant;
    // An already-expired grant is worthless — drop it rather than letting the UI
    // briefly render an unlocked state the server will refuse.
    if (!parsed?.token || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(storageKey(billId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeGrant = (billId: string, grant: StoredGrant) => {
  try {
    sessionStorage.setItem(storageKey(billId), JSON.stringify(grant));
  } catch {
    // Private-browsing quota failures must not break the unlock — the token
    // still works for this render, it just will not survive a reload.
  }
};

interface UseInvoiceAccessArgs {
  /** Preferred when the page already knows the bill row. */
  billId?: string | null;
  /** Used by pages routed on a visit (e.g. /invoice/:visitId); resolved to a billId. */
  visitId?: string | null;
}

export const useInvoiceAccess = (args: UseInvoiceAccessArgs | string | null | undefined) => {
  const opts: UseInvoiceAccessArgs = typeof args === 'string' ? { billId: args } : (args || {});
  const { user } = useAuth();

  // Resolve visit → bill. Only `id` is selected: that column stays readable to
  // anon after the lockdown, whereas the invoice content does not.
  const { data: resolvedBillId, isLoading: isResolving } = useQuery({
    queryKey: ['invoice-bill-id-for-visit', opts.visitId],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from('bills')
        .select('id')
        .eq('visit_id', opts.visitId as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qErr) throw qErr;
      return (data as { id: string } | null)?.id ?? null;
    },
    enabled: !opts.billId && !!opts.visitId,
    staleTime: 60_000,
  });

  const billId = opts.billId || resolvedBillId || null;
  const [grant, setGrant] = useState<StoredGrant | null>(() => (billId ? readGrant(billId) : null));
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Re-read on bill change so navigating between bills never carries a grant across.
  useEffect(() => {
    setGrant(billId ? readGrant(billId) : null);
    setError(null);
  }, [billId]);

  const { data: lockState, isLoading: isLockQueryLoading, refetch: refetchLock } = useQuery({
    queryKey: ['invoice-lock-state', billId],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('invoice_lock_state' as any, {
        p_bill_id: billId,
      });
      if (rpcError) throw rpcError;
      return (data || null) as InvoiceLockState | null;
    },
    enabled: !!billId,
    staleTime: 30_000,
  });

  // Resolution counts as loading. If it did not, a visit-routed page would see
  // billId === null for a tick, conclude "not locked", and render the invoice
  // before the lock state ever arrived.
  const isLockLoading = isResolving || isLockQueryLoading;

  const isLocked = Boolean(lockState?.is_locked);
  const grantExpiry = grant ? new Date(grant.expiresAt).getTime() : 0;
  const isUnlocked = Boolean(grant && grantExpiry > now);
  const remainingMs = isUnlocked ? Math.max(grantExpiry - now, 0) : 0;

  // Only tick while a grant is live. No timer runs on unlocked or never-locked bills.
  useEffect(() => {
    if (!grant) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [grant]);

  // Drop the grant the moment it lapses, so the gate reappears without a reload.
  useEffect(() => {
    if (grant && grantExpiry <= now) {
      if (billId) sessionStorage.removeItem(storageKey(billId));
      setGrant(null);
    }
  }, [grant, grantExpiry, now, billId]);

  const unlock = useCallback(
    async (code: string) => {
      if (!billId) return { ok: false, reason: 'no_bill' };
      setVerifying(true);
      setError(null);
      try {
        const res = await fetch('/api/invoice-otp-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            billId,
            code,
            userEmail: user?.email || user?.username || '',
          }),
        });
        const body = await res.json().catch(() => ({}));

        if (!res.ok || !body?.ok) {
          const reason = body?.reason || body?.error;
          setError(
            reason === 'locked_out'
              ? `Too many wrong attempts. Try again in ${body?.retryAfterMinutes ?? 60} minutes.`
              : reason === 'supabase_not_configured'
                ? 'Invoice access is not configured. Contact the administrator.'
                : 'Incorrect password.',
          );
          return { ok: false, reason };
        }

        const next = { token: body.grantToken, expiresAt: body.expiresAt };
        writeGrant(billId, next);
        setGrant(next);
        setNow(Date.now());
        return { ok: true, via: body.via };
      } catch {
        setError('Network error. Please try again.');
        return { ok: false, reason: 'network' };
      } finally {
        setVerifying(false);
      }
    },
    [billId, user],
  );

  const clearGrant = useCallback(() => {
    if (billId) sessionStorage.removeItem(storageKey(billId));
    setGrant(null);
  }, [billId]);

  return useMemo(
    () => ({
      isLockLoading,
      lockState: lockState || null,
      isLocked,
      isUnlocked,
      // The single question a page asks before rendering bill content.
      needsGate: isLocked && !isUnlocked,
      grantToken: isUnlocked ? grant?.token ?? null : null,
      remainingMs,
      verifying,
      error,
      unlock,
      clearGrant,
      refetchLock,
    }),
    [
      isLockLoading, lockState, isLocked, isUnlocked, grant, remainingMs,
      verifying, error, unlock, clearGrant, refetchLock,
    ],
  );
};
