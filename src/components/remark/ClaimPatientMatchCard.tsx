import React from 'react';
import { CheckCircle2, HelpCircle, Users, XCircle } from 'lucide-react';
import { useClaimPatientMatch } from '@/hooks/useClaimPatientMatch';

// Says whether the person named on an ESIC claim is a patient of ours.
//
// The four states are kept visibly distinct because they are not equally
// trustworthy: a match on the ESIC UHID recorded against a visit is a fact, and
// a match on a name is a guess that a human still has to confirm. Collapsing
// them into one green tick would invite somebody to answer a query about the
// wrong patient.

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const ClaimPatientMatchCard: React.FC<{
  uhid: string | null;
  patientName: string | null;
}> = ({ uhid, patientName }) => {
  const { data: match, isLoading } = useClaimPatientMatch(uhid, patientName);

  if (isLoading) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Checking our records…
      </div>
    );
  }
  if (!match) return null;

  if (match.status === 'found') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          In our records
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Patient</span> {match.patientName || '—'}</div>
          <div><span className="text-muted-foreground">Patient ID</span> {match.patientsId || '—'}</div>
          <div><span className="text-muted-foreground">Visit</span> {match.visitId || '—'}</div>
          <div>
            <span className="text-muted-foreground">Stay</span> {formatDate(match.admissionDate)} – {formatDate(match.dischargeDate)}
          </div>
        </div>
        <p className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-300/80">
          Matched on the ESIC UHID recorded against the visit.
        </p>
      </div>
    );
  }

  if (match.status === 'possible') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
          <HelpCircle className="h-4 w-4" />
          Possible match
        </div>
        <div className="mt-2 text-sm">
          {match.patientName} · {match.patientsId}
        </div>
        <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-300/80">
          Matched on the name only — this claim's UHID is not recorded against any visit, so
          confirm it is the same person before relying on it.
        </p>
      </div>
    );
  }

  if (match.status === 'ambiguous') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
          <Users className="h-4 w-4" />
          {match.sharedBy} patients share this name
        </div>
        <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-300/80">
          Not resolved — search "{patientName}" in Patients to pick the right one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <XCircle className="h-4 w-4" />
        Not found in our records
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        No visit carries this ESIC UHID and no patient carries this name. The ESIC UHID is
        recorded on only a minority of visits, so this does not mean the patient was never here.
      </p>
    </div>
  );
};
