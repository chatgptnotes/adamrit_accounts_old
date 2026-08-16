/**
 * "How much money came in today?"
 *
 * The question had no screen until now. See src/lib/dailyCollection.ts for what
 * counts as money in, why credit sits outside the total, and why the day is an
 * IST day rather than a UTC one.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { canCreateAccountingVouchers } from '@/lib/accounting-access';
import { DailyCollectionView } from '@/components/DailyCollectionView';
import '@/styles/print.css';

const DailyCollectionReport: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // The menu already hides this, but hiding a link is not restricting a page:
  // the URL is guessable and the sidebar is not the only way in. Checked here
  // so a typed address is refused too, matching how TabletModuleHost refuses a
  // typed /t/daily-collection.
  if (!canCreateAccountingVouchers(user)) {
    return (
      <div className="p-4 md:p-6">
        <Card className="max-w-lg">
          <CardContent className="pt-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">This report is not open to your account.</p>
              <p className="text-sm text-muted-foreground mt-1">
                The daily collection figure covers the whole hospital's takings. Ask an
                administrator if you need it.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4" />
                <span className="ml-2">Back</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
