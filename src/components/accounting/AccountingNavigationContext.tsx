import React, { createContext, useContext, useMemo } from 'react';

interface AccountingNavigationContextValue {
  goTo: (tab: string) => void;
  backOneLevel: () => void;
}

const AccountingNavigationContext = createContext<AccountingNavigationContextValue | null>(null);

export const AccountingNavigationProvider: React.FC<{
  children: React.ReactNode;
  goTo: (tab: string) => void;
  backOneLevel: () => void;
}> = ({ children, goTo, backOneLevel }) => {
  const value = useMemo(() => ({ goTo, backOneLevel }), [goTo, backOneLevel]);
  return <AccountingNavigationContext.Provider value={value}>{children}</AccountingNavigationContext.Provider>;
};

export const useAccountingNavigationOptional = (): AccountingNavigationContextValue | null =>
  useContext(AccountingNavigationContext);

