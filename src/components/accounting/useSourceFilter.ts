import { useState } from 'react';
import type { LedgerSource } from '@/lib/mergedLedgerBalances';

export type SourceFilter = 'all' | 'adamrit' | 'tally';

/** True when a row of the given source should be shown under the active filter. */
export const matchesSource = (rowSource: LedgerSource, filter: SourceFilter): boolean =>
  filter === 'all' || rowSource === filter;

/**
 * Shared "Source: All / Adamrit / Tally" toggle for the merged accounting
 * reports. Returns the current filter plus a ready-made F7 rail button that
 * cycles All → Adamrit → Tally.
 */
export function useSourceFilter() {
  const [source, setSource] = useState<SourceFilter>('all');
  const railItem = {
    hotkey: 'F7',
    label: source === 'all' ? 'Source: All' : source === 'adamrit' ? 'Source: Adamrit' : 'Source: Tally',
    gapBefore: true,
    active: source !== 'all',
    onClick: () => setSource((s) => (s === 'all' ? 'adamrit' : s === 'adamrit' ? 'tally' : 'all')),
  };
  return { source, railItem };
}
