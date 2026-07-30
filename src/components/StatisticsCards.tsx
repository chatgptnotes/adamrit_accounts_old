
import { Card, CardContent } from '@/components/ui/card';
import { Users, FileText } from 'lucide-react';

interface StatisticsCardsProps {
  totalPatients: number;
  canSeeTile?: (tileId: string, role?: string | null) => boolean;
}

export const StatisticsCards: React.FC<StatisticsCardsProps> = ({
  totalPatients,
  canSeeTile,
}) => {
  // The "System Status" tile that used to sit beside this one always read
  // "Active" — a hardcoded literal, not a health check — so it could never
  // report a problem. Removed rather than left as a meaningless indicator.
  return (
    <div className="grid grid-cols-1 gap-4 mb-6">
      {(!canSeeTile || canSeeTile("d-total-patients")) && (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Users className="h-8 w-8 text-blue-600 mr-3" />
          <div>
            <p className="text-2xl font-bold text-primary">{totalPatients}</p>
            <p className="text-sm text-muted-foreground">Total Patients</p>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
};
