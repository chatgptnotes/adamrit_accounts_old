import React, { useState } from 'react';
import { TallyChoiceField, TallyPopup } from './TallyPopup';

/**
 * F12: Configure, per report.
 *
 * Tally's F12 is context-sensitive — the Trial Balance offers "Show Opening
 * Balance", the Day Book offers "Show Narrations", the Balance Sheet offers
 * "Show Vertical Balance Sheet". Each screen declares its own switches through
 * `useTallyReport({ configFields })` and reads the answers back off
 * `report.config`.
 *
 * The two global preferences (open reports Detailed, Day Book month view) stay
 * on the top bar's own Configure dialog — they apply to the whole module.
 */

export interface ReportConfigField {
  key: string;
  label: string;
  /** Value the report opens with (default No) */
  value?: boolean;
}

export type ReportConfig = Record<string, boolean>;

export const defaultsOf = (fields: ReportConfigField[]): ReportConfig =>
  Object.fromEntries(fields.map((f) => [f.key, f.value ?? false]));

const YES_NO = ['Yes', 'No'] as const;

const ReportConfigure: React.FC<{
  fields: ReportConfigField[];
  config: ReportConfig;
  onAccept: (next: ReportConfig) => void;
  onClose: () => void;
}> = ({ fields, config, onAccept, onClose }) => {
  const [draft, setDraft] = useState<ReportConfig>(config);

  return (
    <TallyPopup title="Configuration" width={440} onAccept={() => onAccept(draft)} onClose={onClose}>
      {fields.map((field) => (
        <TallyChoiceField
          key={field.key}
          label={field.label}
          labelWidth={300}
          width={60}
          value={draft[field.key] ? 'Yes' : 'No'}
          options={YES_NO}
          onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v === 'Yes' }))}
        />
      ))}
    </TallyPopup>
  );
};

export default ReportConfigure;
