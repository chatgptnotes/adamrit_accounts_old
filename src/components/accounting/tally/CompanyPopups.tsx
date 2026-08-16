import React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyList, type TallyListItem } from './TallyPopup';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';
import { isMlUnlocked, lockMl, ML_COMPANY_KEY, unlockMl } from '@/lib/ml-lock';

/**
 * Tally's two company pop-ups, shared by every accounting screen.
 *
 * F3 opens the company list; Alt+F3 opens Company Info. Both used to exist
 * only on the Gateway — everywhere else F3 silently rotated to the next
 * company, which is not something Tally has ever done.
 */

/** F3 / F1 on the Gateway — "Select Company", with Tally's Shut Company row. */
export const CompanySelectPopup: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const accountingCompany = useAccountingCompanyOptional();
  const queryClient = useQueryClient();
  const companies = accountingCompany?.companies ?? [];

  // The super admin's private books: hidden from the list until the session
  // password is given; a Lock row hides them again.
  const mlUnlocked = isMlUnlocked();
  const unlockRow: TallyListItem = mlUnlocked
    ? {
        label: 'Lock M.L. Enterprises',
        onSelect: () => {
          lockMl();
          const ml = companies.find((company) => company.company_key === ML_COMPANY_KEY);
          if (ml && accountingCompany?.selectedCompanyId === ml.id) {
            accountingCompany?.shutCompany();
          }
          queryClient.invalidateQueries({ queryKey: ['companies'] });
          toast.info('M.L. Enterprises locked');
          onClose();
        },
      }
    : {
        label: 'M.L. Enterprises  🔒',
        onSelect: async () => {
          const password = window.prompt('Enter the password for M.L. Enterprises');
          if (password === null) return;
          if (!unlockMl(password)) {
            toast.error('Wrong password');
            return;
          }
          queryClient.invalidateQueries({ queryKey: ['companies'] });
          // Select it straight away — the filtered list in memory does not
          // hold its id, so ask the database.
          const { data, error } = await (supabase as any)
            .from('companies')
            .select('id')
            .eq('company_key', ML_COMPANY_KEY)
            .maybeSingle();
          // The unlock itself has already happened. If the follow-up lookup
          // fails we must not claim it is selected — the user would carry on
          // in whichever company was already open.
          if (error || !data?.id) {
            toast.error('Unlocked, but could not select M.L. Enterprises — pick it from the company list (F3).');
            onClose();
            return;
          }
          accountingCompany?.setSelectedCompanyId(data.id);
          toast.success('M.L. Enterprises unlocked for this session');
          onClose();
        },
      };

  const items: TallyListItem[] = [
    ...companies.map((company) => ({
      label: company.company_name,
      active: company.id === accountingCompany?.selectedCompanyId,
      onSelect: () => {
        accountingCompany?.setSelectedCompanyId(company.id);
        onClose();
      },
    })),
    unlockRow,
    {
      label: 'Shut Company',
      disabled: !accountingCompany?.selectedCompanyId,
      onSelect: () => {
        accountingCompany?.shutCompany();
        toast.info('Company shut — pick one with F3 to carry on');
        onClose();
      },
    },
  ];

  return <TallyList title="List of Companies" items={items} onClose={onClose} />;
};

/**
 * Alt+F3 — Company Info.
 *
 * Select and Shut are the two entries this module can honour. Create, Alter,
 * Backup, Restore, Split and Security are drawn greyed, the way Tally greys an
 * action that does not apply: companies here are rows in a hosted database, not
 * folders on disk, and there is no company master screen to alter.
 */
export const CompanyInfoPopup: React.FC<{ onClose: () => void; onSelectCompany: () => void }> = ({
  onClose,
  onSelectCompany,
}) => {
  const accountingCompany = useAccountingCompanyOptional();

  const items: TallyListItem[] = [
    { label: 'Select Company', onSelect: onSelectCompany },
    {
      label: 'Shut Company',
      disabled: !accountingCompany?.selectedCompanyId,
      onSelect: () => {
        accountingCompany?.shutCompany();
        toast.info('Company shut — pick one with F3 to carry on');
        onClose();
      },
    },
    { label: 'Create Company', disabled: true, onSelect: () => {} },
    { label: 'Alter Company', disabled: true, onSelect: () => {} },
    { label: 'Backup', disabled: true, onSelect: () => {} },
    { label: 'Restore', disabled: true, onSelect: () => {} },
    { label: 'Split Company Data', disabled: true, onSelect: () => {} },
    { label: 'Security Control', disabled: true, onSelect: () => {} },
  ];

  return <TallyList title="Company Info" items={items} onClose={onClose} width={320} />;
};
