import React, { useState } from 'react';
import { TallyPopup, TallyChoiceField, TallyTextField } from './TallyPopup';

/**
 * B: Basis of Values — Tally's "Report Details" pop-up. Scales every figure on
 * the report, drops zero / small balances and turns paise on or off.
 */

export const SCALE_FACTORS = ['Full', 'Thousands', 'Lakhs', 'Crores'] as const;
export type ScaleFactor = (typeof SCALE_FACTORS)[number];

export const SCALE_DIVISOR: Record<ScaleFactor, number> = {
  Full: 1,
  Thousands: 1_000,
  Lakhs: 100_000,
  Crores: 10_000_000,
};

export interface ValueBasis {
  scale: ScaleFactor;
  showPaise: boolean;
  hideZero: boolean;
  /** Lines whose amount is below this are dropped (0 = keep everything) */
  minAmount: number;
}

export const DEFAULT_BASIS: ValueBasis = { scale: 'Full', showPaise: true, hideZero: true, minAmount: 0 };

const YES_NO = ['Yes', 'No'] as const;

const BasisOfValues: React.FC<{
  basis: ValueBasis;
  onAccept: (basis: ValueBasis) => void;
  onClose: () => void;
}> = ({ basis, onAccept, onClose }) => {
  const [draft, setDraft] = useState(basis);
  const [minText, setMinText] = useState(String(basis.minAmount || ''));

  return (
    <TallyPopup
      title="Basis of Values"
      width={300}
      onClose={onClose}
      onAccept={() => onAccept({ ...draft, minAmount: Math.abs(Number(minText)) || 0 })}
    >
      <TallyChoiceField
        label="Scale factor"
        value={draft.scale}
        options={SCALE_FACTORS}
        onChange={(scale) => setDraft((d) => ({ ...d, scale }))}
      />
      <TallyChoiceField
        label="Show paise"
        value={draft.showPaise ? 'Yes' : 'No'}
        options={YES_NO}
        onChange={(v) => setDraft((d) => ({ ...d, showPaise: v === 'Yes' }))}
      />
      <TallyChoiceField
        label="Hide zero balances"
        value={draft.hideZero ? 'Yes' : 'No'}
        options={YES_NO}
        onChange={(v) => setDraft((d) => ({ ...d, hideZero: v === 'Yes' }))}
      />
      <TallyTextField label="Amount over" value={minText} onChange={setMinText} />
      <div className="pt-2 text-[11px] italic text-gray-500">↑ ↓ move · ← → or Space change · A accepts</div>
    </TallyPopup>
  );
};

export default BasisOfValues;
