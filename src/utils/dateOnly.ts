import { format } from 'date-fns';

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function stripToDateOnly(value: string): string {
  return value.split('T')[0];
}

export function parseDateOnly(value: string): Date {
  const stripped = stripToDateOnly(value);
  const [year, month, day] = stripped.split('-').map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  return new Date(year, month - 1, day);
}

export function formatDateOnlyForDisplay(
  value: string | null | undefined,
  displayFormat = 'dd/MM/yyyy'
): string {
  if (!value) {
    return '-';
  }

  try {
    return format(parseDateOnly(value), displayFormat);
  } catch {
    return '-';
  }
}
