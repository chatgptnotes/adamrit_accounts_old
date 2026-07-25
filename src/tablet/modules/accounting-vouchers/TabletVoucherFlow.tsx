import { useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import VoucherEntry from '@/components/accounting/VoucherEntry';
import { AccountingCompanyProvider } from '@/components/accounting/AccountingCompanyContext';
import { canCreateAccountingVouchers } from '@/lib/accounting-access';
import { TabletButton } from '@/tablet/ui/TabletButton';
import { TabletCard } from '@/tablet/ui/TabletCard';

const CATEGORY_BY_MODULE: Record<string, string> = {
  'payment-voucher': 'PAYMENT',
  'receipt-voucher': 'RECEIPT',
  'contra-voucher': 'CONTRA',
  'journal-voucher': 'JOURNAL',
};

export default function TabletVoucherFlow() {
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const { user, hospitalConfig } = useAuth();
  const category = CATEGORY_BY_MODULE[moduleId];

  if (!category || !canCreateAccountingVouchers(user)) {
    return (
      <div className="mx-auto flex h-full max-w-xl items-center p-4">
        <TabletCard className="w-full space-y-4 p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
          <div>
            <h2 className="text-xl font-semibold">Accounting access required</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Voucher creation is available only to authorised accounting roles.
            </p>
          </div>
          <TabletButton onClick={() => navigate('/')}>Back to tablet home</TabletButton>
        </TabletCard>
      </div>
    );
  }

  return (
    <AccountingCompanyProvider preferredCompanyKey={hospitalConfig.name}>
      <VoucherEntry
        initialVoucherCategory={category}
        lockedVoucherCategory={category}
        tabletMode
        onDone={() => navigate('/')}
      />
    </AccountingCompanyProvider>
  );
}
