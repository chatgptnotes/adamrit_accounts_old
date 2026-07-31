import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useShortcuts } from './tally/keyboard';

interface VoucherType {
  id: string;
  voucher_type_name: string;
  voucher_category: string;
}

interface VoucherTypePickerProps {
  onSelect: (voucherTypeId: string) => void;
  onClose: () => void;
}

/** Tally's first step after Gateway → Vouchers: choose the voucher type. */
const VoucherTypePicker: React.FC<VoucherTypePickerProps> = ({ onSelect, onClose }) => {
  const [cursor, setCursor] = useState(0);
  const { data: voucherTypes = [], isLoading } = useQuery({
    queryKey: ['voucher_types_picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return (data ?? []) as VoucherType[];
    },
  });

  useEffect(() => {
    if (cursor >= voucherTypes.length) setCursor(Math.max(0, voucherTypes.length - 1));
  }, [cursor, voucherTypes.length]);

  useShortcuts([
    {
      combo: 'ArrowDown',
      layer: 'screen',
      label: 'Move the cursor',
      run: () => setCursor((v) => Math.min(v + 1, Math.max(0, voucherTypes.length - 1))),
    },
    { combo: 'ArrowUp', layer: 'screen', run: () => setCursor((v) => Math.max(v - 1, 0)) },
    {
      combo: 'Enter',
      layer: 'screen',
      label: 'Open the highlighted voucher type',
      run: () => {
        const selected = voucherTypes[cursor];
        if (selected) onSelect(selected.id);
      },
    },
  ]);

  return (
    <TallyScreen title="List of Voucher Types" onClose={onClose}>
      <div className="mx-auto max-w-xl overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          Select type of voucher
        </div>
        <div className="bg-[#eef3fa]">
          {isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">Loading voucher types…</div>
          ) : voucherTypes.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No active voucher types found. Create one from Masters → Voucher Type.
            </div>
          ) : (
            voucherTypes.map((type, index) => (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center justify-between border-b border-dashed border-gray-200 px-4 py-2 text-left text-sm ${
                  cursor === index ? 'bg-[#ffc423] font-semibold text-black' : 'hover:bg-[#fdf6d8]'
                }`}
              >
                <span>{type.voucher_type_name}</span>
                <span className="text-xs text-gray-600">{type.voucher_category}</span>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-[#dce6f2] px-3 py-1.5 text-xs text-gray-600">
          <span>↑/↓ Select · Enter Open</span>
          <button type="button" onClick={onClose} className="font-semibold text-[#16437e] hover:underline">
            Esc: Back
          </button>
        </div>
      </div>
    </TallyScreen>
  );
};

export default VoucherTypePicker;
