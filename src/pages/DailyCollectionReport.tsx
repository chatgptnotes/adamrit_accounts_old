/**
 * "How much money came in today?"
 *
 * The question had no screen until now. See src/lib/dailyCollection.ts for what
 * counts as money in, why credit sits outside the total, and why the day is an
 * IST day rather than a UTC one.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DailyCollectionView } from '@/components/DailyCollectionView';
import '@/styles/print.css';

const DailyCollectionReport: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Banknote className="h-6 w-6 text-emerald-700" />
        <div>
          <h1 className="text-2xl font-semibold">Daily Collection Report</h1>
          <p className="text-sm text-muted-foreground">
            Advances, final payments and pharmacy sales for one day
          </p>
        </div>
      </div>

      <DailyCollectionView />
    </div>
  );
};

export default DailyCollectionReport;
