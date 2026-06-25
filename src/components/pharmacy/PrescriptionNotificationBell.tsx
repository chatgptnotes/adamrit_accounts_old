import React from 'react';
import { Bell, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PendingPrescription } from '@/hooks/usePendingPrescriptions';

interface Props {
  count: number;
  recent: PendingPrescription[];
  onViewAll: () => void;
  onRowClick: (id: string) => void;
}

const formatTimeAgo = (iso: string | null) => {
  if (!iso) return '';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

const LOCATION_BADGE: Record<string, string> = {
  ICU:  'bg-red-100 text-red-700',
  Ward: 'bg-blue-100 text-blue-700',
  Room: 'bg-green-100 text-green-700',
  OT:   'bg-orange-100 text-orange-700',
};

const PrescriptionNotificationBell: React.FC<Props> = ({ count, recent, onViewAll, onRowClick }) => {
  const displayCount = count > 99 ? '99+' : String(count);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`${count} pending prescriptions`}
        >
          <Bell className={count > 0 ? 'h-5 w-5 text-orange-600' : 'h-5 w-5 text-muted-foreground'} />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-semibold leading-none">
              {displayCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Pending Prescriptions</span>
          <span className="text-xs text-muted-foreground font-normal">{count} total</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {recent.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No pending prescriptions
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            {recent.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onSelect={() => onRowClick(p.id)}
                className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer"
              >
                <FileText className="h-4 w-4 mt-0.5 text-orange-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 font-medium truncate">
                    {p.prescription_number || p.id.slice(0, 8)}
                    <span className="text-muted-foreground font-normal"> · {p.patient_name}</span>
                    {p.patient_location && LOCATION_BADGE[p.patient_location] ? (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${LOCATION_BADGE[p.patient_location]}`}>
                        {p.patient_location}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.doctor_name || 'Unknown doctor'} · {formatTimeAgo(p.created_at)}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onViewAll}
          className="justify-center text-sm font-medium text-primary cursor-pointer"
        >
          View all →
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PrescriptionNotificationBell;
