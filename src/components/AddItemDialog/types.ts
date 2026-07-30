import type { ReactNode } from 'react';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'date' | 'custom';
  required?: boolean;
  options?: string[] | { label: string; value: string }[];
  placeholder?: string;
  group?: string;
  colSpan?: number; // 1, 2, 3, or 'full'
  /** For type 'custom': the caller draws the control. Whatever it writes back
   *  through onChange lands in formData under this field's key, so a picker can
   *  store an id here while showing a name. */
  render?: (value: string, onChange: (value: string) => void) => ReactNode;
}

export interface AddItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (formData: Record<string, string>) => void;
  title: string;
  fields: FormField[];
  initialData?: Record<string, string>;
  defaultValues?: Record<string, string>;
}
