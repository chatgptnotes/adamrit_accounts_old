import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useCompanies, type Company } from '@/hooks/useCompanies';

interface AccountingCompanyContextValue {
  companies: Company[];
  selectedCompanyId: string;
  setSelectedCompanyId: (companyId: string) => void;
  cycleCompany: () => void;
}

const AccountingCompanyContext = createContext<AccountingCompanyContextValue | null>(null);

const companyKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

const preferredCompany = (companies: Company[]): Company | undefined => {
  const exact = companyKey('DRM Hope Hospital Private Limited');
  return companies.find((company) => companyKey(company.company_name) === exact)
    ?? companies.find((company) => companyKey(company.company_name).includes('drmhopehospital'));
};

export const AccountingCompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  useEffect(() => {
    if (companies.length === 0) return;
    setSelectedCompanyId((current) => {
      if (current && companies.some((company) => company.id === current)) return current;
      return preferredCompany(companies)?.id ?? companies[0].id;
    });
  }, [companies]);

  const cycleCompany = useCallback(() => {
    if (companies.length === 0) return;
    setSelectedCompanyId((current) => {
      const currentIndex = companies.findIndex((company) => company.id === current);
      return companies[(currentIndex + 1 + companies.length) % companies.length].id;
    });
  }, [companies]);

  const value = useMemo(
    () => ({ companies, selectedCompanyId, setSelectedCompanyId, cycleCompany }),
    [companies, selectedCompanyId, cycleCompany],
  );

  return <AccountingCompanyContext.Provider value={value}>{children}</AccountingCompanyContext.Provider>;
};

export const useAccountingCompany = (): AccountingCompanyContextValue => {
  const context = useContext(AccountingCompanyContext);
  if (!context) throw new Error('useAccountingCompany must be used inside AccountingCompanyProvider');
  return context;
};

export const useAccountingCompanyOptional = (): AccountingCompanyContextValue | null =>
  useContext(AccountingCompanyContext);
