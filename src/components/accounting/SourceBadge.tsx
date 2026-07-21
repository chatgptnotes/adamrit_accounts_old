import React from 'react';
import type { LedgerSource } from '@/lib/mergedLedgerBalances';

/** Small [T]/[A] tag marking whether a merged row came from Tally or Adamrit. */
const SourceBadge: React.FC<{ source: LedgerSource | 'adamrit' | 'tally' }> = ({ source }) => (
  <span
    className={`ml-1 rounded px-1 text-[9px] font-semibold not-italic align-middle ${
      source === 'tally' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
    }`}
    title={source === 'tally' ? 'From Tally' : 'From Adamrit'}
  >
    {source === 'tally' ? 'T' : 'A'}
  </span>
);

export default SourceBadge;
