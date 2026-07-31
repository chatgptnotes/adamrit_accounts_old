import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useCompanies, type Company } from '@/hooks/useCompanies';

interface AccountingCompanyContextValue {
  companies: Company[];
  selectedCompanyId: string;
  setSelectedCompanyId: (companyId: string) => void;
  cycleCompany: () => void;
  /** Tally's Shut Company — no company loaded until one is picked again. */
  shutCompany: () => void;
}

const AccountingCompanyContext = createContext<AccountingCompanyContextValue | null>(null);

const companyKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

const companyIdentity = (company: Company): string =>
  companyKey(`${company.company_key} ${company.company_name}`);

const preferredCompany = (companies: Company[], preferredKey?: string): Company | undefined => {
  if (preferredKey) {
    const wanted = companyKey(preferredKey);

    // Hospital configuration uses short keys such as "hope" and "ayushman".
    // Resolve those before generic substring matching so "hope" cannot select
    // the separately maintained Hope Pharmacy company.
    if (wanted === 'hope' || wanted.includes('hopemultispecialty')) {
      const hopeHospital = companies.find((company) => {
        const identity = companyIdentity(company);
        return identity.includes('drm') && identity.includes('hope') && identity.includes('hospital');
      });
      if (hopeHospital) return hopeHospital;
    }
    if (wanted.includes('ayushman')) {
      const ayushman = companies.find((company) => companyIdentity(company).includes('ayushman'));
      if (ayushman) return ayushman;
    }
    if (wanted.includes('pharmacy')) {
      const pharmacy = companies.find((company) => companyIdentity(company).includes('hopepharmacy'));
      if (pharmacy) return pharmacy;
    }

    const matched = companies.find((company) => {
      const key = companyKey(company.company_key);
      const name = companyKey(company.company_name);
      return key === wanted || name === wanted || name.includes(wanted) || wanted.includes(name);
    });
    if (matched) return matched;
  }
  const exact = companyKey('DRM Hope Hospital Private Limited');
  return companies.find((company) => companyKey(company.company_name) === exact)
    ?? companies.find((company) => companyKey(company.company_name).includes('drmhopehospital'));
};

export const AccountingCompanyProvider: React.FC<{
  children: React.ReactNode;
  preferredCompanyKey?: string;
}> = ({ children, preferredCompanyKey }) => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyIdState] = useState('');
  // Shutting the company has to be remembered: the auto-select below runs
  // again whenever the company list is refetched, and would otherwise load a
  // company straight back in.
  const [shut, setShut] = useState(false);

  useEffect(() => {
    if (companies.length === 0 || shut) return;
    setSelectedCompanyIdState((current) => {
      if (current && companies.some((company) => company.id === current)) return current;
      return preferredCompany(companies, preferredCompanyKey)?.id ?? companies[0].id;
    });
  }, [companies, preferredCompanyKey, shut]);

  const setSelectedCompanyId = useCallback((companyId: string) => {
    setShut(false);
    setSelectedCompanyIdState(companyId);
  }, []);

  const shutCompany = useCallback(() => {
    setShut(true);
    setSelectedCompanyIdState('');
  }, []);

  const cycleCompany = useCallback(() => {
    if (companies.length === 0) return;
    setShut(false);
    setSelectedCompanyIdState((current) => {
      const currentIndex = companies.findIndex((company) => company.id === current);
      return companies[(currentIndex + 1 + companies.length) % companies.length].id;
    });
  }, [companies]);

  const value = useMemo(
    () => ({ companies, selectedCompanyId, setSelectedCompanyId, cycleCompany, shutCompany }),
    [companies, selectedCompanyId, setSelectedCompanyId, cycleCompany, shutCompany],
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
