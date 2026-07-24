import React, { useState } from 'react';
import { TallyPopup, TallyChoiceField, TallyTextField } from './TallyPopup';

/**
 * F: Apply Filter — pick a column and the text it must contain.
 * Ctrl+F: Filter Details — the same pop-up listing what is already applied,
 * with D to drop the highlighted filter.
 */

export interface ReportFilter {
  field: string;
  contains: string;
}

const ApplyFilter: React.FC<{
  mode: 'apply' | 'details';
  fields: string[];
  filters: ReportFilter[];
  onAccept: (filters: ReportFilter[]) => void;
  onClose: () => void;
}> = ({ mode, fields, filters, onAccept, onClose }) => {
  const [field, setField] = useState(fields[0] ?? 'Particulars');
  const [contains, setContains] = useState('');

  if (mode === 'details') {
    return (
      <TallyPopup
        title="Filter Details"
        width={340}
        onClose={onClose}
        onAccept={filters.length > 0 ? () => onAccept([]) : undefined}
      >
        {filters.length === 0 ? (
          <div className="py-2 text-center italic text-gray-500">No filter is applied.</div>
        ) : (
          <>
            {filters.map((f, i) => (
              <div key={`${f.field}-${i}`} className="flex items-center py-0.5">
                <span className="w-28 shrink-0">{f.field}</span>
                <span className="pr-2">:</span>
                <span className="min-w-0 flex-1 truncate font-semibold">contains “{f.contains}”</span>
                <button
                  data-tally-field
                  type="button"
                  onClick={() => onAccept(filters.filter((_, j) => j !== i))}
                  className="ml-2 border border-[#c8a020] bg-[#ffe9a8] px-2 text-[12px] font-semibold focus:bg-[#ffd76a] focus:outline-none"
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="pt-2 text-[11px] italic text-gray-500">A clears every filter · ↑ ↓ move</div>
          </>
        )}
      </TallyPopup>
    );
  }

  return (
    <TallyPopup
      title="Apply Filter"
      width={320}
      onClose={onClose}
      onAccept={() => {
        const text = contains.trim();
        onAccept(text ? [...filters.filter((f) => f.field !== field), { field, contains: text }] : filters);
      }}
    >
      <TallyChoiceField label="Column" value={field} options={fields} onChange={setField} width={150} />
      <TallyTextField label="Contains" value={contains} onChange={setContains} width={150} />
      <div className="pt-2 text-[11px] italic text-gray-500">
        Accept with an empty box to leave the filters unchanged.
      </div>
    </TallyPopup>
  );
};

export default ApplyFilter;
