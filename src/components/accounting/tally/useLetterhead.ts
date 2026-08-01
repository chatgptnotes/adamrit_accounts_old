import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';

/**
 * The company block Tally prints at the top of a voucher or a report.
 *
 * The selected accounting company is the book the figures belong to, so its
 * legal name is the letterhead; the hospital config is the fallback for the
 * screens that render before a company is picked.
 */
export const useTallyLetterhead = (): { orgName: string; addressLines: string[] } => {
  const { hospitalConfig } = useAuth();
  const accountingCompany = useAccountingCompanyOptional();
  const company = accountingCompany?.companies.find((c) => c.id === accountingCompany.selectedCompanyId);
  // Stable across renders — the rail memos that print depend on this.
  return useMemo(
    () => ({
      orgName: company?.company_name || hospitalConfig.fullName,
      addressLines: [company?.address_line1, company?.address_line2].filter(Boolean) as string[],
    }),
    [company?.company_name, company?.address_line1, company?.address_line2, hospitalConfig.fullName],
  );
};
