import React from 'react';
import { TallyPopup } from './TallyPopup';
import { useShortcuts } from './keyboard';

/**
 * Tally's "Delete?  Yes / No" box, in the module's own chrome.
 *
 * Deleting and cancelling a voucher used to go through `window.confirm`, which
 * is a browser dialog: it steals the keyboard entirely, cannot be styled, and
 * on some platforms shows the page's origin above the question. Tally asks in a
 * small box with Y / N on it, and so do we.
 */
export const TallyConfirm: React.FC<{
  title: string;
  message: string;
  onAccept: () => void;
  onClose: () => void;
}> = ({ title, message, onAccept, onClose }) => {
  // Y and N answer as well as A: Accept and Q: Quit, which TallyPopup binds.
  useShortcuts([
    { combo: 'Y', layer: 'popup', label: 'Yes', run: onAccept },
    { combo: 'N', layer: 'popup', label: 'No', run: onClose },
  ]);

  return (
    <TallyPopup title={title} width={300} onAccept={onAccept} onClose={onClose}>
      <div className="py-1 text-center">{message}</div>
      <div className="pt-2 text-center text-[11px] italic text-gray-500">Y: Yes · N: No</div>
    </TallyPopup>
  );
};

export default TallyConfirm;
