import type { HotkeyMod } from './keyboard';

/**
 * Tally's F4–F9 voucher keys, in rail order. Shared by the Voucher Entry rail
 * and the module-wide bindings, so pressing F5 on the Trial Balance opens the
 * same Payment voucher the rail's F5 button does.
 */
export interface VoucherKey {
  hotkey: string;
  mod?: HotkeyMod;
  category: string;
  label: string;
}

export const VOUCHER_KEYS: VoucherKey[] = [
  { hotkey: 'F4', category: 'CONTRA', label: 'Contra' },
  { hotkey: 'F5', category: 'PAYMENT', label: 'Payment' },
  { hotkey: 'F6', category: 'RECEIPT', label: 'Receipt' },
  { hotkey: 'F7', category: 'JOURNAL', label: 'Journal' },
  { hotkey: 'F8', category: 'SALES', label: 'Sales' },
  { hotkey: 'F8', mod: 'ctrl', category: 'CREDIT NOTE', label: 'Credit Note' },
  { hotkey: 'F9', category: 'PURCHASE', label: 'Purchase' },
  { hotkey: 'F9', mod: 'ctrl', category: 'DEBIT NOTE', label: 'Debit Note' },
  // Tally's F10 is a list of the other voucher types; Ctrl+F10 goes straight to
  // Memorandum. Neither voucher type exists in this database yet, so Ctrl+F10
  // draws greyed until someone creates one under Masters → Voucher Type.
  { hotkey: 'F10', mod: 'ctrl', category: 'MEMORANDUM', label: 'Memorandum' },
];

/** Companies label these inconsistently — "CREDIT NOTE" / "CREDIT_NOTE" / … */
export const squashCategory = (value: string | null | undefined): string =>
  (value ?? '').toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Find the voucher type a key opens, matching on the category first and
 * falling back to the type's name: a Credit Note type is sometimes filed under
 * the Sales category, and a greyed Ctrl+F8 next to a working "Credit Note"
 * button lower down the rail is just confusing.
 */
export function voucherTypeFor<T extends { voucher_category?: string | null; voucher_type_name?: string | null }>(
  types: T[],
  category: string,
): T | undefined {
  const want = squashCategory(category);
  return (
    types.find((type) => squashCategory(type.voucher_category) === want) ??
    types.find((type) => squashCategory(type.voucher_type_name).replace('VOUCHER', '') === want)
  );
}
