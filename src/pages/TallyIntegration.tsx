import React from 'react';
import AccountingPage from '@/components/accounting/AccountingPage';

// /tally now opens inside the accounting module (same Tally chrome as every
// other accounting screen), landing on the live Tally-gateway suite.
const TallyIntegration = () => {
  return <AccountingPage initialTab="tally-live" />;
};

export default TallyIntegration;
