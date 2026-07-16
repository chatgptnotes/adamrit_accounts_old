import { Card, CardContent } from '@/components/ui/card';

interface StatisticsProps {
  statistics: {
    waiting: number;
    inProgress: number;
    completed: number;
    total: number;
  };
  canSeeTile?: (tileId: string, role?: string | null) => boolean;
}

export const OpdStatisticsCards = ({ statistics, canSeeTile }: StatisticsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {(!canSeeTile || canSeeTile("o-waiting")) && (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="text-3xl font-bold text-blue-600">{statistics.waiting}</div>
          <div className="text-sm text-muted-foreground mt-1">Waiting</div>
        </CardContent>
      </Card>
      )}
      {(!canSeeTile || canSeeTile("o-in-progress")) && (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="text-3xl font-bold text-yellow-600">{statistics.inProgress}</div>
          <div className="text-sm text-muted-foreground mt-1">In Progress</div>
        </CardContent>
      </Card>
      )}
      {(!canSeeTile || canSeeTile("o-completed")) && (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="text-3xl font-bold text-green-600">{statistics.completed}</div>
          <div className="text-sm text-muted-foreground mt-1">Completed</div>
        </CardContent>
      </Card>
      )}
      {(!canSeeTile || canSeeTile("o-total")) && (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="text-3xl font-bold">{statistics.total}</div>
          <div className="text-sm text-muted-foreground mt-1">Total OPD Today</div>
        </CardContent>
      </Card>
      )}
    </div>
  );
};