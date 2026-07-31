import { Camera, FileSpreadsheet, type LucideIcon } from 'lucide-react';

/**
 * The four upload lanes on the Government Portal import page, and the colour
 * each one answers to.
 *
 * The page carries two CSV imports and two screenshot uploads, and before this
 * the two of each kind were drawn identically — same icon, same button, same
 * amber card — so telling "Preauth to be Submitted" from "Preauth Pending"
 * meant reading two paragraphs of body text. Each lane now has one colour and
 * one icon, used by both its card at the top of the page and the section
 * itself, so the eye can follow one to the other.
 *
 * Tailwind builds its stylesheet by scanning source for complete class names,
 * so these are written out in full rather than composed at runtime — a
 * `bg-${accent}-50` would simply not exist in the output.
 */

export type ImportLaneKind = 'csv' | 'screenshot';

export interface ImportAccent {
  /** Anchor target, so a card at the top can jump to its section */
  id: string;
  kind: ImportLaneKind;
  /** "CSV import" / "Screenshot" — the badge over the section title */
  kindLabel: string;
  icon: LucideIcon;
  /** Icon chip behind the section title and on the jump card */
  chip: string;
  /** The bar down the left of the section, and the card's top edge */
  bar: string;
  /** Section card border */
  border: string;
  /** Title colour */
  title: string;
  /** Jump-card hover ring */
  ring: string;
  /** Primary button inside the section */
  button: string;
}

export const IMPORT_ACCENTS: Record<string, ImportAccent> = {
  underTreatment: {
    id: 'import-under-treatment',
    kind: 'csv',
    kindLabel: 'CSV import',
    icon: FileSpreadsheet,
    chip: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
    bar: 'bg-indigo-500',
    border: 'border-indigo-200',
    title: 'text-indigo-950',
    ring: 'hover:border-indigo-300 hover:shadow-indigo-100',
    button: 'bg-indigo-600 text-white hover:bg-indigo-700',
  },
  claims: {
    id: 'import-claims',
    kind: 'csv',
    kindLabel: 'CSV import',
    icon: FileSpreadsheet,
    chip: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200',
    bar: 'bg-teal-500',
    border: 'border-teal-200',
    title: 'text-teal-950',
    ring: 'hover:border-teal-300 hover:shadow-teal-100',
    button: 'bg-teal-600 text-white hover:bg-teal-700',
  },
  preauthToSubmit: {
    id: 'import-preauth-to-submit',
    kind: 'screenshot',
    kindLabel: 'Screenshot',
    icon: Camera,
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
    bar: 'bg-amber-500',
    border: 'border-amber-200',
    title: 'text-amber-950',
    ring: 'hover:border-amber-300 hover:shadow-amber-100',
    button: 'bg-amber-600 text-white hover:bg-amber-700',
  },
  preauthPending: {
    id: 'import-preauth-pending',
    kind: 'screenshot',
    kindLabel: 'Screenshot',
    icon: Camera,
    chip: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
    bar: 'bg-fuchsia-500',
    border: 'border-fuchsia-200',
    title: 'text-fuchsia-950',
    ring: 'hover:border-fuchsia-300 hover:shadow-fuchsia-100',
    button: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700',
  },
};
