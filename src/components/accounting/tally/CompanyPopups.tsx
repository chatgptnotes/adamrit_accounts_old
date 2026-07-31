import React from 'react';
import { toast } from 'sonner';
import { TallyList, type TallyListItem } from './TallyPopup';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';

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
  const companies = accountingCompany?.companies ?? [];

  const items: TallyListItem[] = [
    ...companies.map((company) => ({
      label: company.company_name,
      active: company.id === accountingCompany?.selectedCompanyId,
      onSelect: () => {
        accountingCompany?.setSelectedCompanyId(company.id);
        onClose();
      },
    })),
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
