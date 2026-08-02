import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2 } from 'lucide-react';
import { AyushmanRMO } from './types';
import { usePermissions } from '@/hooks/usePermissions';
import { LedgerBadge } from '@/components/LedgerSearchField';

interface AyushmanRMOCardProps {
  rmo: AyushmanRMO;
  onEdit: (rmo: AyushmanRMO) => void;
  onDelete: (id: string) => void;
}

export const AyushmanRMOCard = ({ rmo, onEdit, onDelete }: AyushmanRMOCardProps) => {
  const { canEditMasters } = usePermissions();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="text-xl">{rmo.name}</span>
          <div className="flex gap-2">
            {rmo.specialty && (
              <Badge variant="outline">{rmo.specialty}</Badge>
            )}
            {rmo.department && (
              <Badge variant="secondary">{rmo.department}</Badge>
            )}
            {canEditMasters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(rmo)}
                className="text-blue-600 hover:text-blue-700"
                title="Edit RMO"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {canEditMasters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(rmo.id)}
                className="text-red-600 hover:text-red-700"
                title="Delete RMO"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 text-sm">
          {rmo.ledger_account_id ? (
            <div>
              <span className="font-semibold">Ledger: </span>
              <LedgerBadge accountId={rmo.ledger_account_id} />
            </div>
          ) : (
            <p className="text-xs font-semibold text-amber-700">
              No accounting ledger mapped — the duty roster will not offer this RMO until one is picked.
            </p>
          )}
          {(rmo.daily_remuneration !== undefined && rmo.daily_remuneration !== null && rmo.daily_remuneration > 0) && (
            <div className="flex items-center gap-2">
              <span className="font-semibold">Daily Remuneration:</span>
              <Badge className="bg-green-100 text-green-800 font-mono">₹{rmo.daily_remuneration.toLocaleString('en-IN')}</Badge>
            </div>
          )}
          {rmo.contact_info && (
            <div><span className="font-semibold">Contact:</span> {rmo.contact_info}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
