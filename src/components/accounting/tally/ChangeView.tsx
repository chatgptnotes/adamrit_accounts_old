import React from 'react';
import { TallyList } from './TallyPopup';

/**
 * H: Change View — Tally's "List of Views": switch the report between Detailed
 * and Condensed, or jump straight to a related report on the same data.
 */

export interface AlternateView {
  label: string;
  /** Accounting tab id opened through the tally-goto event */
  target: string;
}

/** Offered on every screen when it names no closer relatives of its own. */
export const DEFAULT_VIEWS: AlternateView[] = [
  { label: 'Trial Balance', target: 'trial-balance' },
  { label: 'Group Summary', target: 'group-summary' },
  { label: 'Ledger Vouchers', target: 'ledger-view' },
  { label: 'Day Book', target: 'day-book' },
  { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
  { label: 'Balance Sheet', target: 'balance-sheet' },
  { label: 'Profit & Loss A/c', target: 'profit-loss' },
];

const ChangeView: React.FC<{
  detailed: boolean;
  views: AlternateView[];
  onDetailed: (detailed: boolean) => void;
  onClose: () => void;
}> = ({ detailed, views, onDetailed, onClose }) => (
  <TallyList
    title="List of Views"
    onClose={onClose}
    items={[
      { label: 'Detailed', active: detailed, onSelect: () => onDetailed(true) },
      { label: 'Condensed', active: !detailed, onSelect: () => onDetailed(false) },
      ...views.map((v) => ({
        label: v.label,
        onSelect: () => window.dispatchEvent(new CustomEvent('tally-goto', { detail: v.target })),
      })),
    ]}
  />
);

export default ChangeView;
