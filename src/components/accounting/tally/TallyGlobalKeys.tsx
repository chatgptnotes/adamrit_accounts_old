import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useShortcuts, type Binding } from './keyboard';
import { useAccountingPeriod } from './PeriodContext';
import ChangePeriod from './ChangePeriod';
import { CompanyInfoPopup, CompanySelectPopup } from './CompanyPopups';
import TallyCalculator from './TallyCalculator';
import { VOUCHER_KEYS, voucherTypeFor } from './voucherKeys';

/**
 * The keys Tally answers wherever you are: the date and period, the company,
 * the F4–F10 voucher types, and the top-bar actions.
 *
 * These sit on the `global` layer, so a screen that wants a key for itself —
 * the Voucher Entry rail's own F4–F9, a report's F5 — simply declares it and
 * the dispatcher never reaches this far.
 */

const goTo = (target: string) => window.dispatchEvent(new CustomEvent('tally-goto', { detail: target }));
const openVoucher = (category: string) =>
  window.dispatchEvent(new CustomEvent('tally-open-voucher', { detail: category }));

type Popup = null | 'date' | 'period' | 'company' | 'company-info';

const TallyGlobalKeys: React.FC = () => {
  const { period, setPeriod, currentDate, setCurrentDate } = useAccountingPeriod();
  const [popup, setPopup] = useState<Popup>(null);
  const [calculator, setCalculator] = useState(false);

  // A key of its own: the Voucher Entry screen numbers vouchers from a query
  // under `voucher_types` that needs the prefix and counter columns, and a
  // narrower select sharing that key once left it renumbering onto a taken
  // number. This one only ever answers "does this voucher type exist?".
  const { data: voucherTypes = [] } = useQuery({
    queryKey: ['voucher_types_global_keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const bindings = useMemo<Binding[]>(
    () => [
      { combo: 'F2', layer: 'global', label: 'Change the current date', run: () => setPopup('date') },
      { combo: 'Alt+F2', layer: 'global', label: 'Change the reporting period', run: () => setPopup('period') },
      { combo: 'F3', layer: 'global', label: 'Select Company', run: () => setPopup('company') },
      { combo: 'Alt+F3', layer: 'global', label: 'Company Info', run: () => setPopup('company-info') },
      // F4–F9 + Ctrl+F8 / Ctrl+F9 / Ctrl+F10 open that voucher type from
      // anywhere. A type the company has not defined draws greyed and its key
      // is swallowed, exactly as Tally greys an action that does not apply.
      ...VOUCHER_KEYS.map((key): Binding => {
        const type = voucherTypeFor(voucherTypes, key.category);
        return {
          combo: key.mod === 'ctrl' ? `Ctrl+${key.hotkey}` : key.hotkey,
          layer: 'global',
          label: `${key.label} voucher`,
          disabled: !type,
          run: () => openVoucher(key.category),
        };
      }),
      { combo: 'F10', layer: 'global', label: 'Other Vouchers', run: () => goTo('voucher-type-picker') },
      // Tally Prime's top-bar actions. Alt+P prints whatever is on screen;
      // reports and the voucher form override Alt+E / Alt+M with a real export.
      { combo: 'Alt+P', layer: 'global', label: 'Print', run: () => window.print() },
      { combo: 'Alt+E', layer: 'global', label: 'Export', run: () => goTo('tally-import-export') },
      { combo: 'Alt+M', layer: 'global', label: 'E-mail', run: () => goTo('tally-import-export') },
      { combo: 'Alt+O', layer: 'global', label: 'Import', run: () => goTo('tally-import-export') },
      { combo: 'Ctrl+N', layer: 'global', label: 'Calculator', run: () => setCalculator((v) => !v) },
      { combo: 'Ctrl+M', layer: 'global', label: 'Calculator panel', run: () => setCalculator((v) => !v) },
    ],
    [voucherTypes],
  );

  useShortcuts(bindings);

  // The rail's F3 button opens the same list its key does.
  useEffect(() => {
    const onList = () => setPopup('company');
    window.addEventListener('tally-company-list', onList);
    return () => window.removeEventListener('tally-company-list', onList);
  }, []);

  return (
    <>
      {popup === 'date' && (
        <ChangePeriod
          mode="date"
          from={currentDate}
          onAccept={(iso) => {
            setCurrentDate(iso);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'period' && (
        <ChangePeriod
          mode="period"
          from={period.from}
          to={period.to}
          onAccept={(from, to) => {
            setPeriod({ from, to });
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'company' && <CompanySelectPopup onClose={() => setPopup(null)} />}
      {popup === 'company-info' && (
        <CompanyInfoPopup onClose={() => setPopup(null)} onSelectCompany={() => setPopup('company')} />
      )}
      {calculator && <TallyCalculator onClose={() => setCalculator(false)} />}
    </>
  );
};

export default TallyGlobalKeys;
