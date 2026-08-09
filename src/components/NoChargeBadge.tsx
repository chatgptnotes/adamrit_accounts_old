import { Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  NO_CHARGE_REASON_LABEL,
  useNoChargeFlag,
  useNoChargeFlagByUhid,
  type NoChargeFlag,
} from '@/lib/noChargeFlag';

// The "do not charge" label, wherever money is taken. Deliberately loud: it
// exists to stop a charge that has already been settled another way.

export function NoChargeLabel({
  flag,
  className,
  detailed = false,
}: {
  flag: NoChargeFlag;
  className?: string;
  /** Show the note and who authorised it, not just the label. */
  detailed?: boolean;
}) {
  if (!detailed) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700',
          className,
        )}
        title={`${NO_CHARGE_REASON_LABEL[flag.reason]}${flag.note ? ` — ${flag.note}` : ''} · authorised by ${flag.authorised_by}`}
      >
        <Ban className="h-3.5 w-3.5" />
        Do not charge
      </span>
    );
  }

  return (
    <div className={cn('rounded-xl border-2 border-red-400 bg-red-50 p-3', className)}>
      <p className="flex items-center gap-2 text-sm font-bold text-red-800">
        <Ban className="h-4 w-4 shrink-0" />
        Do not charge — {NO_CHARGE_REASON_LABEL[flag.reason]}
      </p>
      {flag.note ? <p className="mt-1 text-sm text-red-900">{flag.note}</p> : null}
      <p className="mt-1 text-xs text-red-700">
        Authorised by {flag.authorised_by} ·{' '}
        {new Date(flag.created_at).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </p>
    </div>
  );
}

/** Looks the flag up itself. Renders nothing when the patient has none. */
export function NoChargeBadge({
  patientId,
  className,
  detailed = false,
}: {
  patientId: string | null | undefined;
  className?: string;
  detailed?: boolean;
}) {
  const { data: flag } = useNoChargeFlag(patientId);
  if (!flag) return null;
  return <NoChargeLabel flag={flag} className={className} detailed={detailed} />;
}

/** Same badge, for screens that hold the printed UHID rather than the row id. */
export function NoChargeBadgeByUhid({
  uhid,
  hospitalName,
  className,
  detailed = false,
}: {
  uhid: string | null | undefined;
  hospitalName?: string;
  className?: string;
  detailed?: boolean;
}) {
  const { data: flag } = useNoChargeFlagByUhid(uhid, hospitalName);
  if (!flag) return null;
  return <NoChargeLabel flag={flag} className={className} detailed={detailed} />;
}

export default NoChargeBadge;
