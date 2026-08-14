import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { isActive } from "./constants";

/**
 * Who could still sign in once password sign-in is switched off.
 *
 * The plan is Google-only sign-in. The danger is that it looks ready when it
 * is not: most staff here have a primary email ending in gmail.com, which
 * reads as "already on Google" but is usually an internal placeholder nobody
 * can actually sign into. Google will only authenticate an address its owner
 * genuinely holds, so those accounts fail at the door.
 *
 * This counts an account ready ONLY where somebody has explicitly recorded a
 * Google sign-in address. That is deliberately strict: over-counting here
 * would be measured in staff standing at a locked counter.
 */

interface Props {
  users: AdminUser[];
}

const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
};

const GoogleSignInReadiness: React.FC<Props> = ({ users }) => {
  const [open, setOpen] = useState(false);

  const { ready, blocked, recentlyBlocked } = useMemo(() => {
    const active = users.filter(isActive);
    const readyList = active.filter((u) => (u.google_email || "").trim().length > 0);
    const blockedList = active.filter((u) => !(u.google_email || "").trim());
    // The ones that matter most: people actually using the system. A dormant
    // account locked out is a nuisance; a counter clerk locked out is not.
    const recent = blockedList
      .filter((u) => {
        const d = daysSince(u.last_login_at);
        return d !== null && d <= 30;
      })
      .sort((a, b) => String(b.last_login_at).localeCompare(String(a.last_login_at)));
    return { ready: readyList, blocked: blockedList, recentlyBlocked: recent };
  }, [users]);

  const total = ready.length + blocked.length;
  const pct = total > 0 ? Math.round((ready.length / total) * 100) : 0;
  const allReady = blocked.length === 0 && total > 0;

  return (
    <Card className={allReady ? "border-emerald-300" : "border-amber-300"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {allReady ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
          Google sign-in readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className={`text-3xl font-bold ${allReady ? "text-emerald-700" : "text-amber-700"}`}>
            {ready.length}
            <span className="text-base font-normal text-muted-foreground"> of {total}</span>
          </p>
          <span className="text-sm text-muted-foreground">{pct}% of active staff</span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${allReady ? "bg-emerald-600" : "bg-amber-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {allReady ? (
          <p className="text-sm text-emerald-800">
            Every active account has a Google sign-in address. Password sign-in can be
            switched off without locking anybody out.
          </p>
        ) : (
          <>
            <p className="text-sm text-amber-900">
              <strong>{blocked.length}</strong> active {blocked.length === 1 ? "person" : "people"} would be
              locked out if password sign-in were switched off now
              {recentlyBlocked.length > 0 && (
                <>
                  , including <strong>{recentlyBlocked.length}</strong> who signed in within the last 30 days
                </>
              )}
              .
            </p>
            <p className="text-xs text-muted-foreground">
              An address ending in gmail.com is not enough on its own — it must be one the
              person can genuinely sign into Google with. Add it per person under
              "Google sign-in address".
            </p>

            {recentlyBlocked.length > 0 && (
              <div className="rounded-md border bg-muted/40">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Recently active, still missing an address ({recentlyBlocked.length})
                </button>
                {open && (
                  <ul className="max-h-64 overflow-y-auto border-t px-3 py-2 text-sm">
                    {recentlyBlocked.map((u) => {
                      const d = daysSince(u.last_login_at);
                      return (
                        <li key={u.id} className="flex flex-wrap justify-between gap-2 py-1">
                          <span className="font-medium">{u.full_name || u.email}</span>
                          <span className="text-xs text-muted-foreground">
                            {u.email} · {u.role || "—"} ·{" "}
                            {d === 0 ? "signed in today" : `${d}d ago`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GoogleSignInReadiness;
